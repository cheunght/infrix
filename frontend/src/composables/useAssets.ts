import { computed, reactive, ref, type ComputedRef, type Ref } from "vue";
import { ElMessage } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import type { Page } from "../types";
import type {
  Asset,
  AssetDetail,
  CustomField,
  DataCenter,
  DictionaryItem,
  Rack,
  ServerRoom,
  Tag,
} from "../types";
import type { AssetFilters, AssetFormState, RequestFn } from "../types/page-context";

export type AssetColumnKey =
  | "asset_no"
  | "name"
  | "asset_type"
  | "brand"
  | "brand_model"
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
  | "maintenance_provider"
  | "maintenance_expiry_date"
  | "notes";

export type AssetColumnOption = {
  key: AssetColumnKey;
  label: string;
  defaultVisible?: boolean;
  required?: boolean;
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
  action: "create" | "conflict" | "error";
  changes: ImportPreviewChange[];
  errors: ImportPreviewError[];
};
export type ImportPreview = {
  filename: string;
  total: number;
  summary: { ready: number; conflicts: number; errors: number };
  rows: ImportPreviewRow[];
};
export type ImportResult = {
  created: number;
  errors: Array<{ line: number; detail: unknown }>;
};

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
  brands: Ref<DictionaryItem[]>;
  deviceTypes: Ref<DictionaryItem[]>;
  tags: Ref<Tag[]>;
  loadRackManagement: () => void | Promise<void>;
  goToLedger: () => void;
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
  { key: "brand_model", label: "型号", defaultVisible: true },
  { key: "maintenance_expiry_date", label: "保修到期", defaultVisible: true },
  { key: "brand", label: "品牌" },
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
  { key: "maintenance_provider", label: "维保厂商" },
  { key: "notes", label: "备注" },
];

const legacyColumnKeys: AssetColumnKey[] = ["name", "u_range"];
const legacyColumnAliases: Partial<Record<AssetColumnKey, AssetColumnKey>> = {
  name: "asset_no",
  u_range: "rack_code",
};
const supportedColumnKeys = new Set<AssetColumnKey>([
  ...defaultColumns.map((column) => column.key),
  ...legacyColumnKeys,
]);

const requiredColumnKeys = defaultColumns
  .filter((column) => column.required)
  .map((column) => column.key);

function normalizeVisibleColumns(keys: AssetColumnKey[]): AssetColumnKey[] {
  const selected = new Set(keys.map((key) => legacyColumnAliases[key] || key));
  return defaultColumns
    .filter((column) => selected.has(column.key) || column.required)
    .map((column) => column.key);
}

function emptyAssetForm(): AssetFormState {
  return {
    asset_no: "",
    name: "",
    asset_type: "",
    brand: "",
    model: "",
    device_type: "",
    brand_model: "",
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
        typeof key === "string" && supportedColumnKeys.has(key as AssetColumnKey),
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

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError",
  );
}

const assetFormFieldNames = new Set([
  "asset_no",
  "name",
  "asset_type",
  "brand",
  "model",
  "device_type",
  "brand_model",
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
    tag: "",
    brand: "",
    model: "",
  });
  const assetTagFilter = computed({
    get: () => assetFilters.tag,
    set: (value: string) => {
      assetFilters.tag = value;
    },
  });
  const assetCustomFilterField = ref("");
  const assetCustomFilterValue = ref("");
  const assetLookup = ref("");
  const assetListLoading = ref(false);
  const assetListError = ref("");
  const visibleAssetColumns = ref<AssetColumnKey[]>(loadSavedColumns());

  const showAssetModal = ref(false);
  const editingAsset = ref<Asset | null>(null);
  const assetModalMode = ref<"new" | "edit" | "clone">("new");
  const assetForm = ref<AssetFormState>(emptyAssetForm());
  const assetCustomFieldSchema = ref<CustomField[]>([]);
  const assetFormLoading = ref(false);
  const assetFormLoadError = ref("");
  const assetFormSaving = ref(false);
  const assetFormFieldErrors = ref<Record<string, string>>({});
  const assetFormRequestId = ref(0);
  const assetFormTarget = ref<{ assetId: number | null; clone: boolean; isNew: boolean }>({
    assetId: null,
    clone: false,
    isNew: false,
  });

  const importFile = ref<File | null>(null);
  const showImportPreview = ref(false);
  const importPreview = ref<ImportPreview | null>(null);
  const showImportResult = ref(false);
  const importResult = ref<ImportResult>({ created: 0, errors: [] });
  const detailRequestId = ref(0);
  const detailAssetId = ref<number | null>(null);

  const visibleAssetColumnOptions = computed(() =>
    defaultColumns.filter((column) => visibleAssetColumns.value.includes(column.key)),
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
  const activeBrands = computed(() => {
    const current = deps.brands.value.find((item) => String(item.id) === assetForm.value.brand);
    return deps.brands.value.filter((item) => item.is_active || item.id === current?.id);
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

  async function loadAssets(version = deps.beginLoad()): Promise<void> {
    if (!deps.authenticated.value) return;
    if (deps.isCurrentLoad(version)) {
      assetListLoading.value = true;
      assetListError.value = "";
    }
    const params = new URLSearchParams({
      page: String(assetPage.value),
      page_size: String(assetPageSize.value),
      compact: "1",
    });
    if (assetSearch.value.trim()) params.set("search", assetSearch.value.trim());
    if (assetFilters.status) params.set("status", assetFilters.status);
    if (assetFilters.deviceType) params.set("device_type", assetFilters.deviceType);
    if (assetFilters.tag) params.set("tag", assetFilters.tag);
    if (assetFilters.brand) params.set("brand", assetFilters.brand);
    if (assetFilters.model.trim()) params.set("model", assetFilters.model.trim());
    if (assetCustomFilterField.value && assetCustomFilterValue.value.trim()) {
      params.set(`custom__${assetCustomFilterField.value}`, assetCustomFilterValue.value.trim());
    }
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
        assetListError.value = error instanceof Error && error.message
          ? error.message
          : "资产数据加载失败，请稍后重试";
      }
    } finally {
      if (deps.isCurrentLoad(version)) assetListLoading.value = false;
    }
  }

  async function loadAssetCustomSchema(deviceTypeId: string | number, version = deps.beginLoad()) {
    if (!deviceTypeId) {
      assetCustomFieldSchema.value = [];
      return;
    }
    const result = await deps.request<CustomField[]>(`/custom-fields/schema/?device_type=${deviceTypeId}`);
    if (deps.isCurrentLoad(version)) assetCustomFieldSchema.value = result;
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
      if (requestId === detailRequestId.value) {
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
    assetCustomFieldSchema.value = [];
    showAssetModal.value = true;
    try {
      await deps.loadRackManagement();
      const detail = await deps.request<AssetDetail>(`/assets/${assetId}/`);
      await loadAssetCustomSchema(detail.device_type ? String(detail.device_type) : "");
      if (requestId !== assetFormRequestId.value) return;
      const network = (role: string) =>
        detail.network_addresses.find((item) => item.role === role)?.address || "";
      const rack = detail.rack_allocation;
      const procurement = detail.procurement_records[0];
      const maintenance = detail.maintenance_contracts[0];
      assetForm.value = {
        ...emptyAssetForm(),
        asset_no: detail.asset_no,
        name: detail.name,
        asset_type: detail.asset_type,
        brand: detail.brand ? String(detail.brand) : "",
        model: detail.model_name || detail.brand_model || "",
        device_type: detail.device_type ? String(detail.device_type) : "",
        brand_model: detail.brand_model || "",
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
        maintenance_provider: maintenance?.provider || "",
        maintenance_contract_no: maintenance?.contract_no || "",
        maintenance_start_date: maintenance?.start_date || "",
        maintenance_expiry_date: maintenance?.expiry_date || "",
        tags: (detail.tags || []).map((tag) => String(tag.id)),
        custom_values: { ...(detail.custom_values || {}) },
      };
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
      if (requestId === assetFormRequestId.value) {
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
    assetCustomFieldSchema.value = [];
    showAssetModal.value = true;
    assetFormLoading.value = true;
    try {
      await deps.loadRackManagement();
    } catch (error) {
      if (requestId === assetFormRequestId.value) {
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

  async function retryAssetFormLoad() {
    const target = assetFormTarget.value;
    if (target.assetId) {
      await openAssetEditor(target.assetId, target.clone);
    } else if (target.isNew) {
      await openNewAssetModal();
    }
  }

  async function saveAsset() {
    if (assetFormSaving.value) return;
    const editingAssetId = editingAsset.value?.id || null;
    assetFormSaving.value = true;
    assetFormFieldErrors.value = {};
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
          asset_data_center: asset_data_center || null,
          brand_model: model || "",
          brand: asset.brand || null,
          model: model || "",
          device_type: asset.device_type || null,
          tags: (tags || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)),
          custom_values: custom_values || {},
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
    const params = new URLSearchParams();
    if (selectedAssetIds.value.length) params.set("ids", selectedAssetIds.value.join(","));
    try {
      await deps.download(`/reports/assets/export/${params.toString() ? `?${params.toString()}` : ""}`, "assets.xlsx");
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "资产导出失败";
    }
  }

  function toggleAssetColumn(key: string) {
    const columnKey = key as AssetColumnKey;
    if (requiredColumnKeys.includes(columnKey)) return;
    if (visibleAssetColumns.value.includes(columnKey)) {
      if (visibleAssetColumns.value.length <= 1) return;
      visibleAssetColumns.value = visibleAssetColumns.value.filter((item) => item !== columnKey);
    } else {
      visibleAssetColumns.value = [...visibleAssetColumns.value, columnKey];
    }
    localStorage.setItem("itam.asset.columns", JSON.stringify(visibleAssetColumns.value));
  }
  function resetAssetColumns() {
    visibleAssetColumns.value = normalizeVisibleColumns(
      defaultColumns.filter((column) => column.defaultVisible).map((column) => column.key),
    );
    localStorage.setItem("itam.asset.columns", JSON.stringify(visibleAssetColumns.value));
  }
  function assetValue(asset: Asset, key: string): string {
    const rack = asset.rack_allocation;
    const network = (role: string) => {
      const compactValue = role === "business" ? asset.business_ip : role === "management" ? asset.management_ip : asset.oob_ip;
      return compactValue || asset.network_addresses?.find((item) => item.role === role)?.address || "";
    };
    const procurement = asset.procurement_records?.[0];
    const maintenance = asset.maintenance_contracts?.[0];
    const values: Record<AssetColumnKey, string> = {
      asset_no: asset.asset_no,
      name: asset.name,
      asset_type: asset.device_type_name || asset.asset_type || "—",
      brand: asset.brand_name || "—",
      brand_model: asset.model || asset.brand_model || "—",
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
      maintenance_provider: asset.maintenance_provider || maintenance?.provider || "—",
      maintenance_expiry_date: asset.maintenance_expiry_date || maintenance?.expiry_date || "—",
      notes: asset.notes || "—",
    };
    return values[key as AssetColumnKey];
  }

  function formatImportError(detail: unknown): string {
    if (Array.isArray(detail)) return detail.map(formatImportError).join("；");
    if (detail && typeof detail === "object") return Object.entries(detail).map(([key, value]) => `${key}：${formatImportError(value)}`).join("；");
    return String(detail ?? "");
  }
  function importErrorText(detail: unknown) { return formatImportError(detail); }

  async function importAssets(): Promise<boolean> {
    if (!importFile.value) return false;
    const form = new FormData();
    form.append("file", importFile.value);
    try {
      const result = await deps.request<ImportResult>("/assets/import/", { method: "POST", body: form });
      importResult.value = result;
      showImportResult.value = result.errors.length > 0;
      const details = result.errors.slice(0, 3).map((item) => `第${item.line}行：${formatImportError(item.detail)}`).join("；");
      deps.actionMessage.value = `导入完成：成功 ${result.created} 条，失败 ${result.errors.length} 条${details ? `。${details}` : ""}`;
      importFile.value = null;
      await loadAssets();
      return true;
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "导入失败";
      return false;
    }
  }
  async function onElementUploadChange(file: { raw?: File }) {
    importFile.value = file.raw || null;
    if (importFile.value) await previewImport();
  }
  async function previewImport() {
    if (!importFile.value) return;
    const form = new FormData();
    form.append("file", importFile.value);
    try {
      const preview = await deps.request<ImportPreview>("/assets/import/preview/", { method: "POST", body: form });
      importPreview.value = preview;
      showImportPreview.value = true;
      deps.actionMessage.value = `预览完成：可导入 ${preview.summary.ready} 条，冲突 ${preview.summary.conflicts} 条，错误 ${preview.summary.errors} 条`;
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "导入预览失败";
    }
  }
  function cancelImportPreview() {
    showImportPreview.value = false;
    importPreview.value = null;
    importFile.value = null;
  }
  async function confirmImportPreview() {
    if (!importPreview.value?.summary.ready || !importFile.value) return;
    if (await importAssets()) {
      showImportPreview.value = false;
      importPreview.value = null;
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
  function downloadImportTemplate() {
    const csv = "\ufeffasset_no,name,device_type,brand,model,asset_type,brand_model,serial_number,purpose,status,owner_name,notes,tags,data_center,server_room,rack_code,rack_total_u,rack_start_u,rack_end_u,business_ip,management_ip,oob_ip,purchase_date,supplier,purchase_order_no,purchase_amount,maintenance_provider,maintenance_contract_no,maintenance_start_date,maintenance_expiry_date\nIT-0001,示例服务器,服务器,示例品牌,示例型号,,旧型号字段,SN001,业务用途,in_stock,张三,备注,核心业务,上海数据中心,A机房,F-01,45,20,22,10.0.0.10,10.0.1.10,10.0.2.10,2026-01-01,示例供应商,PO-001,10000,示例维保商,MT-001,2026-01-01,2027-01-01\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "asset-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function syncAssetDeviceType() {
    const deviceType = deps.deviceTypes.value.find((item) => String(item.id) === assetForm.value.device_type);
    const previousType = editingAsset.value?.device_type ? String(editingAsset.value.device_type) : "";
    if (previousType && previousType !== assetForm.value.device_type && Object.keys(assetForm.value.custom_values || {}).length) {
      const confirmed = await deps.confirmAction("切换设备类型会清空原设备类型的自定义字段值，是否继续？");
      if (!confirmed) {
        assetForm.value.device_type = previousType;
        return;
      }
      assetForm.value.custom_values = {};
    }
    if (deviceType) assetForm.value.asset_type = deviceType.name;
    await loadAssetCustomSchema(assetForm.value.device_type);
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
  function resetAssetFilters() {
    assetSearch.value = "";
    assetFilters.status = "";
    assetFilters.deviceType = "";
    assetFilters.tag = "";
    assetFilters.brand = "";
    assetFilters.model = "";
    assetCustomFilterField.value = "";
    assetCustomFilterValue.value = "";
    assetPage.value = 1;
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
  async function lookupAsset() {
    const query = assetLookup.value.trim();
    if (!query) return;
    try {
      const payload = await deps.request<PageResult<Asset> | Asset[]>(`/assets/?search=${encodeURIComponent(query)}&page_size=100&compact=1`);
      const matches = pageItems(payload);
      if (matches.length === 1) {
        await openAssetDetail(matches[0].id);
        return;
      }
      assetSearch.value = query;
      assetPage.value = 1;
      assets.value = matches;
      assetCount.value = matches.length;
      deps.actionMessage.value = matches.length ? `找到 ${matches.length} 项资产` : `未找到资产标签“${query}”`;
      deps.goToLedger();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "资产查询失败";
    }
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
    assetListError,
    assetTagFilter,
    assetCustomFilterField,
    assetCustomFilterValue,
    assetLookup,
    assetColumnOptions: defaultColumns,
    visibleAssetColumns,
    visibleAssetColumnOptions,
    toggleAssetColumn,
    resetAssetColumns,
    showAssetModal,
    editingAsset,
    assetModalMode,
    assetForm,
    assetFormLoading,
    assetFormLoadError,
    assetFormSaving,
    assetFormFieldErrors,
    assetCustomFieldSchema,
    activeBrands,
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
    onElementUploadChange,
    showImportPreview,
    importPreview,
    showImportResult,
    importResult,
    copyImportErrors,
    downloadImportErrors,
    cancelImportPreview,
    confirmImportPreview,
    importErrorText,
    searchLedger,
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
    invalidateDetail: () => { detailRequestId.value += 1; },
  };
}
