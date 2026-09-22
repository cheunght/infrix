"""Deep authorization module for organization roles and capabilities.

The public interface deliberately hides Django's ``Group`` model.  Group names
are an implementation detail of the current persistence adapter; callers use
stable role codes and capability names instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db.models import Count


ROLE_SYSTEM_ADMIN = "system_admin"
ROLE_ASSET_ADMIN = "asset_admin"
ROLE_REPAIRER = "repairer"
ROLE_AUDITOR = "auditor"
SYSTEM_RESET_CAPABILITY = "system.reset"


@dataclass(frozen=True)
class RoleDefinition:
    code: str
    name: str
    description: str
    capabilities: frozenset[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "name": self.name,
            "description": self.description,
            "capabilities": sorted(self.capabilities),
        }


@dataclass(frozen=True)
class RoleRef:
    code: str
    name: str

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "name": self.name}


@dataclass(frozen=True)
class AuthorizationSnapshot:
    role_codes: tuple[str, ...]
    primary_role_code: str | None
    capabilities: tuple[str, ...]
    is_system_admin: bool

    @property
    def roles(self) -> tuple[RoleRef, ...]:
        return tuple(
            RoleRef(code=code, name=role_definition(code).name)
            for code in self.role_codes
            if role_definition(code) is not None
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "primary_role_code": self.primary_role_code,
            "roles": [role.as_dict() for role in self.roles],
            "capabilities": list(self.capabilities),
            "is_system_admin": self.is_system_admin,
        }


class AuthorizationDenied(PermissionError):
    """Raised by the domain module when a caller lacks a capability."""


class InvalidRoleCode(ValueError):
    """Raised when a caller submits a role code outside the preset catalog."""


class AccountActionDenied(ValueError):
    """Raised when a protected account cannot be changed by an operation."""

    def __init__(self, message: str, *, field: str | None = None, code: str = "protected"):
        super().__init__(message)
        self.field = field
        self.code = code


_ROLE_DEFINITIONS: tuple[RoleDefinition, ...] = (
    RoleDefinition(
        code=ROLE_SYSTEM_ADMIN,
        name="系统管理员",
        description="管理全部业务数据、账号和预设角色",
        capabilities=frozenset({"*"}),
    ),
    RoleDefinition(
        code=ROLE_ASSET_ADMIN,
        name="资产管理员",
        description="管理资产、许可证、数据字典、数据中心、机房和机柜",
        capabilities=frozenset({
            "dashboard.view",
            "assets.view", "assets.manage", "assets.import", "assets.export",
            "racks.view", "racks.manage", "racks.export",
            "licenses.view", "licenses.manage", "licenses.export",
            "spares.view", "spares.manage", "spares.export",
            "custom_fields.view", "custom_fields.manage",
            "tags.view", "tags.manage",
            "faults.view",
            "inventory.view", "inventory.manage", "inventory.export",
            "settings.view", "settings.manage",
        }),
    ),
    RoleDefinition(
        code=ROLE_REPAIRER,
        name="维修人员",
        description="查看资产和机柜，登记故障并完成维修",
        capabilities=frozenset({
            "dashboard.view",
            "assets.view",
            "racks.view",
            "licenses.view",
            "spares.view",
            "custom_fields.view",
            "tags.view",
            "faults.view", "faults.manage", "faults.export",
            "inventory.view",
            "settings.view",
        }),
    ),
    RoleDefinition(
        code=ROLE_AUDITOR,
        name="只读审计员",
        description="查看和导出业务数据，查看操作日志",
        capabilities=frozenset({
            "dashboard.view",
            "assets.view", "assets.export",
            "racks.view", "racks.export",
            "licenses.view", "licenses.export",
            "spares.view", "spares.export",
            "custom_fields.view",
            "tags.view",
            "faults.view", "faults.export",
            "inventory.view", "inventory.export",
            "settings.view",
            "audit.view",
        }),
    ),
)

_DEFINITIONS_BY_CODE = {definition.code: definition for definition in _ROLE_DEFINITIONS}
_CODE_BY_GROUP_NAME = {definition.name: definition.code for definition in _ROLE_DEFINITIONS}


def role_codes() -> tuple[str, ...]:
    return tuple(definition.code for definition in _ROLE_DEFINITIONS)


def role_definition(code: str | None) -> RoleDefinition | None:
    return _DEFINITIONS_BY_CODE.get(code or "")


def role_definitions() -> tuple[RoleDefinition, ...]:
    return _ROLE_DEFINITIONS


def role_group_names() -> frozenset[str]:
    return frozenset(_CODE_BY_GROUP_NAME)


def role_code_for_group_name(name: str | None) -> str | None:
    return _CODE_BY_GROUP_NAME.get(name or "")


def is_preset_role_name(name: str | None) -> bool:
    return role_code_for_group_name(name) is not None


def protect_preset_role_rename(instance) -> None:
    """Keep the Group-backed names immutable at the persistence boundary."""
    if not instance.pk:
        return
    original = Group.objects.filter(pk=instance.pk).values_list("name", flat=True).first()
    if is_preset_role_name(original) and instance.name != original:
        raise ValidationError("预设角色不能重命名")


def protect_preset_role_delete(instance) -> None:
    """Prevent deletion of a preset role through Django's model path."""
    if is_preset_role_name(instance.name):
        raise ValidationError("预设角色不能删除")


def ensure_preset_groups() -> dict[str, Group]:
    return {
        definition.code: Group.objects.get_or_create(name=definition.name)[0]
        for definition in _ROLE_DEFINITIONS
    }


def inspect_role_assignments() -> dict[str, Any]:
    """Return a read-only health report for the Group-backed role adapter."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    preset_names = set(role_group_names())
    present_names = set(Group.objects.filter(name__in=preset_names).values_list("name", flat=True))
    unknown_groups = []
    multiple_roles = []
    for user_id in User.objects.filter(groups__name__in=preset_names).values_list("id", flat=True).distinct():
        names = set(
            Group.objects.filter(user__id=user_id).values_list("name", flat=True)
        )
        recognized = names & preset_names
        if len(recognized) > 1:
            multiple_roles.append(user_id)
    unknown_groups = list(
        Group.objects.exclude(name__in=preset_names).values_list("name", flat=True)
    )
    return {
        "missing_roles": sorted(set(role_group_names()) - present_names),
        "multiple_role_user_ids": sorted(set(multiple_roles)),
        "unknown_group_names": sorted(set(unknown_groups)),
    }


def _recognized_role_codes(user) -> tuple[str, ...]:
    if not user or not user.is_authenticated:
        return ()
    if user.is_superuser:
        return (ROLE_SYSTEM_ADMIN,)
    names = set(user.groups.values_list("name", flat=True))
    return tuple(
        definition.code
        for definition in _ROLE_DEFINITIONS
        if definition.name in names
    )


def read_authorization_snapshot(user) -> AuthorizationSnapshot:
    role_codes_value = _recognized_role_codes(user)
    raw_capabilities = {
        capability
        for code in role_codes_value
        for capability in _DEFINITIONS_BY_CODE[code].capabilities
    }
    is_system_admin = "*" in raw_capabilities
    capabilities = ("*",) if is_system_admin else tuple(sorted(raw_capabilities))
    return AuthorizationSnapshot(
        role_codes=role_codes_value,
        primary_role_code=role_codes_value[0] if role_codes_value else None,
        capabilities=capabilities,
        is_system_admin=is_system_admin,
    )


def can(user, capability: str) -> bool:
    if not user or not user.is_authenticated or not user.is_active:
        return False
    snapshot = read_authorization_snapshot(user)
    return snapshot.is_system_admin or capability in snapshot.capabilities


def require_capability(user, capability: str) -> None:
    if not can(user, capability):
        raise AuthorizationDenied(f"当前角色没有 {capability} 权限")


def preset_group_for_code(code: str) -> Group | None:
    definition = role_definition(code)
    if definition is None:
        return None
    return Group.objects.filter(name=definition.name).first()


def lock_preset_role_rows() -> dict[str, Group]:
    """Create the preset role records and lock the stable reset coordination row."""
    groups = ensure_preset_groups()
    system_group = groups.get(ROLE_SYSTEM_ADMIN)
    if system_group is None:
        raise RuntimeError("系统管理员角色不存在，恢复操作已回滚")
    Group.objects.select_for_update().get(pk=system_group.pk)
    return groups


def delete_non_preset_groups() -> int:
    deleted, _ = Group.objects.exclude(name__in=role_group_names()).delete()
    return deleted


def reset_preserved_administrator_roles(preserved_user_ids) -> dict[str, Group]:
    """Return retained administrator accounts to the canonical preset role."""
    from django.contrib.auth import get_user_model

    groups = ensure_preset_groups()
    system_group = groups[ROLE_SYSTEM_ADMIN]
    User = get_user_model()
    preserved_users = list(User.objects.filter(pk__in=preserved_user_ids))
    if len(preserved_users) != len(set(preserved_user_ids)):
        raise RuntimeError("保留的管理员账号不完整，恢复操作已回滚")
    for user in preserved_users:
        user.groups.set([system_group])
    return groups


def verify_role_bootstrap(actor_id, preserved_user_ids, groups) -> None:
    """Verify role records and retained accounts without exposing Group names."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    expected_codes = set(role_codes())
    if set(groups) != expected_codes:
        raise RuntimeError("系统初始角色不完整，恢复操作已回滚")
    if not User.objects.filter(pk=actor_id, is_active=True).exists():
        raise RuntimeError("执行恢复操作的管理员不存在或已停用，恢复操作已回滚")
    if set(User.objects.filter(pk__in=preserved_user_ids).values_list("pk", flat=True)) != set(preserved_user_ids):
        raise RuntimeError("保留的管理员账号不完整，恢复操作已回滚")


def list_role_definitions(actor) -> list[dict[str, Any]]:
    require_capability(actor, "organization.manage")
    counts = {
        role_code_for_group_name(row["name"]): row["user_count"]
        for row in Group.objects.filter(name__in=role_group_names())
        .annotate(user_count=Count("user"))
        .values("name", "user_count")
    }
    return [
        {**definition.as_dict(), "user_count": counts.get(definition.code, 0)}
        for definition in _ROLE_DEFINITIONS
    ]


def validate_account_action(*, target, action: str, actor) -> None:
    """Validate account lifecycle invariants shared by all user mutations."""
    is_current_user = bool(actor and target.pk == actor.pk)
    if action == "change_role":
        if target.is_superuser:
            raise AccountActionDenied("不能修改超级管理员角色", field="role_code")
        if is_current_user:
            raise AccountActionDenied("不能修改当前登录账号的角色", field="role_code")
        return
    if action == "deactivate":
        if target.is_superuser or is_current_user:
            raise AccountActionDenied("不能停用当前登录账号或超级管理员", field="is_active")
        return
    if action == "delete":
        if is_current_user:
            raise AccountActionDenied("不能删除当前登录账号")
        if target.is_superuser:
            raise AccountActionDenied("不能通过业务接口删除超级管理员")
        from ..ldap_auth import is_directory_managed

        if is_directory_managed(target):
            raise AccountActionDenied(
                "Directory-managed accounts must be removed from the corporate directory first.",
                code="directory_user_protected",
            )
        return
    if action == "reset_password":
        from ..ldap_auth import is_directory_managed

        if is_directory_managed(target):
            raise AccountActionDenied(
                "Directory-managed accounts must change passwords through the corporate directory.",
                code="directory_password_managed",
            )


def assign_role(*, target, role_code: str, actor) -> None:
    require_capability(actor, "organization.manage")
    definition = role_definition(role_code)
    if definition is None:
        raise InvalidRoleCode(role_code)
    current_roles = set(read_authorization_snapshot(target).role_codes) if target.pk else set()
    if current_roles != {role_code}:
        validate_account_action(target=target, action="change_role", actor=actor)
    group = preset_group_for_code(role_code)
    if group is None:
        group = ensure_preset_groups()[role_code]
    target.groups.set([group])


__all__ = [
    "AccountActionDenied",
    "AuthorizationDenied",
    "AuthorizationSnapshot",
    "InvalidRoleCode",
    "ROLE_ASSET_ADMIN",
    "ROLE_AUDITOR",
    "ROLE_REPAIRER",
    "ROLE_SYSTEM_ADMIN",
    "SYSTEM_RESET_CAPABILITY",
    "assign_role",
    "can",
    "ensure_preset_groups",
    "delete_non_preset_groups",
    "is_preset_role_name",
    "inspect_role_assignments",
    "list_role_definitions",
    "lock_preset_role_rows",
    "preset_group_for_code",
    "protect_preset_role_delete",
    "protect_preset_role_rename",
    "read_authorization_snapshot",
    "require_capability",
    "role_code_for_group_name",
    "role_codes",
    "role_definition",
    "role_definitions",
    "role_group_names",
    "reset_preserved_administrator_roles",
    "validate_account_action",
    "verify_role_bootstrap",
]
