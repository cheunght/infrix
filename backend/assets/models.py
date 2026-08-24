from django.conf import settings
from django.db import models
from django.core.exceptions import ValidationError


class Timestamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Department(Timestamped):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=50, unique=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT)

    def __str__(self):
        return self.name


class DataCenter(Timestamped):
    name = models.CharField(max_length=120, unique=True)
    address = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class ServerRoom(Timestamped):
    data_center = models.ForeignKey(DataCenter, on_delete=models.PROTECT, related_name="rooms")
    name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)
    owner_name = models.CharField(max_length=120, blank=True)
    contact_phone = models.CharField(max_length=50, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["data_center", "name"], name="uniq_room_per_dc")]

    def __str__(self):
        return f"{self.data_center} / {self.name}"


class Rack(Timestamped):
    room = models.ForeignKey(ServerRoom, on_delete=models.PROTECT, related_name="racks")
    code = models.CharField(max_length=50)
    vendor = models.CharField(max_length=100, blank=True)
    name = models.CharField(max_length=120, blank=True)
    rack_type = models.CharField(max_length=80, default="标准机柜", blank=True)
    owner_name = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    total_u = models.PositiveSmallIntegerField(default=45)
    is_active = models.BooleanField(default=True)
    STATUS = [("in_use", "使用中"), ("reserved", "预留"), ("disabled", "停用")]
    status = models.CharField(max_length=20, choices=STATUS, default="in_use")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["room", "code"], name="uniq_rack_per_room")]

    def __str__(self):
        return self.code


class Manufacturer(Timestamped):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=80, unique=True, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class DeviceType(Timestamped):
    name = models.CharField(max_length=80, unique=True)
    color = models.CharField(max_length=7, default="#1677EF")
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class CustomField(Timestamped):
    FIELD_TYPES = [
        ("text", "单行文本"),
        ("textarea", "多行文本"),
        ("number", "数字"),
        ("date", "日期"),
        ("select", "下拉单选"),
        ("multiselect", "多选"),
        ("boolean", "是/否"),
    ]

    device_type = models.ForeignKey(
        DeviceType,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="custom_fields",
    )
    key = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=120)
    field_type = models.CharField(max_length=20, choices=FIELD_TYPES)
    required = models.BooleanField(default=False)
    default_value = models.CharField(max_length=255, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    group = models.CharField(max_length=80, blank=True, default="")
    help_text = models.TextField(max_length=1000, blank=True, default="")
    placeholder = models.CharField(max_length=255, blank=True, default="")
    form_visible = models.BooleanField(default=True)
    detail_visible = models.BooleanField(default=True)
    list_visible = models.BooleanField(default=False)
    filterable = models.BooleanField(default=False)
    validation_config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["device_type__name", "sort_order", "id"]

    def __str__(self):
        scope = self.device_type.name if self.device_type_id else "全部资产"
        return f"{scope} / {self.name}"


class CustomFieldOption(Timestamped):
    field = models.ForeignKey(CustomField, on_delete=models.CASCADE, related_name="options")
    value = models.CharField(max_length=120)
    label = models.CharField(max_length=120)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["field", "value"], name="uniq_custom_field_option_value"),
        ]


class Tag(Timestamped):
    name = models.CharField(max_length=80, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name


class SparePart(Timestamped):
    PART_TYPES = [
        ("hard_disk", "备用硬盘"),
        ("memory", "内存"),
        ("power_module", "电源模块"),
        ("optical_module", "光模块"),
        ("network_card", "网卡"),
        ("hba_card", "HBA 卡"),
        ("fan", "风扇"),
        ("raid_card", "RAID 卡"),
        ("other", "其他"),
    ]

    name = models.CharField(max_length=160)
    part_type = models.CharField(max_length=30, choices=PART_TYPES, default="other")
    manufacturer = models.ForeignKey(
        Manufacturer,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="spare_parts",
    )
    model = models.CharField(max_length=160, blank=True)
    specification = models.CharField(max_length=255, blank=True)
    unit = models.CharField(max_length=20, default="件")
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name", "part_type", "id"]

    def __str__(self):
        return self.name


class SpareStock(Timestamped):
    part = models.ForeignKey(SparePart, on_delete=models.PROTECT, related_name="stocks")
    data_center = models.ForeignKey(DataCenter, on_delete=models.PROTECT, related_name="spare_stocks")
    server_room = models.ForeignKey(
        ServerRoom,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="spare_stocks",
    )
    quantity = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["part__name", "data_center__name", "server_room__name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["part", "data_center", "server_room"],
                name="uniq_spare_stock_location",
            ),
            models.CheckConstraint(
                condition=models.Q(quantity__gte=0),
                name="spare_stock_quantity_nonnegative",
            ),
        ]


class SpareStockTransaction(Timestamped):
    OPERATION_TYPES = [
        ("inbound", "入库"),
        ("outbound", "出库"),
        ("transfer", "调拨"),
        ("adjustment", "盘点调整"),
        ("scrap", "报废"),
    ]

    part = models.ForeignKey(SparePart, on_delete=models.PROTECT, related_name="transactions")
    operation_type = models.CharField(max_length=20, choices=OPERATION_TYPES)
    quantity = models.PositiveIntegerField(default=0)
    source_data_center = models.ForeignKey(
        DataCenter,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="spare_source_transactions",
    )
    source_server_room = models.ForeignKey(
        ServerRoom,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="spare_source_transactions",
    )
    target_data_center = models.ForeignKey(
        DataCenter,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="spare_target_transactions",
    )
    target_server_room = models.ForeignKey(
        ServerRoom,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="spare_target_transactions",
    )
    before_quantity = models.PositiveIntegerField(default=0)
    after_quantity = models.PositiveIntegerField(default=0)
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="spare_stock_transactions",
    )
    reference = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class SoftwareLicense(Timestamped):
    name = models.CharField(max_length=160)
    manufacturer = models.ForeignKey(
        Manufacturer,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="software_licenses",
    )
    license_type = models.CharField(max_length=80, blank=True)
    authorized_count = models.PositiveIntegerField(default=0)
    used_count = models.PositiveIntegerField(default=0)
    expiry_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["expiry_date", "name", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(used_count__lte=models.F("authorized_count")),
                name="license_used_lte_authorized",
            )
        ]

    def __str__(self):
        return self.name


class Asset(Timestamped):
    STATUS = [("in_stock", "在库"), ("in_use", "在用"), ("idle", "闲置"), ("repair", "维修中"), ("retired", "已报废")]
    asset_no = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=160)
    asset_type = models.CharField(max_length=80)
    manufacturer_model = models.CharField(max_length=160, blank=True)
    serial_number = models.CharField(max_length=160, blank=True, unique=True, null=True)
    purpose = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default="in_stock")
    status_before_repair = models.CharField(
        max_length=20,
        choices=STATUS,
        null=True,
        blank=True,
        default=None,
        editable=False,
        help_text="由故障维修生命周期维护的维修前资产状态快照",
    )
    depreciation_start_date = models.DateField(null=True, blank=True)
    depreciation_years = models.PositiveSmallIntegerField(null=True, blank=True)
    residual_rate = models.DecimalField(
        max_digits=5,
        decimal_places=4,
        null=True,
        blank=True,
    )
    DEPRECIATION_METHODS = [("straight_line", "直线法")]
    depreciation_method = models.CharField(
        max_length=20,
        choices=DEPRECIATION_METHODS,
        null=True,
        blank=True,
        default=None,
    )
    manufacturer = models.ForeignKey(Manufacturer, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets")
    device_type = models.ForeignKey(DeviceType, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets")
    asset_data_center = models.ForeignKey(
        DataCenter,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="unmounted_assets",
        help_text="未上架资产的所属数据中心；已上架资产以机柜归属为准",
    )
    model = models.CharField(max_length=160, blank=True)
    department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.PROTECT, related_name="assets")
    owner_name = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.asset_no} {self.name}"


class AssetCustomValue(Timestamped):
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="custom_values")
    field = models.ForeignKey(CustomField, on_delete=models.PROTECT, related_name="asset_values")
    text_value = models.TextField(blank=True)
    number_value = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    date_value = models.DateField(null=True, blank=True)
    boolean_value = models.BooleanField(null=True, blank=True)
    json_value = models.JSONField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["asset", "field"], name="uniq_asset_custom_value"),
        ]


class AssetTag(Timestamped):
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="asset_tags")
    tag = models.ForeignKey(Tag, on_delete=models.PROTECT, related_name="asset_tags")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["asset", "tag"], name="uniq_asset_tag"),
        ]


class AssetNetworkAddress(Timestamped):
    ROLE = [("business", "业务 IP"), ("management", "管理 IP"), ("oob", "带外 IP")]
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="network_addresses")
    address = models.GenericIPAddressField()
    role = models.CharField(max_length=20, choices=ROLE)
    is_primary = models.BooleanField(default=False)
    status = models.CharField(max_length=20, default="active")
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["address", "role"], name="uniq_address_role"),
            models.UniqueConstraint(fields=["asset", "role"], name="uniq_asset_network_role"),
        ]


class RackUnitAllocation(Timestamped):
    asset = models.OneToOneField(Asset, on_delete=models.CASCADE, related_name="rack_allocation")
    rack = models.ForeignKey(Rack, on_delete=models.PROTECT, related_name="allocations")
    start_u = models.PositiveSmallIntegerField()
    end_u = models.PositiveSmallIntegerField()

    @property
    def units(self):
        return abs(self.end_u - self.start_u) + 1

    def clean(self):
        if self.start_u > self.end_u:
            raise ValidationError("起始 U 位不能大于结束 U 位")
        if self.rack_id and self.end_u > self.rack.total_u:
            raise ValidationError("结束 U 位超过机柜容量")
        overlap = RackUnitAllocation.objects.filter(rack=self.rack, start_u__lte=self.end_u, end_u__gte=self.start_u).exclude(pk=self.pk)
        if overlap.exists():
            raise ValidationError("机柜 U 位与现有设备重叠")


class ProcurementRecord(Timestamped):
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="procurement_records")
    purchase_date = models.DateField()
    supplier = models.CharField(max_length=160, blank=True)
    order_no = models.CharField(max_length=100, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-purchase_date", "-id"]
        constraints = [models.UniqueConstraint(fields=["asset"], name="uniq_current_procurement_per_asset")]


class MaintenanceContract(Timestamped):
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="maintenance_contracts")
    provider = models.CharField(max_length=160, blank=True)
    contract_no = models.CharField(max_length=100, blank=True)
    start_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["asset"], name="uniq_current_maintenance_per_asset")]


class FaultEvent(Timestamped):
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="fault_events")
    occurred_at = models.DateTimeField()
    reported_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    is_closed = models.BooleanField(default=False)


class RepairRecord(Timestamped):
    fault = models.OneToOneField(FaultEvent, on_delete=models.CASCADE, related_name="repair")
    provider = models.CharField(max_length=160, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)


class AssetRelation(Timestamped):
    source_asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="outgoing_relations")
    target_asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="incoming_relations")
    relation_type = models.CharField(max_length=60)
    metadata = models.JSONField(default=dict, blank=True)
    effective_from = models.DateTimeField(null=True, blank=True)
    effective_to = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["source_asset", "target_asset", "relation_type"], name="uniq_asset_relation"),
            models.CheckConstraint(condition=~models.Q(source_asset=models.F("target_asset")), name="asset_relation_not_self"),
        ]


class InventoryTask(Timestamped):
    STATUS = [("in_progress", "进行中"), ("completed", "已完成")]

    name = models.CharField(max_length=160)
    data_center = models.ForeignKey(DataCenter, on_delete=models.PROTECT, related_name="inventory_tasks")
    server_room = models.ForeignKey(
        ServerRoom,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="inventory_tasks",
    )
    inspector = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="inventory_tasks",
    )
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    status = models.CharField(max_length=20, choices=STATUS, default="in_progress")
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class InventoryItem(Timestamped):
    STATUS = [
        ("pending", "未盘点"),
        ("normal", "正常"),
        ("location_mismatch", "位置不符"),
        ("not_found", "未找到"),
        ("info_mismatch", "设备信息不符"),
        ("other", "其他异常"),
    ]
    RESOLUTION_STATUS = [
        ("not_required", "无需处理"),
        ("pending", "待处理"),
        ("resolved", "已处理"),
    ]
    RESOLUTION_ACTION = [
        ("update_asset", "更新资产台账"),
        ("keep_asset", "保持资产台账"),
        ("confirm_missing", "确认设备缺失"),
        ("ignore", "忽略/误报"),
    ]

    task = models.ForeignKey(InventoryTask, on_delete=models.CASCADE, related_name="items")
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="inventory_items")
    system_snapshot = models.JSONField(default=dict)
    status = models.CharField(max_length=30, choices=STATUS, default="pending")
    checked_at = models.DateTimeField(null=True, blank=True)
    checked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="checked_inventory_items",
    )
    actual_rack = models.ForeignKey(
        Rack,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="inventory_items",
    )
    actual_start_u = models.PositiveSmallIntegerField(null=True, blank=True)
    actual_end_u = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    resolution_status = models.CharField(
        max_length=20,
        choices=RESOLUTION_STATUS,
        default="not_required",
    )
    resolution_action = models.CharField(
        max_length=30,
        choices=RESOLUTION_ACTION,
        null=True,
        blank=True,
    )
    resolution_note = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="resolved_inventory_items",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["asset__asset_no", "id"]
        constraints = [
            models.UniqueConstraint(fields=["task", "asset"], name="uniq_inventory_item_task_asset"),
        ]


class AuditLog(Timestamped):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=80)
    resource_type = models.CharField(max_length=80)
    resource_id = models.CharField(max_length=80)
    payload = models.JSONField(default=dict, blank=True)


class UserSecurityProfile(Timestamped):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="security_profile",
    )
    must_change_password = models.BooleanField(default=False)
    password_changed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.user} security profile"


class AuthThrottleState(Timestamped):
    SCOPE_CHOICES = [("account", "账号"), ("ip", "IP")]

    scope = models.CharField(max_length=16, choices=SCOPE_CHOICES)
    key = models.CharField(max_length=255)
    failure_count = models.PositiveIntegerField(default=0)
    first_failed_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["scope", "key"], name="uniq_auth_throttle_scope_key"),
        ]
        indexes = [models.Index(fields=["scope", "key"])]

    def __str__(self):
        return f"{self.scope}:{self.key}"
