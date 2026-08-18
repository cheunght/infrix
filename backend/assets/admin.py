from django.contrib import admin
from .models import *

for model in [Department, DataCenter, ServerRoom, Rack, Brand, DeviceType, CustomField, CustomFieldOption, Tag, SparePart, SpareStock, SpareStockTransaction, SoftwareLicense, Asset, AssetNetworkAddress, AssetCustomValue, AssetTag, RackUnitAllocation, ProcurementRecord, MaintenanceContract, FaultEvent, RepairRecord, AssetRelation, InventoryTask, InventoryItem]:
    admin.site.register(model)


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
