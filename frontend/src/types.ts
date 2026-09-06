import type {
  AssetStatus,
  InventoryResolutionAction,
  InventoryResolutionStatus,
  InventoryStatus,
  InventoryTaskStatus,
  LicenseStatus,
  RackStatus,
  RepairPartUsageSource,
  SpareUnit,
  StockOperationType,
} from "./business-enums";

export type {
  AssetStatus,
  InventoryResolutionAction,
  InventoryResolutionStatus,
  InventoryStatus,
  InventoryTaskStatus,
  LicenseStatus,
  RackStatus,
  RepairPartUsageSource,
  SpareUnit,
  StockOperationType,
} from "./business-enums";

export type Page =
  | "dashboard"
  | "ledger"
  | "asset-config"
  | "racks"
  | "repairs"
  | "licenses"
  | "spares"
  | "inventory"
  | "settings"
  | "placeholder";

export type SystemSettingKey = "default_page_size" | "default_asset_status";
export type SystemSettingOption = { value: string | number; label: string };
export type SystemSettingDefinition = {
  key: SystemSettingKey;
  label: string;
  type: "integer" | "enum";
  default: string | number;
  options: SystemSettingOption[];
  help_text: string;
};
export type SystemSettingsForm = {
  default_page_size: number;
  default_asset_status: AssetStatus;
};
export type SystemSettings = SystemSettingsForm & {
  definitions: SystemSettingDefinition[];
};

export type DictionaryItem = {
  id: number;
  name: string;
  code?: string | null;
  color?: string;
  is_active: boolean;
  assets_count?: number;
  custom_fields_count?: number;
  licenses_count?: number;
  spare_parts_count?: number;
  created_at?: string;
  updated_at?: string;
};
export type SparePartCategory = DictionaryItem & { code: string; spare_parts_count: number };
export type Manufacturer = { id: number; name: string; code: string | null; is_active: boolean };
export type SparePartFormState = {
  code: string;
  name: string;
  category: string;
  manufacturer: string;
  model: string;
  specification: string;
  unit: SpareUnit;
  initial_quantity: number;
  initial_data_center: string;
  initial_server_room: string;
  current_quantity: number;
  safety_stock: number;
  storage_location: string;
  notes: string;
};
export type CustomFieldOption = { id: number; field?: number; value: string; label: string; sort_order: number; is_active: boolean };
export type CustomFieldValidationConfig = {
  min_length?: number;
  max_length?: number;
  min?: number | string;
  max?: number | string;
  precision?: number;
  min_date?: string;
  max_date?: string;
  min_items?: number;
  max_items?: number;
};
export type CustomField = {
  id: number;
  device_type: number | null;
  device_type_name?: string | null;
  key: string;
  name: string;
  field_type: "text" | "textarea" | "number" | "date" | "select" | "multiselect" | "boolean";
  field_type_label?: string;
  required: boolean;
  default_value: string;
  sort_order: number;
  is_active: boolean;
  group: string;
  help_text: string;
  placeholder: string;
  form_visible: boolean;
  detail_visible: boolean;
  list_visible: boolean;
  filterable: boolean;
  validation_config: CustomFieldValidationConfig;
  assets_count?: number;
  options?: CustomFieldOption[];
};
export type CustomFieldSchema = CustomField;
export type CustomFieldFilterOperator = "contains" | "eq" | "gte" | "lte";
export type AssetCustomFilter = {
  fieldKey: string;
  operator: CustomFieldFilterOperator;
  value: string;
};
export type AssetSortField = "asset_no" | "name" | "manufacturer_model" | "serial_number";
export type AssetSortOrder = "ascending" | "descending" | null;
export type CustomFieldForm = {
  device_type: string;
  key: string;
  name: string;
  field_type: CustomField["field_type"];
  required: boolean;
  default_value: string;
  sort_order: number;
  is_active: boolean;
  group: string;
  help_text: string;
  placeholder: string;
  form_visible: boolean;
  detail_visible: boolean;
  list_visible: boolean;
  filterable: boolean;
  validation_config: CustomFieldValidationConfig;
};
export type Tag = { id: number; name: string; is_active: boolean; assets_count?: number; created_at?: string; updated_at?: string };
export type AssetCustomFieldValue = CustomField & { value: string | number | boolean | string[] | null };
export type DataCenter = {
  id: number;
  name: string;
  address?: string;
  is_active: boolean;
  assets_count?: number;
  rooms_count?: number;
  created_at?: string;
  updated_at?: string;
};
export type DashboardStatus = { status: AssetStatus; label: string; count: number; color: string };
export type DashboardDataCenterCapacity = {
  data_center_id: number;
  data_center: string;
  used_u: number;
  total_u: number;
  utilization: number;
};
export type DashboardRoomCapacity = {
  room_id: number;
  data_center: string;
  room: string;
  used_u: number;
  total_u: number;
  utilization: number;
};
export type DashboardAlert = {
  id: number;
  asset_id: number;
  asset_no: string;
  asset_name: string;
  title: string;
  occurred_at: string;
  level: string;
};
export type DashboardExpiration = {
  asset_id: number;
  asset_no: string;
  asset_name: string;
  expiry_date: string;
  days_remaining: number;
  label: string;
};
export type DashboardTypeDistribution = {
  type: string;
  label: string;
  count: number;
  color: string;
};
export type DashboardDataCenterOverview = {
  data_center_id: number;
  data_center: string;
  room_count: number;
  asset_count: number;
  rack_count: number;
  total_u: number;
  used_u: number;
  free_u: number;
  utilization: number;
};
export type DashboardRackCapacity = {
  id: number;
  code: string;
  data_center: string;
  data_center_id: number;
  server_room: string;
  server_room_id: number;
  total_u: number;
  used_u: number;
  free_u: number;
  utilization: number;
  device_count: number;
};
export type DashboardInventorySummary = {
  task_id: number;
  task_name: string;
  status: InventoryTaskStatus;
  total: number;
  checked: number;
  pending: number;
  normal: number;
  abnormal: number;
  completion_rate: number;
  checked_racks?: number;
  total_racks?: number;
  latest_date: string | null;
};
export type DashboardRecentChange = {
  id: number;
  action: string;
  asset_id: number;
  asset_no: string;
  asset_name: string;
  location: string;
  actor_name: string;
  created_at: string;
};
export type DashboardLicenseSummary = {
  total: number;
  normal: number;
  expiring: number;
  expired: number;
};
export type OperationalAlertLevel = "critical" | "warning" | "notice";
export type OperationalAlert = {
  id: string;
  kind: "maintenance" | "license" | "fault" | "inventory" | "spare" | string;
  state: string;
  level: OperationalAlertLevel;
  entity_id: number;
  asset_id?: number;
  asset_no?: string;
  asset_name?: string;
  name?: string;
  code?: string;
  reference?: string;
  due_date?: string;
  due_at?: string;
  occurred_at?: string;
  days_remaining?: number;
  days_overdue?: number;
  pending_count?: number;
  quantity?: number;
  safety_stock?: number;
  used_count?: number;
  authorized_count?: number;
};
export type OperationalAlertSummary = {
  total: number;
  critical: number;
  warning: number;
  notice: number;
};
export type OperationalAlertsResponse = {
  generated_at: string;
  summary: OperationalAlertSummary;
  alerts: OperationalAlert[];
};
export type DepreciationStatus = "unconfigured" | "not_started" | "depreciating" | "fully_depreciated";
export type DepreciationInfo = {
  method: string | null;
  start_date: string | null;
  years: number | null;
  residual_rate: string | null;
  original_value: string | null;
  residual_value: string | null;
  monthly_depreciation: string | null;
  accumulated_depreciation: string | null;
  net_book_value: string | null;
  elapsed_months: number | null;
  total_months: number | null;
  progress: string | null;
  status: DepreciationStatus;
};
export type AssetDepreciationSummary = Pick<DepreciationInfo, "status" | "net_book_value" | "accumulated_depreciation">;
export type DashboardOverview = {
  assets: {
    total: number;
    in_use: number;
    in_stock: number;
    repair: number;
    idle: number;
    retired: number;
  };
  racks: {
    total: number;
    used_u: number;
    free_u: number;
    device_count: number;
    empty_count?: number;
  };
  data_centers?: { total: number };
  expiring: {
    expired?: number;
    within_30_days: number;
    within_60_days?: number;
    within_90_days?: number;
  };
  alerts?: { open_faults: number };
  type_distribution?: DashboardTypeDistribution[];
  status_distribution: DashboardStatus[];
  data_center_capacity?: DashboardDataCenterCapacity[];
  room_capacity?: DashboardRoomCapacity[];
  recent_alerts?: DashboardAlert[];
  upcoming_expirations: DashboardExpiration[];
  data_center_overview?: DashboardDataCenterOverview[];
  rack_capacity?: DashboardRackCapacity[];
  inventory_summary?: DashboardInventorySummary | null;
  recent_changes?: DashboardRecentChange[];
  licenses?: DashboardLicenseSummary;
};

export type AssetNetwork = { id: number; address: string; role: string; is_primary: boolean; status?: string; notes?: string };
export type AssetProcurement = { id: number; purchase_date: string; supplier: string; order_no: string; amount: string | null; notes: string };
export type AssetMaintenance = { id: number; provider: string; contract_no: string; start_date: string | null; expiry_date: string | null; notes: string };
export type AssetResponsibilityUser = { id: number; username: string; display_name: string; is_active: boolean };
export type AssetResponsibilityEvent = {
  id: number;
  asset: number;
  action: "assign" | "return" | "transfer" | string;
  from_user: number | null;
  from_user_name: string;
  to_user: number | null;
  to_user_name: string;
  operator: number | null;
  operator_name: string;
  reason: string;
  created_at: string;
};
export type Asset = {
  id: number;
  created_at?: string;
  updated_at?: string;
  asset_no: string;
  name: string;
  manufacturer?: number | null;
  manufacturer_name?: string;
  device_type?: number | null;
  device_type_name?: string;
  model?: string;
  model_name?: string;
  manufacturer_model?: string;
  status: AssetStatus;
  allowed_statuses?: AssetStatus[];
  purpose: string;
  serial_number: string | null;
  department?: number | null;
  department_name?: string | null;
  responsible_user?: number | null;
  responsible_user_name?: string;
  owner_name?: string;
  notes?: string;
  asset_data_center?: number | null;
  asset_data_center_name?: string;
  network_addresses?: AssetNetwork[];
  rack_allocation?: { rack?: number; rack_code: string; data_center: string; data_center_id?: number; server_room: string; server_room_id?: number; start_u: number; end_u: number; units: number } | null;
  procurement_records?: AssetProcurement[];
  maintenance_contracts?: AssetMaintenance[];
  business_ip?: string;
  management_ip?: string;
  oob_ip?: string;
  data_center?: string;
  server_room?: string;
  rack_code?: string;
  u_range?: string;
  purchase_date?: string | null;
  supplier?: string;
  purchase_order_no?: string;
  maintenance_provider?: string;
  maintenance_expiry_date?: string | null;
  depreciation_start_date?: string | null;
  depreciation_years?: number | null;
  residual_rate?: string | null;
  depreciation_method?: string | null;
  depreciation?: DepreciationInfo | AssetDepreciationSummary | null;
  tag_names?: string[];
  tags?: Array<{ id: number; name: string; is_active: boolean }>;
  custom_values?: Record<string, unknown>;
  custom_fields?: AssetCustomFieldValue[];
};
export type AssetDetail = Asset & {
  allowed_statuses: AssetStatus[];
  created_at: string;
  updated_at: string;
  department_name: string | null;
  network_addresses: AssetNetwork[];
  rack_allocation: { rack: number; rack_code: string; data_center: string; data_center_id?: number; server_room: string; server_room_id: number; rack_total_u: number; start_u: number; end_u: number; units: number } | null;
  procurement_records: Array<{ id: number; purchase_date: string; supplier: string; order_no: string; amount: string | null; notes: string }>;
  maintenance_contracts: Array<{ id: number; provider: string; contract_no: string; start_date: string | null; expiry_date: string | null; notes: string }>;
  inventory_records_count: number;
  latest_inventory_record: InventoryItem | null;
  tags: Array<{ id: number; name: string; is_active: boolean }>;
  custom_fields: AssetCustomFieldValue[];
  custom_values: Record<string, unknown>;
  depreciation: DepreciationInfo;
};
export type AssetBatchDeleteResult = {
  id: number;
  asset_no: string;
  success: boolean;
  code: "" | "NOT_FOUND" | "PROTECTED" | "CONFLICT" | string;
  reason: string;
};
export type AssetBatchDeleteResponse = {
  requested: number;
  succeeded: number;
  failed: number;
  results: AssetBatchDeleteResult[];
};
export type UserBatchStatusResult = {
  id: number;
  username: string;
  success: boolean;
  code: "" | "NOT_FOUND" | "PROTECTED" | "INVALID_STATE" | "CONFLICT" | string;
  reason: string;
};
export type UserBatchStatusResponse = {
  requested: number;
  succeeded: number;
  failed: number;
  results: UserBatchStatusResult[];
};
export type InventoryBulkResolutionResult = {
  item_id: number;
  asset_no: string;
  success: boolean;
  reason: string;
};
export type InventoryBulkResolutionResponse = {
  requested: number;
  succeeded: number;
  failed: number;
  results: InventoryBulkResolutionResult[];
};
export type InventoryBulkNormalResult = {
  item_id: number;
  asset_no: string;
  success: boolean;
  reason: string;
};
export type InventoryBulkNormalResponse = {
  requested: number;
  succeeded: number;
  failed: number;
  results: InventoryBulkNormalResult[];
};
export type InventoryItem = {
  id: number;
  task: number;
  task_name: string;
  asset: number;
  asset_no: string;
  asset_name: string;
  device_type_name: string | null;
  serial_number: string | null;
  system_data_center: string;
  system_server_room: string;
  system_rack_code: string;
  system_start_u: number | null;
  system_end_u: number | null;
  status: InventoryStatus;
  status_label: string;
  checked_at: string | null;
  checked_by: number | null;
  checked_by_name: string;
  actual_rack: number | null;
  actual_data_center: string | null;
  actual_server_room: string | null;
  actual_rack_code: string | null;
  actual_start_u: number | null;
  actual_end_u: number | null;
  notes: string;
  resolution_status: InventoryResolutionStatus;
  resolution_status_label: string;
  resolution_action: InventoryResolutionAction | null;
  resolution_action_label: string;
  resolution_note: string;
  resolved_by: number | null;
  resolved_by_name: string;
  resolved_at: string | null;
};
export type InventorySummary = {
  total: number;
  checked: number;
  pending: number;
  normal: number;
  location_mismatch: number;
  not_found: number;
  info_mismatch: number;
  other: number;
  exceptions: number;
  resolution_pending: number;
  resolution_resolved: number;
  completion_rate: number;
};
export type InventoryTask = {
  id: number;
  name: string;
  data_center: number;
  data_center_name: string;
  server_room: number | null;
  server_room_name: string | null;
  inspector: number;
  inspector_name: string;
  start_at: string;
  end_at: string;
  status: InventoryTaskStatus;
  completed_at: string | null;
  notes: string;
  can_delete: boolean;
  created_at?: string;
  updated_at?: string;
  summary: InventorySummary;
};
export type InventoryInspector = { id: number; username: string; display_name: string };
export type InventoryScopeLocation = { id: number; name: string };
export type InventoryScopePreview = {
  data_center: InventoryScopeLocation;
  server_room: InventoryScopeLocation | null;
  scope_label: string;
  total: number;
  racked: number;
  unracked: number;
  retired: number;
  includes_unracked: boolean;
  warnings: string[];
};
export type RackFormState = {
  room: string;
  code: string;
  name: string;
  rack_type: string;
  owner_name: string;
  notes: string;
  total_u: number;
  status: RackStatus;
};
export type Rack = {
  id: number;
  code: string;
  room: number;
  created_at?: string;
  updated_at?: string;
  total_u: number;
  name?: string;
  rack_type?: string;
  owner_name?: string;
  notes?: string;
  data_center_name?: string;
  server_room_name?: string;
  is_active?: boolean;
  status?: RackStatus;
  status_label?: string;
  assets_count?: number;
  used_u?: number;
  free_u?: number;
  allocations: Array<{ asset: number; start_u: number; end_u: number; units: number; asset_no: string; asset_name: string; device_type_name?: string | null; device_type_color?: string | null; manufacturer_name?: string | null; model_name?: string | null; manufacturer_model?: string; serial_number?: string | null; status: string }>;
};
export type ServerRoom = { id: number; data_center: number; data_center_name: string; name: string; is_active: boolean; owner_name?: string; contact_phone?: string; notes?: string; racks_count: number; assets_count: number; created_at?: string; updated_at?: string };
export type FacilitySummary = {
  rooms_total: number;
  rooms_in_use: number;
  rooms_disabled: number;
  racks_total: number;
  racks_in_use: number;
  total_u: number;
  used_u: number;
  free_u: number;
  data_centers?: Array<{
    id: number;
    name: string;
    rooms_count: number;
    racks_count: number;
    assets_count: number;
    total_u: number;
    used_u: number;
    free_u: number;
    utilization: number;
    is_active: boolean;
  }>;
  rooms: Array<ServerRoom & { total_u?: number; used_u?: number }>;
  racks: Array<Rack & { room_id: number; device_count?: number }>;
};
export type FaultEvent = { id: number; asset: number; asset_no: string; asset_name: string; occurred_at: string; reported_at: string | null; resolved_at: string | null; reason: string; description: string; is_closed: boolean; repair: { id: number; fault: number; provider: string; started_at: string | null; finished_at: string | null; notes: string } | null };
export type RepairPartUsage = {
  id: number;
  fault: number;
  source: RepairPartUsageSource | string;
  source_label: string;
  spare_part: number | null;
  part_code: string;
  part_name: string;
  part_model: string;
  unit: string;
  unit_label: string;
  spare_stock: number | null;
  stock_location: string;
  stock_data_center_name: string;
  stock_server_room_name: string;
  vendor_name: string;
  quantity: number;
  notes: string;
  operator: number | null;
  operator_name: string;
  created_at: string;
};
export type RepairPartUsageFormState = {
  source: RepairPartUsageSource;
  spare_part_id: string;
  spare_stock_id: string;
  part_code: string;
  part_name: string;
  part_model: string;
  vendor_name: string;
  quantity: number | null;
  notes: string;
};
export type Role = { id: number; code: string; name: string; description: string; user_count?: number };
export type AuthSource = "local" | "ldap";
export type ManagedUser = {
  id: number;
  username: string;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  groups: number[];
  assigned_role_code: string | null;
  assigned_role_name: string;
  auth_source: AuthSource;
  directory_provider: string | null;
  directory_login_identifier: string | null;
  directory_last_seen_at: string | null;
  last_login: string | null;
  date_joined: string;
};
export type LdapStatus = {
  enabled: boolean;
  configured: boolean;
  provider: string;
  directory_type: LdapDirectoryType;
  protocol: "ldap" | "ldaps" | null;
  tls_mode: LdapSecurityMode | null;
  server: string | null;
  secondary_server: string | null;
  base_dn: string | null;
  search_configured: boolean;
  connect_timeout: number;
  operation_timeout: number;
  ad_specific_mode: boolean | null;
  password_configured: boolean;
  secret_available: boolean;
  source: "database" | "environment";
  configuration_error: boolean;
  last_diagnostic_at?: string | null;
  last_diagnostic_success?: boolean | null;
  last_diagnostic_code?: string | null;
};
export type LdapDirectoryType = "active_directory" | "generic_ldap";
export type LdapSecurityMode = "ldaps" | "starttls" | "none";
export type LdapConfiguration = {
  enabled: boolean;
  directory_type: LdapDirectoryType;
  primary_host: string;
  primary_port: number | null;
  secondary_host: string;
  secondary_port: number | null;
  base_dn: string;
  bind_dn: string;
  bind_password_configured: boolean;
  secret_available: boolean;
  secret_error: boolean;
  security_mode: LdapSecurityMode;
  tls_server_name: string;
  ca_cert_file: string;
  user_search_base: string;
  user_login_attribute: string;
  user_filter: string;
  external_id_attribute: string;
  email_attribute: string;
  first_name_attribute: string;
  last_name_attribute: string;
  account_control_attribute: string;
  connect_timeout: number;
  operation_timeout: number;
  directory_identity_count: number;
  identity_anchor_locked: boolean;
  identity_anchor_attribute: string;
  source: "database" | "environment";
  configured: boolean;
  configuration_errors: Record<string, string>;
  last_diagnostic_at?: string | null;
  last_diagnostic_success?: boolean | null;
  last_diagnostic_code?: string | null;
};
export type LdapConfigurationForm = {
  enabled: boolean;
  directory_type: LdapDirectoryType;
  primary_host: string;
  primary_port: number | null;
  secondary_host: string;
  secondary_port: number | null;
  base_dn: string;
  bind_dn: string;
  bind_password: string;
  security_mode: LdapSecurityMode;
  tls_server_name: string;
  ca_cert_file: string;
  user_search_base: string;
  user_login_attribute: string;
  user_filter: string;
  external_id_attribute: string;
  email_attribute: string;
  first_name_attribute: string;
  last_name_attribute: string;
  account_control_attribute: string;
  connect_timeout: number;
  operation_timeout: number;
};
export type LdapDiagnosticCheck = {
  name: "configuration" | "connection" | "tls" | "service_bind" | "search";
  status: "success" | "error" | "disabled";
};
export type LdapDiagnosticResult = {
  success: boolean;
  stage: "configuration" | "connection" | "tls" | "service_bind" | "search";
  checks: LdapDiagnosticCheck[];
  code?: string;
  message?: string;
};
export type AuditLog = { id: number; actor_username: string | null; actor_display_name: string; action: string; resource_type: string; resource_id: string; payload: Record<string, unknown>; created_at: string };
export type SoftwareLicense = { id: number; name: string; manufacturer: Manufacturer | null; license_type: string; authorized_count: number; used_count: number; utilization: number; remaining_count: number; expiry_date: string | null; status: LicenseStatus; status_label: string; days_remaining: number | null; notes: string };
export type SparePart = {
  id: number;
  code: string;
  name: string;
  category: number;
  category_name: string;
  category_code: string;
  manufacturer: number | null;
  manufacturer_name: string | null;
  model: string;
  specification: string;
  unit: SpareUnit;
  safety_stock: number;
  storage_location: string;
  notes: string;
  total_quantity: number;
  location_count: number;
  has_stock_movements: boolean;
  is_low_stock: boolean;
  created_at?: string;
  updated_at?: string;
};
export type SparePartDetail = SparePart & {
  stock_locations: SpareStock[];
  recent_transactions: SpareTransaction[];
};
export type SpareStock = {
  id: number;
  part: number;
  part_code: string;
  part_name: string;
  category_name: string;
  data_center: number;
  data_center_name: string;
  server_room: number | null;
  server_room_name: string | null;
  quantity: number;
  updated_at?: string;
};
export type SpareTransaction = {
  id: number;
  part: number;
  part_code: string;
  part_name: string;
  category_name: string;
  unit: SpareUnit;
  operation_type: StockOperationType;
  operation_type_label: string;
  quantity: number;
  quantity_delta: number;
  adjustment_quantity: number | null;
  source_data_center: number | null;
  source_data_center_name: string | null;
  source_server_room: number | null;
  source_server_room_name: string | null;
  target_data_center: number | null;
  target_data_center_name: string | null;
  target_server_room: number | null;
  target_server_room_name: string | null;
  before_quantity: number;
  after_quantity: number;
  operator: number | null;
  operator_name: string;
  reference: string;
  notes: string;
  created_at: string;
};
