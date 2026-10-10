"""Atomic account, password and data-authorization writes; no HTTP responses."""
from uuid import uuid4
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import DatabaseError, transaction
from django.db.models import F, Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError as DRFValidationError
from .audit import write_audit_log
from .data_scope import scope_for
from .ldap_auth import is_directory_managed
from .maintenance_gate import authorization_access
from .models import DataCenter, Department, InventoryTask, Person, PersonalAccessToken, UserDataScope, UserDataScopeRule, UserSecurityProfile
from .organization_access import AccountActionDenied, ROLE_AUDITOR, assign_role, read_authorization_snapshot, require_capability, role_definition, validate_account_action
from .resource_revision import check_revision, ResourceRevisionConflict, ResourceRevisionRequired
from .system_settings import get_runtime_preferences, validate_local_password


def _user_audit_snapshot(user):
    authorization = read_authorization_snapshot(user)
    role_code = authorization.primary_role_code
    definition = role_definition(role_code)
    return {
        "username": user.username,
        "display_name": user.get_full_name() or user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "role_code": role_code,
        "role_codes": list(authorization.role_codes),
        "role_name": definition.name if definition else "",
        "is_active": user.is_active,
    }


def _security_profile(user):
    profile, _ = UserSecurityProfile.objects.get_or_create(
        user=user,
        defaults={
            "must_change_password": False,
            "locale": get_runtime_preferences().default_locale,
        },
    )
    return profile


def _locked_security_profile(user):
    """Return a security profile while tolerating pre-signal user rows."""

    profile = _security_profile(user)
    return UserSecurityProfile.objects.select_for_update().get(pk=profile.pk)


@transaction.atomic
def create_account_fields(validated_data, *, request, record_audit=False):
    validated_data = dict(validated_data)
    actor = getattr(request, "user", None)
    if request is not None:
        require_capability(actor, "organization.manage")
    role_code = validated_data.pop("role_code", ROLE_AUDITOR)
    validated_data.pop("normalize_roles", None)
    password = validated_data.pop("password")
    person = validated_data.pop("person", None)
    if person is not None:
        person = get_object_or_404(Person.objects.select_for_update(), pk=person.pk)
        if not person.is_active or person.account_id is not None:
            raise DRFValidationError({"person_id": "该人员已关联账号或已停用，请重新选择"})
    user = User(**validated_data)
    if person is not None:
        user._selected_person_id = person.pk
    user.set_password(password)
    user.save()
    UserSecurityProfile.objects.update_or_create(
        user=user,
        defaults={"must_change_password": True, "password_changed_at": None},
    )
    assign_role(target=user, role_code=role_code, actor=actor)
    if record_audit:
        write_audit_log(request, action="create", resource_type="user", resource_id=user.pk, after=_user_audit_snapshot(user))
    return user


@transaction.atomic
def update_account_fields(instance, validated_data, *, request, record_audit=False, batch_operation_id=None):
    validated_data = dict(validated_data)
    actor = getattr(request, "user", None)
    if request is not None:
        require_capability(actor, "organization.manage")
    instance = get_object_or_404(User.objects.select_for_update(), pk=instance.pk)
    from .identity_rules import validate_account_attributes
    validate_protected_update(instance, validated_data, request)
    validate_account_attributes(dict(validated_data), instance=instance)
    before = _user_audit_snapshot(instance) if record_audit else None
    role_code = validated_data.pop("role_code", None)
    validated_data.pop("normalize_roles", None)
    for key, value in validated_data.items():
        setattr(instance, key, value)
    instance.save()
    if role_code is not None:
        assign_role(target=instance, role_code=role_code, actor=actor)
    if record_audit:
        write_audit_log(request, action="update", resource_type="user", resource_id=instance.pk, before=before, after=_user_audit_snapshot(instance), extra={"batch_operation_id": batch_operation_id} if batch_operation_id else None)
    return instance


def validate_protected_update(instance, validated_data, request):

    requested_role = validated_data.get("role_code")
    requested_active = validated_data.get("is_active")
    current_role = read_authorization_snapshot(instance).primary_role_code
    try:
        if requested_role is not None and requested_role != current_role:
            validate_account_action(
                target=instance,
                action="change_role",
                actor=getattr(request, "user", None),
            )
        if requested_active is False:
            validate_account_action(
                target=instance,
                action="deactivate",
                actor=getattr(request, "user", None),
            )
    except AccountActionDenied as exc:
        if exc.field:
            raise DRFValidationError({exc.field: str(exc)}) from exc
        raise DRFValidationError(str(exc)) from exc


@transaction.atomic
def edit_account(request, user_id, *, partial=False):
    from .serializers import UserSerializer
    require_capability(request.user, "organization.manage")
    target = get_object_or_404(User.objects.select_for_update(), pk=user_id)

    from .resource_revision import check_revision
    check_revision(_security_profile(target).administration_revision, request.headers.get("If-Match"))
    serializer = UserSerializer(target, data=request.data, partial=partial, context={"request": request, "identity_write_audit": True})
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return serializer.data


@transaction.atomic
def reset_account_password(request, user_id):
    from .serializers import AdminPasswordResetSerializer
    require_capability(request.user, "organization.manage")
    instance = get_object_or_404(User.objects.select_for_update(), pk=user_id)
    try:
        validate_account_action(target=instance, action="reset_password", actor=request.user)
    except AccountActionDenied as exc:
        raise DRFValidationError({"detail": str(exc), "code": exc.code}) from exc
    serializer = AdminPasswordResetSerializer(
        data=request.data,
        context={"user": instance},
    )
    serializer.is_valid(raise_exception=True)
    instance.set_password(serializer.validated_data["new_password"])
    instance.save(update_fields=["password"])
    profile = _security_profile(instance)
    profile.must_change_password = True
    profile.password_changed_at = None
    profile.save(update_fields=["must_change_password", "password_changed_at", "updated_at"])
    revoked_token_count = PersonalAccessToken.objects.filter(
        user=instance, revoked_at__isnull=True,
    ).update(revoked_at=timezone.now())
    write_audit_log(
        request,
        action="update",
        resource_type="user",
        resource_id=instance.pk,
        extra={"password_reset": True, "target_username": instance.username, "revoked_token_count": revoked_token_count},
    )
    return instance


@transaction.atomic
def delete_account(request, user_id):
    require_capability(request.user, "organization.manage")
    instance = get_object_or_404(User.objects.select_for_update(), pk=user_id)
    try:
        validate_account_action(target=instance, action="delete", actor=request.user)
    except AccountActionDenied as exc:
        if exc.code != "protected":
            raise DRFValidationError({"detail": str(exc), "code": exc.code}) from exc
        raise DRFValidationError(str(exc)) from exc
    if InventoryTask.objects.filter(inspector_id=instance.pk).exists():
        raise DRFValidationError("用户仍被盘点任务引用，不能删除")
    before = _user_audit_snapshot(instance)
    resource_id = instance.pk
    try:
        instance.delete()
    except ProtectedError as exc:
        raise DRFValidationError("用户仍被其他业务数据引用，不能删除") from exc
    write_audit_log(
        request,
        action="delete",
        resource_type="user",
        resource_id=resource_id,
        before=before,
    )


def _batch_error_message(error, fallback):
    def flatten(value):
        if isinstance(value, dict): return "；".join(flatten(child) for child in value.values())
        if isinstance(value, (list, tuple)): return "；".join(flatten(child) for child in value)
        return str(value or "")
    return flatten(getattr(error, "detail", error)) or fallback


def batch_account_status(request, validated):
    from .serializers import UserSerializer
    require_capability(request.user, "organization.manage")
    user_ids = validated["ids"]
    is_active = validated["is_active"]
    revisions = validated["revisions"]
    batch_operation_id = str(uuid4())
    results = []
    succeeded = 0

    for user_id in user_ids:
        username = f"ID {user_id}"
        try:
            with transaction.atomic():
                instance = User.objects.select_for_update().get(pk=user_id)
                username = instance.username
                from .resource_revision import check_revision
                check_revision(_security_profile(instance).administration_revision, revisions.get(str(user_id)))
                serializer = UserSerializer(
                    instance=instance,
                    data={"is_active": is_active},
                    partial=True,
                    context={"request": request},
                )
                serializer.is_valid(raise_exception=True)
                serializer.context.update(identity_write_audit=True, batch_operation_id=batch_operation_id)
                serializer.save()
        except User.DoesNotExist:
            results.append({
                "id": user_id,
                "username": username,
                "success": False,
                "code": "NOT_FOUND",
                "reason": "用户不存在或已被删除",
            })
        except (ResourceRevisionConflict, ResourceRevisionRequired) as exc:
            results.append({"id": user_id, "username": username, "success": False,
                "code": "REVISION_CONFLICT" if isinstance(exc, ResourceRevisionConflict) else "REVISION_REQUIRED",
                "reason": str(exc.detail["detail"]), "current_revision": _security_profile(instance).administration_revision})
        except DRFValidationError as exc:
            detail = getattr(exc, "detail", {})
            code = "PROTECTED" if isinstance(detail, dict) and "is_active" in detail else "INVALID_STATE"
            results.append({
                "id": user_id,
                "username": username,
                "success": False,
                "code": code,
                "reason": _batch_error_message(exc, "用户当前不能更新状态"),
            })
        except DatabaseError:
            results.append({
                "id": user_id,
                "username": username,
                "success": False,
                "code": "CONFLICT",
                "reason": "用户状态更新发生并发冲突，请重试",
            })
        else:
            succeeded += 1
            results.append({
                "id": user_id,
                "username": username,
                "success": True,
                "code": "",
                "reason": "",
            })

    response_data = {
        "requested": len(user_ids),
        "succeeded": succeeded,
        "failed": len(user_ids) - succeeded,
        "results": results,
    }
    return response_data


def account_scope_snapshot(target, grant):
    from .serializers import DataScopeSerializer
    data = DataScopeSerializer(grant).data if grant else {}
    if grant is None:
        # The actor can be global; missing target grants still deny.
        data = {"read_data_centers": [], "write_data_centers": [], "global_read": False,
                "global_write": False, "unlocated_read": False, "unlocated_write": False,
                "global_stock_metrics": False, "revision": 0, "read_departments": [], "write_departments": [],
                "all_departments_read": False, "all_departments_write": False, "unowned_read": False, "unowned_write": False, "rules": []}
    centers = list(DataCenter.objects.filter(
        Q(read_scope_grants=grant) | Q(write_scope_grants=grant)
        | Q(read_scope_rules__grant=grant) | Q(write_scope_rules__grant=grant)
    ).distinct().values("id", "name")) if grant else []
    departments = list(Department.objects.filter(Q(read_scope_grants=grant) | Q(write_scope_grants=grant) | Q(read_scope_rules__grant=grant) | Q(write_scope_rules__grant=grant)).distinct().values("id", "name")) if grant else []
    return {**data, "effective": scope_for(target).as_dict(), "center_options": centers, "department_options": departments}


class ScopeWriteError(APIException):
    def __init__(self, status, detail):
        self.status_code = status
        super().__init__(detail)

def replace_account_scope(request, user_id, validated):
    require_capability(request.user, "organization.manage")
    target = get_object_or_404(User, pk=user_id)
    raw_revision = request.headers.get("If-Match", "").strip().strip('"')
    if not raw_revision or len(raw_revision) > 20 or not raw_revision.isascii() or not raw_revision.isdecimal():
        raise ScopeWriteError(428, {"code": "data_scope_revision_required", "detail": "请读取最新授权并提供 If-Match"})
    with authorization_access(target.pk, exclusive=True):
        with transaction.atomic():
            target = get_object_or_404(User.objects.select_for_update(), pk=user_id)
            grant = UserDataScope.objects.select_for_update().filter(user=target).first()
            if int(raw_revision) != (grant.revision if grant else 0):
                raise ScopeWriteError(409, {"code": "data_scope_revision_conflict", "detail": "授权已被修改，请重新加载"})
            before = account_scope_snapshot(target, grant)
            if grant is None:
                grant = UserDataScope(user=target)
            values = dict(validated)
            rule_values = values.pop("rules")
            reads = values.pop("read_data_centers")
            writes = values.pop("write_data_centers")
            department_reads = values.pop("read_departments")
            department_writes = values.pop("write_departments")
            for key, value in values.items():
                setattr(grant, key, value)
            grant.revision = int(raw_revision) + 1
            grant.save()
            grant.read_data_centers.set(reads)
            grant.write_data_centers.set(writes)
            grant.read_departments.set(department_reads)
            grant.write_departments.set(department_writes)
            grant.rules.all().delete()
            for position, data in enumerate(rule_values):
                data = dict(data)
                memberships = {field: data.pop(field) for field in (
                    "read_data_centers", "write_data_centers", "read_departments", "write_departments")}
                rule = UserDataScopeRule.objects.create(grant=grant, position=position, **data)
                for field, members in memberships.items():
                    getattr(rule, field).set(members)
            after = account_scope_snapshot(target, grant)
            write_audit_log(request, action="update", resource_type="user_data_scope", resource_id=target.pk,
                            before=before, after=after)
        return after


@transaction.atomic
def update_own_profile(request, validated):
    user = get_object_or_404(User.objects.select_for_update(), pk=request.user.pk)
    request.user = user
    from .resource_revision import check_revision
    check_revision(_security_profile(user).administration_revision, request.headers.get("If-Match"))
    before = _user_audit_snapshot(user)
    user_fields = [field for field in ("first_name", "last_name", "email") if field in validated]
    for field in user_fields:
        setattr(user, field, validated[field])
    if user_fields:
        user.save(update_fields=user_fields)
    if "locale" in validated:
        profile = _security_profile(user)
        locale_changed = profile.locale != validated["locale"]
        profile.locale = validated["locale"]
        profile.save(update_fields=["locale", "updated_at"])
        if locale_changed:
            UserSecurityProfile.objects.filter(pk=profile.pk).update(administration_revision=F("administration_revision") + 1)
            user._state.fields_cache.pop("security_profile", None)
    write_audit_log(
        request,
        action="update",
        resource_type="user",
        resource_id=user.pk,
        before=before,
        after=_user_audit_snapshot(user),
        extra={"profile_update": True},
    )
    return user


@transaction.atomic
def change_own_password(request):
    request.user = get_object_or_404(User.objects.select_for_update(), pk=request.user.pk)
    if is_directory_managed(request.user):
        raise DRFValidationError({'detail': 'Directory-managed accounts must change passwords through the corporate directory.', 'code': 'directory_password_managed'})
    old_password = request.data.get('old_password', '')
    new_password = request.data.get('new_password', '')
    confirm_password = request.data.get('confirm_password')
    if not request.user.check_password(old_password):
        raise DRFValidationError({'detail': '原密码错误'})
    if not new_password:
        raise DRFValidationError({'new_password': ['新密码不能为空']})
    if confirm_password is not None and new_password != confirm_password:
        raise DRFValidationError({'confirm_password': ['两次输入的新密码不一致']})
    if request.user.check_password(new_password):
        raise DRFValidationError({'new_password': ['新密码不能与当前密码相同']})
    try:
        validate_local_password(new_password, user=request.user)
    except DjangoValidationError as exc:
        raise DRFValidationError({'new_password': list(exc.messages)})
    request.user.set_password(new_password)
    request.user.save(update_fields=['password'])
    profile = _security_profile(request.user)
    profile.must_change_password = False
    profile.password_changed_at = timezone.now()
    profile.save(update_fields=['must_change_password', 'password_changed_at', 'updated_at'])
    write_audit_log(request, action='update', resource_type='user', resource_id=request.user.pk, extra={'password_change': True})
    update_session_auth_hash(request, request.user)
    return request.user
