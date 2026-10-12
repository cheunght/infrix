"""Detached maintenance execution and receipt-only status, outside restored data."""
import fcntl
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from uuid import UUID, uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .account_policy import requires_password_change
from .backups import BACKUP_CONFIRMATION, BACKUP_FILENAME_RE, BackupServiceError, _require_mariadb
from .data_scope import scope_for
from .maintenance_gate import MaintenanceUnavailable, _open_lock, _read_state, _reject_active, _root, _sync_directory
from .organization_access import can

logger = logging.getLogger(__name__)
STATUS_PATH = re.compile(r"^/api/v1/system/backups/operations/[0-9a-f-]{36}/$")


def _path(root, operation_id):
    return root / f"web-{UUID(str(operation_id))}.json"


def _read(path):
    if path.is_symlink():
        raise OSError("unsafe operation record")
    return json.loads(path.read_text())


def _write(path, record):
    temporary = path.parent / f".web-{uuid4().hex}"
    try:
        with temporary.open("x") as handle:
            os.chmod(temporary, 0o600)
            json.dump(record, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _actor(user_id):
    user = get_user_model().objects.filter(pk=user_id, is_active=True).first()
    if user is None or not can(user, "system.reset") or not scope_for(user).global_write or requires_password_change(user):
        raise BackupServiceError("账号权限已变化，未执行维护。", code="maintenance_authorization_denied", status_code=403)
    return user


def _public(record, root):
    value = {key: record.get(key) for key in (
        "id", "kind", "status", "stage", "filename", "started_at", "finished_at", "error_code", "detail", "result",
    )}
    state = _read_state(root)
    own_state = bool(state and state.get("web_operation_id") == record["id"])
    if own_state and record["status"] == "failed" and not state["dirty"]:
        try:
            _reject_active(root)
        except MaintenanceUnavailable:
            pass
        state = _read_state(root)
        own_state = bool(state and state.get("web_operation_id") == record["id"])
    value["maintenance_closed"] = bool(state)
    if own_state and state and record["status"] in {"queued", "running"}:
        value["stage"] = state["stage"]
    if own_state and state and state.get("dirty"):
        value["recovery_required"] = record["status"] == "failed"
        value["safety_backup"] = state.get("safety_backup", "")
    return value


def submit_operation(*, user, kind, operation_id=None, status_token=None, filename="", confirmation=""):
    if kind not in {"backup", "restore"}:
        raise ValueError("unsupported operation")
    _require_mariadb()
    if kind == "restore":
        if confirmation != BACKUP_CONFIRMATION:
            raise BackupServiceError("请输入 RESTORE INFRIX。", code="restore_confirmation_required")
        if not isinstance(filename, str) or not BACKUP_FILENAME_RE.fullmatch(filename):
            raise BackupServiceError("备份文件名无效。", code="backup_not_found", status_code=400)
    try:
        operation_id = str(UUID(str(operation_id))) if operation_id else str(uuid4())
    except (ValueError, TypeError, AttributeError):
        raise BackupServiceError("维护操作标识无效。", code="maintenance_request_invalid") from None
    status_token = status_token or secrets.token_hex(32)
    if not isinstance(status_token, str) or not re.fullmatch(r"[0-9a-f]{64}", status_token):
        raise BackupServiceError("维护状态凭据无效。", code="maintenance_request_invalid")
    digest = hashlib.sha256(status_token.encode()).hexdigest()
    try:
        root = _root()
    except (MaintenanceUnavailable, OSError):
        raise BackupServiceError("维护目录不可用。", code="maintenance_directory_invalid", status_code=503) from None
    path = _path(root, operation_id)
    descriptor = _open_lock(root, "web-operation.lock")
    try:
        if path.exists():
            record = _read(path)
            if record["actor_id"] != user.pk or record["kind"] != kind or record["filename"] != filename or not hmac.compare_digest(record["token_hash"], digest):
                raise BackupServiceError("操作标识已用于其他请求。", code="maintenance_request_conflict", status_code=409)
            return {"operation": _public(record, root), "status_token": status_token}
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupServiceError("另一维护操作正在执行。", code="backup_operation_in_progress", status_code=409) from None
        # Recheck after serialization, including a replay admitted concurrently.
        if path.exists():
            raise BackupServiceError("请求已提交，请查询操作状态。", code="maintenance_request_conflict", status_code=409)
        record = {"id": operation_id, "kind": kind, "status": "queued", "stage": "queued", "filename": filename,
                  "actor_id": user.pk, "token_hash": digest, "started_at": time.time(), "finished_at": None,
                  "error_code": "", "detail": "", "result": {}}
        _write(path, record)
        try:
            log_fd = os.open(root / f"web-{operation_id}.log", os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            try:
                subprocess.Popen(
                    [sys.executable, str(Path(settings.BASE_DIR) / "manage.py"), "run_web_maintenance", operation_id, "--lock-fd", str(descriptor)],
                    cwd=settings.BASE_DIR, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log_fd,
                    pass_fds=(descriptor,), start_new_session=True,
                )
            finally:
                os.close(log_fd)
            # The child owns the inherited lock. Do not unlock this descriptor.
            # Do not rewrite after spawning: the child may already publish completion.
        except OSError:
            record.update(status="failed", error_code="maintenance_start_failed", detail="无法启动维护进程。", finished_at=time.time())
            _write(path, record)
            raise BackupServiceError("无法启动维护进程。", code="maintenance_start_failed", status_code=503) from None
        return {"operation": _public(record, root), "status_token": status_token}
    finally:
        os.close(descriptor)


def execute_operation(operation_id, descriptor):
    from .system_maintenance import create_backup, restore_backup
    root = _root()
    path = _path(root, operation_id)
    record = _read(path)
    try:
        # Validate that the command inherited the submission reservation.
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if record["status"] != "queued":
            return
        record.update(status="running", stage="draining")
        _write(path, record)
        def authorize(window):
            window.stage(window.state["stage"], web_operation_id=record["id"])
            return _actor(record["actor_id"])
        if record["kind"] == "backup":
            result = create_backup(before_operation=authorize)
            result = {"filename": result["filename"]}
        else:
            result = restore_backup(record["filename"], BACKUP_CONFIRMATION, before_operation=authorize)
            result = {key: result[key] for key in ("filename", "safety_backup", "sessions_invalidated")}
        record.update(status="succeeded", stage="completed", result=result)
    except BackupServiceError as exc:
        record.update(status="failed", error_code=exc.code, detail=exc.message)
    except Exception:
        logger.exception("Web maintenance failed", extra={"operation_id": operation_id})
        record.update(status="failed", error_code="maintenance_failed", detail="维护操作失败，请检查服务器日志。")
    finally:
        record["finished_at"] = time.time()
        _write(path, record)
        os.close(descriptor)


@require_GET
def operation_status(request, operation_id):
    # Receipt authorization deliberately performs no session/PAT/database reads.
    # It permits monitoring after restore invalidates sessions or while SQL imports.
    token = request.headers.get("X-Maintenance-Token", "")
    try:
        root = _root()
        path = _path(root, operation_id)
        record = _read(path)
        if not re.fullmatch(r"[0-9a-f]{64}", token) or not hmac.compare_digest(record["token_hash"], hashlib.sha256(token.encode()).hexdigest()) or time.time() - record["started_at"] > 86400:
            raise ValueError("invalid receipt")
        if record["status"] in {"queued", "running"}:
            descriptor = _open_lock(root, "web-operation.lock")
            try:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    # The worker may have completed between our read and acquiring
                    # the lock. Never overwrite its just-published success.
                    record = _read(path)
                    if record["status"] in {"queued", "running"}:
                        record.update(status="failed", error_code="maintenance_worker_interrupted", detail="维护进程已中断，请核对备份与维护状态。", finished_at=time.time())
                        _write(path, record)
            finally:
                os.close(descriptor)
        response = JsonResponse({"operation": _public(record, root)})
    except (MaintenanceUnavailable, OSError, ValueError, KeyError, TypeError):
        response = JsonResponse({"detail": "维护操作不可读取。", "code": "maintenance_operation_unavailable"}, status=404)
    response["Cache-Control"] = "no-store"
    return response
