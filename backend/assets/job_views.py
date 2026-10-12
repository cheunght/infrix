"""Owner-only job control and authenticated result delivery."""
import json
from django.contrib.auth import get_user_model
from django.http import FileResponse
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, OpenApiTypes, OpenApiParameter
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from .background_jobs import KINDS, file_access, public_job, result_file, submit, transition
from .data_scope import scope_endpoint, scope_for
from .organization_access import can
from .runtime_clock import system_now
from .maintenance_gate import authorization_access
from .models import BackgroundJob, NotificationDelivery


JOB_FILTER_PARAMETERS = [
    OpenApiParameter('kind', str, description='任务类型，多个值用逗号分隔'),
    OpenApiParameter('status', str, description='任务状态，多个值用逗号分隔'),
    OpenApiParameter('task_id', int, description='盘点任务 ID，筛选与其他条件取交集'),
    OpenApiParameter('offset', int, description='非负偏移量，每页 30 条'),
]


def filtered_jobs(request, rows):
    """Validated intersections shared by owner history and metadata-only operations."""
    statuses = {"queued", "running", "succeeded", "failed", "cancelled"}
    for field, allowed in (("kind", KINDS), ("status", statuses)):
        if field in request.query_params:
            values = request.query_params[field].split(",")
            if not values or any(value not in allowed for value in values):
                raise ValidationError({field: "不支持的筛选值"})
            rows = rows.filter(**{f"{field}__in": values})
    if "task_id" in request.query_params:
        value = request.query_params["task_id"]
        if not value.isascii() or not value.isdigit() or len(value) > 18 or int(value) <= 0:
            raise ValidationError({"task_id": "必须是正整数"})
        rows = rows.filter(kind="inventory_export").filter(Q(params__task_id=value) | Q(params__task_id=int(value)))
    try:
        offset = int(request.query_params.get("offset", 0))
        if offset < 0:
            raise ValueError
    except (ValueError, TypeError):
        raise ValidationError({"offset": "必须是非负整数"}) from None
    return rows, offset


def require_job_administrator(request, *, write_scope=False):
    scope = scope_for(request.user)
    if not can(request.user, "settings.manage") or not (scope.global_write if write_scope else scope.global_read):
        raise PermissionDenied({"code": "job_authorization_denied", "detail": "需要系统管理权限及全局数据范围"})


@extend_schema(parameters=JOB_FILTER_PARAMETERS, responses=OpenApiTypes.OBJECT, operation_id="system_jobs_list", description="管理员全员任务运行元数据；不提供业务详情或文件。")
@api_view(["GET"])
@scope_endpoint
def system_jobs(request):
    require_job_administrator(request)
    rows, offset = filtered_jobs(request, BackgroundJob.objects.select_related("submitter"))
    return Response({"count": rows.count(), "results": [{
        "id": str(job.pk), "kind": job.kind, "status": job.status,
        "submitter": job.submitter.get_username() if job.submitter else None,
        "created_at": job.created_at, "started_at": job.started_at,
        "finished_at": job.finished_at, "attempts": job.attempts, "error_code": job.error_code,
    } for job in rows[offset:offset + 30]]})


@extend_schema(responses=OpenApiTypes.OBJECT, operation_id="notification_digest_status", description="最近摘要执行及今日投递统计，无收件地址。")
@api_view(["GET"])
@scope_endpoint
def notification_digest_status(request):
    require_job_administrator(request, write_scope=True)
    latest = BackgroundJob.objects.filter(kind="notification_digest").first()
    result = latest.result if latest else {}
    deliveries = {state: 0 for state in ("pending", "sending", "sent", "failed", "unknown")}
    deliveries.update({row["status"]: row["count"] for row in NotificationDelivery.objects.filter(window_date=system_now().date()).values("status").annotate(count=Count("pk")) if row["status"] in deliveries})
    return Response({"date": system_now().date(), "latest_job": None if latest is None else {
        "id": str(latest.pk), "status": latest.status, "created_at": latest.created_at,
        "finished_at": latest.finished_at, "error_code": latest.error_code,
        "result": {key: result[key] for key in ("status", "sent", "failed") if key in result},
    }, "deliveries": deliveries})


@extend_schema(methods=["GET"], parameters=JOB_FILTER_PARAMETERS, responses=OpenApiTypes.OBJECT, description="查询本人后台作业。")
@extend_schema(methods=["POST"], request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT, description="提交本人后台作业。必须提供 Idempotency-Key；输入为 JSON 或带 kind、file 的 multipart。")
@api_view(["GET", "POST"])
@scope_endpoint
def jobs(request):
    if request.method == "GET":
        rows, offset = filtered_jobs(request, BackgroundJob.objects.filter(submitter=request.user))
        return Response({"count": rows.count(), "results": [public_job(job, request.user) for job in rows[offset:offset + 30]]})
    params = request.data.get("params", {})
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except ValueError:
            raise ValidationError({"params": "必须是 JSON 对象"}) from None
    job = submit(request.data.get("kind", ""), params, user=request.user, key=request.headers.get("Idempotency-Key", ""), uploaded=request.FILES.get("file"))
    return Response({"job": public_job(job, request.user)}, status=202)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@scope_endpoint
def job_detail(request, job_id):
    return Response(public_job(get_object_or_404(BackgroundJob, pk=job_id, submitter=request.user), request.user))


@extend_schema(request=None, responses=OpenApiTypes.OBJECT, description="仅排队作业可取消，仅失败作业可重试；执行中取消返回 409。")
@api_view(["POST"])
@scope_endpoint
def job_action(request, job_id, action):
    get_object_or_404(BackgroundJob, pk=job_id, submitter=request.user)
    if action not in {"cancel", "retry"}:
        raise ValidationError({"action": "仅支持 cancel、retry"})
    return Response(public_job(transition(job_id, request.user, action), request.user))


@extend_schema(responses=OpenApiTypes.BINARY, description="本人导出结果；重新校验账号、密码策略、功能和范围。授权或业务记录变化时必须重新导出。")
@api_view(["GET"])
@scope_endpoint
def job_result(request, job_id):
    files = file_access()
    files.__enter__()
    access = authorization_access(request.user.pk)
    try:
        access.__enter__()
    except BaseException:
        files.__exit__(None, None, None)
        raise
    try:
        user = get_user_model().objects.get(pk=request.user.pk)
        job = get_object_or_404(BackgroundJob, pk=job_id, submitter=user)
        response = FileResponse(result_file(job, user), as_attachment=True, filename=f"{job.kind}.xlsx")
        response["Cache-Control"] = "no-store"
        response._resource_closers.append(lambda: access.__exit__(None, None, None))
        response._resource_closers.append(lambda: files.__exit__(None, None, None))
        return response
    except BaseException:
        access.__exit__(None, None, None)
        files.__exit__(None, None, None)
        raise
