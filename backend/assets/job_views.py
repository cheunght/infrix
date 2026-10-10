"""Owner-only job control and authenticated result delivery."""
import json
from django.contrib.auth import get_user_model
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, OpenApiTypes
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from .background_jobs import file_access, public_job, result_file, submit, transition
from .data_scope import scope_endpoint
from .maintenance_gate import authorization_access
from .models import BackgroundJob


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT, description="提交/查询本人后台作业。POST 必须提供 Idempotency-Key；输入为 JSON 或带 kind、file 的 multipart。")
@api_view(["GET", "POST"])
@scope_endpoint
def jobs(request):
    if request.method == "GET":
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (ValueError, TypeError):
            raise ValidationError({"offset": "必须是整数"}) from None
        rows = BackgroundJob.objects.filter(submitter=request.user)
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
