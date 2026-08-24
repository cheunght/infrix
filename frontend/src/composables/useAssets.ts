import { computed, reactive, ref, type ComputedRef, type Ref } from "vue";
import type { LocationQuery } from "vue-router";
import { ElMessage } from "element-plus";
import { ApiError, buildExportQuery, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type { Page } from "../types";
import type {
  Asset,
  AssetDetail,
  AssetCustomFilter,
  CustomField,
  CustomFieldFilterOperator,
  CustomFieldSchema,
  DataCenter,
  DictionaryItem,
  Rack,
  ServerRoom,
  Tag,
} from "../types";
import type { AssetFilters, AssetFormState, RequestFn } from "../types/page-context";
import {
  DEPRECIATION_METHOD_STRAIGHT_LINE,
  depreciationStatusLabel,
  formatMoneyDecimalString,
  percentageToRate,
  rateToPercentageText,
} from "../depreciation";

export type StaticAssetColumnKey =
  | "asset_no"
  | "name"
  | "asset_type"
  | "manufacturer"
  | "manufacturer_model"
  | "purpose"
  | "status"
  | "serial_number"
  | "owner_name"
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

export interface AssetsDeps {
  request: RequestFn;
  download: (path: string, filename?: string) => Promise<void>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  authenticated: Ref<boolean>;
  page: Ref<Page>;
  actionMessage: Ref<string>;
  dataCenters: Ref<DataCenter[]>;
  serverRooms: Ref<ServerRoom[]>;
  racks: Ref<Rack[]>;
  manufacturers: Ref<DictionaryItem[]>;
  deviceTypes: Ref<DictionaryItem[]>;
  tags: Ref<Tag[]>;
  loadRackManagement: () => void | Promise<void>;
  goToLedger: () => void;
  clearRouteQuery?: (keys: string[]) => boolean;
  showAssetDetail: Ref<boolean>;
  detailAsset: Ref<AssetDetail | null>;
  detailLoading: Ref<boolean>;
  detailError: Ref<string>;
  closeAssetDetail: () => void;
  statusLabel: (status: string) => string;
}

const defaultColumns: AssetColumnOption[] = [
  { key: "asset_no", label: "资产", defaultVisible: true, required: true },
  { key: "asset_type", label: "设备类型", defaultVisible: true },
  { key: "status", label: "状态", defaultVisible: true, required: true },
  { key: "rack_code", label: "位置", defaultVisible: true },
  { key: "manufacturer_model", label: "型号", defaultVisible: true },
  { key: "maintenance_expiry_date", label: "保修到期", defaultVisible: true },
  { key: "manufacturer", label: "厂商" },
  { key: "purpose", label: "用途" },
  { key: "serial_number", label: "序列号" },
  { key: "owner_name", label: "使用人" },
  { key: "data_center", label: "数据中心" },
  { key: "server_room", label: "机房" },
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

const legacyColumnKeys: StaticAssetColumnKey[] = ["name", "u_range"];
const legacyColumnAliases: Partial<Record<StaticAssetColumnKey, StaticAssetColumnKey>> = {
  name: "asset_no",
  u_range: "rack_code",
};
const supportedColumnKeys = new Set<StaticAssetColumnKey>([
  ...defaultColumns.map((column) => column.key as StaticAssetColumnKey),
  ...legacyColumnKeys,
]);

const requiredColumnKeys = defaultColumns
  .filter((column) => column.required)
  .map((column) => column.key);

function normalizeVisibleColumns(keys: AssetColumnKey[], dynamicKeys?: Set<string>): AssetColumnKey[] {
  const selected = new Set<AssetColumnKey>(keys.map((key) => legacyColumnAliases[key as StaticAssetColumnKey] || key));
  const normalizedStatic = defaultColumns
    .filter((column) => selected.has(column.key) || column.required)
    .map((column) => column.key);
  const normalizedDynamic = keys.filter(
    (key): key is DynamicAssetColumnKey => isDynamicAssetColumnKey(key) && (!dynamicKeys || dynamicKeys.has(dynamicAssetFieldKey(key))),
  );
  return [...normalizedStatic, ...Array.from(new Set(normalizedDynamic)).slice(0, MAX_DYNAMIC_ASSET_COLUMNS)];
}

function emptyAssetForm(): AssetFormState {
  return {
    asset_no: "",
    name: "",
    asset_type: "",
    manufacturer_id: "",
    model: "",
    device_type: "",
    manufacturer_model: "",
    serial_number: "",
    purpose: "",
    status: "in_stock",
    owner_name: "",
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
    depreciation_enabled: false,
    depreciation_start_date: "",
    depreciation_years: null,
    residual_rate: "",
    maintenance_provider: "",
    maintenance_contract_no: "",
    maintenance_start_date: "",
    maintenance_expiry_date: "",
    tags: [],
    custom_values: {},
  };
}

function loadSavedColumns(): AssetColumnKey[] {
  try {
    const saved = JSON.parse(localStorage.getItem("itam.asset.columns") || "null");
    if (Array.isArray(saved)) {
      const valid = saved.filter((key): key is AssetColumnKey =>
        typeof key === "string" && (supportedColumnKeys.has(key as StaticAssetColumnKey) || isDynamicAssetColumnKey(key)),
      );
      if (valid.length) return normalizeVisibleColumns(valid);
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
  "asset_type",
  "manufacturer",
  "model",
  "device_type",
  "manufacturer_model",
  "serial_number",
  "purpose",
  "status",
  "owner_name",
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
  "depreciation_enabled",
  "depreciation_start_date",
  "depreciation_years",
  "residual_rate",
  "depreciation_method",
  "maintenance_provider",
  "maintenance_contract_no",
  "maintenance_start_date",
  "maintenance_expiry_date",
  "tags",
  "custom_values",
]);

const assetFormFieldAliases: Record<string, string> = {
  asset_name: "name",
  type: "device_type",
  device_type_id: "device_type",
  server_room: "server_room_id",
  room: "server_room_id",
  rack: "rack_id",
};

function errorText(value: unknown): string {
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join("；");
  if (value && typeof value === "object") {
    return Object.values(value).map(errorText).filter(Boolean).join("；");
  }
  return String(value ?? "");
}

function extractAssetFormErrors(error: unknown): {
  fields: Record<string, string>;
  message: string;
} {
  const candidate = error && typeof error === "object"
    ? error as { details?: unknown; message?: string }
    : {};
  const details = candidate.details;
  const fields: Record<string, string> = {};
  const general: string[] = [];
  const source = details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown>
    : {};
  const nestedDetail = source.detail && typeof source.detail === "object" && !Array.isArray(source.detail)
    ? source.detail as Record<string, unknown>
    : null;
  const errorEntries = nestedDetail || source;

  for (const [rawKey, value] of Object.entries(errorEntries)) {
    if (rawKey === "detail" || rawKey === "non_field_errors") {
      const message = errorText(value);
      if (message) general.push(message);
      continue;
    }
    if (rawKey === "custom_values" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [customKey, customValue] of Object.entries(value)) {
        const message = errorText(customValue);
        if (message) fields[`custom_values.${customKey}`] = message;
      }
      continue;
    }
    const key = assetFormFieldAliases[rawKey] || rawKey;
    const message = errorText(value);
    if (!message) continue;
    if (assetFormFieldNames.has(key) || key.startsWith("custom_values.")) fields[key] = message;
    else general.push(`${rawKey}：${message}`);
  }

  const message = general.join("；") || candidate.message || "资产保存失败";
  return { fields, message };
}

export function useAssets(deps: AssetsDeps) {
  const assets = ref<Asset[]>([]);
  const selectedAssetIds = ref<number[]>([]);
  const assetCount = ref(0);
  const assetPage = ref(1);
  const assetPageSize = ref(50);
  const assetSearch = ref("");
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
  const assetCustomFieldSchema = ref<CustomFieldSchema[]>([]);
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
  const assetCustomFieldHistoryValues = ref<Record<string, unknown>>({});
  const assetCustomFieldUserEditedKeys = new Set<string>();
  let assetCustomSchemaController: AbortController | null = null;
  const assetFormTarget = ref<{ assetId: number | null; clone: boolean; isNew: boolean }>({
    assetId: null,
    clone: false,
    isNew: false,
  });

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

  const assetDynamicColumnOptions = computed<AssetColumnOption[]>(() =>
    assetListCustomFieldSchema.value.map((field) => ({
      key: `custom:${field.key}` as DynamicAssetColumnKey,
      label: field.name,
      dynamic: true,
      field,
      scopeLabel: field.device_type_name || "全局",
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
    localStorage.setItem("itam.asset.columns", JSON.stringify(visibleAssetColumns.value));
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
          assetListCustomSchemaError.value = error instanceof Error && error.message
            ? error.message
            : "扩展列配置加载失败，请重试";
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
          assetFilterCustomSchemaError.value = error instanceof Error && error.message
            ? error.message
            : "动态筛选字段加载失败，请重试";
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
    const details = error.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : {};
    const message = errorText(details.custom_filters);
    return message ? `筛选条件无效：${message}` : "";
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

  async function loadAssets(version = deps.beginLoad()): Promise<void> {
    if (!deps.authenticated.value) return;
    ensureAssetListCustomSchema();
    ensureAssetFilterCustomSchema();
    if (deps.isCurrentLoad(version)) {
      assetListLoading.value = true;
      assetListError.value = "";
    }
    const params = assetQueryParams();
    try {
      const payload = await deps.request<PageResult<Asset> | Asset[]>(`/assets/?${params.toString()}`);
      if (!payload || !deps.isCurrentLoad(version)) return;

      const nextAssets = pageItems(payload);
      const nextCount = pageTotal(payload);
      const maxPage = Math.max(1, Math.ceil(nextCount / assetPageSize.value));
      if (assetPage.value > maxPage) {
        assetPage.value = maxPage;
        await loadAssets();
        return;
      }

      assets.value = nextAssets;
      assetCount.value = nextCount;
      selectedAssetIds.value = selectedAssetIds.value.filter((id) =>
        assets.value.some((asset) => asset.id === id),
      );
    } catch (error) {
      if (deps.isCurrentLoad(version) && !isAbortError(error)) {
        assetListError.value = invalidCustomFilterError(error) || (error instanceof Error && error.message
          ? error.message
          : "资产数据加载失败，请稍后重试");
      }
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
    const history = assetCustomFieldHistoryValues.value;
    const next: Record<string, unknown> = {};
    for (const field of visibleCustomFields(schema)) {
      if (hasCustomValue(current, field.key)) {
        next[field.key] = current[field.key];
        continue;
      }
      if (assetModalMode.value === "edit" && hasCustomValue(history, field.key)) {
        next[field.key] = history[field.key];
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
    for (const field of visibleCustomFields(assetCustomFieldSchema.value)) {
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
  }

  function currentCustomValuesForSubmit(values: Record<string, unknown>) {
    const allowedKeys = new Set(visibleCustomFields(assetCustomFieldSchema.value).map((field) => field.key));
    return Object.fromEntries(
      Object.entries(values).filter(([key]) => allowedKeys.has(key)),
    );
  }

  async function loadAssetCustomSchema(deviceTypeId: string | number): Promise<boolean> {
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
      assetCustomFieldSchema.value = result;
      reconcileCustomValuesForSchema(result);
      return true;
    } catch (error) {
      if (requestId === assetCustomSchemaRequestId.value && !isAbortError(error)) {
        assetCustomSchemaError.value = error instanceof Error && error.message
          ? error.message
          : "扩展字段加载失败，请重试";
      }
      return false;
    } finally {
      if (requestId === assetCustomSchemaRequestId.value) {
        assetCustomSchemaLoading.value = false;
        if (assetCustomSchemaController === controller) assetCustomSchemaController = null;
      }
    }
  }

  async function openAssetDetail(assetId: number) {
    const requestId = ++detailRequestId.value;
    detailAssetId.value = assetId;
    deps.showAssetDetail.value = true;
    deps.detailLoading.value = true;
    deps.detailError.value = "";
    deps.detailAsset.value = null;
    try {
      const asset = await deps.request<AssetDetail>(`/assets/${assetId}/`);
      if (requestId === detailRequestId.value) deps.detailAsset.value = asset;
    } catch (error) {
      if (requestId === detailRequestId.value && !isAbortError(error)) {
        deps.detailError.value = error instanceof Error ? error.message : "资产详情加载失败";
      }
    } finally {
      if (requestId === detailRequestId.value) deps.detailLoading.value = false;
    }
  }

  async function retryAssetDetail() {
    if (detailAssetId.value) await openAssetDetail(detailAssetId.value);
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
    const requestId = ++assetFormRequestId.value;
    assetFormTarget.value = { assetId, clone, isNew: false };
    assetFormLoadError.value = "";
    assetFormFieldErrors.value = {};
    assetFormLoading.value = true;
    assetModalMode.value = clone ? "clone" : "edit";
    editingAsset.value = clone ? null : ({ id: assetId } as Asset);
    assetForm.value = emptyAssetForm();
    depreciationStartTouched.value = false;
    assetCustomFieldHistoryValues.value = {};
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
      const historyValues = { ...(detail.custom_values || {}) };
      assetCustomFieldHistoryValues.value = historyValues;
      assetForm.value = {
        ...emptyAssetForm(),
        asset_no: detail.asset_no,
        name: detail.name,
        asset_type: detail.asset_type,
        manufacturer_id: detail.manufacturer ? String(detail.manufacturer) : "",
        model: detail.model_name || detail.manufacturer_model || "",
        device_type: detail.device_type ? String(detail.device_type) : "",
        manufacturer_model: detail.manufacturer_model || "",
        serial_number: detail.serial_number || "",
        purpose: detail.purpose || "",
        status: detail.status,
        owner_name: detail.owner_name || "",
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
        tags: (detail.tags || [])
          .filter((tag) => !clone || tag.is_active)
          .map((tag) => String(tag.id)),
        custom_values: historyValues,
      };
      depreciationStartTouched.value = Boolean(detail.depreciation_start_date);
      await loadAssetCustomSchema(detail.device_type ? String(detail.device_type) : "");
      if (requestId !== assetFormRequestId.value) return;
      editingAsset.value = clone ? null : detail;
      if (clone) {
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
        assetFormLoadError.value = error instanceof Error ? error.message : "资产信息加载失败";
        deps.actionMessage.value = assetFormLoadError.value;
      }
    } finally {
      if (requestId === assetFormRequestId.value) assetFormLoading.value = false;
    }
  }

  async function openNewAssetModal() {
    const requestId = ++assetFormRequestId.value;
    assetFormTarget.value = { assetId: null, clone: false, isNew: true };
    assetFormLoadError.value = "";
    assetFormFieldErrors.value = {};
    editingAsset.value = null;
    assetModalMode.value = "new";
    assetForm.value = emptyAssetForm();
    depreciationStartTouched.value = false;
    assetCustomFieldHistoryValues.value = {};
    assetCustomFieldUserEditedKeys.clear();
    resetAssetCustomSchemaState();
    showAssetModal.value = true;
    assetFormLoading.value = true;
    try {
      await deps.loadRackManagement();
      await loadAssetCustomSchema("");
    } catch (error) {
      if (requestId === assetFormRequestId.value && !isAbortError(error)) {
        assetFormLoadError.value = error instanceof Error ? error.message : "资产关联数据加载失败";
        deps.actionMessage.value = assetFormLoadError.value;
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
    await loadAssetCustomSchema(assetForm.value.device_type);
  }

  async function saveAsset() {
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
      const confirmed = await deps.confirmAction("确认清除当前资产的折旧配置？\n仅清除折旧配置，不影响采购金额和历史审计。");
      if (!confirmed) return;
    }
    assetFormSaving.value = true;
    try {
      const {
        asset_type: _assetType,
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
        depreciation_enabled,
        depreciation_start_date,
        depreciation_years,
        residual_rate,
        model,
        maintenance_provider,
        maintenance_contract_no,
        maintenance_start_date,
        maintenance_expiry_date,
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
        deps.actionMessage.value = "已开启上架到机柜，请完整选择数据中心、机房、机柜和起止 U 位";
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
            maintenance_provider,
            maintenance_contract_no,
            maintenance_start_date,
            maintenance_expiry_date,
          },
        }),
      });
      showAssetModal.value = false;
      deps.actionMessage.value = editingAsset.value ? "资产及关联信息已更新" : "资产及关联信息已保存";
      editingAsset.value = null;
      assetForm.value = emptyAssetForm();
      depreciationStartTouched.value = false;
      assetCustomFieldHistoryValues.value = {};
      assetCustomFieldUserEditedKeys.clear();
      await loadAssets();
      if (
        editingAssetId &&
        deps.showAssetDetail.value &&
        detailAssetId.value === editingAssetId
      ) {
        await openAssetDetail(editingAssetId);
      }
    } catch (error) {
      const parsed = extractAssetFormErrors(error);
      assetFormFieldErrors.value = parsed.fields;
      deps.actionMessage.value = parsed.message;
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

  async function deleteAsset(asset: Asset) {
    if (!(await deps.confirmAction(`确定删除资产“${asset.asset_no}”吗？`))) return;
    try {
      await deps.request(`/assets/${asset.id}/`, { method: "DELETE" });
      selectedAssetIds.value = selectedAssetIds.value.filter((id) => id !== asset.id);
      deps.actionMessage.value = "资产已删除";
      await loadAssets();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "资产删除失败";
    }
  }

  async function deleteSelectedAssets() {
    const ids = [...selectedAssetIds.value];
    if (!ids.length || !(await deps.confirmAction(`确定删除选中的 ${ids.length} 项资产吗？`))) return;
    let success = 0;
    const failures: string[] = [];
    for (const id of ids) {
      const asset = assets.value.find((item) => item.id === id);
      try {
        await deps.request(`/assets/${id}/`, { method: "DELETE" });
        success += 1;
      } catch {
        failures.push(asset?.asset_no || String(id));
      }
    }
    selectedAssetIds.value = [];
    deps.actionMessage.value = failures.length
      ? `已删除 ${success} 项，${failures.length} 项删除失败：${failures.join("、")}`
      : `已删除 ${success} 项资产`;
    await loadAssets();
  }

  async function exportAssets() {
    if (exportingAssets.value) return;
    exportingAssets.value = true;
    const query = buildExportQuery(assetQueryParams(false));
    try {
      await deps.download(`/reports/assets/export/${query ? `?${query}` : ""}`, "资产台账.xlsx");
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "导出失败，请稍后重试";
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
      ElMessage.info(`扩展列最多同时显示 ${MAX_DYNAMIC_ASSET_COLUMNS} 个`);
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
      asset_type: asset.device_type_name || asset.asset_type || "—",
      manufacturer: asset.manufacturer_name || "—",
      manufacturer_model: asset.model || asset.manufacturer_model || "—",
      purpose: asset.purpose || "—",
      status: deps.statusLabel(asset.status),
      serial_number: asset.serial_number || "—",
      owner_name: asset.owner_name || "—",
      data_center: asset.data_center || rack?.data_center || "—",
      server_room: asset.server_room || rack?.server_room || "—",
      rack_code: rack ? [rack.server_room, rack.rack_code].filter(Boolean).join(" / ") : asset.rack_code || "—",
      u_range: asset.u_range || (rack ? `U${rack.start_u}–U${rack.end_u}` : "—"),
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

  function formatImportError(detail: unknown): string {
    if (Array.isArray(detail)) return detail.map(formatImportError).join("；");
    if (detail && typeof detail === "object") return Object.entries(detail).map(([key, value]) => `${key}：${formatImportError(value)}`).join("；");
    return String(detail ?? "");
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
    const selected = file.raw || null;
    if (!selected || importPreviewing.value || importing.value) return;
    importFile.value = selected;
    importPreview.value = null;
    importPreviewFilter.value = "all";
    importPreviewError.value = "";
    await previewImport();
  }
  async function previewImport() {
    if (!importFile.value) return;
    const form = new FormData();
    form.append("file", importFile.value);
    importController?.abort();
    importController = new AbortController();
    importPreviewing.value = true;
    importPreviewError.value = "";
    try {
      const preview = await deps.request<ImportPreview>("/assets/import/preview/", { method: "POST", body: form, signal: importController.signal });
      importPreview.value = preview;
      importStep.value = "preview";
      deps.actionMessage.value = `预览完成：可导入 ${preview.valid} 条，异常 ${preview.invalid} 条`;
    } catch (error) {
      if (isAbortError(error)) return;
      importPreviewError.value = error instanceof Error ? error.message : "导入文件预览失败，请检查文件后重试";
      deps.actionMessage.value = importPreviewError.value;
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
      deps.actionMessage.value = `导入完成：成功导入 ${result.created} 条资产`;
      await loadAssets();
    } catch (error) {
      if (isAbortError(error)) return;
      const details = error instanceof ApiError ? error.details : null;
      if (details && typeof details === "object" && "preview" in details) {
        const latest = (details as { preview?: ImportPreview }).preview;
        if (latest) {
          importPreview.value = latest;
          importStep.value = "preview";
          importPreviewFilter.value = latest.invalid ? "errors" : "all";
        }
      }
      importPreviewError.value = error instanceof Error ? error.message : "确认导入失败，请检查预览结果后重试";
      deps.actionMessage.value = importPreviewError.value;
    } finally {
      importing.value = false;
      importController = null;
    }
  }
  async function copyImportErrors() {
    const text = importResult.value.errors.map((item) => `第${item.line}行：${formatImportError(item.detail)}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      ElMessage.success("失败明细已复制");
    } catch {
      ElMessage.warning("浏览器不允许直接复制，请手动选择明细");
    }
  }
  function downloadImportErrors() {
    const rows = ["行号,错误明细", ...importResult.value.errors.map((item) => `${item.line},"${formatImportError(item.detail).replace(/"/g, '""')}"`)];
    const url = URL.createObjectURL(new Blob([`\ufeff${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "asset-import-errors.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function downloadImportTemplate() {
    try {
      await deps.download("/assets/import/template/", "asset-import-template.xlsx");
    } catch (error) {
      if (!isAbortError(error)) deps.actionMessage.value = error instanceof Error ? error.message : "导入模板下载失败";
    }
  }
  async function syncAssetDeviceType() {
    const deviceType = deps.deviceTypes.value.find((item) => String(item.id) === assetForm.value.device_type);
    const nextType = assetForm.value.device_type;
    const previousType = assetCustomFieldDeviceType.value;
    const previousValues = assetForm.value.custom_values || {};
    const hasPreviousScopedValues = previousType !== "" && visibleCustomFields(assetCustomFieldSchema.value).some(
      (field) => field.device_type != null && String(field.device_type) === previousType && hasCustomValue(previousValues, field.key),
    );
    if (editingAsset.value && previousType !== nextType && hasPreviousScopedValues) {
      const confirmed = await deps.confirmAction("切换设备类型后，原设备类型的扩展字段将作为历史数据保留，新设备类型将使用新的字段配置，是否继续？");
      if (!confirmed) {
        assetForm.value.device_type = previousType;
        return;
      }
    }
    if (previousType !== nextType) resetCustomValuesForDeviceType(previousType);
    if (deviceType) assetForm.value.asset_type = deviceType.name;
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
  function searchLedger() {
    assetPage.value = 1;
    if (deps.page.value !== "ledger") {
      deps.goToLedger();
      return;
    }
    return loadAssets();
  }
  function applyAssetCustomFilters(filters: AssetCustomFilter[]) {
    appliedCustomFilters.value = filters.map((filter) => ({ ...filter }));
    assetPage.value = 1;
    return loadAssets();
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
    assetSearch.value = queryValue(query, "search");
    const status = queryValue(query, "status");
    const dataCenter = queryValue(query, "data_center");
    const warranty = queryValue(query, "warranty");
    const tagIds = queryList(query, "tags");
    const validStatuses = new Set(["in_stock", "in_use", "idle", "repair", "retired"]);
    const validWarranties = new Set(["within_30_days", "expired"]);

    assetFilters.status = validStatuses.has(status) ? status : "";
    assetFilters.dataCenter = /^\d+$/.test(dataCenter) && Number(dataCenter) > 0 ? dataCenter : "";
    assetFilters.warranty = validWarranties.has(warranty) ? warranty : "";
    assetFilters.tag = tagIds;
  }

  function resetAssetFilters() {
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
    if (deps.clearRouteQuery?.(["search", "status", "data_center", "warranty", "tags"])) return;
    return loadAssets();
  }
  function changeAssetPage(pageNumber: number) {
    assetPage.value = Math.min(Math.max(pageNumber, 1), Math.max(1, Math.ceil(assetCount.value / assetPageSize.value)));
    return loadAssets();
  }
  function changeAssetPageSize(size?: number) {
    if (size) assetPageSize.value = size;
    assetPage.value = 1;
    return loadAssets();
  }
  return {
    assets,
    selectedAssetIds,
    assetCount,
    assetPage,
    assetPageSize,
    assetSearch,
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
    deleteAsset,
    deleteSelectedAssets,
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
    syncFiltersFromQuery,
    resetAssetFilters,
    changeAssetPage,
    changeAssetPageSize,
    syncAssetDeviceType,
    changeAssetDataCenter,
    changeAssetRoom,
    changeAssetRack,
    setAssetRackMounted,
    closeAssetDetail: deps.closeAssetDetail,
    invalidateDetail: () => { detailRequestId.value += 1; },
  };
}
