from rest_framework.routers import DefaultRouter
from django.urls import path
from .views import AuditLogViewSet, AssetCategoryViewSet, AssetViewSet, BrandViewSet, CustomFieldOptionViewSet, CustomFieldViewSet, DataCenterViewSet, DeviceTypeViewSet, GroupViewSet, InventoryItemViewSet, InventoryTaskViewSet, FaultEventViewSet, RepairRecordViewSet, RackViewSet, ServerRoomViewSet, SoftwareLicenseViewSet, SparePartViewSet, SpareStockViewSet, SpareStockTransactionViewSet, TagViewSet, UserViewSet, asset_inventory_records, dashboard_overview, facilities_summary, inventory_inspectors, license_summary, repair_record_export, rack_layout_export, auth_login, auth_me, auth_logout, auth_csrf, auth_change_password, asset_import, asset_import_preview, asset_export

router = DefaultRouter()
router.register("assets", AssetViewSet)
router.register("racks", RackViewSet)
router.register("server-rooms", ServerRoomViewSet, basename="server-room")
router.register("data-centers", DataCenterViewSet, basename="data-center")
router.register("categories", AssetCategoryViewSet, basename="category")
router.register("brands", BrandViewSet, basename="brand")
router.register("device-types", DeviceTypeViewSet, basename="device-type")
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
    path("assets/import/preview/", asset_import_preview),
    path("assets/import/", asset_import),
    path("reports/assets/export/", asset_export),
    path("reports/repairs/export/", repair_record_export),
    path("licenses/summary/", license_summary),
    path("reports/dashboard/", dashboard_overview),
    path("facilities/summary/", facilities_summary),
    path("reports/racks/export/", rack_layout_export),
    path("inventory-inspectors/", inventory_inspectors),
    path("assets/<int:pk>/inventory-records/", asset_inventory_records),
] + router.urls
