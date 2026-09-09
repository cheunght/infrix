from rest_framework.permissions import BasePermission, SAFE_METHODS

from .roles import user_has_capability


class BusinessRolePermission(BasePermission):
    message = "当前角色没有执行此操作的权限"

    def has_permission(self, request, view):
        resource = getattr(view, "permission_resource", None)
        if not resource:
            return bool(request.user and request.user.is_authenticated)
        action = getattr(view, "action", None)
        capability = (
            f"{resource}.view"
            if request.method in SAFE_METHODS or action in {"list", "retrieve"}
            else f"{resource}.manage"
        )
        return user_has_capability(request.user, capability)


class CanViewAssetCustomFieldSchema(BasePermission):
    message = "当前角色没有读取资产业务字段 Schema 的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "assets.view") or user_has_capability(
            request.user, "assets.manage"
        )


class CanViewAssetTagsRuntime(BasePermission):
    """Allow asset users to read tags without granting tag administration."""

    message = "当前角色没有读取资产标签的权限"

    def has_permission(self, request, view):
        return any(
            user_has_capability(request.user, capability)
            for capability in ("tags.view", "tags.manage", "assets.view", "assets.manage")
        )


class CanViewManufacturerRuntime(BasePermission):
    """Allow business forms to read manufacturers without granting dictionary CRUD."""

    message = "当前角色没有读取厂商的权限"

    def has_permission(self, request, view):
        return any(
            user_has_capability(request.user, capability)
            for capability in (
                "assets.view",
                "assets.manage",
                "licenses.view",
                "licenses.manage",
                "spares.view",
                "spares.manage",
                "settings.view",
                "settings.manage",
            )
        )


class CanViewDepartmentRuntime(BasePermission):
    """Allow asset workflows to read departments without granting CRUD."""

    message = "当前角色没有读取部门的权限"

    def has_permission(self, request, view):
        return any(
            user_has_capability(request.user, capability)
            for capability in (
                "assets.view",
                "assets.manage",
                "settings.view",
                "settings.manage",
            )
        )


class CanViewPeopleRuntime(BasePermission):
    """Allow asset workflows to choose people without exposing directory CRUD."""

    message = "当前角色没有读取使用人的权限"

    def has_permission(self, request, view):
        return any(
            user_has_capability(request.user, capability)
            for capability in (
                "assets.view",
                "assets.manage",
                "settings.view",
                "settings.manage",
            )
        )


class CanViewSparePartCategoryRuntime(BasePermission):
    """Allow spare part forms to read categories without granting dictionary CRUD."""

    message = "当前角色没有读取备件类型的权限"

    def has_permission(self, request, view):
        return any(
            user_has_capability(request.user, capability)
            for capability in ("spares.view", "spares.manage", "settings.manage")
        )


class IsSystemAdministrator(BasePermission):
    message = "仅系统管理员可以执行此操作"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "organization.manage")


class CanResetSystem(BasePermission):
    message = "当前账号没有执行系统恢复的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "system.reset")


class CanManageSystemSettings(BasePermission):
    """Use the existing settings view/manage capabilities by HTTP method."""

    message = "当前角色没有系统设置权限"

    def has_permission(self, request, view):
        capability = "settings.view" if request.method in SAFE_METHODS else "settings.manage"
        return user_has_capability(request.user, capability)


class CanImportAssets(BasePermission):
    message = "当前角色没有资产管理权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "assets.manage")


class CanExportAssets(BasePermission):
    message = "当前角色没有导出资产的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "assets.export")


class CanExportRacks(BasePermission):
    message = "当前角色没有导出机柜的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "racks.export")


class CanExportFaults(BasePermission):
    message = "当前角色没有导出维修记录的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "faults.export")


class CanExportLicenses(BasePermission):
    message = "当前角色没有导出软件许可的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "licenses.export")


class CanExportSpares(BasePermission):
    message = "当前角色没有导出备件的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "spares.export")


class CanViewAuditLog(BasePermission):
    message = "当前角色没有查看操作日志的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "audit.view")


class CanViewDashboard(BasePermission):
    message = "当前角色没有查看仪表盘的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "dashboard.view")


class CanViewLicenses(BasePermission):
    message = "当前角色没有查看软件许可的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "licenses.view")


class CanViewInventory(BasePermission):
    message = "当前角色没有查看盘点任务的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "inventory.view")


class CanManageInventory(BasePermission):
    message = "当前角色没有管理盘点任务的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "inventory.manage")


class CanExportInventory(BasePermission):
    message = "当前角色没有导出盘点结果的权限"

    def has_permission(self, request, view):
        return user_has_capability(request.user, "inventory.export")
