from django.contrib.auth.models import Group


ROLE_SYSTEM_ADMIN = "system_admin"
ROLE_ASSET_ADMIN = "asset_admin"
ROLE_REPAIRER = "repairer"
ROLE_AUDITOR = "auditor"
SYSTEM_RESET_CAPABILITY = "system.reset"

ROLE_DEFINITIONS = {
    ROLE_SYSTEM_ADMIN: {
        "name": "系统管理员",
        "description": "管理全部业务数据、账号和预设角色",
    },
    ROLE_ASSET_ADMIN: {
        "name": "资产管理员",
        "description": "管理资产、许可证、数据字典、数据中心、机房和机柜",
    },
    ROLE_REPAIRER: {
        "name": "维修人员",
        "description": "查看资产和机柜，登记故障并完成维修",
    },
    ROLE_AUDITOR: {
        "name": "只读审计员",
        "description": "查看和导出业务数据，查看操作日志",
    },
}

ROLE_NAME_TO_CODE = {
    definition["name"]: code for code, definition in ROLE_DEFINITIONS.items()
}

ROLE_CAPABILITIES = {
    ROLE_SYSTEM_ADMIN: {"*"},
    ROLE_ASSET_ADMIN: {
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
    },
    ROLE_REPAIRER: {
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
    },
    ROLE_AUDITOR: {
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
    },
}


def ensure_preset_groups():
    return {
        code: Group.objects.get_or_create(name=definition["name"])[0]
        for code, definition in ROLE_DEFINITIONS.items()
    }


def user_role_codes(user):
    """Return recognized preset role codes in stable definition order."""
    if not user or not user.is_authenticated:
        return []
    if user.is_superuser:
        return [ROLE_SYSTEM_ADMIN]
    names = set(user.groups.values_list("name", flat=True))
    return [
        code
        for code, definition in ROLE_DEFINITIONS.items()
        if definition["name"] in names
    ]


def user_role_code(user):
    """Return the stable primary role for legacy display contracts."""
    return next(iter(user_role_codes(user)), None)


def _user_role_capabilities(user):
    return {
        capability
        for code in user_role_codes(user)
        for capability in ROLE_CAPABILITIES.get(code, set())
    }


def user_capabilities(user):
    capabilities = _user_role_capabilities(user)
    if "*" in capabilities:
        capabilities = {
            capability
            for values in ROLE_CAPABILITIES.values()
            for capability in values
            if capability != "*"
        } | {"organization.manage", "audit.view", SYSTEM_RESET_CAPABILITY}
    return sorted(capabilities)


def user_has_capability(user, capability):
    if not user or not user.is_authenticated or not user.is_active:
        return False
    if user.is_superuser:
        return True
    capabilities = _user_role_capabilities(user)
    return "*" in capabilities or capability in capabilities


def preset_group_for_code(code):
    definition = ROLE_DEFINITIONS.get(code)
    if not definition:
        return None
    return Group.objects.filter(name=definition["name"]).first()
