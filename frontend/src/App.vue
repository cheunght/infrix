<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import {
  Checked,
  Edit,
  Expand,
  Fold,
  House,
  Key,
  Lock,
  Message,
  Monitor,
  OfficeBuilding,
  Setting,
  User,
  Warning,
} from "@element-plus/icons-vue";
import {
  apiBase as api,
  ApiError,
  apiRequest,
  pageItems,
  pageTotal,
  type PageResult,
} from "./api";
import AssetDetailDrawer from "./components/AssetDetailDrawer.vue";
import AssetFormDialog from "./components/AssetFormDialog.vue";
import ApiErrorAlert from "./components/ApiErrorAlert.vue";
import DashboardPage from "./components/DashboardPage.vue";
import AssetLedgerPage from "./components/AssetLedgerPage.vue";
import RackViewPage from "./components/RackViewPage.vue";
import RepairPage from "./components/RepairPage.vue";
import LicensePage from "./components/LicensePage.vue";
import SparePartPage from "./components/SparePartPage.vue";
import InventoryPage from "./components/InventoryPage.vue";
import SettingsPage from "./components/SettingsPage.vue";
import SearchField from "./components/SearchField.vue";
import infrixMark from "./assets/infrix-mark.png";
import infrixWordmark from "./assets/infrix-wordmark.png";
import { hasCapability } from "./permissions";
import type {
  Page,
  DictionaryItem,
  DataCenter,
  DashboardStatus,
  DashboardAlert,
  DashboardExpiration,
  DashboardOverview,
  AssetNetwork,
  AssetProcurement,
  AssetMaintenance,
  Asset,
  AssetDetail,
  Rack,
  ServerRoom,
  FacilitySummary,
  FaultEvent,
  Role,
  ManagedUser,
  AuditLog,
  SoftwareLicense,
  SparePart,
  SpareStock,
  SpareTransaction,
  CustomField,
  CustomFieldOption,
  Tag,
} from "./types";
const page = ref<Page>("dashboard");
const pageTitle = ref("仪表盘");
const assets = ref<Asset[]>([]);
const selectedAssetIds = ref<number[]>([]);
const racks = ref<Rack[]>([]);
const brands = ref<DictionaryItem[]>([]);
const deviceTypes = ref<DictionaryItem[]>([]);
const dataCenters = ref<DataCenter[]>([]);
const customFields = ref<CustomField[]>([]);
const customFieldOptions = ref<CustomFieldOption[]>([]);
const tags = ref<Tag[]>([]);
const customFieldDeviceType = ref("");
const customFieldActive = ref("all");
const tagSearch = ref("");
const tagActive = ref("all");
const customFieldForm = ref({ device_type: "", key: "", name: "", field_type: "text", required: false, default_value: "", sort_order: 0, is_active: true });
const customFieldOptionForm = ref({ value: "", label: "", sort_order: 0, is_active: true });
const editingCustomField = ref<CustomField | null>(null);
const editingCustomFieldOption = ref<CustomFieldOption | null>(null);
const showCustomFieldModal = ref(false);
const showCustomFieldOptionModal = ref(false);
const tagForm = ref({ name: "", is_active: true });
const editingTag = ref<Tag | null>(null);
const showTagModal = ref(false);
const assetCustomFieldSchema = ref<CustomField[]>([]);
const dashboard = ref<DashboardOverview | null>(null);
const dashboardLoading = ref(false);
const users = ref<ManagedUser[]>([]);
const roles = ref<Role[]>([]);
const repairRows = ref<FaultEvent[]>([]);
const licenses = ref<SoftwareLicense[]>([]);
const spareParts = ref<SparePart[]>([]);
const spareStocks = ref<SpareStock[]>([]);
const spareTransactions = ref<SpareTransaction[]>([]);
const sparePartCount = ref(0);
const spareStockCount = ref(0);
const spareTransactionCount = ref(0);
const sparePage = ref(1);
const sparePageSize = ref(50);
const spareStockPage = ref(1);
const spareStockPageSize = ref(50);
const spareTransactionPage = ref(1);
const spareTransactionPageSize = ref(50);
const spareSearch = ref("");
const spareType = ref("");
const spareActive = ref("true");
const spareListDataCenter = ref("");
const spareListRoom = ref("");
const spareDataCenter = ref("");
const spareRoom = ref("");
const spareSelectedPart = ref<SparePart | null>(null);
const sparePartForm = ref({
  name: "",
  part_type: "other",
  brand: "",
  model: "",
  specification: "",
  unit: "件",
  is_active: true,
  notes: "",
});
const showSparePartModal = ref(false);
const editingSparePart = ref<SparePart | null>(null);
const spareOperationType = ref("inbound");
const spareOperationForm = ref({
  part: "",
  quantity: "1",
  target_quantity: "",
  source_data_center: "",
  source_server_room: "",
  target_data_center: "",
  target_server_room: "",
  reference: "",
  notes: "",
});
const showSpareOperationModal = ref(false);
const spareOperationSaving = ref(false);
const spareOperationCurrentQuantity = ref<number | null>(null);
const spareOperationLocationLabel = ref("");
const spareOperationLocationLocked = ref(false);
const spareTransactionFilters = ref({ part: "", operation_type: "" });
const assetCount = ref(0);
const assetPage = ref(1);
const assetPageSize = ref(50);
const repairCount = ref(0);
const repairPage = ref(1);
const repairPageSize = ref(50);
const licenseCount = ref(0);
const licensePage = ref(1);
const licensePageSize = ref(50);
const rackCount = ref(0);
const rackPage = ref(1);
// Keep the U-position canvas readable without introducing a horizontal
// scrolling surface. Five racks fit comfortably on the desktop canvas and
// the existing server-side pagination lets the user reach the rest.
const rackPageSize = ref(5);
const loading = ref(false);
const authChecked = ref(false);
const authenticated = ref(false);
const passwordChangeRequired = ref(false);
const isAdmin = ref(false);
const roleCode = ref("");
const permissions = ref<string[]>([]);
const can = (capability: string) => hasCapability(permissions.value, capability);
const sidebarCollapsed = ref(
  localStorage.getItem("itam.sidebar.collapsed") === "1" ||
    (window.matchMedia?.("(max-width: 900px)").matches &&
      !localStorage.getItem("itam.sidebar.collapsed")),
);
const settingsMenuExpanded = ref(
  localStorage.getItem("itam.settings.expanded") !== "0",
);
const sidebarMenu = ref<{ open: (index: string) => void } | null>(null);
const userName = ref("");
const assetLookup = ref("");
const assetSearch = ref("");
const assetTagFilter = ref("");
const assetCustomFilterField = ref("");
const assetCustomFilterValue = ref("");
const showColumnMenu = ref(false);
type AssetColumnKey =
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
const assetColumnOptions: Array<{
  key: AssetColumnKey;
  label: string;
  defaultVisible?: boolean;
}> = [
  { key: "asset_no", label: "资产编号", defaultVisible: true },
  { key: "name", label: "资产名称", defaultVisible: true },
  { key: "asset_type", label: "类型", defaultVisible: true },
  { key: "brand", label: "品牌", defaultVisible: true },
  { key: "brand_model", label: "型号", defaultVisible: true },
  { key: "rack_code", label: "机房 / 机柜", defaultVisible: true },
  { key: "u_range", label: "U 位", defaultVisible: true },
  { key: "status", label: "状态", defaultVisible: true },
  { key: "maintenance_expiry_date", label: "保修到期", defaultVisible: true },
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
const defaultAssetColumns = assetColumnOptions
  .filter((column) => column.defaultVisible)
  .map((column) => column.key);
function loadAssetColumns(): AssetColumnKey[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem("itam.asset.columns") || "null",
    );
    if (Array.isArray(saved)) {
      const valid = saved.filter((key): key is AssetColumnKey =>
        assetColumnOptions.some((column) => column.key === key),
      );
      if (valid.length) return valid;
    }
  } catch {
    /* use defaults */
  }
  return defaultAssetColumns;
}
const visibleAssetColumns = ref<AssetColumnKey[]>(loadAssetColumns());
const username = ref("");
const password = ref("");
const loginError = ref("");
const placeholderTitle = ref("");
const csrfToken = ref("");
// Every page load gets a monotonically increasing token.  Older responses are
// ignored when a user changes filters or navigates before the request returns.
const loadVersion = ref(0);
function beginLoad() {
  loadVersion.value += 1;
  return loadVersion.value;
}
function isCurrentLoad(version: number) {
  return version === loadVersion.value;
}
const showUserMenu = ref(false);
const showAssetModal = ref(false);
const editingAsset = ref<Asset | null>(null);
const assetModalMode = ref<"new" | "edit" | "clone">("new");
const showPasswordModal = ref(false);
const showAssetDetail = ref(false);
const detailAsset = ref<AssetDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const detailRequestId = ref(0);
const actionMessage = ref("");
const pageError = ref("");
const importFile = ref<File | null>(null);
type ImportPreviewChange = {
  field: string;
  label: string;
  old_value: string;
  new_value: string;
};
type ImportPreviewError = {
  field: string;
  label: string;
  message: string;
};
type ImportPreviewRow = {
  line: number;
  asset_no: string;
  name: string;
  action: "create" | "conflict" | "error";
  changes: ImportPreviewChange[];
  errors: ImportPreviewError[];
};
type ImportPreview = {
  filename: string;
  total: number;
  summary: { ready: number; conflicts: number; errors: number };
  rows: ImportPreviewRow[];
};
const showImportPreview = ref(false);
const importPreview = ref<ImportPreview | null>(null);
const showImportResult = ref(false);
const importResult = ref<{ created: number; errors: Array<{ line: number; detail: unknown }> }>({
  created: 0,
  errors: [],
});
const emptyAssetForm = () => ({
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
  tags: [] as string[],
  custom_values: {} as Record<string, unknown>,
});
const assetForm = ref(emptyAssetForm());
const passwordForm = ref({ old_password: "", new_password: "" });
const repairKeyword = ref("");
const repairStatus = ref("");
const repairStart = ref("");
const repairEnd = ref("");
const licenseKeyword = ref("");
const licenseStatus = ref("");
const showFaultModal = ref(false);
const showRepairModal = ref(false);
const selectedFault = ref<FaultEvent | null>(null);
const faultForm = ref({
  asset: "",
  occurred_at: "",
  reason: "",
  description: "",
});
const faultAssetSearch = ref("");
const faultAssetOptions = ref<Asset[]>([]);
const faultAssetLoading = ref(false);
const faultAssetRequestId = ref(0);
const repairForm = ref({ finished_at: "" });
const showLicenseModal = ref(false);
const editingLicense = ref<SoftwareLicense | null>(null);
const licenseForm = ref({
  name: "",
  vendor: "",
  license_type: "",
  authorized_count: "0",
  used_count: "0",
  expiry_date: "",
  notes: "",
});
const selectedDataCenter = ref("");
const selectedRoom = ref("");
const selectedRack = ref("");
const selectedRackDeviceType = ref("");
const focusedRackId = ref<number | null>(null);
const viewportHeight = ref(window.innerHeight);
const showUserModal = ref(false);
const editingUser = ref<ManagedUser | null>(null);
const userForm = ref({
  username: "",
  first_name: "",
  last_name: "",
  email: "",
  password: "",
  confirm_password: "",
  is_active: true,
  role_code: "auditor",
});
const userFormRef = ref<FormInstance>();
const userFormRules: FormRules = {
  username: [{ required: true, message: "请输入用户名", trigger: "blur" }],
  last_name: [{ required: true, message: "请输入姓", trigger: "blur" }],
  first_name: [{ required: true, message: "请输入名", trigger: "blur" }],
  email: [{ type: "email", message: "请输入有效邮箱", trigger: ["blur", "change"] }],
  role_code: [{ required: true, message: "请选择角色", trigger: "change" }],
  password: [
    {
      validator: (_rule, value, callback) => {
        const passwordValue = String(value || "");
        if (!editingUser.value && !passwordValue) {
          callback(new Error("请输入密码"));
        } else if (passwordValue && passwordValue.length < 8) {
          callback(new Error("密码至少需要 8 位"));
        } else {
          callback();
        }
      },
      trigger: ["blur", "change"],
    },
  ],
  confirm_password: [
    {
      validator: (_rule, value, callback) => {
        const passwordValue = String(userForm.value.password || "");
        const confirmValue = String(value || "");
        if (editingUser.value && !passwordValue && !confirmValue) {
          callback();
        } else if (!confirmValue) {
          callback(new Error("请确认密码"));
        } else if (confirmValue !== passwordValue) {
          callback(new Error("两次输入的密码不一致"));
        } else {
          callback();
        }
      },
      trigger: ["blur", "change"],
    },
  ],
};
const showRoleModal = ref(false);
const editingRole = ref<Role | null>(null);
const roleForm = ref({ name: "" });
const settingsSection = ref<"dictionaries" | "organization" | "audit" | "custom-fields" | "tags">("dictionaries");
const auditLogs = ref<AuditLog[]>([]);
const auditCount = ref(0);
const auditPage = ref(1);
const auditPageSize = ref(50);
const auditFilters = ref({ search: "", actor: "", resource_type: "", action: "", start: "", end: "" });
const serverRooms = ref<ServerRoom[]>([]);
const spareRooms = ref<ServerRoom[]>([]);
// 机房资源保留机房管理和视图管理两个入口。
const rackSection = ref<"view" | "rooms">("rooms");
const facilitySummary = ref<FacilitySummary | null>(null);
const showDataCenterModal = ref(false);
const editingDataCenter = ref<DataCenter | null>(null);
const dataCenterForm = ref({ name: "", address: "", is_active: true });
const showRoomModal = ref(false);
const editingRoom = ref<ServerRoom | null>(null);
const roomForm = ref({ data_center: "", name: "", owner_name: "", contact_phone: "", notes: "", is_active: true });
const dictionarySection = ref<"brands" | "device-types" | "data-centers">(
  "brands",
);
const dictionarySearch = ref("");
const showDictionaryModal = ref(false);
const editingDictionary = ref<DictionaryItem | null>(null);
const dictionaryForm = ref({ name: "", color: "#1677EF", is_active: true });
const navItems = [
  { label: "仪表盘", icon: "⌂", iconIndex: 0, page: "dashboard" as Page },
  { label: "资产管理", icon: "▤", iconIndex: 1, page: "ledger" as Page },
  { label: "机房资源", icon: "▦", iconIndex: 2, page: "racks" as Page },
  { label: "软件许可", icon: "▣", iconIndex: 6, page: "licenses" as Page },
  { label: "盘点中心", icon: "✓", iconIndex: 5, page: "inventory" as Page },
  { label: "事件中心", icon: "⚒", iconIndex: 4, page: "repairs" as Page },
  {
    label: "系统设置",
    icon: "⚙",
    iconIndex: 9,
    page: "settings" as Page,
    children: [
      { label: "数据字典", section: "dictionaries" as const },
      { label: "自定义字段", section: "custom-fields" as const },
      { label: "标签管理", section: "tags" as const },
      { label: "组织权限", section: "organization" as const, adminOnly: true },
      { label: "操作日志", section: "audit" as const },
    ],
  },
  { label: "备件管理", icon: "", iconIndex: 0, page: "spares" as Page },
];

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(
    "itam.sidebar.collapsed",
    sidebarCollapsed.value ? "1" : "0",
  );
  if (!sidebarCollapsed.value && settingsMenuExpanded.value) {
    nextTick(() => sidebarMenu.value?.open("settings"));
  }
}
function toggleSettingsMenu() {
  if (sidebarCollapsed.value) {
    sidebarCollapsed.value = false;
    localStorage.setItem("itam.sidebar.collapsed", "0");
    settingsMenuExpanded.value = true;
    localStorage.setItem("itam.settings.expanded", "1");
    return;
  }
  settingsMenuExpanded.value = !settingsMenuExpanded.value;
  localStorage.setItem(
    "itam.settings.expanded",
    settingsMenuExpanded.value ? "1" : "0",
  );
}
function handleSettingsMenuOpen(index: string) {
  if (index !== "settings") return;
  // In collapsed mode Element Plus opens the submenu in an adjacent popper.
  // Do not expand the whole sidebar in response to that transient event.
  if (sidebarCollapsed.value) return;
  settingsMenuExpanded.value = true;
  localStorage.setItem("itam.settings.expanded", "1");
}
function handleSettingsMenuClose(index: string) {
  if (index !== "settings") return;
  if (sidebarCollapsed.value) return;
  settingsMenuExpanded.value = false;
  localStorage.setItem("itam.settings.expanded", "0");
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryCsrf = true,
): Promise<T> {
  return apiRequest<T>(
    path,
    options,
    () => csrfToken.value,
    loadCsrf,
    () => {
      authenticated.value = false;
    },
    retryCsrf,
  );
}
function totalPages(total: number, size: number) {
  return Math.max(1, Math.ceil(total / size));
}
async function confirmAction(message: string) {
  try {
    await ElMessageBox.confirm(message, "确认操作", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
    return true;
  } catch {
    return false;
  }
}
async function loadCsrf() {
  const response = await fetch(`${api}/auth/csrf/`, { credentials: "include" });
  const data = await response.json();
  csrfToken.value = data.csrfToken;
}
async function checkAuth() {
  try {
    const user = await request<{
      username: string;
      display_name: string;
      is_staff: boolean;
      role_code: string;
      permissions: string[];
      password_change_required: boolean;
    }>("/auth/me/");
    authenticated.value = true;
    userName.value = user.display_name;
    isAdmin.value = user.is_staff;
    roleCode.value = user.role_code;
    permissions.value = user.permissions;
    passwordChangeRequired.value = Boolean(user.password_change_required);
    if (passwordChangeRequired.value) showPasswordModal.value = true;
    if (!isAdmin.value && settingsSection.value === "organization")
      settingsSection.value = "dictionaries";
  } catch {
    authenticated.value = false;
    isAdmin.value = false;
    roleCode.value = "";
    permissions.value = [];
    passwordChangeRequired.value = false;
    showPasswordModal.value = false;
  } finally {
    authChecked.value = true;
  }
}
async function loadDictionaries(version = beginLoad()) {
  const params = new URLSearchParams({ page_size: "100", is_active: "all" });
  if (dictionarySearch.value.trim())
    params.set("search", dictionarySearch.value.trim());
  const dataCenterParams = new URLSearchParams({ page_size: "100", is_active: "all" });
  const [brandResult, deviceTypeResult, dataCenterResult] = await Promise.all([
    request<PageResult<DictionaryItem> | DictionaryItem[]>(
      `/brands/?${params.toString()}`,
    ),
    request<PageResult<DictionaryItem> | DictionaryItem[]>(
      `/device-types/?${params.toString()}`,
    ),
    request<PageResult<DataCenter> | DataCenter[]>(
      `/data-centers/?${dataCenterParams.toString()}`,
    ),
  ]);
  if (!isCurrentLoad(version)) return;
  brands.value = pageItems(brandResult);
  deviceTypes.value = pageItems(deviceTypeResult);
  dataCenters.value = pageItems(dataCenterResult);
}
async function loadCustomFields(version = beginLoad()) {
  const params = new URLSearchParams({ page_size: "100", is_active: customFieldActive.value });
  if (customFieldDeviceType.value) params.set("device_type", customFieldDeviceType.value);
  const result = await request<PageResult<CustomField> | CustomField[]>(`/custom-fields/?${params}`);
  if (isCurrentLoad(version)) customFields.value = pageItems(result);
}
async function loadTags(version = beginLoad()) {
  const params = new URLSearchParams({ page_size: "100", is_active: tagActive.value });
  if (tagSearch.value.trim()) params.set("search", tagSearch.value.trim());
  const result = await request<PageResult<Tag> | Tag[]>(`/tags/?${params}`);
  if (isCurrentLoad(version)) tags.value = pageItems(result);
}
async function loadAssetCustomSchema(deviceTypeId: string | number, version = beginLoad()) {
  if (!deviceTypeId) {
    assetCustomFieldSchema.value = [];
    return;
  }
  const result = await request<CustomField[]>(`/custom-fields/schema/?device_type=${deviceTypeId}`);
  if (isCurrentLoad(version)) assetCustomFieldSchema.value = result;
}
async function loadDataCenters(version = beginLoad()) {
  const result = await request<PageResult<DataCenter> | DataCenter[]>(
    "/data-centers/?page_size=100",
  );
  if (isCurrentLoad(version)) dataCenters.value = pageItems(result);
}
async function loadDashboardData(version = beginLoad()) {
  dashboardLoading.value = true;
  try {
    const dashboardResult = await request<DashboardOverview>("/reports/dashboard/");
    if (!isCurrentLoad(version)) return;
    dashboard.value = dashboardResult;
  } finally {
    if (isCurrentLoad(version)) dashboardLoading.value = false;
  }
}
async function loadLicenses(version = beginLoad()) {
  const params = new URLSearchParams({
    page: String(licensePage.value),
    page_size: String(licensePageSize.value),
  });
  if (licenseKeyword.value.trim())
    params.set("search", licenseKeyword.value.trim());
  if (licenseStatus.value) params.set("status", licenseStatus.value);
  const listResult = await request<PageResult<SoftwareLicense> | SoftwareLicense[]>(
    `/licenses/?${params.toString()}`,
  );
  if (!isCurrentLoad(version)) return;
  licenses.value = pageItems(listResult);
  licenseCount.value = pageTotal(listResult);
}
async function loadSpareData(version = beginLoad()) {
  const partParams = new URLSearchParams({
    page: String(sparePage.value),
    page_size: String(sparePageSize.value),
  });
  if (spareSearch.value.trim()) partParams.set("search", spareSearch.value.trim());
  if (spareType.value) partParams.set("part_type", spareType.value);
  if (spareActive.value) partParams.set("is_active", spareActive.value);
  if (spareListDataCenter.value) partParams.set("data_center", spareListDataCenter.value);
  if (spareListRoom.value) partParams.set("server_room", spareListRoom.value);
  const stockParams = new URLSearchParams({
    page: String(spareStockPage.value),
    page_size: String(spareStockPageSize.value),
  });
  const transactionParams = new URLSearchParams({
    page: String(spareTransactionPage.value),
    page_size: String(spareTransactionPageSize.value),
  });
  if (spareSelectedPart.value) {
    stockParams.set("part", String(spareSelectedPart.value.id));
    transactionParams.set("part", String(spareSelectedPart.value.id));
    if (spareDataCenter.value) stockParams.set("data_center", spareDataCenter.value);
    if (spareRoom.value) stockParams.set("server_room", spareRoom.value);
  }
  const requests: Promise<unknown>[] = [
    request<PageResult<SparePart> | SparePart[]>(`/spare-parts/?${partParams}`),
    request<PageResult<ServerRoom> | ServerRoom[]>("/server-rooms/?page_size=100&is_active=true"),
  ];
  if (spareSelectedPart.value) {
    requests.push(
      request<PageResult<SpareStock> | SpareStock[]>(`/spare-stocks/?${stockParams}`),
      request<PageResult<SpareTransaction> | SpareTransaction[]>(`/spare-transactions/?${transactionParams}`),
    );
  }
  const results = await Promise.all(requests);
  if (!isCurrentLoad(version)) return;
  const partResult = results[0] as PageResult<SparePart> | SparePart[];
  spareParts.value = pageItems(partResult);
  sparePartCount.value = pageTotal(partResult);
  spareRooms.value = pageItems(results[1] as PageResult<ServerRoom> | ServerRoom[]);
  if (spareSelectedPart.value) {
    const current = spareParts.value.find((part) => part.id === spareSelectedPart.value?.id);
    if (current) spareSelectedPart.value = current;
    const stockResult = results[2] as PageResult<SpareStock> | SpareStock[];
    const transactionResult = results[3] as PageResult<SpareTransaction> | SpareTransaction[];
    spareStocks.value = pageItems(stockResult);
    spareStockCount.value = pageTotal(stockResult);
    spareTransactions.value = pageItems(transactionResult);
    spareTransactionCount.value = pageTotal(transactionResult);
  } else {
    spareStocks.value = [];
    spareStockCount.value = 0;
    spareTransactions.value = [];
    spareTransactionCount.value = 0;
  }
}
async function refreshSparePart(partId: number) {
  const detail = await request<SparePart>(`/spare-parts/${partId}/`);
  const index = spareParts.value.findIndex((part) => part.id === partId);
  if (index >= 0) spareParts.value.splice(index, 1, detail);
  if (spareSelectedPart.value?.id === partId) spareSelectedPart.value = detail;
}
async function loadOrganization(version = beginLoad()) {
  const [userResult, roleResult] = await Promise.all([
    request<PageResult<ManagedUser> | ManagedUser[]>("/users/?page_size=100"),
    request<PageResult<Role> | Role[]>("/roles/?page_size=100"),
  ]);
  if (!isCurrentLoad(version)) return;
  users.value = pageItems(userResult);
  roles.value = pageItems(roleResult);
}
async function loadAuditLogs(version = beginLoad()) {
  const params = new URLSearchParams({ page: String(auditPage.value), page_size: String(auditPageSize.value) });
  Object.entries(auditFilters.value).forEach(([key, value]) => {
    if (value.trim()) params.set(key, value.trim());
  });
  const result = await request<PageResult<AuditLog> | AuditLog[]>(`/audit-logs/?${params}`);
  if (!isCurrentLoad(version)) return;
  auditLogs.value = pageItems(result);
  auditCount.value = pageTotal(result);
}
async function loadRackManagement(version = beginLoad()) {
  const [dataCenterResult, roomsResult, racksResult, summaryResult] = await Promise.all([
    request<PageResult<DataCenter> | DataCenter[]>("/data-centers/?page_size=100&is_active=all"),
    request<PageResult<ServerRoom> | ServerRoom[]>("/server-rooms/?page_size=100&is_active=all"),
    request<PageResult<Rack> | Rack[]>("/racks/?page_size=100&is_active=all"),
    request<FacilitySummary>("/facilities/summary/"),
  ]);
  if (!isCurrentLoad(version)) return;
  dataCenters.value = pageItems(dataCenterResult);
  serverRooms.value = pageItems(roomsResult);
  racks.value = pageItems(racksResult);
  facilitySummary.value = summaryResult;
}
async function loadServerRooms(version = beginLoad()) {
  const params = new URLSearchParams({ page_size: "100", is_active: "true" });
  if (selectedDataCenter.value)
    params.set("data_center", selectedDataCenter.value);
  const result = await request<PageResult<ServerRoom> | ServerRoom[]>(
    `/server-rooms/?${params.toString()}`,
  );
  if (isCurrentLoad(version)) serverRooms.value = pageItems(result);
}
function openDataCenterModal(dataCenter?: DataCenter) {
  editingDataCenter.value = dataCenter || null;
  dataCenterForm.value = dataCenter
    ? {
        name: dataCenter.name,
        address: dataCenter.address || "",
        is_active: dataCenter.is_active !== false,
      }
    : { name: "", address: "", is_active: true };
  showDataCenterModal.value = true;
}
async function saveDataCenter() {
  try {
    const path = editingDataCenter.value
      ? `/data-centers/${editingDataCenter.value.id}/`
      : "/data-centers/";
    await request(path, {
      method: editingDataCenter.value ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataCenterForm.value),
    });
    showDataCenterModal.value = false;
    actionMessage.value = "数据中心已保存";
    // These loaders share the page request sequence guard; run them in order
    // so a later refresh cannot invalidate the data-center result midway.
    await loadDictionaries();
    await loadRackManagement();
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "数据中心保存失败";
  }
}
function openRoomModal(room?: ServerRoom) {
  editingRoom.value = room || null;
  roomForm.value = room
    ? { data_center: String(room.data_center), name: room.name, owner_name: room.owner_name || "", contact_phone: room.contact_phone || "", notes: room.notes || "", is_active: room.is_active }
    : { data_center: "", name: "", owner_name: "", contact_phone: "", notes: "", is_active: true };
  showRoomModal.value = true;
}
async function saveRoom() {
  try {
    const path = editingRoom.value ? `/server-rooms/${editingRoom.value.id}/` : "/server-rooms/";
    await request(path, { method: editingRoom.value ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roomForm.value) });
    showRoomModal.value = false;
    ElMessage.success("机房已保存");
    await loadRackManagement();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "机房保存失败");
  }
}
async function deleteRoom(room: ServerRoom) {
  if (!await confirmAction(`确定删除机房“${room.name}”吗？`)) return;
  try { await request(`/server-rooms/${room.id}/`, { method: "DELETE" }); await loadRackManagement(); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "删除失败"); }
}
function openRackSection(section: "view" | "rooms") {
  rackSection.value = section;
  page.value = "racks";
  pageTitle.value = "机房机柜管理";
  load();
}
function openUserModal(user?: ManagedUser) {
  editingUser.value = user || null;
  userForm.value = user
    ? {
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        password: "",
        confirm_password: "",
        is_active: user.is_active,
        role_code: user.assigned_role_code || "auditor",
      }
    : {
        username: "",
        first_name: "",
        last_name: "",
        email: "",
        password: "",
        confirm_password: "",
        is_active: true,
        role_code: "auditor",
      };
  showUserModal.value = true;
  nextTick(() => userFormRef.value?.clearValidate());
}
async function saveUser() {
  const isValid = await userFormRef.value?.validate().then(() => true).catch(() => false);
  if (!isValid) return;
  try {
    const method = editingUser.value ? "PATCH" : "POST";
    const path = editingUser.value
      ? `/users/${editingUser.value.id}/`
      : "/users/";
    const payload = {
      username: userForm.value.username,
      first_name: userForm.value.first_name,
      last_name: userForm.value.last_name,
      email: userForm.value.email,
      is_active: userForm.value.is_active,
      role_code: userForm.value.role_code,
      ...(userForm.value.password ? { password: userForm.value.password } : {}),
    };
    await request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showUserModal.value = false;
    actionMessage.value = "用户账号已保存";
    await loadOrganization();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "用户保存失败";
  }
}
async function toggleUser(user: ManagedUser) {
  try {
    await request(`/users/${user.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    actionMessage.value = user.is_active ? "用户已停用" : "用户已启用";
    await loadOrganization();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "状态更新失败";
  }
}
async function deleteUser(user: ManagedUser) {
  if (!(await confirmAction(`确定删除用户“${user.username}”吗？`))) return;
  try {
    await request(`/users/${user.id}/`, { method: "DELETE" });
    actionMessage.value = "用户已删除";
    await loadOrganization();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "用户删除失败";
  }
}
function openRoleModal(role?: Role) {
  editingRole.value = role || null;
  roleForm.value = { name: role?.name || "" };
  showRoleModal.value = true;
}
async function saveRole() {
  try {
    const method = editingRole.value ? "PATCH" : "POST";
    const path = editingRole.value
      ? `/roles/${editingRole.value.id}/`
      : "/roles/";
    await request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roleForm.value),
    });
    showRoleModal.value = false;
    actionMessage.value = "角色已保存";
    await loadOrganization();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "角色保存失败";
  }
}
async function deleteRole(role: Role) {
  if ((role.user_count || 0) > 0) {
    actionMessage.value = "角色仍被用户使用，不能删除";
    return;
  }
  if (!(await confirmAction(`确定删除角色“${role.name}”吗？`))) return;
  try {
    await request(`/roles/${role.id}/`, { method: "DELETE" });
    actionMessage.value = "角色已删除";
    await loadOrganization();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "角色删除失败";
  }
}
async function login() {
  loginError.value = "";
  try {
    const user = await request<{ display_name: string; is_staff: boolean; role_code: string; permissions: string[]; password_change_required: boolean }>(
      "/auth/login/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.value,
          password: password.value,
        }),
      },
    );
    authenticated.value = true;
    userName.value = user.display_name;
    isAdmin.value = user.is_staff;
    roleCode.value = user.role_code;
    permissions.value = user.permissions;
    passwordChangeRequired.value = Boolean(user.password_change_required);
    if (!isAdmin.value && settingsSection.value === "organization")
      settingsSection.value = "dictionaries";
    password.value = "";
    await loadCsrf();
    if (passwordChangeRequired.value) {
      showPasswordModal.value = true;
      return;
    }
    await bootstrapApplication();
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      const details = error.details as { retry_after?: number } | undefined;
      const retryAfter = Number(details?.retry_after || 0);
      const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 0;
      loginError.value = minutes ? `${error.message}（约 ${minutes} 分钟后重试）` : error.message;
    } else {
      loginError.value = error instanceof Error ? error.message : "登录失败";
    }
  }
}
async function bootstrapApplication() {
    await loadDataCenters();
    await loadDictionaries();
    await loadCustomFields();
    await loadTags();
    await load();
}
async function logout() {
  try {
    await request("/auth/logout/", { method: "POST" });
  } finally {
    authenticated.value = false;
    isAdmin.value = false;
    roleCode.value = "";
    permissions.value = [];
    userName.value = "";
    passwordChangeRequired.value = false;
    showPasswordModal.value = false;
  }
}
async function openAssetEditor(assetId: number, clone = false) {
  try {
    await loadRackManagement();
    const detail = await request<AssetDetail>(`/assets/${assetId}/`);
    await loadAssetCustomSchema(detail.device_type ? String(detail.device_type) : "");
    const network = (role: string) =>
      detail.network_addresses.find((item) => item.role === role)?.address ||
      "";
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
    assetModalMode.value = clone ? "clone" : "edit";
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
    showAssetModal.value = true;
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "资产信息加载失败";
  }
}
function openAssetClone(assetId: number) {
  return openAssetEditor(assetId, true);
}
async function openNewAssetModal() {
  await loadRackManagement();
  editingAsset.value = null;
  assetModalMode.value = "new";
  assetForm.value = emptyAssetForm();
  assetCustomFieldSchema.value = [];
  showAssetModal.value = true;
}
async function saveAsset() {
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
      actionMessage.value = "已开启上架到机柜，请完整选择数据中心、机房、机柜和起止 U 位";
      return;
    }
    const method = editingAsset.value ? "PATCH" : "POST";
    const path = editingAsset.value
      ? `/assets/${editingAsset.value.id}/`
      : "/assets/";
    await request(path, {
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
    actionMessage.value = editingAsset.value
      ? "资产及关联信息已更新"
      : "资产及关联信息已保存";
    editingAsset.value = null;
    assetForm.value = emptyAssetForm();
    await load();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "资产保存失败";
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
    visibleIds.length &&
    visibleIds.every((id) => selectedAssetIds.value.includes(id))
      ? selectedAssetIds.value.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...selectedAssetIds.value, ...visibleIds]));
}
async function deleteAsset(asset: Asset) {
  if (!(await confirmAction(`确定删除资产“${asset.asset_no}”吗？`))) return;
  try {
    await request(`/assets/${asset.id}/`, { method: "DELETE" });
    selectedAssetIds.value = selectedAssetIds.value.filter(
      (id) => id !== asset.id,
    );
    actionMessage.value = "资产已删除";
    await load();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "资产删除失败";
  }
}
async function deleteSelectedAssets() {
  const ids = [...selectedAssetIds.value];
  if (
    !ids.length ||
    !(await confirmAction(`确定删除选中的 ${ids.length} 项资产吗？`))
  )
    return;
  let success = 0;
  const failures: string[] = [];
  for (const id of ids) {
    const asset = assets.value.find((item) => item.id === id);
    try {
      await request(`/assets/${id}/`, { method: "DELETE" });
      success += 1;
    } catch (error) {
      failures.push(asset?.asset_no || String(id));
    }
  }
  selectedAssetIds.value = [];
  actionMessage.value = failures.length
    ? `已删除 ${success} 项，${failures.length} 项删除失败：${failures.join("、")}`
    : `已删除 ${success} 项资产`;
  await load();
}
function exportAssets() {
  const params = new URLSearchParams();
  if (selectedAssetIds.value.length)
    params.set("ids", selectedAssetIds.value.join(","));
  window.open(
    `${api}/reports/assets/export/${params.toString() ? `?${params.toString()}` : ""}`,
    "_blank",
  );
}
function toggleAssetColumn(key: AssetColumnKey) {
  if (visibleAssetColumns.value.includes(key)) {
    if (visibleAssetColumns.value.length <= 1) return;
    visibleAssetColumns.value = visibleAssetColumns.value.filter(
      (item) => item !== key,
    );
  } else {
    visibleAssetColumns.value = [...visibleAssetColumns.value, key];
  }
  localStorage.setItem(
    "itam.asset.columns",
    JSON.stringify(visibleAssetColumns.value),
  );
}
function resetAssetColumns() {
  visibleAssetColumns.value = [...defaultAssetColumns];
  localStorage.setItem(
    "itam.asset.columns",
    JSON.stringify(visibleAssetColumns.value),
  );
}
function assetValue(asset: Asset, key: AssetColumnKey): string {
  const rack = asset.rack_allocation;
  const network = (role: string) => {
    const compactValue =
      role === "business"
        ? asset.business_ip
        : role === "management"
          ? asset.management_ip
          : asset.oob_ip;
    return compactValue || asset.network_addresses?.find((item) => item.role === role)?.address || "";
  };
  const procurement = asset.procurement_records?.[0];
  const maintenance = asset.maintenance_contracts?.[0];
  const values: Record<AssetColumnKey, string> = {
    asset_no: asset.asset_no,
    name: asset.name,
    asset_type: asset.asset_type,
    brand: asset.brand_name || "—",
    brand_model: asset.model || asset.brand_model || "—",
    purpose: asset.purpose || "—",
    status: statusLabel(asset.status),
    serial_number: asset.serial_number || "—",
    owner_name: asset.owner_name || "—",
    data_center: asset.data_center || rack?.data_center || "—",
    server_room: asset.server_room || rack?.server_room || "—",
    rack_code: rack
      ? [rack.server_room, rack.rack_code].filter(Boolean).join(" / ")
      : asset.rack_code || "—",
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
  return values[key];
}
async function importAssets(): Promise<boolean> {
  if (!importFile.value) return false;
  const form = new FormData();
  form.append("file", importFile.value);
  try {
    const result = await request<{
      created: number;
      errors: Array<{ line: number; detail: unknown }>;
    }>("/assets/import/", { method: "POST", body: form });
    const formatImportError = (detail: unknown): string => {
      if (Array.isArray(detail))
        return detail.map((item) => formatImportError(item)).join("；");
      if (detail && typeof detail === "object")
        return Object.entries(detail)
          .map(([key, value]) => `${key}：${formatImportError(value)}`)
          .join("；");
      return String(detail ?? "");
    };
    const details = result.errors
      .slice(0, 3)
      .map((item) => `第${item.line}行：${formatImportError(item.detail)}`)
      .join("；");
    importResult.value = result;
    showImportResult.value = result.errors.length > 0;
    actionMessage.value = `导入完成：成功 ${result.created} 条，失败 ${result.errors.length} 条${details ? `。${details}` : ""}`;
    importFile.value = null;
    await load();
    return true;
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "导入失败";
    return false;
  }
}
function importErrorText(detail: unknown): string {
  if (Array.isArray(detail)) return detail.map(importErrorText).join("；");
  if (detail && typeof detail === "object")
    return Object.entries(detail)
      .map(([key, value]) => `${key}：${importErrorText(value)}`)
      .join("；");
  return String(detail ?? "");
}
async function copyImportErrors() {
  const text = importResult.value.errors
    .map((item) => `第${item.line}行：${importErrorText(item.detail)}`)
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success("失败明细已复制");
  } catch {
    ElMessage.warning("浏览器不允许直接复制，请手动选择明细");
  }
}
function downloadImportErrors() {
  const rows = ["行号,错误明细", ...importResult.value.errors.map((item) => {
    const detail = importErrorText(item.detail).replace(/"/g, '""');
    return `${item.line},"${detail}"`;
  })];
  const url = URL.createObjectURL(
    new Blob([`\ufeff${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "asset-import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}
async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  importFile.value = input.files?.[0] || null;
  if (importFile.value) await previewImport();
  input.value = "";
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
    const preview = await request<ImportPreview>("/assets/import/preview/", {
      method: "POST",
      body: form,
    });
    importPreview.value = preview;
    showImportPreview.value = true;
    actionMessage.value = `预览完成：可导入 ${preview.summary.ready} 条，冲突 ${preview.summary.conflicts} 条，错误 ${preview.summary.errors} 条`;
  } catch (error) {
    // Keep the selected File so the user can retry without selecting it again.
    actionMessage.value = error instanceof Error ? error.message : "导入预览失败";
  }
}
function cancelImportPreview() {
  showImportPreview.value = false;
  importPreview.value = null;
  importFile.value = null;
}
async function confirmImportPreview() {
  if (!importPreview.value?.summary.ready || !importFile.value) return;
  const success = await importAssets();
  if (success) {
    showImportPreview.value = false;
    importPreview.value = null;
  }
}
function handleElementAssetSelection(rows: Asset[]) {
  selectedAssetIds.value = rows.map((asset) => asset.id);
}
function downloadImportTemplate() {
  const csv =
    "\ufeffasset_no,name,device_type,brand,model,asset_type,brand_model,serial_number,purpose,status,owner_name,notes,tags,data_center,server_room,rack_code,rack_total_u,rack_start_u,rack_end_u,business_ip,management_ip,oob_ip,purchase_date,supplier,purchase_order_no,purchase_amount,maintenance_provider,maintenance_contract_no,maintenance_start_date,maintenance_expiry_date\nIT-0001,示例服务器,服务器,示例品牌,示例型号,,旧型号字段,SN001,业务用途,in_stock,张三,备注,核心业务,上海数据中心,A机房,F-01,45,20,22,10.0.0.10,10.0.1.10,10.0.2.10,2026-01-01,示例供应商,PO-001,10000,示例维保商,MT-001,2026-01-01,2027-01-01\n";
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "asset-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}
async function syncAssetDeviceType() {
  const deviceType = deviceTypes.value.find(
    (item) => String(item.id) === assetForm.value.device_type,
  );
  const previousType = editingAsset.value?.device_type ? String(editingAsset.value.device_type) : "";
  if (previousType && previousType !== assetForm.value.device_type && Object.keys(assetForm.value.custom_values || {}).length) {
    const confirmed = await confirmAction("切换设备类型会清空原设备类型的自定义字段值，是否继续？");
    if (!confirmed) {
      assetForm.value.device_type = previousType;
      return;
    }
    assetForm.value.custom_values = {};
  }
  if (deviceType) assetForm.value.asset_type = deviceType.name;
  await loadAssetCustomSchema(assetForm.value.device_type);
}
async function changePassword() {
  try {
    const wasRequired = passwordChangeRequired.value;
    await request("/auth/change-password/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(passwordForm.value),
    });
    showPasswordModal.value = false;
    passwordChangeRequired.value = false;
    passwordForm.value = { old_password: "", new_password: "" };
    actionMessage.value = "密码已修改，请妥善保存";
    if (wasRequired) await bootstrapApplication();
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "修改失败";
  }
}
function nowDateTimeLocal() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function openFaultModal(assetId?: number | PointerEvent) {
  if (assetId instanceof PointerEvent) assetId = undefined;
  faultAssetRequestId.value += 1;
  faultAssetLoading.value = false;
  const selected = assetId
    ? assets.value.find((item) => item.id === assetId)
    : undefined;
  faultForm.value = {
    asset: selected ? String(selected.id) : "",
    occurred_at: nowDateTimeLocal(),
    reason: "",
    description: "",
  };
  faultAssetSearch.value = selected
    ? `${selected.asset_no} · ${selected.name}`
    : "";
  faultAssetOptions.value = selected ? [selected] : [];
  showFaultModal.value = true;
}
async function searchFaultAssets() {
  const keyword = faultAssetSearch.value.trim();
  const requestId = ++faultAssetRequestId.value;
  if (!keyword) {
    faultAssetOptions.value = [];
    faultAssetLoading.value = false;
    return;
  }
  faultAssetLoading.value = true;
  try {
    const payload = await request<PageResult<Asset> | Asset[]>(
      `/assets/?search=${encodeURIComponent(keyword)}&page_size=20&compact=1`,
    );
    if (requestId !== faultAssetRequestId.value) return;
    faultAssetOptions.value = pageItems(payload);
    if (faultAssetOptions.value.length === 1)
      faultForm.value.asset = String(faultAssetOptions.value[0].id);
  } catch (error) {
    if (requestId !== faultAssetRequestId.value) return;
    actionMessage.value =
      error instanceof Error ? error.message : "资产搜索失败";
  } finally {
    if (requestId === faultAssetRequestId.value) faultAssetLoading.value = false;
  }
}
function registerFaultFromSelection() {
  if (selectedAssetIds.value.length !== 1) {
    actionMessage.value = "请先选择一项资产再登记故障";
    return;
  }
  openFaultModal(selectedAssetIds.value[0]);
}
function openRepairModal(fault: FaultEvent) {
  selectedFault.value = fault;
  repairForm.value = {
    finished_at: toDateTimeLocal(fault.repair?.finished_at || null),
  };
  showRepairModal.value = true;
}
async function loadRepairs(version = beginLoad()) {
  const params = new URLSearchParams({
    ordering: "-occurred_at",
    page: String(repairPage.value),
    page_size: String(repairPageSize.value),
  });
  if (repairKeyword.value) params.set("search", repairKeyword.value);
  if (repairStatus.value) params.set("is_closed", repairStatus.value);
  if (repairStart.value) params.set("start", repairStart.value);
  if (repairEnd.value) params.set("end", repairEnd.value);
  const payload = await request<PageResult<FaultEvent> | FaultEvent[]>(
    `/fault-events/?${params.toString()}`,
  );
  if (!isCurrentLoad(version)) return;
  repairRows.value = pageItems(payload);
  repairCount.value = pageTotal(payload);
}
function searchRepairs() {
  repairPage.value = 1;
  loadRepairs();
}
async function createFault() {
  try {
    await request("/fault-events/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...faultForm.value,
        asset: Number(faultForm.value.asset),
      }),
    });
    showFaultModal.value = false;
    actionMessage.value = "故障已登记";
    await loadRepairs();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "故障登记失败";
  }
}
async function saveRepair() {
  if (!selectedFault.value) return;
  try {
    const payload = {
      finished_at: repairForm.value.finished_at || null,
      fault: selectedFault.value.id,
    };
    if (selectedFault.value.repair)
      await request(`/repair-records/${selectedFault.value.repair.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    else
      await request("/repair-records/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    showRepairModal.value = false;
    actionMessage.value = repairForm.value.finished_at
      ? "维修已完成，故障已关闭"
      : "维修记录已保存";
    await loadRepairs();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "维修记录保存失败";
  }
}
function exportRepairs() {
  const params = new URLSearchParams();
  if (repairKeyword.value) params.set("search", repairKeyword.value);
  if (repairStatus.value) params.set("is_closed", repairStatus.value);
  if (repairStart.value) params.set("start", repairStart.value);
  if (repairEnd.value) params.set("end", repairEnd.value);
  window.open(`${api}/reports/repairs/export/?${params.toString()}`, "_blank");
}
async function openAssetDetail(assetId: number) {
  const requestId = ++detailRequestId.value;
  showAssetDetail.value = true;
  detailLoading.value = true;
  detailError.value = "";
  detailAsset.value = null;
  try {
    const asset = await request<AssetDetail>(`/assets/${assetId}/`);
    if (requestId === detailRequestId.value) detailAsset.value = asset;
  } catch (error) {
    if (requestId === detailRequestId.value)
      detailError.value =
        error instanceof Error ? error.message : "资产详情加载失败";
  } finally {
    if (requestId === detailRequestId.value) detailLoading.value = false;
  }
}
async function openRackAssetDetail(assetId: number, rackId: number) {
  focusedRackId.value = rackId;
  await openAssetDetail(assetId);
}
async function lookupAsset() {
  const query = assetLookup.value.trim();
  if (!query) return;
  try {
    const payload = await request<PageResult<Asset> | Asset[]>(
      `/assets/?search=${encodeURIComponent(query)}&page_size=100&compact=1`,
    );
    const matches = pageItems(payload);
    if (matches.length === 1) {
      await openAssetDetail(matches[0].id);
      return;
    }
    page.value = "ledger";
    pageTitle.value = "资产台账";
    assetSearch.value = query;
    assets.value = matches;
    actionMessage.value = matches.length
      ? `找到 ${matches.length} 项资产`
      : `未找到资产标签“${query}”`;
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "资产查询失败";
  }
}
async function searchLedger() {
  if (page.value !== "ledger") {
    page.value = "ledger";
    pageTitle.value = "资产台账";
  }
  assetPage.value = 1;
  await load();
}
function closeAssetDetail() {
  detailRequestId.value += 1;
  showAssetDetail.value = false;
  detailAsset.value = null;
}
function roleLabel(role: string) {
  return (
    (
      { business: "业务 IP", management: "管理 IP", oob: "带外 IP" } as Record<
        string,
        string
      >
    )[role] || role
  );
}
function statusLabel(status: string) {
  return (
    (
      {
        in_stock: "在库",
        in_use: "在用",
        idle: "闲置",
        repair: "维修中",
        retired: "已报废",
      } as Record<string, string>
    )[status] || status
  );
}
function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}
async function load() {
  if (!authenticated.value) return;
  const version = beginLoad();
  loading.value = true;
  pageError.value = "";
  try {
    if (page.value === "ledger") {
      const params = new URLSearchParams({
        page: String(assetPage.value),
        page_size: String(assetPageSize.value),
        compact: "1",
      });
      if (page.value !== "ledger") {
        params.set("page", "1");
        params.set("page_size", "20");
      }
      if (page.value === "ledger" && assetSearch.value.trim())
        params.set("search", assetSearch.value.trim());
      if (page.value === "ledger" && assetTagFilter.value)
        params.set("tag", assetTagFilter.value);
      if (page.value === "ledger" && assetCustomFilterField.value && assetCustomFilterValue.value.trim())
        params.set(`custom__${assetCustomFilterField.value}`, assetCustomFilterValue.value.trim());
      const payload = await request<PageResult<Asset> | Asset[]>(
        `/assets/?${params.toString()}`,
      );
      if (!isCurrentLoad(version)) return;
      assets.value = pageItems(payload);
      assetCount.value = pageTotal(payload);
      selectedAssetIds.value = selectedAssetIds.value.filter((id) =>
        assets.value.some((asset) => asset.id === id),
      );
    }
    if (page.value === "dashboard") {
      await loadDashboardData(version);
    }
    if (page.value === "racks" && rackSection.value === "rooms") {
      await loadRackManagement(version);
    } else if (page.value === "racks") {
      await loadServerRooms(version);
      const params = new URLSearchParams({
        page: String(rackPage.value),
        page_size: String(rackPageSize.value),
      });
      if (selectedDataCenter.value)
        params.set("room__data_center", selectedDataCenter.value);
      if (selectedRoom.value) params.set("room", selectedRoom.value);
      if (selectedRack.value) params.set("code", selectedRack.value);
      if (selectedRackDeviceType.value)
        params.set("device_type", selectedRackDeviceType.value);
      const payload = await request<PageResult<Rack> | Rack[]>(
        `/racks/?${params.toString()}`,
      );
      if (!isCurrentLoad(version)) return;
      racks.value = pageItems(payload);
      rackCount.value = pageTotal(payload);
    }
    if (page.value === "repairs") await loadRepairs(version);
    if (page.value === "licenses") await loadLicenses(version);
    if (page.value === "spares") await loadSpareData(version);
    if (page.value === "settings") {
      if (settingsSection.value === "organization" && isAdmin.value)
        await loadOrganization(version);
      else if (settingsSection.value === "audit" && can("audit.view"))
        await loadAuditLogs(version);
      else if (settingsSection.value === "dictionaries")
        await loadDictionaries(version);
      else if (settingsSection.value === "custom-fields")
        await loadCustomFields(version);
      else if (settingsSection.value === "tags")
        await loadTags(version);
      else await loadDictionaries(version);
    }
  } catch (error) {
    console.error(error);
    if (isCurrentLoad(version)) {
      pageError.value = error instanceof Error ? error.message : "加载失败";
      actionMessage.value = pageError.value;
    }
  } finally {
    if (isCurrentLoad(version)) loading.value = false;
  }
}
function navigate(item: (typeof navItems)[number]) {
  closeAssetDetail();
  showAssetModal.value = false;
  showFaultModal.value = false;
  showRepairModal.value = false;
  showImportPreview.value = false;
  showImportResult.value = false;
  showRoomModal.value = false;
  showLicenseModal.value = false;
  showSparePartModal.value = false;
  showSpareOperationModal.value = false;
  page.value = item.page;
  pageTitle.value = item.page === "racks" ? "机房机柜管理" : item.page === "spares" ? "资产管理 / 备件管理" : item.label;
  if (item.page === "placeholder") placeholderTitle.value = item.label;
  if (item.page === "ledger") assetPage.value = 1;
  if (item.page === "repairs") repairPage.value = 1;
  if (item.page === "licenses") licensePage.value = 1;
  if (item.page === "spares") sparePage.value = 1;
  if (item.page === "spares") nextTick(() => sidebarMenu.value?.open("asset-menu"));
  if (item.page === "racks") rackPage.value = 1;
  if (item.page === "racks") rackSection.value = "rooms";
  if (item.page === "settings") {
    settingsSection.value = "dictionaries";
    settingsMenuExpanded.value = true;
    localStorage.setItem("itam.settings.expanded", "1");
    pageTitle.value = "系统设置 / 数据字典";
    nextTick(() => sidebarMenu.value?.open("settings"));
  }
  load();
}
function openSettingsSection(
  section: "dictionaries" | "organization" | "audit" | "custom-fields" | "tags",
) {
  if (section === "organization" && !isAdmin.value) {
    settingsSection.value = "dictionaries";
    return;
  }
  if (section === "audit" && !can("audit.view")) return;
  showAssetModal.value = false;
  showFaultModal.value = false;
  showRepairModal.value = false;
  showImportPreview.value = false;
  showImportResult.value = false;
  showRoomModal.value = false;
  showLicenseModal.value = false;
  closeAssetDetail();
  settingsSection.value = section;
  page.value = "settings";
  pageTitle.value = `系统设置 / ${section === "dictionaries" ? "数据字典" : section === "custom-fields" ? "自定义字段" : section === "tags" ? "标签管理" : section === "organization" ? "组织权限" : "操作日志"}`;
  settingsMenuExpanded.value = true;
  localStorage.setItem("itam.settings.expanded", "1");
  nextTick(() => sidebarMenu.value?.open("settings"));
  load();
}
const activeMenu = computed(() =>
  page.value === "settings"
    ? `settings-${settingsSection.value}`
    : page.value === "racks"
      ? `racks-${rackSection.value}`
      : page.value === "ledger"
        ? "asset-list"
        : page.value,
);
function handleMenuSelect(index: string) {
  if (index.startsWith("asset-")) {
    const ledgerItem = navItems.find((entry) => entry.page === "ledger");
    if (ledgerItem) navigate(ledgerItem);
    nextTick(() => sidebarMenu.value?.open("asset-menu"));
    return;
  }
  if (index === "spares") {
    const spareItem = navItems.find((entry) => entry.page === "spares");
    if (spareItem) navigate(spareItem);
    nextTick(() => sidebarMenu.value?.open("asset-menu"));
    return;
  }
  if (index.startsWith("racks-")) {
    openRackSection(index === "racks-rooms" ? "rooms" : "view");
    return;
  }
  if (index.startsWith("settings-")) {
    openSettingsSection(
      index.slice(9) as "dictionaries" | "organization" | "audit" | "custom-fields" | "tags",
    );
    return;
  }
  const item = navItems.find((entry) => entry.page === index);
  if (item) navigate(item);
}
function exportRackLayout() {
  window.open(`${api}/reports/racks/export/`, "_blank");
}
const inUse = computed(
  () => assets.value.filter((a) => a.status === "in_use").length,
);
const repairing = computed(
  () => assets.value.filter((a) => a.status === "repair").length,
);
const visibleAssetColumnOptions = computed(() =>
  assetColumnOptions.filter((column) =>
    visibleAssetColumns.value.includes(column.key),
  ),
);
const allAssetsSelected = computed(
  () =>
    assets.value.length > 0 &&
    assets.value.every((asset) => selectedAssetIds.value.includes(asset.id)),
);
const someAssetsSelected = computed(
  () => selectedAssetIds.value.length > 0 && !allAssetsSelected.value,
);
const visibleRacks = computed(() =>
  racks.value.filter(
    (rack) =>
      (!selectedRoom.value || String(rack.room) === selectedRoom.value) &&
      (!selectedRack.value || rack.code === selectedRack.value) &&
      (!selectedRackDeviceType.value ||
        rack.allocations.some(
          (item) => item.device_type_name === selectedRackDeviceType.value,
        )),
  ),
);
const roomOptions = computed(() =>
  serverRooms.value
    .filter(
      (room) =>
        room.is_active &&
        (!selectedDataCenter.value ||
          String(room.data_center) === selectedDataCenter.value),
    )
    .map((room) => ({ id: String(room.id), name: room.name })),
);
const rackOptions = computed(() =>
  racks.value
    .map((rack) => rack.code)
    .filter((code, index, all) => all.indexOf(code) === index)
    .sort(),
);
const assetRoomOptions = computed(() =>
  serverRooms.value.filter(
    (room) => room.is_active && String(room.data_center) === assetForm.value.data_center,
  ),
);
const assetRackOptions = computed(() =>
  racks.value.filter(
    (rack) => rack.is_active !== false && (rack.status || "in_use") === "in_use" && String(rack.room) === assetForm.value.server_room_id,
  ),
);
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
  const rack = racks.value.find((item) => String(item.id) === assetForm.value.rack_id);
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
const focusedRack = computed(
  () =>
    visibleRacks.value.find((rack) => rack.id === focusedRackId.value) ||
    visibleRacks.value[0] ||
    null,
);
const rackDetailOpen = computed(
  () => page.value === "racks" && showAssetDetail.value,
);
const displayedRacks = computed(() =>
  rackDetailOpen.value && focusedRack.value
    ? [focusedRack.value]
    : visibleRacks.value,
);
const rackViewTitle = computed(() =>
  focusedRack.value
    ? `${focusedRack.value.server_room_name || focusedRack.value.data_center_name || "机柜"} · 机柜 U 位视图`
    : "机柜 U 位视图",
);
const rackViewStyle = computed(() => {
  const maximumUnits = Math.max(
    1,
    ...displayedRacks.value.map((rack) => rack.total_u),
  );
  if (window.innerWidth <= 1000) return { "--rack-unit-height": "14px" };
  // Leave room for the page header, filter divider and panel padding while
  // allowing the U-position rows to use the taller rack workspace.
  const availableHeight = Math.max(495, viewportHeight.value - 307);
  return {
    "--rack-unit-height": `${Math.max(11, Math.min(19, Math.floor((availableHeight - 4) / maximumUnits)))}px`,
  };
});
function rackUnitHeight(rack: Rack) {
  if (window.innerWidth <= 1000) return 14;
  const availableHeight = Math.max(495, viewportHeight.value - 307);
  return Math.max(
    11,
    Math.min(19, Math.floor((availableHeight - 4) / Math.max(rack.total_u, 1))),
  );
}
function rackBodyHeight(rack: Rack) {
  return rack.total_u * rackUnitHeight(rack) + 4;
}
function rackBodyStyle(rack: Rack) {
  return {
    height: `${rackBodyHeight(rack)}px`,
    "--rack-unit-height": `${rackUnitHeight(rack)}px`,
  };
}
function rackAllocationStyle(
  rack: Rack,
  allocation: Rack["allocations"][number],
) {
  const unitHeight = rackUnitHeight(rack);
  return {
    top: `${(rack.total_u - allocation.end_u) * unitHeight + 2}px`,
    height: `${Math.max(unitHeight - 3, allocation.units * unitHeight - 3)}px`,
    background: allocation.device_type_color || "#1677EF",
  };
}
function rackUsedU(rack: Rack) {
  const allocations = [...rack.allocations].sort(
    (a, b) => a.start_u - b.start_u || a.end_u - b.end_u,
  );
  const occupied = allocations.reduce(
    (sum, allocation) => sum + allocation.units,
    0,
  );
  const singleUnitGaps = allocations
    .slice(1)
    .reduce((sum, allocation, index) => {
      const previous = allocations[index];
      return sum + (allocation.start_u - previous.end_u - 1 === 1 ? 1 : 0);
    }, 0);
  return Math.min(rack.total_u, occupied + singleUnitGaps);
}
function rackGapUnavailable(rack: Rack, u: number) {
  const allocations = [...rack.allocations].sort(
    (a, b) => a.start_u - b.start_u || a.end_u - b.end_u,
  );
  return allocations.slice(1).some((allocation, index) => {
    const previous = allocations[index];
    return (
      allocation.start_u - previous.end_u - 1 === 1 && previous.end_u + 1 === u
    );
  });
}
function rackUtilization(rack: Rack) {
  return rack.total_u > 0
    ? Math.round((rackUsedU(rack) / rack.total_u) * 100)
    : 0;
}
function rackUtilizationColor(rack: Rack) {
  const utilization = rackUtilization(rack);
  return utilization >= 90
    ? "#DC2626"
    : utilization >= 80
      ? "#D97706"
      : "#2864EB";
}
function focusRack(rack: Rack) {
  focusedRackId.value = rack.id;
  nextTick(() =>
    document.getElementById(`rack-view-${rack.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    }),
  );
}
function selectRack(rack: Rack) {
  if (rackDetailOpen.value && focusedRackId.value !== rack.id)
    closeAssetDetail();
  focusRack(rack);
}
const maxDashboardStatusCount = computed(() =>
  Math.max(
    1,
    ...(dashboard.value?.status_distribution || []).map((item) => item.count),
  ),
);
function dashboardBarPercent(value: number, maximum: number) {
  return `${Math.max(value ? 2 : 0, Math.min(100, (value / Math.max(maximum, 1)) * 100))}%`;
}
function dashboardDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN");
}
function dashboardDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function dashboardAlertLevel(level: string) {
  return level === "critical" ? "严重" : level === "warning" ? "警告" : "提醒";
}
function changeAssetPage(pageNumber: number) {
  assetPage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(assetCount.value, assetPageSize.value),
  );
  load();
}
function changeAssetPageSize() {
  assetPage.value = 1;
  load();
}
function changeRepairPage(pageNumber: number) {
  repairPage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(repairCount.value, repairPageSize.value),
  );
  loadRepairs();
}
function changeRepairPageSize() {
  repairPage.value = 1;
  loadRepairs();
}
function changeRackPage(pageNumber: number) {
  rackPage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(rackCount.value, rackPageSize.value),
  );
  load();
}
function changeAuditPage(pageNumber: number) {
  auditPage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(auditCount.value, auditPageSize.value),
  );
  loadAuditLogs();
}
function changeAuditPageSize() {
  auditPage.value = 1;
  loadAuditLogs();
}
function searchAuditLogs() {
  auditPage.value = 1;
  loadAuditLogs();
}
function changeDataCenter() {
  selectedRoom.value = "";
  selectedRack.value = "";
  focusedRackId.value = null;
  closeAssetDetail();
  rackPage.value = 1;
  load();
}
function changeRoom() {
  selectedRack.value = "";
  focusedRackId.value = null;
  closeAssetDetail();
  rackPage.value = 1;
  load();
}
function changeRackFilter() {
  focusedRackId.value = null;
  closeAssetDetail();
  rackPage.value = 1;
  load();
}
function resetRackFilters() {
  selectedDataCenter.value = "";
  selectedRoom.value = "";
  selectedRack.value = "";
  selectedRackDeviceType.value = "";
  focusedRackId.value = null;
  closeAssetDetail();
  rackPage.value = 1;
  load();
}
function searchLicenses() {
  licensePage.value = 1;
  loadLicenses();
}
function changeLicensePage(pageNumber: number) {
  licensePage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(licenseCount.value, licensePageSize.value),
  );
  loadLicenses();
}
function changeLicensePageSize() {
  licensePage.value = 1;
  loadLicenses();
}
function searchSpareParts() {
  sparePage.value = 1;
  loadSpareData();
}
function changeSparePage(pageNumber: number) {
  sparePage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(sparePartCount.value, sparePageSize.value),
  );
  loadSpareData();
}
function changeSparePageSize() {
  sparePage.value = 1;
  loadSpareData();
}
function selectSparePart(part: SparePart | null, resetFilters = true) {
  spareSelectedPart.value = part;
  spareStockPage.value = 1;
  spareTransactionPage.value = 1;
  if (resetFilters) {
    spareDataCenter.value = "";
    spareRoom.value = "";
  }
  loadSpareData();
}
function changeSpareStockPage(pageNumber: number) {
  spareStockPage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(spareStockCount.value, spareStockPageSize.value),
  );
  loadSpareData();
}
function changeSpareStockPageSize() {
  spareStockPage.value = 1;
  loadSpareData();
}
function changeSpareTransactionPage(pageNumber: number) {
  spareTransactionPage.value = Math.min(
    Math.max(pageNumber, 1),
    totalPages(spareTransactionCount.value, spareTransactionPageSize.value),
  );
  loadSpareData();
}
function changeSpareTransactionPageSize() {
  spareTransactionPage.value = 1;
  loadSpareData();
}
function openSparePartModal(part?: SparePart) {
  editingSparePart.value = part || null;
  sparePartForm.value = part
    ? {
        name: part.name,
        part_type: part.part_type,
        brand: part.brand ? String(part.brand) : "",
        model: part.model || "",
        specification: part.specification || "",
        unit: part.unit || "件",
        is_active: part.is_active,
        notes: part.notes || "",
      }
    : {
        name: "",
        part_type: "other",
        brand: "",
        model: "",
        specification: "",
        unit: "件",
        is_active: true,
        notes: "",
      };
  showSparePartModal.value = true;
}
async function saveSparePart() {
  try {
    const path = editingSparePart.value
      ? `/spare-parts/${editingSparePart.value.id}/`
      : "/spare-parts/";
    await request(path, {
      method: editingSparePart.value ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...sparePartForm.value,
        brand: sparePartForm.value.brand ? Number(sparePartForm.value.brand) : null,
      }),
    });
    showSparePartModal.value = false;
    actionMessage.value = "备件已保存";
    await loadSpareData();
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "备件保存失败";
  }
}
async function toggleSparePart(part: SparePart) {
  try {
    await request(`/spare-parts/${part.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !part.is_active }),
    });
    actionMessage.value = part.is_active ? "备件已停用" : "备件已启用";
    await loadSpareData();
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "备件状态更新失败";
  }
}
async function deleteSparePart(part: SparePart) {
  if (!(await confirmAction(`确定删除备件“${part.name}”吗？`))) return;
  try {
    await request(`/spare-parts/${part.id}/`, { method: "DELETE" });
    actionMessage.value = "备件已删除";
    if (spareSelectedPart.value?.id === part.id) spareSelectedPart.value = null;
    await loadSpareData();
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "备件删除失败";
  }
}
type SpareOperationLocation = {
  data_center: number;
  server_room: number | null;
  quantity: number;
  label: string;
};

function openSpareOperation(part: SparePart, operationType = "inbound", location?: SpareOperationLocation) {
  spareOperationType.value = operationType;
  let remembered: Partial<SpareOperationLocation> | null = null;
  if (!location) {
    try {
      remembered = JSON.parse(localStorage.getItem("itam.spare.last_location") || "null") as Partial<SpareOperationLocation> | null;
    } catch {
      remembered = null;
    }
  }
  const rememberedCenter = remembered?.data_center
    ? dataCenters.value.find((center) => center.is_active && center.id === Number(remembered?.data_center))
    : null;
  const rememberedRoom = rememberedCenter && remembered?.server_room
    ? spareRooms.value.find((room) => room.is_active && room.id === Number(remembered?.server_room) && room.data_center === rememberedCenter.id)
    : null;
  const preset = location || (rememberedCenter && (!remembered?.server_room || rememberedRoom) ? {
    data_center: rememberedCenter.id,
    server_room: rememberedRoom?.id || null,
    quantity: 0,
    label: "最近使用地点",
  } : undefined);
  spareOperationForm.value = {
    part: String(part.id),
    quantity: "1",
    target_quantity: "",
    source_data_center: preset && ["outbound", "transfer", "scrap"].includes(operationType) ? String(preset.data_center) : "",
    source_server_room: preset && ["outbound", "transfer", "scrap"].includes(operationType) && preset.server_room ? String(preset.server_room) : "",
    target_data_center: preset && ["inbound", "transfer", "adjustment"].includes(operationType) ? String(preset.data_center) : "",
    target_server_room: preset && ["inbound", "transfer", "adjustment"].includes(operationType) && preset.server_room ? String(preset.server_room) : "",
    reference: "",
    notes: "",
  };
  spareOperationCurrentQuantity.value = location ? location.quantity : null;
  spareOperationLocationLabel.value = location?.label || "";
  spareOperationLocationLocked.value = Boolean(location);
  showSpareOperationModal.value = true;
}
async function saveSpareOperation(): Promise<boolean> {
  spareOperationSaving.value = true;
  try {
    const operation = spareOperationType.value;
    const form = spareOperationForm.value;
    const payload: Record<string, unknown> = {
      part: Number(form.part),
      operation_type: operation,
      quantity: Number(form.quantity || 0),
      reference: form.reference,
      notes: form.notes,
    };
    if (operation === "inbound" || operation === "transfer" || operation === "adjustment") {
      payload.target_data_center = Number(form.target_data_center);
      payload.target_server_room = form.target_server_room ? Number(form.target_server_room) : null;
    }
    if (operation === "outbound" || operation === "transfer" || operation === "scrap") {
      payload.source_data_center = Number(form.source_data_center);
      payload.source_server_room = form.source_server_room ? Number(form.source_server_room) : null;
    }
    if (operation === "adjustment") payload.target_quantity = Number(form.target_quantity || 0);
    await request("/spare-transactions/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const locationDataCenter = ["outbound", "transfer", "scrap"].includes(operation)
      ? form.source_data_center
      : form.target_data_center;
    const locationServerRoom = ["outbound", "transfer", "scrap"].includes(operation)
      ? form.source_server_room
      : form.target_server_room;
    if (locationDataCenter) {
      localStorage.setItem("itam.spare.last_location", JSON.stringify({
        data_center: Number(locationDataCenter),
        server_room: locationServerRoom ? Number(locationServerRoom) : null,
      }));
    }
    showSpareOperationModal.value = false;
    actionMessage.value = "库存流水已登记";
    try {
      await refreshSparePart(Number(form.part));
    } catch {
      actionMessage.value = "库存流水已登记，但备件余额刷新失败，请重新加载页面";
    }
    return true;
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "库存操作失败";
    return false;
  } finally {
    spareOperationSaving.value = false;
  }
}
function spareOperationLabel(operation: string) {
  return ({ inbound: "入库", outbound: "出库", transfer: "调拨", adjustment: "盘点调整", scrap: "报废" } as Record<string, string>)[operation] || operation;
}
function openLicenseModal(license?: SoftwareLicense) {
  editingLicense.value = license || null;
  licenseForm.value = license
    ? {
        name: license.name,
        vendor: license.vendor,
        license_type: license.license_type,
        authorized_count: String(license.authorized_count),
        used_count: String(license.used_count),
        expiry_date: license.expiry_date || "",
        notes: license.notes || "",
      }
    : {
        name: "",
        vendor: "",
        license_type: "",
        authorized_count: "0",
        used_count: "0",
        expiry_date: "",
        notes: "",
      };
  showLicenseModal.value = true;
}
async function saveLicense() {
  try {
    const method = editingLicense.value ? "PATCH" : "POST";
    const path = editingLicense.value
      ? `/licenses/${editingLicense.value.id}/`
      : "/licenses/";
    const payload = {
      ...licenseForm.value,
      authorized_count: Number(licenseForm.value.authorized_count),
      used_count: Number(licenseForm.value.used_count),
      expiry_date: licenseForm.value.expiry_date || null,
    };
    await request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showLicenseModal.value = false;
    editingLicense.value = null;
    actionMessage.value = "许可证已保存";
    await loadLicenses();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "许可证保存失败";
  }
}
async function deleteLicense(license: SoftwareLicense) {
  if (!(await confirmAction(`确定删除许可证“${license.name}”吗？`))) return;
  try {
    await request(`/licenses/${license.id}/`, { method: "DELETE" });
    actionMessage.value = "许可证已删除";
    await loadLicenses();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "许可证删除失败";
  }
}
function openCustomFieldModal(field?: CustomField) {
  editingCustomField.value = field || null;
  customFieldForm.value = field
    ? { device_type: String(field.device_type), key: field.key, name: field.name, field_type: field.field_type, required: field.required, default_value: field.default_value || "", sort_order: field.sort_order || 0, is_active: field.is_active }
    : { device_type: customFieldDeviceType.value, key: "", name: "", field_type: "text", required: false, default_value: "", sort_order: 0, is_active: true };
  showCustomFieldModal.value = true;
}
async function saveCustomField() {
  try {
    const path = editingCustomField.value ? `/custom-fields/${editingCustomField.value.id}/` : "/custom-fields/";
    await request(path, { method: editingCustomField.value ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...customFieldForm.value, device_type: Number(customFieldForm.value.device_type), sort_order: Number(customFieldForm.value.sort_order) }) });
    showCustomFieldModal.value = false;
    actionMessage.value = "自定义字段已保存";
    await loadCustomFields();
  } catch (error) {
    actionMessage.value = error instanceof Error ? error.message : "自定义字段保存失败";
  }
}
async function toggleCustomField(field: CustomField) {
  try {
    await request(`/custom-fields/${field.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !field.is_active }) });
    actionMessage.value = field.is_active ? "自定义字段已停用" : "自定义字段已启用";
    await loadCustomFields();
  } catch (error) { actionMessage.value = error instanceof Error ? error.message : "状态更新失败"; }
}
async function deleteCustomField(field: CustomField) {
  if ((field.assets_count || 0) > 0) { actionMessage.value = "字段已有资产值，不能删除，请先停用"; return; }
  if (!(await confirmAction(`确定删除字段“${field.name}”吗？`))) return;
  try { await request(`/custom-fields/${field.id}/`, { method: "DELETE" }); actionMessage.value = "自定义字段已删除"; await loadCustomFields(); }
  catch (error) { actionMessage.value = error instanceof Error ? error.message : "自定义字段删除失败"; }
}
function openCustomFieldOptionModal(field: CustomField, option?: CustomFieldOption) {
  editingCustomField.value = field;
  editingCustomFieldOption.value = option || null;
  customFieldOptionForm.value = option ? { value: option.value, label: option.label, sort_order: option.sort_order, is_active: option.is_active } : { value: "", label: "", sort_order: 0, is_active: true };
  showCustomFieldOptionModal.value = true;
}
async function saveCustomFieldOption() {
  if (!editingCustomField.value) return;
  try {
    const path = editingCustomFieldOption.value ? `/custom-field-options/${editingCustomFieldOption.value.id}/` : "/custom-field-options/";
    await request(path, { method: editingCustomFieldOption.value ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...customFieldOptionForm.value, field: editingCustomField.value.id }) });
    showCustomFieldOptionModal.value = false;
    actionMessage.value = "字段选项已保存";
    await loadCustomFields();
  } catch (error) { actionMessage.value = error instanceof Error ? error.message : "字段选项保存失败"; }
}
async function deleteCustomFieldOption(option: CustomFieldOption) {
  if (!(await confirmAction(`确定删除选项“${option.label}”吗？`))) return;
  try { await request(`/custom-field-options/${option.id}/`, { method: "DELETE" }); actionMessage.value = "字段选项已删除"; await loadCustomFields(); }
  catch (error) { actionMessage.value = error instanceof Error ? error.message : "字段选项删除失败"; }
}
function openTagModal(tag?: Tag) {
  editingTag.value = tag || null;
  tagForm.value = tag ? { name: tag.name, is_active: tag.is_active } : { name: "", is_active: true };
  showTagModal.value = true;
}
async function saveTag() {
  try {
    const path = editingTag.value ? `/tags/${editingTag.value.id}/` : "/tags/";
    await request(path, { method: editingTag.value ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tagForm.value) });
    showTagModal.value = false; actionMessage.value = "标签已保存"; await loadTags();
  } catch (error) { actionMessage.value = error instanceof Error ? error.message : "标签保存失败"; }
}
async function toggleTag(tag: Tag) {
  try { await request(`/tags/${tag.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !tag.is_active }) }); actionMessage.value = tag.is_active ? "标签已停用" : "标签已启用"; await loadTags(); }
  catch (error) { actionMessage.value = error instanceof Error ? error.message : "状态更新失败"; }
}
async function deleteTag(tag: Tag) {
  if ((tag.assets_count || 0) > 0) { actionMessage.value = "标签正在被资产使用，不能删除，请先停用"; return; }
  if (!(await confirmAction(`确定删除标签“${tag.name}”吗？`))) return;
  try { await request(`/tags/${tag.id}/`, { method: "DELETE" }); actionMessage.value = "标签已删除"; await loadTags(); }
  catch (error) { actionMessage.value = error instanceof Error ? error.message : "标签删除失败"; }
}
const currentDictionaryItems = computed(() =>
  dictionarySection.value === "brands"
    ? brands.value
    : dictionarySection.value === "device-types"
      ? deviceTypes.value
      : dataCenters.value,
);
const currentDictionaryLabel = computed(() =>
  dictionarySection.value === "brands"
    ? "品牌"
    : dictionarySection.value === "device-types"
      ? "设备类型"
      : "数据中心",
);
function dictionaryItemUsed(item: DictionaryItem | DataCenter) {
  return (
    (item.assets_count || 0) > 0 ||
    (dictionarySection.value === "data-centers" &&
      ((item as DataCenter).rooms_count || 0) > 0)
  );
}
const activeBrands = computed(() => {
  const current = brands.value.find(
    (item) => String(item.id) === assetForm.value.brand,
  );
  return brands.value.filter(
    (item) => item.is_active || item.id === current?.id,
  );
});
const activeDeviceTypes = computed(() => {
  const current = deviceTypes.value.find(
    (item) => String(item.id) === assetForm.value.device_type,
  );
  return deviceTypes.value.filter(
    (item) => item.is_active || item.id === current?.id,
  );
});
const activeDataCenters = computed(() => {
  const currentIds = new Set(
    [assetForm.value.data_center, assetForm.value.asset_data_center].filter(Boolean),
  );
  return dataCenters.value.filter(
    (item) => item.is_active !== false || currentIds.has(String(item.id)),
  );
});
function openDictionaryModal(item?: DictionaryItem) {
  editingDictionary.value = item || null;
  dictionaryForm.value = item
    ? { name: item.name, color: item.color || "#1677EF", is_active: item.is_active }
    : { name: "", color: "#1677EF", is_active: true };
  showDictionaryModal.value = true;
}
async function saveDictionary() {
  try {
    const base =
      dictionarySection.value === "brands"
        ? "brands"
        : dictionarySection.value === "device-types"
          ? "device-types"
          : "data-centers";
    const method = editingDictionary.value ? "PATCH" : "POST";
    const path = editingDictionary.value
      ? `/${base}/${editingDictionary.value.id}/`
      : `/${base}/`;
    const payload = dictionarySection.value === "device-types"
      ? dictionaryForm.value
      : { name: dictionaryForm.value.name, is_active: dictionaryForm.value.is_active };
    await request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showDictionaryModal.value = false;
    actionMessage.value = `${currentDictionaryLabel.value}已保存`;
    await loadDictionaries();
  } catch (error) {
    actionMessage.value =
      error instanceof Error
        ? error.message
        : `${currentDictionaryLabel.value}保存失败`;
  }
}
async function toggleDictionary(item: DictionaryItem) {
  try {
    const base =
      dictionarySection.value === "brands"
        ? "brands"
        : dictionarySection.value === "device-types"
          ? "device-types"
          : "data-centers";
    await request(`/${base}/${item.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !item.is_active }),
    });
    actionMessage.value = item.is_active
      ? `${currentDictionaryLabel.value}已停用`
      : `${currentDictionaryLabel.value}已启用`;
    await loadDictionaries();
  } catch (error) {
    actionMessage.value =
      error instanceof Error ? error.message : "状态更新失败";
  }
}
async function deleteDictionary(item: DictionaryItem) {
  if (dictionaryItemUsed(item)) {
    actionMessage.value =
      dictionarySection.value === "data-centers"
        ? "数据中心仍包含机房或资产，不能删除，请先停用"
        : "字典项正在被资产使用，请先停用";
    return;
  }
  if (
    !(await confirmAction(
      `确定删除${currentDictionaryLabel.value}“${item.name}”吗？`,
    ))
  )
    return;
  try {
    const base =
      dictionarySection.value === "brands"
        ? "brands"
        : dictionarySection.value === "device-types"
          ? "device-types"
          : "data-centers";
    await request(`/${base}/${item.id}/`, { method: "DELETE" });
    actionMessage.value = `${currentDictionaryLabel.value}已删除`;
    await loadDictionaries();
  } catch (error) {
    actionMessage.value =
      error instanceof Error
        ? error.message
        : `${currentDictionaryLabel.value}删除失败`;
  }
}
function closeMenusOnOutsideClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".user-menu")) showUserMenu.value = false;
  if (!target?.closest(".column-menu-wrap")) showColumnMenu.value = false;
}
function updateViewportHeight() {
  viewportHeight.value = window.innerHeight;
}
watch(actionMessage, (message) => {
  if (!message) return;
  const isError = /(^\d{3}:|失败|错误|不能|请先|未找到|请求|权限|无权|失效)/.test(message);
  ElMessage({
    message,
    type: isError ? "error" : "success",
    duration: 3200,
    showClose: true,
  });
  actionMessage.value = "";
});
watch(
  visibleRacks,
  (currentRacks) => {
    if (!currentRacks.some((rack) => rack.id === focusedRackId.value))
      focusedRackId.value = currentRacks[0]?.id ?? null;
    if (
      page.value === "racks" &&
      detailAsset.value?.id &&
      !currentRacks.some((rack) =>
        rack.allocations.some(
          (allocation) => allocation.asset === detailAsset.value?.id,
        ),
      )
    ) {
      closeAssetDetail();
    }
  },
  { immediate: true },
);
onMounted(async () => {
  document.addEventListener("click", closeMenusOnOutsideClick);
  window.addEventListener("resize", updateViewportHeight);
  await loadCsrf();
  await checkAuth();
  if (authenticated.value && !passwordChangeRequired.value) await bootstrapApplication();
});
onBeforeUnmount(() => {
  document.removeEventListener("click", closeMenusOnOutsideClick);
  window.removeEventListener("resize", updateViewportHeight);
});

// Page components receive refs and handlers through this stable context. The
// shell keeps ownership of authentication/navigation while page-specific
// markup can evolve independently without changing API contracts.
const pageContext = {
  request,
  loading, dashboard, assets, inUse, maxDashboardStatusCount,
  dashboardBarPercent, dashboardDate, dashboardDateTime, handleMenuSelect,
  dashboardLoading,
  openAssetDetail, statusLabel, openRackSection,
  assetSearch, searchLedger, assetColumnOptions, visibleAssetColumns,
  assetTagFilter, assetCustomFilterField, assetCustomFilterValue, customFields,
  toggleAssetColumn, resetAssetColumns, visibleAssetColumnOptions, can,
  openNewAssetModal, selectedAssetIds, deleteSelectedAssets, exportAssets,
  registerFaultFromSelection, downloadImportTemplate, onElementUploadChange,
  handleElementAssetSelection, assetValue, openAssetClone, openAssetEditor,
  deleteAsset, assetPage, assetPageSize, assetCount, changeAssetPage,
  changeAssetPageSize,
  repairKeyword, searchRepairs, repairStatus, repairStart, repairEnd,
  exportRepairs, openFaultModal, repairRows, openRepairModal, formatDateTime,
  repairPage, repairPageSize, repairCount, changeRepairPage,
  changeRepairPageSize,
  licenseKeyword, searchLicenses, licenseStatus,
  openLicenseModal, deleteLicense, licenses, licensePage,
  licensePageSize, licenseCount, changeLicensePage, changeLicensePageSize,
  spareParts, spareStocks, spareTransactions, sparePartCount, spareStockCount, spareTransactionCount,
  sparePage, sparePageSize, spareStockPage, spareStockPageSize, spareTransactionPage, spareTransactionPageSize,
  spareSearch, spareType, spareActive, spareListDataCenter, spareListRoom,
  spareDataCenter, spareRoom, spareSelectedPart, spareRooms,
  sparePartForm, editingSparePart, showSparePartModal, openSparePartModal, saveSparePart, toggleSparePart,
  deleteSparePart, selectSparePart, searchSpareParts, changeSparePage, changeSparePageSize,
  changeSpareStockPage, changeSpareStockPageSize, changeSpareTransactionPage, changeSpareTransactionPageSize,
  openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationCurrentQuantity, spareOperationLocationLabel,
  spareOperationLocationLocked, saveSpareOperation, spareOperationLabel,
  rackSection, serverRooms, openDataCenterModal, openRoomModal, deleteRoom, racks,
  dataCenters, selectedDataCenter, changeDataCenter, changeRoom,
  facilitySummary,
  changeRackFilter, selectedRoom,
  roomOptions, selectedRack, rackOptions, selectedRackDeviceType, deviceTypes,
  resetRackFilters, exportRackLayout, rackViewTitle, displayedRacks,
  rackUtilization, rackUtilizationColor, rackUsedU, focusedRackId, focusedRack, visibleRacks, selectRack,
  rackViewStyle, rackBodyStyle, rackBodyHeight, rackUnitHeight,
  rackAllocationStyle, rackGapUnavailable, openRackAssetDetail,
  rackDetailOpen, detailAsset, detailLoading, detailError, closeAssetDetail,
  rackCount, rackPage, changeRackPage,
  settingsSection, dictionarySection,
  dictionarySearch, loadDictionaries, currentDictionaryLabel,
  openDictionaryModal, currentDictionaryItems, toggleDictionary,
  dictionaryItemUsed, deleteDictionary, isAdmin, users, openUserModal,
  toggleUser, deleteUser, roles, openRoleModal, deleteRole, auditFilters,
  loadAuditLogs, searchAuditLogs, auditLogs, auditPage, auditPageSize, auditCount,
  changeAuditPage, changeAuditPageSize,
  customFieldDeviceType, customFieldActive, loadCustomFields,
  openCustomFieldModal, saveCustomField, toggleCustomField, deleteCustomField,
  openCustomFieldOptionModal, saveCustomFieldOption, deleteCustomFieldOption,
  customFieldForm, showCustomFieldModal, editingCustomField, customFieldOptionForm,
  showCustomFieldOptionModal, editingCustomFieldOption, tags, tagSearch, tagActive,
  loadTags, openTagModal, saveTag, toggleTag, deleteTag, tagForm, showTagModal, editingTag,
  api, brands,
  showAssetModal, assetModalMode, editingAsset, assetForm, activeDeviceTypes,
  assetCustomFieldSchema,
  syncAssetDeviceType, activeBrands, activeDataCenters, changeAssetDataCenter,
  assetRoomOptions, changeAssetRoom, assetRackOptions, changeAssetRack, setAssetRackMounted,
  saveAsset, downloadImportErrors,
};
</script>

<template>
  <div v-if="!authChecked" class="loading-screen">正在检查登录状态…</div>
  <div v-else-if="!authenticated" class="login-screen">
    <div class="login-card">
      <div class="login-brand">
        <img class="login-brand-wordmark" :src="infrixWordmark" alt="Infrix" />
        <div class="login-brand-subtitle">IT Asset Management</div>
      </div>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="用户名" required
          ><el-input
            v-model="username"
            :prefix-icon="User"
            autocomplete="username"
        /></el-form-item>
        <el-form-item label="密码" required
          ><el-input
            v-model="password"
            :prefix-icon="Lock"
            type="password"
            show-password
            autocomplete="current-password"
        /></el-form-item>
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
        <el-button
          class="login-button"
          type="primary"
          native-type="submit"
          block
          >登录</el-button
        >
      </el-form>
      <small>请使用管理员或本地账号登录</small>
    </div>
  </div>
  <el-container
    v-else
    class="shell"
    :class="{ 'sidebar-collapsed': sidebarCollapsed }"
  >
    <el-aside
      class="sidebar ep-sidebar"
      :width="sidebarCollapsed ? '64px' : '216px'"
    >
      <div class="sidebar-brand">
        <img
          v-if="sidebarCollapsed"
          class="sidebar-brand-icon"
          :src="infrixMark"
          alt="Infrix"
        />
        <img
          v-else
          class="sidebar-wordmark"
          :src="infrixWordmark"
          alt="Infrix"
        />
      </div>
      <el-menu
        ref="sidebarMenu"
        class="ep-sidebar-menu"
        :default-active="activeMenu"
        :default-openeds="settingsMenuExpanded ? ['settings'] : []"
        :unique-opened="true"
        :collapse="sidebarCollapsed"
        :collapse-transition="false"
        :popper-offset="0"
        popper-effect="light"
        popper-class="ep-sidebar-submenu-popper"
        @open="handleSettingsMenuOpen"
        @close="handleSettingsMenuClose"
        @select="handleMenuSelect"
      >
        <el-menu-item index="dashboard" title="仪表盘"
          ><el-icon><House /></el-icon
          ><template #title>仪表盘</template></el-menu-item
        >
        <el-sub-menu
          index="asset-menu"
          popper-class="ep-sidebar-submenu-popper ep-sidebar-submenu-popper--assets"
          ><template #title><el-icon><Monitor /></el-icon><span>资产管理</span></template
          ><el-menu-item index="asset-list">资产列表</el-menu-item
          ><el-menu-item v-if="can('spares.view')" index="spares">备件管理</el-menu-item
        ></el-sub-menu
        >
        <el-sub-menu
          index="racks-menu"
          popper-class="ep-sidebar-submenu-popper ep-sidebar-submenu-popper--racks"
          @title-click="openRackSection('rooms')"
          ><template #title><el-icon><OfficeBuilding /></el-icon><span>机房资源</span></template
          ><el-menu-item v-if="can('racks.manage')" index="racks-rooms">机房管理</el-menu-item
          ><el-menu-item index="racks-view">视图管理</el-menu-item></el-sub-menu
        >
        <el-menu-item index="licenses" title="软件许可"
          ><el-icon><Key /></el-icon
          ><template #title>软件许可</template></el-menu-item
        >
        <el-menu-item index="inventory" title="盘点中心"
          ><el-icon><Checked /></el-icon
          ><template #title>盘点中心</template></el-menu-item
        >
        <el-menu-item index="repairs" title="事件中心"
          ><el-icon><Warning /></el-icon
          ><template #title>事件中心</template></el-menu-item
        >
        <el-sub-menu
          index="settings"
          popper-class="ep-sidebar-submenu-popper ep-sidebar-submenu-popper--settings"
          ><template #title
            ><el-icon><Setting /></el-icon><span>系统设置</span></template
          ><el-menu-item index="settings-dictionaries"
            >数据字典</el-menu-item
          ><el-menu-item v-if="can('custom_fields.manage')" index="settings-custom-fields"
            >自定义字段</el-menu-item
          ><el-menu-item v-if="can('tags.manage')" index="settings-tags"
            >标签管理</el-menu-item
          ><el-menu-item v-if="isAdmin" index="settings-organization"
            >组织权限</el-menu-item
          ><el-menu-item v-if="can('audit.view')" index="settings-audit"
            >操作日志</el-menu-item
          ></el-sub-menu
        >
      </el-menu>
    </el-aside>
    <el-main class="main ep-main" :class="{ 'dashboard-host': page === 'dashboard' }"
      ><el-header class="app-header"
        ><div class="page-heading">
          <el-button
            class="ep-main-collapse-button"
            text
            :title="sidebarCollapsed ? '展开导航' : '收缩导航'"
            :aria-label="sidebarCollapsed ? '展开导航' : '收缩导航'"
            @click="toggleSidebar"
            ><el-icon
              ><Expand v-if="sidebarCollapsed" /><Fold v-else /></el-icon
          ></el-button>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="header-tools">
          <SearchField
            class="ep-global-search itam-filter-search"
            v-model="assetLookup"
            placeholder="搜索资产编号 / SN / 名称"
            aria-label="搜索资产"
            @search="lookupAsset"
          />
          <el-dropdown trigger="click"
            ><el-button text
              ><el-avatar :size="30" :icon="User" /><span
                class="ep-user-name"
                >{{ userName || "当前用户" }}</span
              ></el-button
            ><template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item @click="showPasswordModal = true"
                  >修改密码</el-dropdown-item
                ><el-dropdown-item divided @click="logout"
                  >退出登录</el-dropdown-item
                ></el-dropdown-menu
              ></template
            ></el-dropdown
          >
        </div></el-header
      >
      <div v-if="loading" class="loading">加载中…</div>
      <ApiErrorAlert :message="pageError" />
      <template v-if="!loading">
      <LicensePage v-if="page === 'licenses'" :context="pageContext" />
      <DashboardPage v-else-if="page === 'dashboard'" :context="pageContext" />
      <AssetLedgerPage v-else-if="page === 'ledger'" :context="pageContext" />
      <RepairPage v-else-if="page === 'repairs'" :context="pageContext" />
      <SparePartPage v-else-if="page === 'spares'" :context="pageContext" />
      <InventoryPage v-else-if="page === 'inventory'" :context="pageContext" />
      <RackViewPage v-else-if="page === 'racks'" :context="pageContext" />
      <SettingsPage v-else-if="page === 'settings'" :context="pageContext" />
      <template v-else
        ><section class="empty-page">
          <div class="empty-icon">◎</div>
          <h2>{{ placeholderTitle }}</h2>
          <p>该模块已接入导航，业务页面正在建设中。</p>
          <el-button type="primary" @click="navigate(navItems[0])">
            返回首页
          </el-button>
        </section></template
      >
      </template>
      <AssetFormDialog :context="pageContext" />
      <el-dialog
        v-model="showUserModal"
        :title="editingUser ? '编辑用户' : '新增用户'"
        class="user-account-dialog"
        width="660px"
        destroy-on-close
        ><el-form
          ref="userFormRef"
          class="user-account-form"
          :model="userForm"
          :rules="userFormRules"
          :validate-on-rule-change="false"
          label-position="left"
          label-width="88px"
          @submit.prevent="saveUser"
          ><el-form-item label="用户名" prop="username" required
            ><el-input
              v-model="userForm.username"
              :disabled="!!editingUser"
              autocomplete="username"
              :validate-event="false"
              :prefix-icon="Edit"
              placeholder="请输入用户名" /></el-form-item
          ><el-form-item label="姓" prop="last_name" required
            ><el-input
              v-model="userForm.last_name"
              autocomplete="family-name"
              :validate-event="false"
              :prefix-icon="Edit"
              placeholder="请输入姓" /></el-form-item
          ><el-form-item label="名" prop="first_name" required
            ><el-input
              v-model="userForm.first_name"
              autocomplete="given-name"
              :validate-event="false"
              :prefix-icon="Edit"
              placeholder="请输入名" /></el-form-item
          ><el-form-item label="邮箱" prop="email"
            ><el-input
              v-model="userForm.email"
              type="email"
              autocomplete="email"
              :validate-event="false"
              :prefix-icon="Message"
              placeholder="请输入邮箱（可选）" /></el-form-item
          ><el-form-item label="角色" prop="role_code" required
            ><el-select
              v-model="userForm.role_code"
              class="user-account-role"
              placeholder="请选择角色"
              :validate-event="false"
              ><template #prefix><el-icon><User /></el-icon></template
              ><el-option
                v-for="role in roles"
                :key="role.id"
                :label="role.name"
                :value="role.code" /></el-select
          ></el-form-item>
          <el-form-item label="账号状态" class="user-account-status"
            ><el-switch
              v-model="userForm.is_active"
              active-text="启用"
              inactive-text="停用" /></el-form-item
          ><el-divider class="user-account-divider" />
          <el-form-item
            :label="editingUser ? '重置密码' : '密码'"
            prop="password"
            :required="!editingUser"
            ><el-input
              v-model="userForm.password"
              type="password"
              show-password
              autocomplete="new-password"
              :validate-event="false"
              :prefix-icon="Lock"
              :placeholder="editingUser ? '留空表示不修改密码' : '请输入密码（至少 8 位）'" /></el-form-item
          ><el-form-item label="确认密码" prop="confirm_password" :required="!editingUser"
            ><el-input
              v-model="userForm.confirm_password"
              type="password"
              show-password
              autocomplete="new-password"
              :validate-event="false"
              :prefix-icon="Lock"
              placeholder="请再次输入密码" /></el-form-item>
          <p class="form-hint">
            每个账号只分配一个预设角色，权限由服务端强制校验。
          </p></el-form
        ><template #footer
          ><el-button @click="showUserModal = false">取消</el-button
          ><el-button type="primary" @click="saveUser"
            >保存用户</el-button
          ></template
        ></el-dialog
      >
      <el-dialog
        v-model="showRoleModal"
        :title="editingRole ? '编辑角色' : '新增角色'"
        width="420px"
        destroy-on-close
        ><el-form label-position="top"
          ><el-form-item label="角色名称" required
            ><el-input v-model="roleForm.name" maxlength="150"
          /></el-form-item>
          <p class="form-hint">
            角色可分配给用户，后续可在 Django 权限组中配置具体权限。
          </p></el-form
        ><template #footer
          ><el-button @click="showRoleModal = false">取消</el-button
          ><el-button type="primary" @click="saveRole"
            >保存角色</el-button
          ></template
        ></el-dialog
      >
      <el-dialog
        v-model="showDictionaryModal"
        :title="`${editingDictionary ? '编辑' : '新增'}${currentDictionaryLabel}`"
        width="420px"
        destroy-on-close
        ><el-form label-position="top"
          ><el-form-item :label="`${currentDictionaryLabel}名称`" required
            ><el-input
              v-model="dictionaryForm.name"
              maxlength="120" /></el-form-item
          ><el-form-item v-if="dictionarySection === 'device-types'" label="类型颜色"
            ><div class="color-input"><el-color-picker v-model="dictionaryForm.color" /><el-input v-model="dictionaryForm.color" /></div></el-form-item
          ><el-checkbox v-model="dictionaryForm.is_active">启用</el-checkbox>
          <p class="form-hint">
            已被资产使用的字典项不能删除，只能停用。
          </p></el-form
        ><template #footer
          ><el-button @click="showDictionaryModal = false">取消</el-button
          ><el-button type="primary" @click="saveDictionary"
            >保存{{ currentDictionaryLabel }}</el-button
          ></template
        ></el-dialog
      >
      <el-dialog
        v-model="showLicenseModal"
        :title="editingLicense ? '编辑许可证' : '新增许可证'"
        width="520px"
        destroy-on-close
        ><el-form label-position="top"
          ><el-form-item label="软件名称" required
            ><el-input
              v-model="licenseForm.name"
              maxlength="160" /></el-form-item
          ><el-form-item label="厂商"
            ><el-input
              v-model="licenseForm.vendor"
              maxlength="120" /></el-form-item
          ><el-form-item label="许可类型"
            ><el-input
              v-model="licenseForm.license_type"
              maxlength="80"
              placeholder="如：按核心、按用户"
          /></el-form-item>
          <div class="form-grid license-form-grid">
            <el-form-item label="授权数" required
              ><el-input
                v-model="licenseForm.authorized_count"
                type="number"
                min="0" /></el-form-item
            ><el-form-item label="已用数" required
              ><el-input v-model="licenseForm.used_count" type="number" min="0"
            /></el-form-item>
          </div>
          <el-form-item label="到期日期"
            ><el-date-picker
              v-model="licenseForm.expiry_date"
              type="date"
              value-format="YYYY-MM-DD" /></el-form-item
          ><el-form-item label="备注"
            ><el-input v-model="licenseForm.notes" type="textarea" :rows="3"
          /></el-form-item>
          <p class="form-hint">
            已用授权数不能超过授权数；不填写到期日期表示长期有效。
          </p></el-form
        ><template #footer
          ><el-button @click="showLicenseModal = false">取消</el-button
          ><el-button type="primary" @click="saveLicense"
            >保存许可证</el-button
          ></template
        ></el-dialog
      >
      <el-dialog
        v-model="showPasswordModal"
        :title="passwordChangeRequired ? '首次登录请修改密码' : '修改密码'"
        width="420px"
        destroy-on-close
        :show-close="!passwordChangeRequired"
        :close-on-click-modal="!passwordChangeRequired"
        :close-on-press-escape="!passwordChangeRequired"
        ><el-form label-position="top"
          ><el-form-item label="原密码" required
            ><el-input
              v-model="passwordForm.old_password"
              type="password"
              show-password /></el-form-item
          ><el-form-item label="新密码" required
            ><el-input
              v-model="passwordForm.new_password"
              type="password"
              show-password
          /></el-form-item>
          <p class="form-hint">新密码至少 8 位。{{ passwordChangeRequired ? '首次登录必须完成修改后才能进入系统。' : '' }}</p></el-form
        ><template #footer
          ><el-button v-if="!passwordChangeRequired" @click="showPasswordModal = false">取消</el-button
          ><el-button type="primary" @click="changePassword"
            >保存密码</el-button
          ></template
        ></el-dialog
      >
      <el-dialog
        v-model="showFaultModal"
        title="登记故障"
        width="560px"
        destroy-on-close
        ><el-form label-position="top"
          ><el-form-item label="搜索资产"
            ><div class="fault-asset-search">
              <SearchField
                class="itam-filter-search"
                v-model="faultAssetSearch"
                placeholder="输入资产编号、名称或序列号"
                aria-label="搜索故障资产"
                :loading="faultAssetLoading"
                @search="searchFaultAssets"
              />
            </div></el-form-item
          ><el-form-item label="资产" required
            ><el-select v-model="faultForm.asset" placeholder="请选择搜索结果"
              ><el-option
                v-for="asset in faultAssetOptions"
                :key="asset.id"
                :label="`${asset.asset_no} · ${asset.name}`"
                :value="String(asset.id)" /></el-select></el-form-item
          ><el-form-item label="发生时间" required
            ><el-date-picker
              v-model="faultForm.occurred_at"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm" /></el-form-item
          ><el-form-item label="故障原因"
            ><el-input
              v-model="faultForm.reason"
              placeholder="如：设备宕机、磁盘故障" /></el-form-item
          ><el-form-item label="故障描述"
            ><el-input
              v-model="faultForm.description"
              type="textarea"
              :rows="4"
              placeholder="描述故障现象和影响" /></el-form-item></el-form
        ><template #footer
          ><el-button @click="showFaultModal = false">取消</el-button
          ><el-button type="primary" @click="createFault"
            >保存故障</el-button
          ></template
        ></el-dialog
      >
      <el-dialog
        v-model="showRepairModal"
        :title="selectedFault?.repair ? '编辑维修记录' : '填写维修记录'"
        width="420px"
        destroy-on-close
        ><el-form label-position="top"
          ><el-alert
            :title="`${selectedFault?.asset_no || ''} · ${selectedFault?.asset_name || ''}`"
            type="info"
            :closable="false"
          /><el-form-item label="维修完成时间"
            ><el-date-picker
              v-model="repairForm.finished_at"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm"
          /></el-form-item>
          <p class="form-hint">
            保存后故障自动关闭；清空完成时间会重新打开故障。
          </p></el-form
        ><template #footer
          ><el-button @click="showRepairModal = false">取消</el-button
          ><el-button type="primary" @click="saveRepair"
            >保存维修记录</el-button
          ></template
        ></el-dialog
      >
      <el-dialog v-model="showImportResult" title="资产导入失败明细" width="680px">
        <el-alert
          :title="`成功 ${importResult.created} 条，失败 ${importResult.errors.length} 条`"
          type="warning"
          :closable="false"
        />
        <div class="import-error-list">
          <p v-for="item in importResult.errors" :key="item.line">
            <strong>第{{ item.line }}行：</strong>{{ importErrorText(item.detail) }}
          </p>
        </div>
        <template #footer>
          <el-button @click="copyImportErrors">复制失败明细</el-button>
          <el-button @click="downloadImportErrors">下载失败明细</el-button>
          <el-button @click="showImportResult = false">关闭</el-button>
        </template>
      </el-dialog>
      <el-dialog
        v-model="showImportPreview"
        title="资产导入预览"
        width="1000px"
        :close-on-click-modal="false"
        destroy-on-close
        @close="cancelImportPreview"
      >
        <template v-if="importPreview">
          <el-alert
            title="重复资产编号不会更新已有资产，错误行和冲突行将在确认导入时跳过。"
            type="info"
            :closable="false"
            show-icon
          />
          <div class="import-preview-summary">
            <el-tag type="info">共 {{ importPreview.total }} 行</el-tag>
            <el-tag type="success">可导入 {{ importPreview.summary.ready }} 行</el-tag>
            <el-tag type="warning">冲突 {{ importPreview.summary.conflicts }} 行</el-tag>
            <el-tag type="danger">错误 {{ importPreview.summary.errors }} 行</el-tag>
          </div>
          <el-table
            :data="importPreview.rows"
            border
            stripe
            max-height="480"
            row-key="line"
            empty-text="没有可预览的资产"
          >
            <el-table-column prop="line" label="行号" width="72" />
            <el-table-column prop="asset_no" label="资产编号" min-width="150" show-overflow-tooltip />
            <el-table-column prop="name" label="资产名称" min-width="170" show-overflow-tooltip />
            <el-table-column label="状态" width="96">
              <template #default="{ row }">
                <el-tag v-if="row.action === 'create'" type="success">可导入</el-tag>
                <el-tag v-else-if="row.action === 'conflict'" type="warning">冲突</el-tag>
                <el-tag v-else type="danger">错误</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="差异 / 错误" min-width="390">
              <template #default="{ row }">
                <div v-if="row.changes.length" class="import-preview-changes">
                  <div v-for="change in row.changes" :key="`${row.line}-${change.field}`">
                    <span class="import-preview-label">{{ change.label }}：</span>
                    <span>{{ change.old_value || "—" }}</span>
                    <span class="import-preview-arrow">→</span>
                    <span>{{ change.new_value || "—" }}</span>
                  </div>
                </div>
                <div v-if="row.errors.length" class="import-preview-errors">
                  <div v-for="error in row.errors" :key="`${row.line}-${error.field}-${error.message}`">
                    {{ error.label }}：{{ error.message }}
                  </div>
                </div>
                <span v-if="!row.changes.length && !row.errors.length" class="muted-text">—</span>
              </template>
            </el-table-column>
          </el-table>
        </template>
        <template #footer>
          <el-button @click="cancelImportPreview">取消</el-button>
          <el-button
            type="primary"
            :disabled="!importPreview?.summary.ready"
            @click="confirmImportPreview"
          >确认导入</el-button>
        </template>
      </el-dialog>
      <el-dialog
        v-model="showDataCenterModal"
        :title="editingDataCenter ? '编辑数据中心' : '新增数据中心'"
        width="460px"
        destroy-on-close
      >
        <el-form label-position="top">
          <el-form-item label="数据中心名称" required>
            <el-input v-model="dataCenterForm.name" maxlength="120" />
          </el-form-item>
          <el-form-item label="地址">
            <el-input v-model="dataCenterForm.address" maxlength="255" />
          </el-form-item>
          <el-checkbox v-model="dataCenterForm.is_active">启用</el-checkbox>
        </el-form>
        <template #footer>
          <el-button @click="showDataCenterModal = false">取消</el-button>
          <el-button type="primary" @click="saveDataCenter">保存</el-button>
        </template>
      </el-dialog>
      <el-dialog v-model="showRoomModal" :title="editingRoom ? '编辑机房' : '新增机房'" width="520px" destroy-on-close>
        <el-form label-position="top"><el-form-item label="数据中心" required><el-select v-model="roomForm.data_center" placeholder="请选择数据中心"><el-option v-for="center in dataCenters" :key="center.id" :label="center.is_active ? center.name : `${center.name}（停用）`" :value="String(center.id)" :disabled="!center.is_active && String(center.id) !== roomForm.data_center"/></el-select></el-form-item><el-form-item label="机房名称" required><el-input v-model="roomForm.name"/></el-form-item><div class="form-grid"><el-form-item label="负责人"><el-input v-model="roomForm.owner_name"/></el-form-item><el-form-item label="联系电话"><el-input v-model="roomForm.contact_phone"/></el-form-item></div><el-form-item label="备注"><el-input v-model="roomForm.notes" type="textarea" :rows="3"/></el-form-item><el-checkbox v-model="roomForm.is_active">启用</el-checkbox></el-form>
        <template #footer><el-button @click="showRoomModal = false">取消</el-button><el-button type="primary" @click="saveRoom">保存</el-button></template>
      </el-dialog>
      <AssetDetailDrawer
        v-if="page !== 'racks'"
        v-model="showAssetDetail"
        :asset="detailAsset"
        :loading="detailLoading"
        :error="detailError"
        @closed="detailAsset = null"
      />
    </el-main>
  </el-container>
</template>
