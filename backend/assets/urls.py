from rest_framework.routers import DefaultRouter
from django.urls import path
from .views import AuditLogViewSet, AssetViewSet, CustomFieldOptionViewSet, CustomFieldViewSet, DataCenterViewSet, DeviceTypeViewSet, FaultEventViewSet, GroupViewSet, InventoryItemViewSet, InventoryTaskViewSet, ManufacturerViewSet, RackViewSet, RepairRecordViewSet, ServerRoomViewSet, SoftwareLicenseViewSet, SparePartCategoryViewSet, SparePartViewSet, SpareStockViewSet, SpareStockTransactionViewSet, TagViewSet, UserViewSet, alerts_overview, asset_inventory_records, dashboard_overview, facilities_summary, inventory_inspectors, license_export, license_summary, repair_record_export, rack_layout_export, spare_part_export, spare_transaction_export, auth_login, auth_me, auth_logout, auth_csrf, auth_change_password, auth_ldap_status, auth_ldap_config, auth_ldap_diagnostics, system_reset, system_settings, asset_import, asset_import_preview, asset_import_template, asset_export

router = DefaultRouter()
router.register("assets", AssetViewSet)
router.register("racks", RackViewSet)
router.register("server-rooms", ServerRoomViewSet, basename="server-room")
router.register("data-centers", DataCenterViewSet, basename="data-center")
router.register("manufacturers", ManufacturerViewSet, basename="manufacturer")
router.register("device-types", DeviceTypeViewSet, basename="device-type")
router.register("spare-part-categories", SparePartCategoryViewSet, basename="spare-part-category")
router.register("custom-fields", CustomFieldViewSet, basename="custom-field")
router.register("custom-field-options", CustomFieldOptionViewSet, basename="custom-field-option")
router.register("tags", TagViewSet, basename="tag")
router.register("users", UserViewSet, basename="user")
router.register("roles", GroupViewSet, basename="role")
router.register("fault-events", FaultEventViewSet)
router.register("repair-records", RepairRecordViewSet)
router.register("licenses", SoftwareLicenseViewSet)
router.register("spare-parts", SparePartViewSet, basename="spare-part")
router.register("spare-stocks", SpareStockViewSet, basename="spare-stock")
router.register("spare-transactions", SpareStockTransactionViewSet, basename="spare-transaction")
router.register("audit-logs", AuditLogViewSet, basename="audit-log")
router.register("inventory-tasks", InventoryTaskViewSet, basename="inventory-task")
router.register("inventory-items", InventoryItemViewSet, basename="inventory-item")

urlpatterns = [
    path("auth/login/", auth_login),
    path("auth/csrf/", auth_csrf),
    path("auth/me/", auth_me),
    path("auth/logout/", auth_logout),
    path("auth/change-password/", auth_change_password),
    path("auth/ldap/status/", auth_ldap_status),
    path("auth/ldap/config/", auth_ldap_config),
    path("auth/ldap/diagnostics/", auth_ldap_diagnostics),
    path("system/reset/", system_reset),
    path("system/settings/", system_settings),
    path("assets/import/template/", asset_import_template),
    path("assets/import/preview/", asset_import_preview),
    path("assets/import/", asset_import),
    path("reports/assets/export/", asset_export),
    path("reports/repairs/export/", repair_record_export),
    path("reports/licenses/export/", license_export),
    path("reports/spare-parts/export/", spare_part_export),
    path("reports/spare-transactions/export/", spare_transaction_export),
    path("licenses/summary/", license_summary),
    path("reports/dashboard/", dashboard_overview),
    path("reports/alerts/", alerts_overview),
    path("facilities/summary/", facilities_summary),
    path("reports/racks/export/", rack_layout_export),
    path("inventory-inspectors/", inventory_inspectors),
    path("assets/<int:pk>/inventory-records/", asset_inventory_records),
] + router.urls
