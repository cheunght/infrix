from django.contrib import admin
from .models import *


class ReadOnlyInspectionAdmin(admin.ModelAdmin):
    """Allow staff to inspect immutable inventory records without mutation."""

    def get_readonly_fields(self, request, obj=None):
        return tuple(field.name for field in self.model._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_view_permission(self, request, obj=None):
        return super().has_view_permission(request, obj)

    def has_change_permission(self, request, obj=None):
        # Django 5.x uses has_view_permission for the GET inspection page.
        # Keep change permission false for every request, including POST.
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        extra_context = {
            **(extra_context or {}),
            "show_save": False,
            "show_save_and_continue": False,
            "show_save_and_add_another": False,
            "show_close": True,
        }
        return super().changeform_view(request, object_id, form_url, extra_context)


for model in [
    Department,
    DataCenter,
    ServerRoom,
    Rack,
    Manufacturer,
    DeviceType,
    CustomField,
    CustomFieldOption,
    Tag,
    SparePartCategory,
    SparePart,
    SoftwareLicense,
    Asset,
    AssetNetworkAddress,
    AssetCustomValue,
    AssetTag,
    RackUnitAllocation,
    ProcurementRecord,
    MaintenanceContract,
    FaultEvent,
    RepairRecord,
    RepairPartUsage,
    AssetRelation,
    InventoryTask,
    InventoryItem,
]:
    admin.site.register(model, ReadOnlyInspectionAdmin)


@admin.register(SpareStock)
class SpareStockAdmin(ReadOnlyInspectionAdmin):
    list_display = ("part", "data_center", "server_room", "quantity", "updated_at")
    list_filter = ("data_center", "server_room")
    search_fields = (
        "part__name",
        "part__model",
        "data_center__name",
        "server_room__name",
    )
    list_select_related = ("part", "part__category", "data_center", "server_room")


@admin.register(SpareStockTransaction)
class SpareStockTransactionAdmin(ReadOnlyInspectionAdmin):
    list_display = (
        "created_at",
        "part",
        "operation_type",
        "quantity_delta",
        "quantity",
        "before_quantity",
        "after_quantity",
        "source_data_center",
        "target_data_center",
        "operator",
    )
    list_filter = (
        "operation_type",
        "source_data_center",
        "target_data_center",
        "created_at",
    )
    search_fields = (
        "part__name",
        "part__model",
        "reference",
        "notes",
        "operator__username",
    )
    list_select_related = (
        "part",
        "part__category",
        "operator",
        "source_data_center",
        "source_server_room",
        "target_data_center",
        "target_server_room",
    )


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "resource_type", "action", "resource_id")
    list_filter = ("resource_type", "action", "created_at")
    search_fields = ("actor__username", "resource_type", "resource_id")
    readonly_fields = tuple(field.name for field in AuditLog._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
