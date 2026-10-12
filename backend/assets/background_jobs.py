"""Durable queue for one host. DB commits fence business facts; flocks fence workers.

Imports commit as a whole file with their job result. SMTP keeps its existing
recipient claims outside that transaction, including indeterminate deliveries.
Only explicit operations are executable; submitted paths/code are never used.
"""
import contextlib
import fcntl
import hashlib
import json
import logging
import os
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.db.models import Count, Max
from django.http import HttpRequest, QueryDict
from django.utils import timezone
from django.utils.datastructures import MultiValueDict
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.request import Request

from . import data_scope
from .account_policy import enforce_api_password_policy
from .maintenance_gate import _open_lock, _root, authorization_access, business_access
from .models import AuditLog, BackgroundJob
from .idempotency import IdempotencyConflict
from .organization_access import can, read_authorization_snapshot

logger = logging.getLogger(__name__)
MAX_INPUT_BYTES = 10 * 1024 * 1024
IMPORTS = {"asset_import", "asset_model_import", "people_import", "department_import"}
EXPORTS = {"asset_export", "asset_model_export", "repair_record_export", "license_export", "spare_part_export", "spare_transaction_export", "rack_layout_export", "inventory_export", "audit_export"}
KINDS = IMPORTS | EXPORTS | {"notification_digest"}


class JobConflict(APIException):
    status_code = 409
    default_detail = {"code": "job_state_conflict", "detail": "作业状态不允许此操作，请刷新状态"}


@contextlib.contextmanager
def file_access(*, exclusive=False):
    descriptor = _open_lock(_root(), "job-files.lock")
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield
    finally:
        os.close(descriptor)


@contextlib.contextmanager
def execution_access(job_id):
    descriptor = _open_lock(_root(), f"job-{job_id}.lock")
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def authorization_fingerprint(user):
    return hashlib.sha256(json.dumps({"scope": asdict(data_scope.scope_for(user)), "roles": asdict(read_authorization_snapshot(user))}, sort_keys=True).encode()).hexdigest()


def data_epoch():
    # Conservative result invalidation: any audited business change requires a
    # fresh export. This also covers records moved outside an unchanged grant.
    value = AuditLog.objects.aggregate(count=Count("pk"), latest=Max("pk"))
    return f"{value['count']}:{value['latest']}"


def _operation_request(kind, user, params, uploaded=None):
    raw = HttpRequest()
    raw.method = "POST" if kind in IMPORTS else "GET"
    raw.path = raw.path_info = "/api/v1/jobs/execute/"
    raw.GET = QueryDict("", mutable=True)
    for key, value in params.items():
        raw.GET[key] = str(value)
    raw.user = user
    # The queue has already admitted this actor and owns the transaction.
    raw._data_scope_access = contextlib.nullcontext()
    raw._data_scope_read_access = contextlib.nullcontext()
    request = Request(raw)
    request.user = user
    request._data = MultiValueDict()
    request._files = MultiValueDict({"file": [uploaded]} if uploaded is not None else {})
    request._full_data = request._files
    return request


def _operation_view(kind, params):
    from . import views
    if kind in {"inventory_export", "audit_export"}:
        view = views.InventoryTaskViewSet() if kind == "inventory_export" else views.AuditLogViewSet()
        view.action = "export"
        view.args = ()
        view.kwargs = {"pk": params.get("task_id")} if kind == "inventory_export" else {}
    else:
        view = getattr(views, kind).cls()
        view.kwargs = {}
    return view


def authorize(kind, user, params):
    if not isinstance(kind, str) or kind not in KINDS:
        raise ValidationError({"code": "job_kind_invalid", "detail": "不支持的作业类型"})
    if user is None:
        if kind != "notification_digest":
            raise PermissionDenied()
        return
    if not user.is_active:
        raise PermissionDenied({"code": "job_authorization_denied", "detail": "提交账号已停用"})
    request = _operation_request(kind, user, params)
    enforce_api_password_policy(request, user)
    if kind == "notification_digest":
        if not can(user, "settings.manage") or not data_scope.scope_for(user).global_write:
            raise PermissionDenied()
        return
    view = _operation_view(kind, params)
    view.request = request
    view.check_permissions(request)
    if kind in IMPORTS - {"asset_import"} and not data_scope.scope_for(user).global_write:
        raise PermissionDenied({"code": "data_scope_global_required", "detail": "目录导入需要全局写入范围"})
    if kind == "inventory_export":
        from .models import InventoryTask
        from django.shortcuts import get_object_or_404
        data_scope.require_object(get_object_or_404(InventoryTask, pk=params["task_id"]), write=False)


def _validate_params(kind, params):
    if not isinstance(params, dict) or len(params) > 80:
        raise ValidationError({"params": "筛选条件必须为对象，最多 80 项"})
    if any(not isinstance(key, str) or len(key) > 100 or not isinstance(value, (str, int, bool)) or len(str(value)) > 1000 for key, value in params.items()):
        raise ValidationError({"params": "筛选项仅支持长度受限的字符串、整数或布尔值"})
    if kind in IMPORTS and params:
        raise ValidationError({"params": "导入作业不接受筛选条件"})
    if kind == "inventory_export" and (not str(params.get("task_id", "")).isdigit() or int(params["task_id"]) <= 0):
        raise ValidationError({"params": "盘点导出需要 task_id"})


def _file_path(name):
    path = Path(settings.MEDIA_ROOT) / name
    root = Path(settings.MEDIA_ROOT).resolve()
    if not name.startswith("job-files/") or path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValidationError({"code": "job_file_invalid", "detail": "作业文件路径无效"})
    return path


def _write_file(content, suffix):
    name = f"job-files/{uuid4().hex}.{suffix}"
    path = _file_path(name)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return name


def submit(kind, params, *, user, key, uploaded=None):
    if not isinstance(kind, str) or kind not in KINDS:
        raise ValidationError({"code": "job_kind_invalid", "detail": "不支持的作业类型"})
    _validate_params(kind, params)
    authorize(kind, user, params)
    if not key or len(key) > 128 or not all(33 <= ord(char) <= 126 for char in key):
        raise ValidationError({"code": "idempotency_key_required", "detail": "作业提交需要 1–128 位可见 ASCII Idempotency-Key；重试复用原键"})
    content = b""
    if kind in IMPORTS:
        if uploaded is None or uploaded.size > MAX_INPUT_BYTES:
            raise ValidationError({"file": "请选择不超过 10 MiB 的 XLSX 文件"})
        content = uploaded.read(MAX_INPUT_BYTES + 1)
        if len(content) > MAX_INPUT_BYTES:
            raise ValidationError({"file": "文件超过 10 MiB"})
    payload = json.dumps({"kind": kind, "params": params, "input": hashlib.sha256(content).hexdigest()}, sort_keys=True)
    payload_hash = hashlib.sha256(payload.encode()).hexdigest()
    identity = hashlib.sha256(f"{user.pk if user else 'scheduler'}:{key}".encode()).hexdigest()
    with file_access():
        previous = BackgroundJob.objects.filter(idempotency_key=identity).first()
        if previous:
            if previous.payload_hash != payload_hash:
                raise IdempotencyConflict()
            return previous
        name = _write_file(content, "xlsx") if kind in IMPORTS else ""
        try:
            with transaction.atomic():
                return BackgroundJob.objects.create(kind=kind, params=params, submitter=user, idempotency_key=identity, payload_hash=payload_hash, input_file=name, authorization=authorization_fingerprint(user) if user else "")
        except IntegrityError:
            if name:
                _file_path(name).unlink(missing_ok=True)
            previous = BackgroundJob.objects.get(idempotency_key=identity)
            if previous.payload_hash != payload_hash:
                raise IdempotencyConflict()
            return previous
        except BaseException:
            if name:
                _file_path(name).unlink(missing_ok=True)
            raise


@contextlib.contextmanager
def actor_access(job):
    with contextlib.ExitStack() as stack:
        if job.submitter_id:
            stack.enter_context(authorization_access(job.submitter_id))
            user = get_user_model().objects.filter(pk=job.submitter_id).first()
            if user is None:
                raise PermissionDenied()
        else:
            user = None
        actor = data_scope._actor.set(user)
        scope = data_scope._scope_snapshot.set(None)
        try:
            authorize(job.kind, user, job.params)
            if user and job.authorization != authorization_fingerprint(user):
                raise PermissionDenied({"code": "job_authorization_changed", "detail": "授权已变化，请按当前权限重新提交或重试"})
            yield user
        finally:
            data_scope._scope_snapshot.reset(scope)
            data_scope._actor.reset(actor)


def _execute(job, user):
    from .notification_delivery import send_digest
    if job.kind == "notification_digest":
        return send_digest(), ""
    with contextlib.ExitStack() as stack:
        uploaded = None
        if job.input_file:
            from django.core.files.uploadedfile import UploadedFile
            handle = stack.enter_context(_file_path(job.input_file.name).open("rb"))
            content = handle.read(MAX_INPUT_BYTES + 1)
            payload = json.dumps({"kind": job.kind, "params": job.params, "input": hashlib.sha256(content).hexdigest()}, sort_keys=True)
            if len(content) > MAX_INPUT_BYTES or hashlib.sha256(payload.encode()).hexdigest() != job.payload_hash:
                raise ValidationError({"code": "job_input_changed", "detail": "作业输入文件已变化，请重新提交"})
            handle.seek(0)
            uploaded = UploadedFile(handle, name="input.xlsx", size=os.fstat(handle.fileno()).st_size)
        request = _operation_request(job.kind, user, job.params, uploaded)
        view = _operation_view(job.kind, job.params)
        view.request = request
        if job.kind in {"inventory_export", "audit_export"}:
            response = view.export(request, **view.kwargs)
        else:
            response = getattr(view, request.method.lower())(request)
        if response.status_code >= 400:
            raise ValidationError(getattr(response, "data", {"detail": "作业校验失败"}))
        if job.kind in EXPORTS:
            return {}, _write_file(response.content, "xlsx")
        return json.loads(json.dumps(response.data, cls=DjangoJSONEncoder)), ""


def run_one():
    """Execute/recover one job. Running rows are recoverable only without a flock.

    No age-based lease stealing: a slow live worker retains its file lock.
    Process death releases it and rolls back any incomplete whole-file import.
    """
    with business_access(), file_access():
        for job_id in BackgroundJob.objects.filter(status__in=["queued", "running"]).order_by("created_at", "id").values_list("pk", flat=True).iterator():
            try:
                with execution_access(job_id):
                    with transaction.atomic():
                        job = BackgroundJob.objects.select_for_update().get(pk=job_id)
                        if job.status not in {"queued", "running"}:
                            continue
                        job.status = "running"
                        job.attempts += 1
                        job.started_at = timezone.now()
                        job.progress = 10
                        job.checkpoint = "executing"
                        job.save()
                    output = ""
                    try:
                        with actor_access(job) as user:
                            # SMTP's recipient claims must survive process death;
                            # import mutations and job completion must commit together.
                            if job.kind == "notification_digest":
                                result, output = _execute(job, user)
                                with transaction.atomic():
                                    _complete(job, result, output)
                            else:
                                if job.kind in EXPORTS and not transaction.get_connection().in_atomic_block and transaction.get_connection().vendor == "mysql":
                                    with transaction.get_connection().cursor() as cursor:
                                        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                                with transaction.atomic():
                                    result, output = _execute(job, user)
                                    _complete(job, result, output)
                    except Exception as exc:
                        if output:
                            _file_path(output).unlink(missing_ok=True)
                        job.status = "failed"
                        job.progress = 100
                        job.checkpoint = "failed"
                        job.finished_at = timezone.now()
                        job.result = {}
                        job.result_file = ""
                        job.result_epoch = data_epoch()
                        job.error_code = "job_authorization_denied" if isinstance(exc, PermissionDenied) else "job_validation_failed" if isinstance(exc, ValidationError) else "job_execution_failed"
                        # Unknown exceptions may contain SQL/input/secrets. Keep
                        # only a public code; validation details remain owner-scoped.
                        if isinstance(exc, (ValidationError, PermissionDenied)):
                            job.result = {"detail": json.loads(json.dumps(exc.detail, cls=DjangoJSONEncoder))}
                        job.save()
                        logger.warning("Background job %s failed (%s)", job.id, job.error_code)
                    return True
            except BlockingIOError:
                continue
            except BackgroundJob.DoesNotExist:
                continue
    return False


def _complete(job, result, output):
    job.result = result
    job.result_file = output
    job.result_epoch = data_epoch() if job.kind in EXPORTS else ""
    job.status = "succeeded"
    job.progress = 100
    job.checkpoint = "committed"
    job.error_code = ""
    job.finished_at = timezone.now()
    job.save()


def transition(job_id, user, action):
    from django.shortcuts import get_object_or_404
    try:
        with file_access(), execution_access(job_id), transaction.atomic():
            job = get_object_or_404(BackgroundJob.objects.select_for_update(), pk=job_id, submitter=user)
            if action == "cancel" and job.status == "queued":
                job.status = "cancelled"
                job.progress = 100
                job.checkpoint = "cancelled_before_execution"
                job.finished_at = timezone.now()
            elif action == "retry" and job.status == "failed":
                authorize(job.kind, user, job.params)
                job.authorization = authorization_fingerprint(user)
                job.status = "queued"
                job.progress = 0
                job.checkpoint = "queued"
                job.error_code = ""
                job.result = {}
                job.finished_at = None
            else:
                raise JobConflict()
            job.save()
            return job
    except BlockingIOError:
        raise JobConflict() from None


def public_job(job, user):
    current = job.authorization == authorization_fingerprint(user)
    fresh = job.result_epoch == data_epoch()
    reason = ""
    if job.kind in EXPORTS and job.status == "succeeded":
        if not current:
            reason = "job_authorization_changed"
        elif not fresh:
            reason = "job_result_stale"
        elif not job.result_file or not _file_path(job.result_file.name).is_file():
            reason = "job_result_missing"
    return {"id": str(job.pk), "kind": job.kind, "status": job.status, "progress": job.progress, "checkpoint": job.checkpoint, "attempts": job.attempts, "created_at": job.created_at, "started_at": job.started_at, "finished_at": job.finished_at, "error_code": job.error_code, "result": job.result if current and (job.status != "failed" or fresh) else {}, "result_available": bool(job.result_file and current and fresh and not reason), "result_unavailable_reason": reason, "params": job.params if current and job.kind in EXPORTS else None, "task_id": job.params.get("task_id") if current and job.kind == "inventory_export" else None}


def suppress_restored_notifications():
    """SMTP acceptance cannot be rolled back with SQL. Never auto-send restored work."""
    from .runtime_clock import system_now
    with transaction.atomic():
        BackgroundJob.objects.filter(kind="notification_digest", status__in=["queued", "running"]).update(status="cancelled", progress=100, checkpoint="cancelled_after_restore", finished_at=timezone.now())
        job = submit("notification_digest", {}, user=None, key=f"daily-digest:{system_now().date()}")
        if job.status == "queued":
            job.status = "cancelled"
            job.checkpoint = "cancelled_after_restore"
            job.progress = 100
            job.finished_at = timezone.now()
            job.save()


def result_file(job, user):
    authorize(job.kind, user, job.params)
    if job.authorization != authorization_fingerprint(user):
        raise PermissionDenied({"code": "job_authorization_changed", "detail": "授权变化后需要重新生成导出"})
    if job.status != "succeeded" or not job.result_file:
        raise JobConflict()
    if job.result_epoch != data_epoch():
        raise PermissionDenied({"code": "job_result_stale", "detail": "业务记录已变化，请重新生成导出"})
    try:
        return _file_path(job.result_file.name).open("rb")
    except FileNotFoundError:
        raise JobConflict({"code": "job_result_missing", "detail": "作业文件缺失，请重新导出"}) from None


def clean_jobs(days):
    """Delete terminal records/files and reconcile files left by killed writers."""
    from datetime import timedelta
    with business_access(), file_access(exclusive=True):
        with transaction.atomic():
            rows = BackgroundJob.objects.filter(status__in=["succeeded", "failed", "cancelled"], finished_at__lt=timezone.now() - timedelta(days=days))
            count = rows.count()
            rows.delete()
        referenced = set(BackgroundJob.objects.exclude(input_file="").values_list("input_file", flat=True)) | set(BackgroundJob.objects.exclude(result_file="").values_list("result_file", flat=True))
        root = _file_path("job-files/placeholder").parent
        removed = 0
        if root.exists():
            for path in root.iterdir():
                name = f"job-files/{path.name}"
                if name not in referenced and path.is_file() and not path.is_symlink():
                    _file_path(name).unlink()
                    removed += 1
        return count, removed
