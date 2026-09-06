import { computed, reactive, ref, watch, type ComputedRef, type Ref } from "vue";
import type { LocationQuery } from "vue-router";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ApiError, buildExportQuery, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type { Page } from "../types";
import type {
  Asset,
  AssetBatchDeleteResponse,
  AssetDetail,
  AssetResponsibilityEvent,
  AssetResponsibilityUser,
  AssetStatus,
  AssetCustomFieldValue,
  AssetCustomFilter,
  AssetSortField,
  AssetSortOrder,
  CustomField,
  CustomFieldFilterOperator,
  CustomFieldSchema,
  DataCenter,
  DictionaryItem,
  InventoryItem,
  Rack,
  ServerRoom,
  SystemSettingDefinition,
  Tag,
} from "../types";
import type { AssetFilters, AssetFormState, CapabilityFn, RequestFn } from "../page-context";
import { ASSET_STATUS_OPTIONS, isAssetStatus } from "../business-enums";
import {
  DEPRECIATION_METHOD_STRAIGHT_LINE,
  depreciationStatusLabel,
  formatMoneyDecimalString,
  percentageToRate,
  rateToPercentageText,
} from "../depreciation";
import { systemSettingsState } from "../system-settings";
import { i18n } from "../i18n";
import {
  clearFieldError,
  fieldErrorsToText,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

const RESPONSIBILITY_ACTION_FIELDS = ["target_user", "reason"] as const;

export type StaticAssetColumnKey =
  | "asset_no"
  | "name"
  | "device_type"
  | "manufacturer"
  | "manufacturer_model"
  | "purpose"
  | "status"
  | "serial_number"
  | "responsible_user"
  | "data_center"
  | "server_room"
  | "rack_code"
  | "u_range"
  | "business_ip"
  | "management_ip"
  | "oob_ip"
  | "purchase_date"
  | "supplier"
  | "purchase_order_no"
  | "depreciation_net_book_value"
  | "depreciation_accumulated_depreciation"
  | "depreciation_status"
  | "maintenance_provider"
  | "maintenance_expiry_date"
  | "notes";

export const ASSET_SORT_FIELD_MAP: Record<AssetSortField, string> = {
  asset_no: "asset_no",
  name: "name",
  manufacturer_model: "manufacturer_model",
  serial_number: "serial_number",
};

export type DynamicAssetColumnKey = `custom:${string}`;
export type AssetColumnKey = StaticAssetColumnKey | DynamicAssetColumnKey;
export const MAX_DYNAMIC_ASSET_COLUMNS = 12;
export const MAX_DYNAMIC_ASSET_FILTERS = 8;
export const CUSTOM_FIELD_FILTER_OPERATORS: Record<CustomField["field_type"], CustomFieldFilterOperator[]> = {
  text: ["contains", "eq"],
  textarea: ["contains", "eq"],
  number: ["eq", "gte", "lte"],
  date: ["eq", "gte", "lte"],
  boolean: ["eq"],
  select: ["eq"],
  multiselect: ["contains"],
};

export function defaultCustomFieldFilterOperator(fieldType: CustomField["field_type"]): CustomFieldFilterOperator {
  return fieldType === "text" || fieldType === "textarea" || fieldType === "multiselect" ? "contains" : "eq";
}

export function isDynamicAssetColumnKey(key: string): key is DynamicAssetColumnKey {
  return key.startsWith("custom:") && key.length > "custom:".length;
}

function dynamicAssetFieldKey(key: string): string {
  return key.slice("custom:".length);
}

export type AssetColumnOption = {
  key: AssetColumnKey;
  label: string;
  defaultVisible?: boolean;
  required?: boolean;
  dynamic?: boolean;
  field?: CustomFieldSchema;
  scopeLabel?: string;
  width?: number;
};

export type ImportPreviewChange = {
  field: string;
  label: string;
  old_value: string;
  new_value: string;
};
export type ImportPreviewError = {
  field: string;
  label: string;
  message: string;
};
export type ImportPreviewRow = {
  line: number;
  asset_no: string;
  name: string;
  device_type: string;
  location: string;
  depreciation?: string;
  valid: boolean;
  action: "create" | "conflict" | "error";
  changes: ImportPreviewChange[];
  errors: ImportPreviewError[];
};
export type ImportPreview = {
  filename: string;
  total: number;
  valid: number;
  invalid: number;
  summary: { ready: number; conflicts: number; errors: number };
  rows: ImportPreviewRow[];
};
export type ImportResult = {
  created: number;
  total: number;
  errors: Array<{ line: number; detail: unknown }>;
};
export type ImportStep = "upload" | "preview" | "result";

const IMPORT_FIELD_LABEL_KEYS: Record<string, string> = {
  asset_no: "asset.code",
  name: "asset.name",
  device_type: "asset.deviceType",
  device_type_id: "asset.deviceType",
  manufacturer: "asset.manufacturer",
  manufacturer_id: "asset.manufacturer",
  model: "asset.model",
  manufacturer_model: "asset.manufacturerModel",
  serial_number: "asset.serialNumber",
  purpose: "asset.purpose",
  status: "asset.status",
  notes: "common.notes",
  asset_data_center: "common.dataCenter",
  data_center: "common.dataCenter",
  server_room: "common.room",
  server_room_id: "common.room",
  rack: "asset.rack",
  rack_code: "asset.rack",
  rack_id: "asset.rack",
  rack_start_u: "asset.startU",
  rack_end_u: "asset.endU",
  business_ip: "asset.businessIp",
  management_ip: "asset.managementIp",
  oob_ip: "asset.oobIp",
  network_addresses: "asset.networkAddress",
  purchase_date: "asset.purchaseDate",
  supplier: "asset.supplier",
  purchase_order_no: "asset.purchaseOrder",
  purchase_amount: "asset.purchaseAmount",
  procurement_notes: "asset.procurementNotes",
  depreciation_enabled: "asset.depreciation",
  depreciation_method: "asset.depreciationMethod",
  depreciation_start_date: "asset.depreciationStart",
  depreciation_years: "asset.depreciationYears",
  residual_rate: "asset.residualRate",
  maintenance_provider: "asset.maintenanceProvider",
  maintenance_contract_no: "asset.maintenanceContract",
  maintenance_start_date: "asset.maintenanceStart",
  maintenance_expiry_date: "asset.maintenanceExpiry",
  maintenance_notes: "asset.maintenanceNotes",
  responsible_user: "asset.responsibleUser",
  department: "asset.department",
  department_id: "asset.department",
  tags: "asset.tags",
  configuration: "asset.locationOwnership",
  custom_values: "asset.customFields",
};

type ImportErrorEntry = { field: string; message: string };
export type FormattedImportError = { field: string; label: string; message: string };

function importFieldRoot(field: string): string {
  const normalized = field.trim();
  const root = normalized.split(/[.[\]]/, 1)[0];
  return IMPORT_FIELD_LABEL_KEYS[root] ? root : "";
}

function importFieldLabel(field: string): string {
  const root = importFieldRoot(field);
  return root ? tr(IMPORT_FIELD_LABEL_KEYS[root]) : "";
}

function safeImportReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return normalizeApiError(new ApiError(400, "", { detail: value })).message;
}

function collectImportErrorEntries(detail: unknown, field = ""): ImportErrorEntry[] {
  if (Array.isArray(detail)) return detail.flatMap((item) => collectImportErrorEntries(item, field));
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    const recordField = typeof record.field === "string" ? record.field : field;
    if (recordField && ("message" in record || "detail" in record)) {
      return collectImportErrorEntries(record.message ?? record.detail, recordField);
    }
    return Object.entries(record)
      .filter(([key]) => !["field", "label", "code", "status", "preview"].includes(key))
      .flatMap(([key, value]) => {
        if (["message", "detail", "non_field_errors"].includes(key)) {
          return collectImportErrorEntries(value, field);
        }
        return collectImportErrorEntries(value, field ? `${field}.${key}` : key);
      });
  }
  const message = safeImportReason(detail);
  return message ? [{ field, message }] : [];
}

export function formatImportErrorEntries(detail: unknown): FormattedImportError[] {
  const entries = collectImportErrorEntries(detail);
  const formatted = entries.map(({ field, message }) => {
    const label = importFieldLabel(field);
    return label
      ? { field, label, message }
      : field
        ? { field: "", label: "", message: tr("asset.importUnknownField") }
        : { field: "", label: "", message };
  });
  const unique = new Map<string, FormattedImportError>();
  formatted.forEach((entry) => unique.set(`${entry.label}\u0000${entry.message}`, entry));
  return unique.size
    ? [...unique.values()]
    : [{ field: "", label: "", message: tr("asset.importUnknownField") }];
}

export function formatImportError(detail: unknown): string {
  return formatImportErrorEntries(detail)
    .map(({ label, message }) => label ? `${label}：${message}` : message)
    .join("；");
}

function normalizeImportPreviewErrors(detail: unknown): ImportPreviewError[] {
  if (detail == null || (Array.isArray(detail) && detail.length === 0)) return [];
  return formatImportErrorEntries(detail).map(({ field, label, message }) => ({
    field: field || "row",
    label: label || tr("common.errorDetails"),
    message,
  }));
}

function normalizeImportPreview(preview: ImportPreview): ImportPreview {
  return {
    ...preview,
    rows: Array.isArray(preview.rows)
      ? preview.rows.map((row) => ({ ...row, errors: normalizeImportPreviewErrors(row.errors) }))
      : [],
  };
}

export interface AssetsDeps {
  can: CapabilityFn;
  request: RequestFn;
  download: (path: string, filename?: string) => Promise<void>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  authenticated: Ref<boolean>;
  page: Ref<Page>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
  dataCenters: Ref<DataCenter[]>;
  serverRooms: Ref<ServerRoom[]>;
  racks: Ref<Rack[]>;
  manufacturers: Ref<DictionaryItem[]>;
  deviceTypes: Ref<DictionaryItem[]>;
  tags: Ref<Tag[]>;
  loadRackManagement: () => void | Promise<void>;
  goToLedger: () => void;
  clearRouteQuery?: (keys: string[]) => boolean;
  updateRouteQuery?: (updates: Record<string, string | undefined>) => boolean;
  showAssetDetail: Ref<boolean>;
  detailAsset: Ref<AssetDetail | null>;
  detailLoading: Ref<boolean>;
  detailError: Ref<string>;
  closeAssetDetail: () => void;
  statusLabel: (status: string) => string;
  systemSettingsDefinitions: ComputedRef<SystemSettingDefinition[]>;
}

const defaultColumns: AssetColumnOption[] = [
  { key: "name", label: "资产名称", defaultVisible: true, required: true },
  { key: "asset_no", label: "资产编号", defaultVisible: true, required: true },
  { key: "device_type", label: "设备类型", defaultVisible: true },
  { key: "manufacturer", label: "厂商", defaultVisible: true },
  { key: "status", label: "状态", defaultVisible: true, required: true },
  { key: "data_center", label: "数据中心" },
  { key: "server_room", label: "机房" },
  { key: "rack_code", label: "机柜", defaultVisible: true },
  { key: "u_range", label: "U 位", defaultVisible: true },
  { key: "manufacturer_model", label: "型号" },
  { key: "maintenance_expiry_date", label: "保修到期" },
  { key: "purpose", label: "用途" },
  { key: "serial_number", label: "序列号" },
  { key: "responsible_user", label: "责任人", defaultVisible: true },
  { key: "business_ip", label: "业务 IP" },
  { key: "management_ip", label: "管理 IP" },
  { key: "oob_ip", label: "带外 IP" },
  { key: "purchase_date", label: "采购日期" },
  { key: "supplier", label: "供应商" },
  { key: "purchase_order_no", label: "采购单号" },
  { key: "depreciation_net_book_value", label: "当前净值", width: 140 },
  { key: "depreciation_accumulated_depreciation", label: "累计折旧", width: 140 },
  { key: "depreciation_status", label: "折旧状态", width: 110 },
  { key: "maintenance_provider", label: "维保厂商" },
  { key: "notes", label: "备注" },
];

const supportedColumnKeys = new Set<StaticAssetColumnKey>([
  ...defaultColumns.map((column) => column.key as StaticAssetColumnKey),
]);

const requiredColumnKeys = defaultColumns
  .filter((column) => column.required)
  .map((column) => column.key);
const ASSET_COLUMNS_STORAGE_KEY = "infrix.asset.columns";
const ASSET_COLUMNS_MIGRATION_KEY = "infrix.asset.columns.migration";
const ASSET_COLUMNS_MIGRATION_VERSION = "location-split-v3";
const ASSET_COLUMNS_MIGRATION_REMOVALS: StaticAssetColumnKey[] = ["data_center", "server_room"];
const ASSET_COLUMNS_AUTO_ADDED_VERSIONS = new Set(["location-split-v1", "location-split-v2"]);

function normalizeVisibleColumns(keys: AssetColumnKey[], dynamicKeys?: Set<string>): AssetColumnKey[] {
  const selected = new Set<AssetColumnKey>(keys);
  const normalizedStatic = defaultColumns
    .filter((column) => selected.has(column.key) || column.required)
    .map((column) => column.key);
  const normalizedDynamic = keys.filter(
    (key): key is DynamicAssetColumnKey => isDynamicAssetColumnKey(key) && (!dynamicKeys || dynamicKeys.has(dynamicAssetFieldKey(key))),
  );
  return [...normalizedStatic, ...Array.from(new Set(normalizedDynamic)).slice(0, MAX_DYNAMIC_ASSET_COLUMNS)];
}

function emptyAssetForm(defaultStatus = systemSettingsState.defaultAssetStatus): AssetFormState {
  return {
    asset_no: "",
    name: "",
    manufacturer_id: "",
    model: "",
    device_type: "",
    manufacturer_model: "",
    serial_number: "",
    purpose: "",
    status: defaultStatus,
    notes: "",
    rack_mounted: false,
    asset_data_center: "",
    data_center: "",
    server_room_id: "",
    rack_id: "",
    rack_total_u: "45",
    rack_start_u: "",
    rack_end_u: "",
    business_ip: "",
    management_ip: "",
    oob_ip: "",
    purchase_date: "",
    supplier: "",
    purchase_order_no: "",
    purchase_amount: "",
    procurement_notes: "",
    depreciation_enabled: false,
    depreciation_start_date: "",
    depreciation_years: null,
    residual_rate: "",
    maintenance_provider: "",
    maintenance_contract_no: "",
    maintenance_start_date: "",
    maintenance_expiry_date: "",
    maintenance_notes: "",
    tags: [],
    custom_values: {},
  };
}

function loadSavedColumns(): AssetColumnKey[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ASSET_COLUMNS_STORAGE_KEY) || "null");
    if (Array.isArray(saved)) {
      const valid = saved.filter((key): key is AssetColumnKey =>
        typeof key === "string" && (supportedColumnKeys.has(key as StaticAssetColumnKey) || isDynamicAssetColumnKey(key)),
      );
      if (valid.length) {
        const previousMigration = localStorage.getItem(ASSET_COLUMNS_MIGRATION_KEY);
        const migratedKeys = previousMigration && ASSET_COLUMNS_AUTO_ADDED_VERSIONS.has(previousMigration)
          ? valid.filter((key) => !ASSET_COLUMNS_MIGRATION_REMOVALS.includes(key as StaticAssetColumnKey))
          : valid;
        const normalized = normalizeVisibleColumns(migratedKeys);
        localStorage.setItem(ASSET_COLUMNS_STORAGE_KEY, JSON.stringify(normalized));
        localStorage.setItem(ASSET_COLUMNS_MIGRATION_KEY, ASSET_COLUMNS_MIGRATION_VERSION);
        return normalized;
      }
    }
  } catch {
    // Fall back to the defaults when local storage is malformed.
  }
  return normalizeVisibleColumns(
    defaultColumns.filter((column) => column.defaultVisible).map((column) => column.key),
  );
}

const assetFormFieldNames = new Set([
  "asset_no",
  "name",
  "manufacturer_id",
  "manufacturer",
  "model",
  "device_type",
  "manufacturer_model",
  "serial_number",
  "purpose",
  "status",
  "notes",
  "asset_data_center",
  "data_center",
  "server_room_id",
  "rack_id",
  "rack_total_u",
  "rack_start_u",
  "rack_end_u",
  "business_ip",
  "management_ip",
  "oob_ip",
  "purchase_date",
  "supplier",
  "purchase_order_no",
  "purchase_amount",
  "procurement_notes",
  "depreciation_enabled",
  "depreciation_start_date",
  "depreciation_years",
  "residual_rate",
  "depreciation_method",
  "configuration",
  "maintenance_provider",
  "maintenance_contract_no",
  "maintenance_start_date",
  "maintenance_expiry_date",
  "maintenance_notes",
  "tags",
  "custom_values",
]);

function extractAssetFormErrors(error: unknown): {
  fields: Record<string, string>;
  message: string;
} {
  const normalized = normalizeApiError(error);
  const allowedFields = [...assetFormFieldNames].filter((field) => field !== "custom_values");
  const fields = fieldErrorsToText(normalized.fieldErrors, allowedFields);
  for (const [field, messages] of Object.entries(normalized.fieldErrors)) {
    if (field.startsWith("custom_values.")) fields[field] = messages.join("；");
  }
  return { fields, message: normalized.message };
}

export function useAssets(deps: AssetsDeps) {
  const assets = ref<Asset[]>([]);
  const selectedAssetIds = ref<number[]>([]);
  const assetBatchDeleteSaving = ref(false);
  const assetBatchDeleteResult = ref<AssetBatchDeleteResponse | null>(null);
  const showAssetBatchDeleteResult = ref(false);
  const assetCount = ref(0);
  const assetPage = ref(1);
  const assetPageSize = ref(systemSettingsState.defaultPageSize);
  const assetSortField = ref<AssetSortField | null>(null);
  const assetSortOrder = ref<AssetSortOrder>(null);
  let assetPageSizeUserSelected = false;
  watch(
    () => systemSettingsState.defaultPageSize,
    (pageSize, previousPageSize) => {
      if (assetPageSizeUserSelected || pageSize === previousPageSize) return;
      assetPageSize.value = pageSize;
      assetPage.value = 1;
    },
  );
  const assetSearch = ref("");
  const assetLookup = ref("");
  const assetFilters = reactive<AssetFilters>({
    status: "",
    deviceType: "",
    tag: [],
    manufacturer: "",
    model: "",
    dataCenter: "",
    warranty: "",
  });
  const assetTagFilter = computed({
    get: () => assetFilters.tag,
    set: (value: string[]) => {
      assetFilters.tag = value;
    },
  });
  const draftCustomFilters = ref<AssetCustomFilter[]>([]);
  const appliedCustomFilters = ref<AssetCustomFilter[]>([]);
  const assetFilterCustomFieldSchema = ref<CustomFieldSchema[]>([]);
  const assetFilterCustomSchemaLoading = ref(false);
  const assetFilterCustomSchemaError = ref("");
  const assetFilterCustomSchemaLoaded = ref(false);
  const assetFilterCustomSchemaRequestId = ref(0);
  let assetFilterCustomSchemaController: AbortController | null = null;
  let assetFilterCustomSchemaPromise: Promise<boolean> | null = null;
  const assetListLoading = ref(false);
  const assetListError = ref("");
  const exportingAssets = ref(false);
  const visibleAssetColumns = ref<AssetColumnKey[]>(loadSavedColumns());
  const assetListCustomFieldSchema = ref<CustomFieldSchema[]>([]);
  const assetListCustomSchemaLoading = ref(false);
  const assetListCustomSchemaError = ref("");
  const assetListCustomSchemaLoaded = ref(false);
  const assetListCustomSchemaRequestId = ref(0);
  let assetListCustomSchemaController: AbortController | null = null;
  let assetListCustomSchemaPromise: Promise<boolean> | null = null;

  const showAssetModal = ref(false);
  const editingAsset = ref<Asset | null>(null);
  const assetModalMode = ref<"new" | "edit" | "clone">("new");
  const assetForm = ref<AssetFormState>(emptyAssetForm());
  const initialAssetStatusValues = computed<Set<AssetStatus>>(() => {
    const definition = deps.systemSettingsDefinitions.value.find(
      (item) => item.key === "default_asset_status",
    );
    const values = (definition?.options || [])
      .map((option) => String(option.value))
      .filter((value): value is AssetStatus => isAssetStatus(value) && value !== "repair");
    return new Set(
      values.length
        ? values
        : ASSET_STATUS_OPTIONS
            .filter((option) => option.value !== "repair")
            .map((option) => option.value),
    );
  });
  const assetStatusOptions = computed(() => {
    const serverAllowed = editingAsset.value?.allowed_statuses;
    const allowed = serverAllowed
      ? new Set(serverAllowed.filter(isAssetStatus))
      : initialAssetStatusValues.value;
    return ASSET_STATUS_OPTIONS.filter((option) => allowed.has(option.value));
  });
  const assetCustomFieldSchema = ref<CustomFieldSchema[]>([]);
  const assetFormExistingCustomFields = ref<AssetCustomFieldValue[]>([]);
  const assetFormLoading = ref(false);
  const assetFormLoadError = ref("");
  const assetFormSaving = ref(false);
  const assetFormFieldErrors = ref<Record<string, string>>({});
  const assetFormRequestId = ref(0);
  const depreciationStartTouched = ref(false);
  const assetCustomSchemaLoading = ref(false);
  const assetCustomSchemaError = ref("");
  const assetCustomSchemaRequestId = ref(0);
  const assetCustomFieldDeviceType = ref("");
  const assetCustomFieldUserEditedKeys = new Set<string>();
  let assetCustomSchemaController: AbortController | null = null;
  const assetFormTarget = ref<{ assetId: number | null; clone: boolean; isNew: boolean }>({
    assetId: null,
    clone: false,
    isNew: false,
  });

  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function errorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }

  function setActionError(error: unknown, fallback: string): string {
    const message = errorMessage(error, fallback);
    setActionMessage(message, "error");
    return message;
  }

  function watchAssetFormFieldErrors(fields: readonly string[]) {
    for (const field of fields) {
      watch(
        () => (assetForm.value as Record<string, unknown>)[field],
        () => {
          if (assetFormFieldErrors.value[field]) {
            assetFormFieldErrors.value = clearFieldError(assetFormFieldErrors.value, field);
          }
        },
      );
    }
  }

  watchAssetFormFieldErrors([
    "asset_no",
    "name",
    "manufacturer_id",
    "model",
    "device_type",
    "manufacturer_model",
    "serial_number",
    "purpose",
    "status",
    "notes",
    "rack_mounted",
    "asset_data_center",
    "data_center",
    "server_room_id",
    "rack_id",
    "rack_total_u",
    "rack_start_u",
    "rack_end_u",
    "business_ip",
    "management_ip",
    "oob_ip",
    "purchase_date",
    "supplier",
    "purchase_order_no",
    "purchase_amount",
    "procurement_notes",
    "depreciation_enabled",
    "depreciation_start_date",
    "depreciation_years",
    "residual_rate",
    "maintenance_provider",
    "maintenance_contract_no",
    "maintenance_start_date",
    "maintenance_expiry_date",
    "maintenance_notes",
    "tags",
    "configuration",
  ]);
  watch(
    () => JSON.stringify(assetForm.value.custom_values || {}),
    () => {
      const next = Object.fromEntries(
        Object.entries(assetFormFieldErrors.value)
          .filter(([field]) => !field.startsWith("custom_values.")),
      );
      if (Object.keys(next).length !== Object.keys(assetFormFieldErrors.value).length) {
        assetFormFieldErrors.value = next;
      }
    },
  );

  const importFile = ref<File | null>(null);
  const showImportDialog = ref(false);
  const importStep = ref<ImportStep>("upload");
  const importPreview = ref<ImportPreview | null>(null);
  const importPreviewFilter = ref<"all" | "errors">("all");
  const importPreviewError = ref("");
  const importPreviewing = ref(false);
  const importing = ref(false);
  const importResult = ref<ImportResult>({ created: 0, total: 0, errors: [] });
  let importController: AbortController | null = null;
  const detailRequestId = ref(0);
  const detailAssetId = ref<number | null>(null);
  const inventoryHistoryItems = ref<InventoryItem[]>([]);
  const inventoryHistoryLatest = ref<InventoryItem | null>(null);
  const inventoryHistoryPage = ref(1);
  const inventoryHistoryPageSize = ref(systemSettingsState.defaultPageSize);
  const inventoryHistoryTotal = ref(0);
  const inventoryHistoryLoading = ref(false);
  const inventoryHistoryError = ref("");
  const inventoryHistoryCanView = ref(false);
  const inventoryHistoryRequestId = ref(0);
  let inventoryHistoryController: AbortController | null = null;
  const responsibilityHistoryItems = ref<AssetResponsibilityEvent[]>([]);
  const responsibilityHistoryPage = ref(1);
  const responsibilityHistoryPageSize = ref(systemSettingsState.defaultPageSize);
  const responsibilityHistoryTotal = ref(0);
  const responsibilityHistoryLoading = ref(false);
  const responsibilityHistoryError = ref("");
  const responsibilityHistoryCanView = ref(false);
  const responsibilityHistoryRequestId = ref(0);
  let responsibilityHistoryController: AbortController | null = null;
  const responsibilityUsers = ref<AssetResponsibilityUser[]>([]);
  const responsibilityUsersLoading = ref(false);
  const responsibilityUsersError = ref("");
  const responsibilityUsersRequestId = ref(0);
  let responsibilityUsersController: AbortController | null = null;
  const responsibilityActionSaving = ref(false);
  const responsibilityActionError = ref("");
  const responsibilityActionFieldErrors = ref<Record<string, string>>({});

  const assetDynamicColumnOptions = computed<AssetColumnOption[]>(() =>
    assetListCustomFieldSchema.value.map((field) => ({
      key: `custom:${field.key}` as DynamicAssetColumnKey,
      label: field.name,
      dynamic: true,
      field,
      scopeLabel: field.device_type_name || tr("common.global"),
      width: field.field_type === "textarea" ? 160 : 130,
    })),
  );
  const visibleAssetColumnOptions = computed(() =>
    [...defaultColumns, ...assetDynamicColumnOptions.value].filter((column) => visibleAssetColumns.value.includes(column.key)),
  );
  const assetRoomOptions = computed(() =>
    deps.serverRooms.value.filter(
      (room) => room.is_active && String(room.data_center) === assetForm.value.data_center,
    ),
  );
  const assetRackOptions = computed(() =>
    deps.racks.value.filter(
      (rack) =>
        rack.is_active !== false &&
        (rack.status || "in_use") === "in_use" &&
        String(rack.room) === assetForm.value.server_room_id,
    ),
  );
  const activeManufacturers = computed(() => {
    const current = deps.manufacturers.value.find((item) => String(item.id) === assetForm.value.manufacturer_id);
    return deps.manufacturers.value.filter((item) => item.is_active || item.id === current?.id);
  });
  const activeDeviceTypes = computed(() => {
    const current = deps.deviceTypes.value.find((item) => String(item.id) === assetForm.value.device_type);
    return deps.deviceTypes.value.filter((item) => item.is_active || item.id === current?.id);
  });
  const activeDataCenters = computed(() => {
    const currentIds = new Set(
      [assetForm.value.data_center, assetForm.value.asset_data_center].filter(Boolean),
    );
    return deps.dataCenters.value.filter(
      (item) => item.is_active !== false || currentIds.has(String(item.id)),
    );
  });

  function saveVisibleColumns() {
    localStorage.setItem(ASSET_COLUMNS_STORAGE_KEY, JSON.stringify(visibleAssetColumns.value));
    localStorage.setItem(ASSET_COLUMNS_MIGRATION_KEY, ASSET_COLUMNS_MIGRATION_VERSION);
  }

  function selectedAssetCustomColumnKeys(): string[] {
    const availableKeys = new Set(assetListCustomFieldSchema.value.map((field) => field.key));
    return visibleAssetColumns.value
      .filter(isDynamicAssetColumnKey)
      .map(dynamicAssetFieldKey)
      .filter((key) => availableKeys.has(key));
  }

  async function loadAssetListCustomSchema(force = false): Promise<boolean> {
    if (!force && assetListCustomSchemaLoaded.value) return true;
    if (!force && assetListCustomSchemaPromise) return assetListCustomSchemaPromise;

    assetListCustomSchemaController?.abort();
    const controller = new AbortController();
    assetListCustomSchemaController = controller;
    const requestId = ++assetListCustomSchemaRequestId.value;
    assetListCustomSchemaLoading.value = true;
    assetListCustomSchemaError.value = "";

    const request = (async () => {
      try {
        const result = await deps.request<CustomFieldSchema[]>("/custom-fields/schema/?list_visible=1", {
          signal: controller.signal,
        });
        if (!result || requestId !== assetListCustomSchemaRequestId.value || controller.signal.aborted) return false;

        const fields = result.filter((field) => field.is_active !== false && field.list_visible !== false);
        assetListCustomFieldSchema.value = fields;
        assetListCustomSchemaLoaded.value = true;
        const availableKeys = new Set(fields.map((field) => field.key));
        visibleAssetColumns.value = normalizeVisibleColumns(visibleAssetColumns.value, availableKeys);
        saveVisibleColumns();
        return true;
      } catch (error) {
        if (requestId === assetListCustomSchemaRequestId.value && !isAbortError(error)) {
          assetListCustomFieldSchema.value = [];
          assetListCustomSchemaLoaded.value = false;
          assetListCustomSchemaError.value = errorMessage(error, tr("asset.extendedColumnsLoadFailed"));
        }
        return false;
      } finally {
        if (requestId === assetListCustomSchemaRequestId.value) {
          assetListCustomSchemaLoading.value = false;
          if (assetListCustomSchemaController === controller) assetListCustomSchemaController = null;
        }
      }
    })();
    assetListCustomSchemaPromise = request;
    try {
      return await request;
    } finally {
      if (assetListCustomSchemaPromise === request) assetListCustomSchemaPromise = null;
    }
  }

  function ensureAssetListCustomSchema() {
    if (assetListCustomSchemaLoaded.value || assetListCustomSchemaLoading.value) return;
    void loadAssetListCustomSchema().then((loaded) => {
      if (loaded && selectedAssetCustomColumnKeys().length) void loadAssets();
    });
  }

  async function retryAssetListCustomSchema() {
    if (await loadAssetListCustomSchema(true)) await loadAssets();
  }

  async function loadAssetFilterCustomSchema(force = false): Promise<boolean> {
    if (!force && assetFilterCustomSchemaLoaded.value) return true;
    if (!force && assetFilterCustomSchemaPromise) return assetFilterCustomSchemaPromise;

    assetFilterCustomSchemaController?.abort();
    const controller = new AbortController();
    assetFilterCustomSchemaController = controller;
    const requestId = ++assetFilterCustomSchemaRequestId.value;
    assetFilterCustomSchemaLoading.value = true;
    assetFilterCustomSchemaError.value = "";

    const request = (async () => {
      try {
        const result = await deps.request<CustomFieldSchema[]>("/custom-fields/schema/?filterable=1", {
          signal: controller.signal,
        });
        if (!result || requestId !== assetFilterCustomSchemaRequestId.value || controller.signal.aborted) return false;

        assetFilterCustomFieldSchema.value = result.filter((field) => field.is_active !== false && field.filterable === true);
        assetFilterCustomSchemaLoaded.value = true;
        return true;
      } catch (error) {
        if (requestId === assetFilterCustomSchemaRequestId.value && !isAbortError(error)) {
          assetFilterCustomFieldSchema.value = [];
          assetFilterCustomSchemaLoaded.value = false;
          assetFilterCustomSchemaError.value = errorMessage(error, tr("asset.dynamicFiltersLoadFailed"));
        }
        return false;
      } finally {
        if (requestId === assetFilterCustomSchemaRequestId.value) {
          assetFilterCustomSchemaLoading.value = false;
          if (assetFilterCustomSchemaController === controller) assetFilterCustomSchemaController = null;
        }
      }
    })();
    assetFilterCustomSchemaPromise = request;
    try {
      return await request;
    } finally {
      if (assetFilterCustomSchemaPromise === request) assetFilterCustomSchemaPromise = null;
    }
  }

  function ensureAssetFilterCustomSchema() {
    if (assetFilterCustomSchemaLoaded.value || assetFilterCustomSchemaLoading.value) return;
    void loadAssetFilterCustomSchema();
  }

  async function retryAssetFilterCustomSchema() {
    await loadAssetFilterCustomSchema(true);
  }

  function invalidCustomFilterError(error: unknown): string {
    if (!(error instanceof ApiError) || error.status !== 400) return "";
    const message = fieldErrorsToText(normalizeApiError(error).fieldErrors).custom_filters;
    return message ? tr("asset.invalidFilter", { message }) : "";
  }

  function assetOrderingValue(): string | undefined {
    if (!assetSortField.value || !assetSortOrder.value) return undefined;
    const field = ASSET_SORT_FIELD_MAP[assetSortField.value];
    return assetSortOrder.value === "descending" ? `-${field}` : field;
  }

  function assetRouteQueryUpdates(): Record<string, string | undefined> {
    return {
      search: assetSearch.value.trim() || undefined,
      status: assetFilters.status || undefined,
      device_type: assetFilters.deviceType || undefined,
      tags: assetFilters.tag.length ? assetFilters.tag.join(",") : undefined,
      manufacturer: assetFilters.manufacturer || undefined,
      model: assetFilters.model.trim() || undefined,
      data_center: assetFilters.dataCenter || undefined,
      warranty: assetFilters.warranty || undefined,
      ordering: assetOrderingValue(),
    };
  }

  function assetSortFromOrdering(value: string): { field: AssetSortField | null; order: AssetSortOrder } {
    const descending = value.startsWith("-");
    const apiField = descending ? value.slice(1) : value;
    const field = (Object.keys(ASSET_SORT_FIELD_MAP) as AssetSortField[]).find(
      (candidate) => ASSET_SORT_FIELD_MAP[candidate] === apiField,
    ) || null;
    return {
      field,
      order: field ? (descending ? "descending" : "ascending") : null,
    };
  }

  function assetQueryParams(includePagination = true) {
    const params = new URLSearchParams();
    if (includePagination) {
      params.set("page", String(assetPage.value));
      params.set("page_size", String(assetPageSize.value));
      params.set("compact", "1");
    }
    if (assetSearch.value.trim()) params.set("search", assetSearch.value.trim());
    if (assetFilters.status) params.set("status", assetFilters.status);
    if (assetFilters.deviceType) params.set("device_type", assetFilters.deviceType);
    if (assetFilters.tag.length) params.set("tags", assetFilters.tag.join(","));
    if (assetFilters.manufacturer) params.set("manufacturer", assetFilters.manufacturer);
    if (assetFilters.model.trim()) params.set("model", assetFilters.model.trim());
    if (assetFilters.dataCenter) params.set("data_center", assetFilters.dataCenter);
    if (assetFilters.warranty) params.set("warranty", assetFilters.warranty);
    const ordering = assetOrderingValue();
    if (ordering) params.set("ordering", ordering);
    for (const filter of appliedCustomFilters.value) {
      if (filter.fieldKey && filter.value.trim()) {
        params.append(`custom__${filter.fieldKey}__${filter.operator}`, filter.value.trim());
      }
    }
    if (includePagination) {
      const requestedCustomColumns = selectedAssetCustomColumnKeys();
      if (requestedCustomColumns.length) params.set("custom_columns", requestedCustomColumns.join(","));
    }
    return params;
  }

  async function loadAssets(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.authenticated.value || !deps.can("assets.view")) return false;
    ensureAssetListCustomSchema();
    ensureAssetFilterCustomSchema();
    if (deps.isCurrentLoad(version)) {
      assetListLoading.value = true;
      assetListError.value = "";
    }
    const params = assetQueryParams();
    try {
      const payload = await deps.request<PageResult<Asset> | Asset[]>(`/assets/?${params.toString()}`);
      if (!payload || !deps.isCurrentLoad(version)) return false;

      const nextAssets = pageItems(payload);
      const nextCount = pageTotal(payload);
      const maxPage = Math.max(1, Math.ceil(nextCount / assetPageSize.value));
      if (assetPage.value > maxPage) {
        assetPage.value = maxPage;
        return loadAssets();
      }

      assets.value = nextAssets;
      assetCount.value = nextCount;
      selectedAssetIds.value = [];
      return true;
    } catch (error) {
      if (deps.isCurrentLoad(version) && !isAbortError(error)) {
        assetListError.value = invalidCustomFilterError(error) || errorMessage(error, tr("asset.dataLoadFailed"));
      }
      return false;
    } finally {
      if (deps.isCurrentLoad(version)) assetListLoading.value = false;
    }
  }

  function visibleCustomFields(schema: CustomFieldSchema[]) {
    return schema.filter((field) => field.is_active !== false && field.form_visible !== false);
  }

  function hasCustomValue(values: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(values, key);
  }

  function defaultCustomFieldValue(field: CustomFieldSchema): unknown {
    const raw = field.default_value;
    if (!raw) return undefined;
    if (field.field_type === "number") {
      const value = Number(raw.trim());
      return Number.isFinite(value) ? value : undefined;
    }
    if (field.field_type === "boolean") return raw.trim() === "true";
    if (field.field_type === "multiselect") {
      try {
        const value: unknown = JSON.parse(raw);
        return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
      } catch {
        return undefined;
      }
    }
    return raw;
  }

  function reconcileCustomValuesForSchema(schema: CustomFieldSchema[]) {
    const current = assetForm.value.custom_values || {};
    const next: Record<string, unknown> = {};
    for (const field of visibleCustomFields(schema)) {
      if (hasCustomValue(current, field.key)) {
        next[field.key] = current[field.key];
        continue;
      }
      if (assetModalMode.value === "new" && !assetCustomFieldUserEditedKeys.has(field.key)) {
        const defaultValue = defaultCustomFieldValue(field);
        if (defaultValue !== undefined) next[field.key] = defaultValue;
        else if (field.field_type === "boolean") next[field.key] = false;
      }
    }
    assetForm.value.custom_values = next;
  }

  function resetCustomValuesForDeviceType(deviceTypeId: string) {
    if (!deviceTypeId) return;
    const values = assetForm.value.custom_values || {};
    for (const field of assetCustomFieldSchema.value) {
      if (field.device_type != null && String(field.device_type) === deviceTypeId) {
        delete values[field.key];
        assetCustomFieldUserEditedKeys.delete(field.key);
      }
    }
    assetForm.value.custom_values = { ...values };
  }

  function updateAssetCustomFieldValue(key: string, value: unknown) {
    assetForm.value.custom_values[key] = value;
    assetCustomFieldUserEditedKeys.add(key);
  }

  function resetAssetCustomSchemaState() {
    assetCustomSchemaController?.abort();
    assetCustomSchemaController = null;
    assetCustomSchemaRequestId.value += 1;
    assetCustomSchemaLoading.value = false;
    assetCustomSchemaError.value = "";
    assetCustomFieldDeviceType.value = "";
    assetCustomFieldSchema.value = [];
    assetFormExistingCustomFields.value = [];
  }

  function currentCustomValuesForSubmit(values: Record<string, unknown>) {
    const allowedKeys = new Set(visibleCustomFields(assetCustomFieldSchema.value).map((field) => field.key));
    return Object.fromEntries(
      Object.entries(values).filter(([key]) =>
        allowedKeys.has(key) && (
          !editingAsset.value || assetCustomFieldUserEditedKeys.has(key)
        ),
      ),
    );
  }

  async function loadAssetCustomSchema(
    deviceTypeId: string | number,
    existingFields: AssetCustomFieldValue[] = [],
  ): Promise<boolean> {
    const normalizedDeviceType = deviceTypeId ? String(deviceTypeId) : "";
    assetCustomSchemaController?.abort();
    const controller = new AbortController();
    assetCustomSchemaController = controller;
    const requestId = ++assetCustomSchemaRequestId.value;
    assetCustomFieldDeviceType.value = normalizedDeviceType;
    assetCustomSchemaLoading.value = true;
    assetCustomSchemaError.value = "";
    assetCustomFieldSchema.value = [];
    const query = normalizedDeviceType ? `?device_type=${encodeURIComponent(normalizedDeviceType)}` : "";
    try {
      const result = await deps.request<CustomFieldSchema[]>(`/custom-fields/schema/${query}`, { signal: controller.signal });
      if (!result || requestId !== assetCustomSchemaRequestId.value) return false;
      const existingByKey = new Map(existingFields.map((field) => [field.key, field]));
      const schemaWithExistingOptions = result.map((field) => {
        if (!field.options || !["select", "multiselect"].includes(field.field_type)) return field;
        const existing = existingByKey.get(field.key);
        if (!existing?.options?.length) return field;
        const options = [...field.options];
        for (const option of existing.options) {
          if (!options.some((candidate) => candidate.value === option.value)) options.push(option);
        }
        return { ...field, options };
      });
      assetCustomFieldSchema.value = schemaWithExistingOptions;
      reconcileCustomValuesForSchema(schemaWithExistingOptions);
      return true;
    } catch (error) {
      if (requestId === assetCustomSchemaRequestId.value && !isAbortError(error)) {
        assetCustomSchemaError.value = errorMessage(error, tr("asset.extendedFieldsLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === assetCustomSchemaRequestId.value) {
        assetCustomSchemaLoading.value = false;
        if (assetCustomSchemaController === controller) assetCustomSchemaController = null;
      }
    }
  }

  function resetInventoryHistoryState() {
    inventoryHistoryController?.abort();
    inventoryHistoryController = null;
    inventoryHistoryRequestId.value += 1;
    inventoryHistoryItems.value = [];
    inventoryHistoryLatest.value = null;
    inventoryHistoryPage.value = 1;
    inventoryHistoryTotal.value = 0;
    inventoryHistoryLoading.value = false;
    inventoryHistoryError.value = "";
    inventoryHistoryCanView.value = false;
  }

  async function loadInventoryHistory(assetId: number, requestedPage = inventoryHistoryPage.value): Promise<boolean> {
    if (!deps.can("inventory.view")) {
      inventoryHistoryCanView.value = false;
      return true;
    }

    inventoryHistoryCanView.value = true;
    inventoryHistoryController?.abort();
    const controller = new AbortController();
    inventoryHistoryController = controller;
    const requestId = ++inventoryHistoryRequestId.value;
    const pageNumber = Math.max(1, Math.trunc(requestedPage || 1));
    inventoryHistoryPage.value = pageNumber;
    inventoryHistoryLoading.value = true;
    inventoryHistoryError.value = "";
    const params = new URLSearchParams({
      page: String(pageNumber),
      page_size: String(inventoryHistoryPageSize.value),
    });

    try {
      const payload = await deps.request<PageResult<InventoryItem>>(
        `/assets/${assetId}/inventory-records/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (
        requestId !== inventoryHistoryRequestId.value ||
        detailAssetId.value !== assetId ||
        controller.signal.aborted
      ) return false;
      inventoryHistoryItems.value = pageItems(payload);
      inventoryHistoryTotal.value = pageTotal(payload);
      return true;
    } catch (error) {
      if (
        requestId === inventoryHistoryRequestId.value &&
        detailAssetId.value === assetId &&
        !isAbortError(error)
      ) {
        const normalized = normalizeApiError(error);
        inventoryHistoryError.value = normalized.kind === "unknown"
          ? tr("asset.relatedDataLoadFailed")
          : normalized.message;
      }
      return false;
    } finally {
      if (requestId === inventoryHistoryRequestId.value) {
        inventoryHistoryLoading.value = false;
        if (inventoryHistoryController === controller) inventoryHistoryController = null;
      }
    }
  }

  function resetResponsibilityHistoryState() {
    responsibilityHistoryController?.abort();
    responsibilityHistoryController = null;
    responsibilityHistoryRequestId.value += 1;
    responsibilityHistoryItems.value = [];
    responsibilityHistoryPage.value = 1;
    responsibilityHistoryTotal.value = 0;
    responsibilityHistoryLoading.value = false;
    responsibilityHistoryError.value = "";
    responsibilityHistoryCanView.value = false;
  }

  async function loadResponsibilityHistory(assetId: number, requestedPage = responsibilityHistoryPage.value): Promise<boolean> {
    if (!deps.can("assets.view")) {
      responsibilityHistoryCanView.value = false;
      return true;
    }

    responsibilityHistoryCanView.value = true;
    responsibilityHistoryController?.abort();
    const controller = new AbortController();
    responsibilityHistoryController = controller;
    const requestId = ++responsibilityHistoryRequestId.value;
    const pageNumber = Math.max(1, Math.trunc(requestedPage || 1));
    responsibilityHistoryPage.value = pageNumber;
    responsibilityHistoryLoading.value = true;
    responsibilityHistoryError.value = "";
    const params = new URLSearchParams({
      page: String(pageNumber),
      page_size: String(responsibilityHistoryPageSize.value),
    });

    try {
      const payload = await deps.request<PageResult<AssetResponsibilityEvent>>(
        `/assets/${assetId}/responsibility-history/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (
        requestId !== responsibilityHistoryRequestId.value ||
        detailAssetId.value !== assetId ||
        controller.signal.aborted
      ) return false;
      responsibilityHistoryItems.value = pageItems(payload);
      responsibilityHistoryTotal.value = pageTotal(payload);
      return true;
    } catch (error) {
      if (
        requestId === responsibilityHistoryRequestId.value &&
        detailAssetId.value === assetId &&
        !isAbortError(error)
      ) {
        const normalized = normalizeApiError(error);
        responsibilityHistoryError.value = normalized.kind === "unknown"
          ? tr("asset.responsibilityHistoryLoadFailed")
          : normalized.message;
      }
      return false;
    } finally {
      if (requestId === responsibilityHistoryRequestId.value) {
        responsibilityHistoryLoading.value = false;
        if (responsibilityHistoryController === controller) responsibilityHistoryController = null;
      }
    }
  }

  async function loadResponsibilityUsers(search = ""): Promise<boolean> {
    if (!deps.can("assets.view")) return false;
    responsibilityUsersController?.abort();
    const controller = new AbortController();
    responsibilityUsersController = controller;
    const requestId = ++responsibilityUsersRequestId.value;
    responsibilityUsersLoading.value = true;
    responsibilityUsersError.value = "";
    const params = new URLSearchParams({ page: "1", page_size: "50" });
    if (search.trim()) params.set("search", search.trim());
    try {
      const payload = await deps.request<PageResult<AssetResponsibilityUser>>(
        `/assets/responsibility-users/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (requestId !== responsibilityUsersRequestId.value || controller.signal.aborted) return false;
      responsibilityUsers.value = pageItems(payload);
      return true;
    } catch (error) {
      if (requestId === responsibilityUsersRequestId.value && !isAbortError(error)) {
        const normalized = normalizeApiError(error);
        responsibilityUsersError.value = normalized.kind === "unknown"
          ? tr("asset.responsibilityUsersLoadFailed")
          : normalized.message;
      }
      return false;
    } finally {
      if (requestId === responsibilityUsersRequestId.value) {
        responsibilityUsersLoading.value = false;
        if (responsibilityUsersController === controller) responsibilityUsersController = null;
      }
    }
  }

  async function mutateAssetResponsibility(
    assetId: number,
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<boolean> {
    if (!deps.can("assets.manage") || responsibilityActionSaving.value) return false;
    responsibilityActionSaving.value = true;
    responsibilityActionError.value = "";
    responsibilityActionFieldErrors.value = {};
    try {
      await deps.request<AssetDetail>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const listRefreshed = await loadAssets();
      let detailRefreshed = true;
      let historyRefreshed = true;
      if (deps.showAssetDetail.value && detailAssetId.value === assetId) {
        await openAssetDetail(assetId);
        detailRefreshed = !deps.detailError.value;
        historyRefreshed = !inventoryHistoryError.value && !responsibilityHistoryError.value;
      }
      const refreshFailed = !(listRefreshed && detailRefreshed && historyRefreshed);
      setActionMessage(
        refreshFailed
          ? `${successMessage}；${tr("common.refreshFailed")}，${tr("common.retry")}`
          : successMessage,
        refreshFailed ? "error" : "success",
      );
      return true;
    } catch (error) {
      if (!isAbortError(error)) {
        const normalized = normalizeApiError(error);
        responsibilityActionFieldErrors.value = fieldErrorsToText(
          normalized.fieldErrors,
          RESPONSIBILITY_ACTION_FIELDS,
        );
        const hasUnknownField = Object.keys(normalized.fieldErrors).some(
          (field) => !RESPONSIBILITY_ACTION_FIELDS.includes(field as typeof RESPONSIBILITY_ACTION_FIELDS[number]),
        );
        responsibilityActionError.value = normalized.kind === "field-validation" && !hasUnknownField
          ? ""
          : normalized.kind === "unknown"
            ? tr("asset.responsibilityActionFailed")
            : normalized.message;
      }
      return false;
    } finally {
      responsibilityActionSaving.value = false;
    }
  }

  function clearResponsibilityActionErrors() {
    responsibilityActionError.value = "";
    responsibilityActionFieldErrors.value = {};
  }

  function clearResponsibilityActionFieldError(field: string) {
    if (responsibilityActionFieldErrors.value[field]) {
      responsibilityActionFieldErrors.value = clearFieldError(
        responsibilityActionFieldErrors.value,
        field,
      );
    }
  }

  function assignAsset(assetId: number, targetUserId: number, reason: string): Promise<boolean> {
    return mutateAssetResponsibility(
      assetId,
      `/assets/${assetId}/assign/`,
      { target_user: targetUserId, reason },
      tr("asset.assignSuccess"),
    );
  }

  function returnAsset(assetId: number, reason: string): Promise<boolean> {
    return mutateAssetResponsibility(
      assetId,
      `/assets/${assetId}/return/`,
      { reason },
      tr("asset.returnSuccess"),
    );
  }

  function transferAsset(assetId: number, targetUserId: number, reason: string): Promise<boolean> {
    return mutateAssetResponsibility(
      assetId,
      `/assets/${assetId}/transfer/`,
      { target_user: targetUserId, reason },
      tr("asset.transferSuccess"),
    );
  }

  async function openAssetDetail(assetId: number) {
    if (!deps.can("assets.view")) return;
    const requestId = ++detailRequestId.value;
    detailAssetId.value = assetId;
    resetInventoryHistoryState();
    resetResponsibilityHistoryState();
    deps.showAssetDetail.value = true;
    deps.detailLoading.value = true;
    deps.detailError.value = "";
    deps.detailAsset.value = null;
    let detailLoaded = false;
    try {
      const asset = await deps.request<AssetDetail>(`/assets/${assetId}/`);
      if (requestId === detailRequestId.value) {
        deps.detailAsset.value = asset;
        inventoryHistoryTotal.value = asset.inventory_records_count || 0;
        inventoryHistoryLatest.value = asset.latest_inventory_record || null;
        detailLoaded = true;
      }
    } catch (error) {
      if (requestId === detailRequestId.value && !isAbortError(error)) {
        deps.detailError.value = errorMessage(error, tr("asset.assetDetailLoadFailed"));
      }
    } finally {
      if (requestId === detailRequestId.value) deps.detailLoading.value = false;
    }
    if (detailLoaded && requestId === detailRequestId.value) {
      await Promise.all([
        loadInventoryHistory(assetId),
        loadResponsibilityHistory(assetId),
      ]);
    }
  }

  async function retryAssetDetail() {
    if (detailAssetId.value) await openAssetDetail(detailAssetId.value);
  }

  async function retryInventoryHistory() {
    if (detailAssetId.value && inventoryHistoryCanView.value) {
      await loadInventoryHistory(detailAssetId.value, inventoryHistoryPage.value);
    }
  }

  async function changeInventoryHistoryPage(pageNumber: number) {
    if (!detailAssetId.value || !inventoryHistoryCanView.value) return;
    await loadInventoryHistory(detailAssetId.value, pageNumber);
  }

  async function changeInventoryHistoryPageSize(size: number) {
    if (!detailAssetId.value || !inventoryHistoryCanView.value) return;
    if (![20, 50, 100].includes(size)) return;
    inventoryHistoryPageSize.value = size;
    await loadInventoryHistory(detailAssetId.value, 1);
  }

  async function retryResponsibilityHistory() {
    if (detailAssetId.value && responsibilityHistoryCanView.value) {
      await loadResponsibilityHistory(detailAssetId.value, responsibilityHistoryPage.value);
    }
  }

  async function changeResponsibilityHistoryPage(pageNumber: number) {
    if (!detailAssetId.value || !responsibilityHistoryCanView.value) return;
    await loadResponsibilityHistory(detailAssetId.value, pageNumber);
  }

  async function changeResponsibilityHistoryPageSize(size: number) {
    if (!detailAssetId.value || !responsibilityHistoryCanView.value) return;
    if (![20, 50, 100].includes(size)) return;
    responsibilityHistoryPageSize.value = size;
    await loadResponsibilityHistory(detailAssetId.value, 1);
  }

  /**
   * Refresh the drawer only when it is still showing the asset that changed.
   * Returning null means no refresh was needed; false means a refresh was
   * attempted but the detail request failed.
   */
  async function refreshOpenAssetDetail(assetId: number): Promise<boolean | null> {
    if (!deps.showAssetDetail.value || detailAssetId.value !== assetId) return null;
    await openAssetDetail(assetId);
    return !deps.detailError.value;
  }

  async function openAssetEditor(assetId: number, clone = false) {
    if (!deps.can("assets.manage")) return;
    const requestId = ++assetFormRequestId.value;
    assetFormTarget.value = { assetId, clone, isNew: false };
    assetFormLoadError.value = "";
    assetFormFieldErrors.value = {};
    assetFormLoading.value = true;
    assetModalMode.value = clone ? "clone" : "edit";
    editingAsset.value = clone ? null : ({ id: assetId } as Asset);
    assetForm.value = emptyAssetForm();
    depreciationStartTouched.value = false;
    assetCustomFieldUserEditedKeys.clear();
    resetAssetCustomSchemaState();
    showAssetModal.value = true;
    try {
      await deps.loadRackManagement();
      const detail = await deps.request<AssetDetail>(`/assets/${assetId}/`);
      if (!detail || requestId !== assetFormRequestId.value) return;
      const network = (role: string) =>
        detail.network_addresses.find((item) => item.role === role)?.address || "";
      const rack = detail.rack_allocation;
      const procurement = detail.procurement_records[0];
      const maintenance = detail.maintenance_contracts[0];
      assetForm.value = {
        ...emptyAssetForm(),
        asset_no: detail.asset_no,
        name: detail.name,
        manufacturer_id: detail.manufacturer ? String(detail.manufacturer) : "",
        model: detail.model_name || detail.manufacturer_model || "",
        device_type: detail.device_type ? String(detail.device_type) : "",
        manufacturer_model: detail.manufacturer_model || "",
        serial_number: detail.serial_number || "",
        purpose: detail.purpose || "",
        status: detail.status,
        notes: detail.notes || "",
        rack_mounted: Boolean(rack),
        asset_data_center: detail.asset_data_center ? String(detail.asset_data_center) : "",
        data_center: rack?.data_center_id ? String(rack.data_center_id) : "",
        server_room_id: rack?.server_room_id ? String(rack.server_room_id) : "",
        rack_id: rack?.rack ? String(rack.rack) : "",
        rack_total_u: rack ? String(rack.rack_total_u) : "45",
        rack_start_u: rack ? String(rack.start_u) : "",
        rack_end_u: rack ? String(rack.end_u) : "",
        business_ip: network("business"),
        management_ip: network("management"),
        oob_ip: network("oob"),
        purchase_date: procurement?.purchase_date || "",
        supplier: procurement?.supplier || "",
        purchase_order_no: procurement?.order_no || "",
        purchase_amount: procurement?.amount || "",
        procurement_notes: procurement?.notes || "",
        depreciation_enabled: Boolean(
          detail.depreciation_start_date &&
          detail.depreciation_years != null &&
          detail.residual_rate != null &&
          detail.depreciation_method,
        ),
        depreciation_start_date: detail.depreciation_start_date || "",
        depreciation_years: detail.depreciation_years ?? null,
        residual_rate: rateToPercentageText(detail.residual_rate) || "",
        maintenance_provider: maintenance?.provider || "",
        maintenance_contract_no: maintenance?.contract_no || "",
        maintenance_start_date: maintenance?.start_date || "",
        maintenance_expiry_date: maintenance?.expiry_date || "",
        maintenance_notes: maintenance?.notes || "",
        tags: (detail.tags || [])
          .filter((tag) => !clone || tag.is_active)
          .map((tag) => String(tag.id)),
        custom_values: { ...(detail.custom_values || {}) },
      };
      assetFormExistingCustomFields.value = detail.custom_fields || [];
      depreciationStartTouched.value = Boolean(detail.depreciation_start_date);
      await loadAssetCustomSchema(
        detail.device_type ? String(detail.device_type) : "",
        assetFormExistingCustomFields.value,
      );
      if (requestId !== assetFormRequestId.value) return;
      editingAsset.value = clone ? null : detail;
      if (clone) {
        if (!assetStatusOptions.value.some((option) => option.value === assetForm.value.status)) {
          const defaultStatus = systemSettingsState.defaultAssetStatus;
          assetForm.value.status = assetStatusOptions.value.some((option) => option.value === defaultStatus)
            ? defaultStatus
            : assetStatusOptions.value[0]?.value || "in_stock";
        }
        assetForm.value.asset_no = "";
        assetForm.value.serial_number = "";
        assetForm.value.rack_mounted = false;
        assetForm.value.data_center = "";
        assetForm.value.asset_data_center = "";
        assetForm.value.server_room_id = "";
        assetForm.value.rack_id = "";
        assetForm.value.rack_start_u = "";
        assetForm.value.rack_end_u = "";
        assetForm.value.business_ip = "";
        assetForm.value.management_ip = "";
        assetForm.value.oob_ip = "";
      }
    } catch (error) {
      if (requestId === assetFormRequestId.value && !isAbortError(error)) {
        assetFormLoadError.value = errorMessage(error, tr("asset.formLoadFailed"));
      }
    } finally {
      if (requestId === assetFormRequestId.value) assetFormLoading.value = false;
    }
  }

  async function openNewAssetModal() {
    if (!deps.can("assets.manage")) return;
    const requestId = ++assetFormRequestId.value;
    assetFormTarget.value = { assetId: null, clone: false, isNew: true };
    assetFormLoadError.value = "";
    assetFormFieldErrors.value = {};
    editingAsset.value = null;
    assetModalMode.value = "new";
    assetForm.value = emptyAssetForm();
    depreciationStartTouched.value = false;
    assetCustomFieldUserEditedKeys.clear();
    resetAssetCustomSchemaState();
    showAssetModal.value = true;
    assetFormLoading.value = true;
    try {
      await deps.loadRackManagement();
      await loadAssetCustomSchema("");
    } catch (error) {
      if (requestId === assetFormRequestId.value && !isAbortError(error)) {
        assetFormLoadError.value = errorMessage(error, tr("asset.relatedDataLoadFailed"));
      }
    } finally {
      if (requestId === assetFormRequestId.value) assetFormLoading.value = false;
    }
  }

  function clearAssetFormErrors() {
    assetFormFieldErrors.value = {};
  }

  function syncDepreciationStartFromPurchase() {
    if (assetForm.value.depreciation_enabled && !depreciationStartTouched.value) {
      assetForm.value.depreciation_start_date = assetForm.value.purchase_date || "";
    }
  }

  function enableDepreciation() {
    if (assetForm.value.depreciation_years == null) assetForm.value.depreciation_years = 5;
    if (!assetForm.value.residual_rate.trim()) assetForm.value.residual_rate = "5";
    syncDepreciationStartFromPurchase();
  }

  function markDepreciationStartTouched() {
    depreciationStartTouched.value = true;
  }

  async function retryAssetFormLoad() {
    const target = assetFormTarget.value;
    if (target.assetId) {
      await openAssetEditor(target.assetId, target.clone);
    } else if (target.isNew) {
      await openNewAssetModal();
    }
  }

  async function retryAssetCustomSchema() {
    if (!showAssetModal.value || assetFormLoading.value) return;
    await loadAssetCustomSchema(assetForm.value.device_type, assetFormExistingCustomFields.value);
  }

  async function saveAsset() {
    if (!deps.can("assets.manage")) return;
    if (assetFormSaving.value || assetCustomSchemaLoading.value || assetCustomSchemaError.value) return;
    const editingAssetId = editingAsset.value?.id || null;
    assetFormFieldErrors.value = {};
    const existingDepreciation = Boolean(
      editingAsset.value && (
        editingAsset.value.depreciation_start_date ||
        editingAsset.value.depreciation_years != null ||
        editingAsset.value.residual_rate != null ||
        editingAsset.value.depreciation_method
      ),
    );
    if (existingDepreciation && !assetForm.value.depreciation_enabled) {
      const confirmed = await deps.confirmAction(tr("asset.clearDepreciationConfirm"));
      if (!confirmed) return;
    }
    assetFormSaving.value = true;
    try {
      const {
        data_center,
        asset_data_center,
        server_room_id,
        rack_id,
        rack_total_u,
        rack_start_u,
        rack_end_u,
        business_ip,
        management_ip,
        oob_ip,
        purchase_date,
        supplier,
        purchase_order_no,
        purchase_amount,
        procurement_notes,
        depreciation_enabled,
        depreciation_start_date,
        depreciation_years,
        residual_rate,
        model,
        maintenance_provider,
        maintenance_contract_no,
        maintenance_start_date,
        maintenance_expiry_date,
        maintenance_notes,
        rack_mounted,
        tags,
        custom_values,
        ...asset
      } = assetForm.value;
      const submittedCustomValues = currentCustomValuesForSubmit(custom_values || {});
      const depreciation = depreciation_enabled
        ? {
            depreciation_start_date: depreciation_start_date || null,
            depreciation_years,
            residual_rate: percentageToRate(residual_rate),
            depreciation_method: DEPRECIATION_METHOD_STRAIGHT_LINE,
          }
        : {
            depreciation_start_date: null,
            depreciation_years: null,
            residual_rate: null,
            depreciation_method: null,
          };
      if (
        rack_mounted &&
        [data_center, server_room_id, rack_id, rack_start_u, rack_end_u].some(
          (value) => !String(value || "").trim(),
        )
      ) {
        setActionMessage(tr("asset.rackPlacementIncomplete"), "error");
        return;
      }
      const method = editingAsset.value ? "PATCH" : "POST";
      const path = editingAsset.value ? `/assets/${editingAsset.value.id}/` : "/assets/";
      await deps.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...asset,
          ...depreciation,
          asset_data_center: asset_data_center || null,
          manufacturer_model: model || "",
          manufacturer_id: asset.manufacturer_id ? Number(asset.manufacturer_id) : null,
          model: model || "",
          device_type: asset.device_type || null,
          tags: (tags || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)),
          custom_values: submittedCustomValues,
          configuration: {
            data_center: rack_mounted ? data_center : "",
            server_room_id: rack_mounted ? server_room_id : "",
            rack_id: rack_mounted ? rack_id : "",
            rack_total_u: rack_mounted ? rack_total_u : "",
            rack_start_u: rack_mounted ? rack_start_u : "",
            rack_end_u: rack_mounted ? rack_end_u : "",
            business_ip,
            management_ip,
            oob_ip,
            purchase_date,
            supplier,
            purchase_order_no,
            purchase_amount,
            procurement_notes,
            maintenance_provider,
            maintenance_contract_no,
            maintenance_start_date,
            maintenance_expiry_date,
            maintenance_notes,
          },
        }),
      });
      showAssetModal.value = false;
      const wasEditing = Boolean(editingAssetId);
      editingAsset.value = null;
      assetForm.value = emptyAssetForm();
      depreciationStartTouched.value = false;
      assetCustomFieldUserEditedKeys.clear();
      await loadAssets();
      let refreshFailed = Boolean(assetListError.value);
      if (
        editingAssetId &&
        deps.showAssetDetail.value &&
        detailAssetId.value === editingAssetId
      ) {
        await openAssetDetail(editingAssetId);
        refreshFailed = refreshFailed || Boolean(deps.detailError.value);
      }
      setActionMessage(
        refreshFailed
          ? tr("asset.savedRefreshFailed")
          : wasEditing
            ? tr("asset.updated")
            : tr("asset.saved"),
        refreshFailed ? "error" : "success",
      );
    } catch (error) {
      const parsed = extractAssetFormErrors(error);
      assetFormFieldErrors.value = parsed.fields;
      setActionMessage(parsed.message, "error");
    } finally {
      assetFormSaving.value = false;
    }
  }

  function toggleAssetSelection(assetId: number) {
    selectedAssetIds.value = selectedAssetIds.value.includes(assetId)
      ? selectedAssetIds.value.filter((id) => id !== assetId)
      : [...selectedAssetIds.value, assetId];
  }
  function toggleAllAssetSelection() {
    const visibleIds = assets.value.map((asset) => asset.id);
    selectedAssetIds.value =
      visibleIds.length && visibleIds.every((id) => selectedAssetIds.value.includes(id))
        ? selectedAssetIds.value.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...selectedAssetIds.value, ...visibleIds]));
  }
  function handleElementAssetSelection(rows: Asset[]) {
    selectedAssetIds.value = rows.map((asset) => asset.id);
  }

  function clearAssetSelection() {
    selectedAssetIds.value = [];
  }

  async function deleteAsset(asset: Asset) {
    if (!deps.can("assets.manage")) return;
    if (!(await deps.confirmAction(tr("asset.deleteConfirm", { asset: asset.asset_no })))) return;
    try {
      await deps.request(`/assets/${asset.id}/`, { method: "DELETE" });
      selectedAssetIds.value = selectedAssetIds.value.filter((id) => id !== asset.id);
      setActionMessage(tr("asset.deleted"));
      if (!(await loadAssets())) {
        setActionMessage(tr("asset.deletedRefreshFailed"), "error");
      }
    } catch (error) {
      setActionError(error, tr("asset.deleteFailed"));
    }
  }

  async function deleteSelectedAssets() {
    if (!deps.can("assets.manage")) return;
    const ids = [...selectedAssetIds.value];
    if (!ids.length || assetBatchDeleteSaving.value) return;
    if (!(await deps.confirmAction(tr("asset.batchDeleteConfirm", { count: ids.length })))) return;
    assetBatchDeleteSaving.value = true;
    assetBatchDeleteResult.value = null;
    showAssetBatchDeleteResult.value = false;
    clearAssetSelection();
    try {
      const result = await deps.request<AssetBatchDeleteResponse>("/assets/batch-delete/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      assetBatchDeleteResult.value = result;
      const mutationMessage = result.failed
        ? tr("asset.batchDeleteSummary", { succeeded: result.succeeded, failed: result.failed })
        : tr("asset.batchDeleteSuccess", { count: result.succeeded });
      setActionMessage(mutationMessage, result.failed ? "error" : "success");
      const refreshed = await loadAssets();
      if (!refreshed) {
        setActionMessage(`${mutationMessage}；${tr("common.refreshFailed")}，${tr("common.retry")}`, "error");
      }
      if (result.failed) showAssetBatchDeleteResult.value = true;
    } catch (error) {
      setActionError(error, tr("asset.batchDeleteFailed"));
    } finally {
      assetBatchDeleteSaving.value = false;
    }
  }

  function closeAssetBatchDeleteResult() {
    if (assetBatchDeleteSaving.value) return;
    showAssetBatchDeleteResult.value = false;
    assetBatchDeleteResult.value = null;
  }

  async function exportAssets() {
    if (!deps.can("assets.export")) return;
    if (exportingAssets.value) return;
    exportingAssets.value = true;
    const query = buildExportQuery(assetQueryParams(false));
    try {
      await deps.download(`/reports/assets/export/${query ? `?${query}` : ""}`, tr("asset.exportFilename"));
    } catch (error) {
      setActionError(error, tr("asset.exportFailed"));
    } finally {
      exportingAssets.value = false;
    }
  }

  function toggleAssetColumn(key: string) {
    const columnKey = key as AssetColumnKey;
    if (requiredColumnKeys.includes(columnKey)) return;
    if (
      isDynamicAssetColumnKey(columnKey) &&
      !visibleAssetColumns.value.includes(columnKey) &&
      visibleAssetColumns.value.filter(isDynamicAssetColumnKey).length >= MAX_DYNAMIC_ASSET_COLUMNS
    ) {
      ElMessage.info(tr("asset.maxDynamicColumns", { count: MAX_DYNAMIC_ASSET_COLUMNS }));
      return;
    }
    if (visibleAssetColumns.value.includes(columnKey)) {
      if (visibleAssetColumns.value.length <= 1) return;
      visibleAssetColumns.value = visibleAssetColumns.value.filter((item) => item !== columnKey);
    } else {
      visibleAssetColumns.value = [...visibleAssetColumns.value, columnKey];
    }
    saveVisibleColumns();
    if (isDynamicAssetColumnKey(columnKey)) void loadAssets();
  }
  function resetAssetColumns() {
    visibleAssetColumns.value = normalizeVisibleColumns(
      defaultColumns.filter((column) => column.defaultVisible).map((column) => column.key),
    );
    saveVisibleColumns();
    void loadAssets();
  }
  function assetValue(asset: Asset, key: string): string {
    const rack = asset.rack_allocation;
    const network = (role: string) => {
      const compactValue = role === "business" ? asset.business_ip : role === "management" ? asset.management_ip : asset.oob_ip;
      return compactValue || asset.network_addresses?.find((item) => item.role === role)?.address || "";
    };
    const procurement = asset.procurement_records?.[0];
    const maintenance = asset.maintenance_contracts?.[0];
    const depreciation = asset.depreciation;
    const values: Record<StaticAssetColumnKey, string> = {
      asset_no: asset.asset_no,
      name: asset.name,
      device_type: asset.device_type_name || "—",
      manufacturer: asset.manufacturer_name || "—",
      manufacturer_model: asset.model || asset.manufacturer_model || "—",
      purpose: asset.purpose || "—",
      status: deps.statusLabel(asset.status),
      serial_number: asset.serial_number || "—",
      responsible_user: asset.responsible_user_name || "—",
      data_center: asset.data_center || rack?.data_center || asset.asset_data_center_name || "—",
      server_room: asset.server_room || rack?.server_room || "—",
      rack_code: asset.rack_code || rack?.rack_code || "—",
      u_range: asset.u_range || (rack?.start_u != null && rack?.end_u != null ? `U${rack.start_u}–U${rack.end_u}` : "—"),
      business_ip: network("business") || "—",
      management_ip: network("management") || "—",
      oob_ip: network("oob") || "—",
      purchase_date: asset.purchase_date || procurement?.purchase_date || "—",
      supplier: asset.supplier || procurement?.supplier || "—",
      purchase_order_no: asset.purchase_order_no || procurement?.order_no || "—",
      depreciation_net_book_value: formatMoneyDecimalString(depreciation?.net_book_value),
      depreciation_accumulated_depreciation: formatMoneyDecimalString(depreciation?.accumulated_depreciation),
      depreciation_status: depreciationStatusLabel(depreciation?.status || "unconfigured"),
      maintenance_provider: asset.maintenance_provider || maintenance?.provider || "—",
      maintenance_expiry_date: asset.maintenance_expiry_date || maintenance?.expiry_date || "—",
      notes: asset.notes || "—",
    };
    return values[key as StaticAssetColumnKey] || "—";
  }

  function importErrorText(detail: unknown) { return formatImportError(detail); }

  function resetImportState() {
    importController?.abort();
    importController = null;
    importFile.value = null;
    importStep.value = "upload";
    importPreview.value = null;
    importPreviewFilter.value = "all";
    importPreviewError.value = "";
    importResult.value = { created: 0, total: 0, errors: [] };
  }
  function openImportDialog() {
    if (!deps.can("assets.manage")) return;
    if (importPreviewing.value || importing.value) return;
    resetImportState();
    showImportDialog.value = true;
  }
  function closeImportDialog() {
    if (importPreviewing.value || importing.value) return;
    showImportDialog.value = false;
    resetImportState();
  }
  function chooseAnotherImportFile() {
    if (importPreviewing.value || importing.value) return;
    importFile.value = null;
    importStep.value = "upload";
    importPreview.value = null;
    importPreviewFilter.value = "all";
    importPreviewError.value = "";
  }
  async function onElementUploadChange(file: { raw?: File }) {
    if (!deps.can("assets.manage")) return;
    const selected = file.raw || null;
    if (!selected || importPreviewing.value || importing.value) return;
    importFile.value = selected;
    importPreview.value = null;
    importPreviewFilter.value = "all";
    importPreviewError.value = "";
    await previewImport();
  }
  async function previewImport() {
    if (!deps.can("assets.manage")) return;
    if (!importFile.value) return;
    const form = new FormData();
    form.append("file", importFile.value);
    importController?.abort();
    importController = new AbortController();
    importPreviewing.value = true;
    importPreviewError.value = "";
    try {
      const preview = await deps.request<ImportPreview>("/assets/import/preview/", { method: "POST", body: form, signal: importController.signal });
      const normalizedPreview = normalizeImportPreview(preview);
      importPreview.value = normalizedPreview;
      importStep.value = "preview";
      setActionMessage(tr("asset.importPreviewSummary", { valid: normalizedPreview.valid, invalid: normalizedPreview.invalid }));
    } catch (error) {
      if (isAbortError(error)) return;
      importPreviewError.value = errorMessage(error, tr("asset.importPreviewFailed"));
    } finally {
      importPreviewing.value = false;
      importController = null;
    }
  }
  const filteredImportRows = computed(() => {
    if (!importPreview.value || importPreviewFilter.value === "all") return importPreview.value?.rows || [];
    return importPreview.value.rows.filter((row) => !row.valid);
  });
  async function confirmImportPreview() {
    if (!deps.can("assets.manage")) return;
    if (!importPreview.value?.valid || importPreview.value.invalid || !importFile.value || importing.value) return;
    const form = new FormData();
    form.append("file", importFile.value);
    importController?.abort();
    importController = new AbortController();
    importing.value = true;
    importPreviewError.value = "";
    try {
      const result = await deps.request<ImportResult>("/assets/import/", { method: "POST", body: form, signal: importController.signal });
      importResult.value = result;
      importStep.value = "result";
      const importMessage = result.errors.length
        ? tr("overlay.importCreatedWithErrors", { created: result.created, failed: result.errors.length })
        : tr("asset.importSuccess", { count: result.created });
      const refreshed = await loadAssets();
      setActionMessage(
        refreshed ? importMessage : `${importMessage}；${tr("common.refreshFailed")}，${tr("common.retry")}`,
        result.errors.length || !refreshed ? "error" : "success",
      );
    } catch (error) {
      if (isAbortError(error)) return;
      const details = error instanceof ApiError ? error.details : null;
      if (details && typeof details === "object" && "preview" in details) {
        const latest = (details as { preview?: ImportPreview }).preview;
        if (latest) {
          const normalizedPreview = normalizeImportPreview(latest);
          importPreview.value = normalizedPreview;
          importStep.value = "preview";
          importPreviewFilter.value = normalizedPreview.invalid ? "errors" : "all";
        }
      }
      importPreviewError.value = errorMessage(error, tr("asset.importConfirmFailed"));
    } finally {
      importing.value = false;
      importController = null;
    }
  }
  async function copyImportErrors() {
    const text = importResult.value.errors
      .flatMap((item) => formatImportErrorEntries(item.detail).map(({ label, message }) => (
        `${tr("overlay.importErrorLine", { line: item.line })}${label ? `${label}：` : ""}${message}`
      )))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      ElMessage.success(tr("asset.importErrorsCopied"));
    } catch {
      ElMessage.warning(tr("asset.copyDenied"));
    }
  }
  function downloadImportErrors() {
    const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      [tr("common.line"), tr("common.field"), tr("common.errorDetails")].map(csvCell).join(","),
      ...importResult.value.errors.flatMap((item) => formatImportErrorEntries(item.detail).map(({ label, message }) => (
        [item.line, label || tr("common.errorDetails"), message].map(csvCell).join(",")
      ))),
    ];
    const url = URL.createObjectURL(new Blob([`\ufeff${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "asset-import-errors.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function downloadImportTemplate() {
    if (!deps.can("assets.manage")) return;
    try {
      await deps.download("/assets/import/template/", "asset-import-template.xlsx");
    } catch (error) {
      if (!isAbortError(error)) setActionError(error, tr("asset.importTemplateFailed"));
    }
  }
  async function syncAssetDeviceType() {
    const nextType = assetForm.value.device_type;
    const previousType = assetCustomFieldDeviceType.value;
    const previousValues = assetForm.value.custom_values || {};
    const hasPreviousScopedValues = previousType !== "" && assetCustomFieldSchema.value.some(
      (field) => field.device_type != null && String(field.device_type) === previousType && hasCustomValue(previousValues, field.key),
    );
    if (editingAsset.value && previousType !== nextType && hasPreviousScopedValues) {
      const confirmed = await deps.confirmAction(tr("asset.deviceTypeSwitchConfirm"));
      if (!confirmed) {
        assetForm.value.device_type = previousType;
        return;
      }
    }
    if (previousType !== nextType) resetCustomValuesForDeviceType(previousType);
    await loadAssetCustomSchema(nextType);
  }
  function changeAssetDataCenter() {
    assetForm.value.server_room_id = "";
    assetForm.value.rack_id = "";
    assetForm.value.rack_start_u = "";
    assetForm.value.rack_end_u = "";
  }
  function changeAssetRoom() {
    assetForm.value.rack_id = "";
    assetForm.value.rack_start_u = "";
    assetForm.value.rack_end_u = "";
  }
  function changeAssetRack() {
    const rack = deps.racks.value.find((item) => String(item.id) === assetForm.value.rack_id);
    assetForm.value.rack_total_u = rack ? String(rack.total_u) : "45";
  }
  function setAssetRackMounted(value: boolean) {
    assetForm.value.rack_mounted = value;
    if (!value) {
      assetForm.value.data_center = "";
      assetForm.value.server_room_id = "";
      assetForm.value.rack_id = "";
      assetForm.value.rack_total_u = "45";
      assetForm.value.rack_start_u = "";
      assetForm.value.rack_end_u = "";
    }
  }

  async function changeAssetSort(sort: { prop: string | null; order: AssetSortOrder }): Promise<void> {
    const field = sort.prop && Object.prototype.hasOwnProperty.call(ASSET_SORT_FIELD_MAP, sort.prop)
      ? sort.prop as AssetSortField
      : null;
    const order = field && (sort.order === "ascending" || sort.order === "descending")
      ? sort.order
      : null;
    assetSortField.value = field;
    assetSortOrder.value = order;
    clearAssetSelection();
    assetPage.value = 1;
    if (!appliedCustomFilters.value.length && deps.updateRouteQuery?.(assetRouteQueryUpdates())) return;
    await loadAssets();
  }

  async function searchLedger(): Promise<void> {
    clearAssetSelection();
    assetPage.value = 1;
    if (deps.page.value !== "ledger") {
      deps.goToLedger();
      return;
    }
    await loadAssets();
  }
  async function applyAssetCustomFilters(filters: AssetCustomFilter[]): Promise<void> {
    clearAssetSelection();
    appliedCustomFilters.value = filters.map((filter) => ({ ...filter }));
    assetPage.value = 1;
    await loadAssets();
  }

  function queryValue(query: LocationQuery, key: string): string {
    const value = query[key];
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  }

  function queryList(query: LocationQuery, key: string): string[] {
    const raw = query[key];
    const values = Array.isArray(raw) ? raw : [raw];
    return values
      .flatMap((value) => String(value ?? "").split(","))
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value) && Number(value) > 0)
      .filter((value, index, all) => all.indexOf(value) === index);
  }

  function syncFiltersFromQuery(query: LocationQuery) {
    clearAssetSelection();
    assetSearch.value = queryValue(query, "search");
    const status = queryValue(query, "status");
    const deviceType = queryValue(query, "device_type");
    const manufacturer = queryValue(query, "manufacturer");
    const model = queryValue(query, "model");
    const dataCenter = queryValue(query, "data_center");
    const warranty = queryValue(query, "warranty");
    const tagIds = queryList(query, "tags");
    const validWarranties = new Set(["within_30_days", "expired"]);

    assetFilters.status = isAssetStatus(status) ? status : "";
    assetFilters.deviceType = /^\d+$/.test(deviceType) && Number(deviceType) > 0 ? deviceType : "";
    assetFilters.manufacturer = /^\d+$/.test(manufacturer) && Number(manufacturer) > 0 ? manufacturer : "";
    assetFilters.model = model;
    assetFilters.dataCenter = /^\d+$/.test(dataCenter) && Number(dataCenter) > 0 ? dataCenter : "";
    assetFilters.warranty = validWarranties.has(warranty) ? warranty : "";
    assetFilters.tag = tagIds;
    const parsedOrdering = assetSortFromOrdering(queryValue(query, "ordering"));
    assetSortField.value = parsedOrdering.field;
    assetSortOrder.value = parsedOrdering.order;
    draftCustomFilters.value = [];
    appliedCustomFilters.value = [];
    assetPage.value = 1;
  }

  async function resetAssetFilters(): Promise<void> {
    clearAssetSelection();
    assetSearch.value = "";
    assetFilters.status = "";
    assetFilters.deviceType = "";
    assetFilters.tag = [];
    assetFilters.manufacturer = "";
    assetFilters.model = "";
    assetFilters.dataCenter = "";
    assetFilters.warranty = "";
    draftCustomFilters.value = [];
    appliedCustomFilters.value = [];
    assetPage.value = 1;
    if (deps.clearRouteQuery?.([
      "search",
      "status",
      "device_type",
      "manufacturer",
      "model",
      "data_center",
      "warranty",
      "tags",
    ])) return;
    await loadAssets();
  }
  async function changeAssetPage(pageNumber: number): Promise<void> {
    clearAssetSelection();
    assetPage.value = Math.min(Math.max(pageNumber, 1), Math.max(1, Math.ceil(assetCount.value / assetPageSize.value)));
    await loadAssets();
  }
  async function changeAssetPageSize(size?: number): Promise<void> {
    clearAssetSelection();
    if (size) {
      assetPageSizeUserSelected = true;
      assetPageSize.value = size;
    }
    assetPage.value = 1;
    await loadAssets();
  }

  async function lookupAsset(): Promise<void> {
    const query = assetLookup.value.trim();
    if (!query || !deps.can("assets.view")) return;
    try {
      // Quick lookup only needs to decide between a single hit and the full
      // ledger search. The ledger itself remains the authoritative paged view.
      const params = new URLSearchParams({ search: query, page: "1", page_size: "2", compact: "1" });
      const requestedCustomColumns = selectedAssetCustomColumnKeys();
      if (requestedCustomColumns.length) params.set("custom_columns", requestedCustomColumns.join(","));
      const payload = await deps.request<PageResult<Asset> | Asset[]>(`/assets/?${params.toString()}`);
      const matches = pageItems(payload);
      const matchCount = pageTotal(payload);
      if (matchCount === 1 && matches.length === 1) {
        await openAssetDetail(matches[0].id);
        return;
      }
      assetSearch.value = query;
      assetPage.value = 1;
      assets.value = matches;
      assetCount.value = matchCount;
      setActionMessage(
        matches.length
          ? tr("asset.quickLookupFound", { count: matchCount })
          : tr("asset.quickLookupNotFound", { query }),
        matches.length ? "success" : "error",
      );
      deps.goToLedger();
    } catch (error) {
      setActionError(error, tr("asset.quickLookupFailed"));
    }
  }

  function applySystemSettingsDefaults(): void {
    assetPageSizeUserSelected = false;
    assetPageSize.value = systemSettingsState.defaultPageSize;
  }

  return {
    can: deps.can,
    assets,
    selectedAssetIds,
    assetBatchDeleteSaving,
    assetBatchDeleteResult,
    showAssetBatchDeleteResult,
    assetCount,
    assetPage,
    assetPageSize,
    assetSortField,
    assetSortOrder,
    applySystemSettingsDefaults,
    assetSearch,
    assetLookup,
    assetFilters,
    assetListLoading,
    exportingAssets,
    assetListError,
    assetTagFilter,
    draftCustomFilters,
    appliedCustomFilters,
    applyAssetCustomFilters,
    assetFilterCustomFieldSchema,
    assetFilterCustomSchemaLoading,
    assetFilterCustomSchemaError,
    retryAssetFilterCustomSchema,
    assetColumnOptions: defaultColumns,
    assetDynamicColumnOptions,
    visibleAssetColumns,
    visibleAssetColumnOptions,
    toggleAssetColumn,
    resetAssetColumns,
    assetListCustomFieldSchema,
    assetListCustomSchemaLoading,
    assetListCustomSchemaError,
    retryAssetListCustomSchema,
    showAssetModal,
    editingAsset,
    assetModalMode,
    assetForm,
    assetStatusOptions,
    assetFormLoading,
    assetFormLoadError,
    assetFormSaving,
    assetFormFieldErrors,
    depreciationStartTouched,
    assetCustomFieldSchema,
    assetCustomSchemaLoading,
    assetCustomSchemaError,
    retryAssetCustomSchema,
    enableDepreciation,
    markDepreciationStartTouched,
    syncDepreciationStartFromPurchase,
    updateAssetCustomFieldValue,
    manufacturerOptions: activeManufacturers,
    activeDeviceTypes,
    activeDataCenters,
    assetRoomOptions,
    assetRackOptions,
    loadAssets,
    openAssetDetail,
    retryAssetDetail,
    refreshOpenAssetDetail,
    openAssetEditor,
    openAssetClone: (assetId: number) => openAssetEditor(assetId, true),
    openNewAssetModal,
    retryAssetFormLoad,
    clearAssetFormErrors,
    saveAsset,
    toggleAssetSelection,
    toggleAllAssetSelection,
    handleElementAssetSelection,
    clearAssetSelection,
    deleteAsset,
    deleteSelectedAssets,
    closeAssetBatchDeleteResult,
    exportAssets,
    assetValue,
    downloadImportTemplate,
    importFile,
    showImportDialog,
    importStep,
    importPreviewFilter,
    importPreviewError,
    importPreviewing,
    importing,
    onElementUploadChange,
    importPreview,
    filteredImportRows,
    importResult,
    copyImportErrors,
    downloadImportErrors,
    openImportDialog,
    closeImportDialog,
    chooseAnotherImportFile,
    confirmImportPreview,
    importErrorText,
    searchLedger,
    changeAssetSort,
    syncFiltersFromQuery,
    resetAssetFilters,
    changeAssetPage,
    changeAssetPageSize,
    lookupAsset,
    syncAssetDeviceType,
    changeAssetDataCenter,
    changeAssetRoom,
    changeAssetRack,
    setAssetRackMounted,
    closeAssetDetail: deps.closeAssetDetail,
    invalidateDetail: () => {
      detailRequestId.value += 1;
      resetInventoryHistoryState();
      resetResponsibilityHistoryState();
    },
    inventoryHistoryItems,
    inventoryHistoryLatest,
    inventoryHistoryPage,
    inventoryHistoryPageSize,
    inventoryHistoryTotal,
    inventoryHistoryLoading,
    inventoryHistoryError,
    inventoryHistoryCanView,
    retryInventoryHistory,
    changeInventoryHistoryPage,
    changeInventoryHistoryPageSize,
    responsibilityHistoryItems,
    responsibilityHistoryPage,
    responsibilityHistoryPageSize,
    responsibilityHistoryTotal,
    responsibilityHistoryLoading,
    responsibilityHistoryError,
    responsibilityHistoryCanView,
    retryResponsibilityHistory,
    changeResponsibilityHistoryPage,
    changeResponsibilityHistoryPageSize,
    responsibilityUsers,
    responsibilityUsersLoading,
    responsibilityUsersError,
    loadResponsibilityUsers,
    responsibilityActionSaving,
    responsibilityActionError,
    responsibilityActionFieldErrors,
    clearResponsibilityActionErrors,
    clearResponsibilityActionFieldError,
    assignAsset,
    returnAsset,
    transferAsset,
  };
}
