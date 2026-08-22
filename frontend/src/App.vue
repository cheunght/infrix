<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Checked,
  Expand,
  Fold,
  House,
  Key,
  Lock,
  Monitor,
  OfficeBuilding,
  Setting,
  User,
  Warning,
} from "@element-plus/icons-vue";
import { useApiClient } from "./composables/useApiClient";
import { useDashboard } from "./composables/useDashboard";
import { useAssets } from "./composables/useAssets";
import { useAuth } from "./composables/useAuth";
import { useFacilities } from "./composables/useFacilities";
import { useLicenses } from "./composables/useLicenses";
import { useRepairs } from "./composables/useRepairs";
import { useSpareParts } from "./composables/useSpareParts";
import { useSettings } from "./composables/useSettings";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import GlobalOverlayHost from "./components/overlays/GlobalOverlayHost.vue";
import ApiErrorAlert from "./components/ApiErrorAlert.vue";
import SearchField from "./components/SearchField.vue";
import infrixMark from "./assets/infrix-mark.png";
import infrixWordmark from "./assets/infrix-wordmark.png";
import { hasCapability } from "./permissions";
import {
  routeForPage,
  type RackSection,
  type SettingsSection,
} from "./router";
import type {
  Page,
  AssetDetail,
} from "./types";
import type { PageContext } from "./types/page-context";
const route = useRoute();
const router = useRouter();
const page = ref<Page>(route.meta.page || "dashboard");
const pageTitle = ref(route.meta.title || "仪表盘");
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
const showColumnMenu = ref(false);
const username = ref("");
const password = ref("");
const loginError = ref("");
const placeholderTitle = ref("");
const csrfToken = ref("");
// Shared API plumbing is kept outside the page shell so every composable
// uses the same CSRF retry, cancellation and download behaviour.
const apiClient = useApiClient({ csrfToken, authenticated });
const {
  beginLoad,
  isCurrentLoad,
  loadCsrf,
  request,
  download,
} = apiClient;
const {
  dashboard,
  dashboardLoading,
  loadDashboardData,
  maxDashboardStatusCount,
  dashboardBarPercent,
  dashboardDate,
  dashboardDateTime,
  dashboardAlertLevel,
} = useDashboard({ request, beginLoad, isCurrentLoad });
const showUserMenu = ref(false);
const showPasswordModal = ref(false);
const showAssetDetail = ref(false);
const detailAsset = ref<AssetDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
let openAssetDetail: (assetId: number) => Promise<void> = async () => {};
let invalidateAssetDetail: () => void = () => {};
const actionMessage = ref("");
const pageError = ref("");
const passwordForm = ref({ old_password: "", new_password: "", confirm_password: "" });
const passwordSaving = ref(false);
const passwordFormErrors = ref<Record<string, string>>({});
const viewportHeight = ref(window.innerHeight);
const settingsSection = ref<SettingsSection>("dictionaries");
// 机房资源保留机房管理和视图管理两个入口。
const rackSection = ref<RackSection>("rooms");
const facilities = useFacilities({
  request,
  beginLoad,
  isCurrentLoad,
  download,
  page,
  rackSection,
  showAssetDetail,
  detailAsset,
  viewportHeight,
  actionMessage,
  closeAssetDetail,
  openRackAssetDetail,
  refreshDictionaries: async () => {
    return loadDictionaries();
  },
  reload: () => load(),
  confirmAction,
});
const {
  dataCenters,
  serverRooms,
  racks,
  facilitySummary,
  rackListLoading,
  rackCanvasLoading,
  rackListError,
  rackCanvasError,
  selectedDataCenter,
  selectedRoom,
  selectedRack,
  selectedRackDeviceType,
  focusedRackId,
  rackCount,
  rackPage,
  rackPageSize,
  showDataCenterModal,
  editingDataCenter,
  dataCenterForm,
  showRoomModal,
  editingRoom,
  roomForm,
  showRackModal,
  editingRack,
  rackForm,
  rackFormFieldErrors,
  rackSaving,
  deletingRackId,
  updatingRackId,
  loadDataCenters,
  loadRackManagement,
  loadServerRooms,
  loadRackView,
  openDataCenterModal,
  saveDataCenter,
  openRoomModal,
  saveRoom,
  deleteRoom,
  openRackModal,
  saveRack,
  deleteRack,
  updateRackStatus,
  clearRackFormErrors,
  exportRackLayout,
  visibleRacks,
  roomOptions,
  rackOptions,
  hasRackFilters,
  focusedRack,
  rackDetailOpen,
  displayedRacks,
  rackViewTitle,
  rackViewStyle,
  rackUnitHeight,
  rackBodyHeight,
  rackBodyStyle,
  rackAllocationStyle,
  rackUsedU,
  rackGapUnavailable,
  rackUtilization,
  rackUtilizationColor,
  selectRack,
  retryRackView,
  changeDataCenter,
  changeRoom,
  changeRackFilter,
  resetRackFilters,
  changeRackPage,
} = facilities;
const settings = useSettings({
  request,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  can,
  isAdmin,
  settingsSection,
  dataCenters,
  actionMessage,
});
const {
  brands,
  deviceTypes,
  customFields,
  customFieldDeviceType,
  customFieldActive,
  customFieldListLoading,
  customFieldListError,
  customFieldOptionLoading,
  customFieldOptionError,
  customFieldSaving,
  customFieldOptionSaving,
  customFieldActionId,
  customFieldOptionActionId,
  customFieldForm,
  customFieldOptionForm,
  customFieldFormErrors,
  customFieldOptionFormErrors,
  editingCustomField,
  editingCustomFieldOption,
  showCustomFieldModal,
  showCustomFieldOptionModal,
  tags,
  tagListLoading,
  tagListError,
  tagSaving,
  tagActionId,
  tagSearch,
  tagActive,
  tagForm,
  tagFormErrors,
  editingTag,
  showTagModal,
  users,
  organizationLoading,
  organizationError,
  userListError,
  roleListError,
  userSaving,
  userActionId,
  userFormErrors,
  roles,
  userSearch,
  userPage,
  userPageSize,
  userCount,
  showUserModal,
  editingUser,
  userForm,
  userFormRef,
  userFormRules,
  dictionarySection,
  dictionaryLoading,
  dictionaryError,
  dictionarySaving,
  dictionaryActionId,
  dictionarySearch,
  showDictionaryModal,
  editingDictionary,
  dictionaryForm,
  dictionaryFormErrors,
  auditLogs,
  auditCount,
  auditPage,
  auditPageSize,
  auditFilters,
  auditListLoading,
  auditListError,
  loadDictionaries,
  retryDictionaries,
  loadCustomFields,
  retryCustomFieldList,
  loadCustomFieldOptions,
  retryCustomFieldOptions,
  loadTags,
  retryTagList,
  loadOrganization,
  retryOrganization,
  loadUsers,
  retryUserList,
  searchUsers,
  changeUserPage,
  changeUserPageSize,
  loadAuditLogs,
  retryAuditLogs,
  openUserModal,
  saveUser,
  toggleUser,
  deleteUser,
  openCustomFieldModal,
  saveCustomField,
  toggleCustomField,
  deleteCustomField,
  openCustomFieldOptionModal,
  saveCustomFieldOption,
  deleteCustomFieldOption,
  openTagModal,
  saveTag,
  toggleTag,
  deleteTag,
  currentDictionaryItems,
  currentDictionaryLabel,
  dictionaryItemUsed,
  openDictionaryModal,
  saveDictionary,
  toggleDictionary,
  deleteDictionary,
  formatDateTime,
  changeAuditPage,
  changeAuditPageSize,
  searchAuditLogs,
} = settings;
const auth = useAuth({
  request,
  loadCsrf,
  routerReplace: (location) => router.replace(location),
  syncRouteState,
  ensureRouteAccess,
  bootstrapApplication,
  authenticated,
  authChecked,
  passwordChangeRequired,
  isAdmin,
  roleCode,
  permissions,
  userName,
  username,
  password,
  loginError,
  showPasswordModal,
  passwordForm,
  passwordSaving,
  passwordFormErrors,
  actionMessage,
  settingsSection,
});
const { checkAuth, login, logout, changePassword } = auth;
const overlayAuth = {
  showPasswordModal,
  passwordChangeRequired,
  passwordForm,
  passwordSaving,
  passwordFormErrors,
  changePassword,
};
const assetsApi = useAssets({
  request,
  download,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  authenticated,
  page,
  actionMessage,
  dataCenters,
  serverRooms,
  racks,
  brands,
  deviceTypes,
  tags,
  loadRackManagement,
  goToLedger: () => navigateToRoute(routeForPage("ledger"), true),
  showAssetDetail,
  detailAsset,
  detailLoading,
  detailError,
  closeAssetDetail,
  statusLabel: (status) => ({ in_stock: "在库", in_use: "在用", idle: "闲置", repair: "维修中", retired: "已报废" }[status] || status),
});
const {
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
  assetLookup,
  draftCustomFilters,
  appliedCustomFilters,
  applyAssetCustomFilters,
  assetFilterCustomFieldSchema,
  assetFilterCustomSchemaLoading,
  assetFilterCustomSchemaError,
  retryAssetFilterCustomSchema,
  assetColumnOptions,
  assetDynamicColumnOptions,
  visibleAssetColumns,
  visibleAssetColumnOptions,
  toggleAssetColumn,
  resetAssetColumns,
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
  retryAssetFormLoad,
  clearAssetFormErrors,
  assetCustomFieldSchema,
  assetCustomSchemaLoading,
  assetCustomSchemaError,
  retryAssetCustomSchema,
  updateAssetCustomFieldValue,
  activeBrands,
  activeDeviceTypes,
  activeDataCenters,
  assetRoomOptions,
  assetRackOptions,
  loadAssets,
  openAssetEditor,
  retryAssetDetail,
  refreshOpenAssetDetail,
  openAssetClone,
  openNewAssetModal,
  saveAsset,
  deleteAsset,
  deleteSelectedAssets,
  handleElementAssetSelection,
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
} = assetsApi;
openAssetDetail = assetsApi.openAssetDetail;
invalidateAssetDetail = assetsApi.invalidateDetail;
const licensesApi = useLicenses({
  request,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  actionMessage,
});
const {
  licenses,
  licenseCount,
  licensePage,
  licensePageSize,
  licenseKeyword,
  licenseStatus,
  licenseListLoading,
  licenseListError,
  resetLicenseFilters,
  retryLicenseList,
  deletingLicenseId,
  showLicenseModal,
  editingLicense,
  licenseForm,
  loadLicenses,
  searchLicenses,
  changeLicensePage,
  changeLicensePageSize,
  openLicenseModal,
  saveLicense,
  deleteLicense,
} = licensesApi;
const repairs = useRepairs({
  request,
  download,
  beginLoad,
  isCurrentLoad,
  assets,
  selectedAssetIds,
  actionMessage,
  refreshOpenAssetDetail: assetsApi.refreshOpenAssetDetail,
});
const {
  repairListLoading,
  repairListError,
  repairRows,
  repairCount,
  repairPage,
  repairPageSize,
  repairKeyword,
  repairStatus,
  repairStart,
  repairEnd,
  showFaultModal,
  showRepairModal,
  selectedFault,
  faultForm,
  faultAssetSearch,
  faultAssetOptions,
  faultAssetLoading,
  repairForm,
  openFaultModal,
  searchFaultAssets,
  registerFaultFromSelection,
  openRepairModal,
  loadRepairs,
  searchRepairs,
  onRepairStatusChange,
  onRepairDateChange,
  resetRepairFilters,
  retryRepairList,
  createFault,
  saveRepair,
  exportRepairs,
  changeRepairPage,
  changeRepairPageSize,
} = repairs;
const spares = useSpareParts({
  request,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  dataCenters,
  actionMessage,
  can,
});
const {
  spareParts,
  spareStocks,
  spareTransactions,
  sparePartCount,
  spareStockCount,
  spareTransactionCount,
  sparePage,
  sparePageSize,
  spareStockPage,
  spareStockPageSize,
  spareTransactionPage,
  spareTransactionPageSize,
  spareRooms,
  spareSearch,
  spareType,
  spareActive,
  spareListDataCenter,
  spareListRoom,
  spareDataCenter,
  spareRoom,
  spareSelectedPart,
  sparePartForm,
  showSparePartModal,
  spareSaving,
  deletingSparePartId,
  updatingSparePartId,
  spareListLoading,
  spareListError,
  editingSparePart,
  spareOperationType,
  spareOperationForm,
  showSpareOperationModal,
  spareOperationSaving,
  spareOperationCurrentQuantity,
  spareOperationLocationLabel,
  spareOperationLocationLocked,
  spareTransactionFilters,
  loadSpareData,
  refreshSparePart,
  searchSpareParts,
  resetSpareFilters,
  retrySpareList,
  changeSparePage,
  changeSparePageSize,
  selectSparePart,
  changeSpareStockPage,
  changeSpareStockPageSize,
  changeSpareTransactionPage,
  changeSpareTransactionPageSize,
  openSparePartModal,
  saveSparePart,
  toggleSparePart,
  deleteSparePart,
  openSpareOperation,
  saveSpareOperation,
  spareOperationLabel,
  stockLocations,
  stockLoading,
  stockLocationLoadingByPart,
  stockLocationErrorByPart,
  stockLocationTotalsByPart,
  stockLocationLoadedByPart,
  loadStockLocations,
  transactionRows,
  transactionCount,
  transactionPage,
  transactionPageSize,
  transactionLoading,
  transactionError,
  loadTransactions,
  changeTransactionPage,
  changeTransactionPageSize,
} = spares;
const navItems = [
  { label: "仪表盘", icon: "⌂", iconIndex: 0, page: "dashboard" as Page },
  { label: "资产管理", icon: "▤", iconIndex: 1, page: "ledger" as Page },
  { label: "机房资源", icon: "▦", iconIndex: 2, page: "racks" as Page },
  { label: "软件许可", icon: "▣", iconIndex: 6, page: "licenses" as Page },
  { label: "盘点中心", icon: "✓", iconIndex: 5, page: "inventory" as Page },
  { label: "故障维修", icon: "⚒", iconIndex: 4, page: "repairs" as Page },
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

function closeTransientUi() {
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
}

function syncRouteState() {
  const routePage = route.meta.page || "dashboard";
  page.value = routePage;
  if (routePage === "settings")
    settingsSection.value = route.meta.settingsSection || "dictionaries";
  if (routePage === "racks")
    rackSection.value = route.meta.rackSection || "rooms";
  pageTitle.value = route.meta.title || "仪表盘";
}

function routeIsAllowed() {
  const routePage = route.meta.page || "dashboard";
  if (routePage === "spares" && !can("spares.view")) return false;
  if (
    routePage === "racks" &&
    route.meta.rackSection === "rooms" &&
    !can("racks.manage")
  ) {
    return false;
  }
  if (routePage !== "settings") return true;
  const section = route.meta.settingsSection || "dictionaries";
  if (section === "organization" && !isAdmin.value) return false;
  if (section === "audit" && !can("audit.view")) return false;
  if (section === "custom-fields" && !can("custom_fields.view")) return false;
  if (section === "tags" && !can("tags.view")) return false;
  return true;
}

function ensureRouteAccess() {
  if (!authenticated.value || routeIsAllowed()) return true;
  page.value = "dashboard";
  pageTitle.value = "仪表盘";
  void router.replace(routeForPage("dashboard"));
  return false;
}

function navigateToRoute(location: RouteLocationRaw, reloadIfSame = false) {
  const target = router.resolve(location);
  if (target.fullPath === route.fullPath) {
    syncRouteState();
    if (reloadIfSame && authenticated.value) void load();
    return;
  }
  void router.push(location);
}

function resetMainScroll() {
  nextTick(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".ep-main")?.scrollTo({
        top: 0,
        left: 0,
      });
    });
  });
}

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
function openRackSection(section: RackSection | string) {
  const normalized: RackSection = section === "view" ? "view" : "rooms";
  rackSection.value = normalized;
  navigateToRoute(routeForPage("racks", { rackSection: normalized }), true);
}
async function bootstrapApplication() {
  await loadDataCenters();
  await loadDictionaries();
  await loadCustomFields();
  await loadTags();
  await load();
}
function openRackAssetDetail(assetId: number, rackId: number) {
  focusedRackId.value = rackId;
  return openAssetDetail(assetId);
}
function closeAssetDetail() {
  invalidateAssetDetail();
  showAssetDetail.value = false;
  detailAsset.value = null;
}
async function load() {
  if (!authenticated.value) return;
  const version = beginLoad();
  // Spare parts and the rack view own their workspace loading masks so a
  // list/canvas request never blocks the entire routed application.
  const usesLocalPageLoading = page.value === "settings" || page.value === "spares" || (page.value === "racks" && rackSection.value === "view");
  loading.value = !usesLocalPageLoading;
  pageError.value = "";
  try {
    if (page.value === "ledger") await loadAssets(version);
    if (page.value === "dashboard") {
      await loadDashboardData(version);
    }
    if (page.value === "racks" && rackSection.value === "rooms") {
      await loadRackManagement(version);
    } else if (page.value === "racks") {
      await loadRackView(version);
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
    if (isCurrentLoad(version) && !usesLocalPageLoading) loading.value = false;
  }
}
function navigate(item: (typeof navItems)[number]) {
  closeTransientUi();
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
    nextTick(() => sidebarMenu.value?.open("settings"));
  }
  navigateToRoute(
    routeForPage(item.page, {
      rackSection: rackSection.value,
      settingsSection: settingsSection.value,
    }),
    true,
  );
}
function openSettingsSection(
  section: SettingsSection,
) {
  if (section === "organization" && !isAdmin.value) {
    settingsSection.value = "dictionaries";
    return;
  }
  if (section === "audit" && !can("audit.view")) return;
  closeTransientUi();
  settingsSection.value = section;
  settingsMenuExpanded.value = true;
  localStorage.setItem("itam.settings.expanded", "1");
  nextTick(() => sidebarMenu.value?.open("settings"));
  navigateToRoute(routeForPage("settings", { settingsSection: section }), true);
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
  () => route.fullPath,
  () => {
    syncRouteState();
    closeTransientUi();
    if (!authenticated.value || !ensureRouteAccess()) return;
    void load();
    resetMainScroll();
  },
  { immediate: true },
);
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
  if (authenticated.value && !passwordChangeRequired.value) {
    resetMainScroll();
    await bootstrapApplication();
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("click", closeMenusOnOutsideClick);
  window.removeEventListener("resize", updateViewportHeight);
  apiClient.dispose();
});

// Page components receive refs and handlers through this stable context. The
// shell keeps ownership of authentication/navigation while page-specific
// markup can evolve independently without changing API contracts.
const pageContext = {
  request,
  downloadFile: download,
  currentUsername: username,
  loading, dashboard, assets,
  dashboardDate, dashboardDateTime, handleMenuSelect,
  dashboardLoading,
  openAssetDetail, refreshOpenAssetDetail, openRackSection,
  assetSearch, searchLedger, assetColumnOptions, assetDynamicColumnOptions, visibleAssetColumns,
  assetFilters, assetListLoading, assetListError, resetAssetFilters,
  draftCustomFilters, appliedCustomFilters, applyAssetCustomFilters,
  assetFilterCustomFieldSchema, assetFilterCustomSchemaLoading, assetFilterCustomSchemaError,
  retryAssetFilterCustomSchema,
  assetTagFilter, tags, assetListCustomSchemaLoading, assetListCustomSchemaError,
  retryAssetListCustomSchema,
  toggleAssetColumn, resetAssetColumns, visibleAssetColumnOptions, can,
  openNewAssetModal, selectedAssetIds, deleteSelectedAssets, exportAssets,
  registerFaultFromSelection, downloadImportTemplate, onElementUploadChange,
  handleElementAssetSelection, assetValue, openAssetClone, openAssetEditor,
  deleteAsset, assetPage, assetPageSize, assetCount, changeAssetPage,
  changeAssetPageSize,
  repairListLoading, repairListError,
  repairKeyword, searchRepairs, repairStatus, repairStart, repairEnd,
  onRepairStatusChange, onRepairDateChange, resetRepairFilters, retryRepairList,
  exportRepairs, openFaultModal, repairRows, openRepairModal, formatDateTime,
  repairPage, repairPageSize, repairCount, changeRepairPage,
  changeRepairPageSize,
  licenseKeyword, searchLicenses, licenseStatus, licenseListLoading, licenseListError,
  resetLicenseFilters, retryLicenseList, deletingLicenseId,
  openLicenseModal, deleteLicense, licenses, licensePage,
  licensePageSize, licenseCount, changeLicensePage, changeLicensePageSize,
  spareParts, spareStocks, spareTransactions, sparePartCount, spareStockCount, spareTransactionCount,
  sparePage, sparePageSize,
  spareSearch, spareType, spareActive, spareListDataCenter, spareListRoom,
  spareRooms,
  sparePartForm, editingSparePart, showSparePartModal, spareSaving, deletingSparePartId, updatingSparePartId,
  spareListLoading, spareListError, openSparePartModal, saveSparePart, toggleSparePart,
  deleteSparePart, searchSpareParts, resetSpareFilters, retrySpareList, changeSparePage, changeSparePageSize,
  openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationCurrentQuantity, spareOperationLocationLabel,
  spareOperationLocationLocked, saveSpareOperation, spareOperationLabel,
  stockLocations, stockLoading, stockLocationLoadingByPart, stockLocationErrorByPart,
  stockLocationTotalsByPart, stockLocationLoadedByPart, loadStockLocations, transactionRows, transactionCount,
  transactionPage, transactionPageSize, transactionLoading, transactionError, loadTransactions,
  changeTransactionPage, changeTransactionPageSize,
  rackSection, serverRooms, openDataCenterModal, openRoomModal, deleteRoom, racks,
  showRackModal, editingRack, rackForm, rackFormFieldErrors, rackSaving, deletingRackId, updatingRackId,
  openRackModal, saveRack, deleteRack, updateRackStatus, clearRackFormErrors,
  dataCenters, selectedDataCenter, changeDataCenter, changeRoom,
  facilitySummary, rackListLoading, rackCanvasLoading, rackListError, rackCanvasError,
  changeRackFilter, selectedRoom,
  roomOptions, selectedRack, rackOptions, hasRackFilters, selectedRackDeviceType, deviceTypes,
  resetRackFilters, retryRackView, exportRackLayout, rackViewTitle, displayedRacks,
  rackUtilization, rackUtilizationColor, rackUsedU, focusedRackId, focusedRack, visibleRacks, selectRack,
  rackViewStyle, rackBodyStyle,
  rackAllocationStyle, rackGapUnavailable, openRackAssetDetail,
  rackDetailOpen, detailAsset, detailLoading, detailError, retryAssetDetail, closeAssetDetail,
  rackCount, rackPage, changeRackPage,
  settingsSection, dictionarySection,
  dictionarySearch, dictionaryLoading, dictionaryError, dictionarySaving, dictionaryActionId,
  dictionaryFormErrors,
  loadDictionaries, retryDictionaries, currentDictionaryLabel,
  openDictionaryModal, currentDictionaryItems, toggleDictionary,
  dictionaryItemUsed, deleteDictionary, isAdmin, organizationLoading, organizationError,
  userListError, roleListError, retryOrganization, users, userSearch, userPage, userPageSize, userCount,
  userFormErrors, userSaving, userActionId, openUserModal,
  toggleUser, deleteUser, roles, retryUserList, searchUsers, changeUserPage, changeUserPageSize,
  auditFilters, auditListLoading, auditListError,
  loadAuditLogs, retryAuditLogs, searchAuditLogs, auditLogs, auditPage, auditPageSize, auditCount,
  changeAuditPage, changeAuditPageSize,
  customFieldDeviceType, customFieldActive, customFieldListLoading, customFieldListError,
  customFieldOptionLoading, customFieldOptionError, customFieldSaving, customFieldOptionSaving,
  customFieldActionId, customFieldOptionActionId, loadCustomFields, retryCustomFieldList, loadCustomFieldOptions, retryCustomFieldOptions, customFields,
  openCustomFieldModal, saveCustomField, toggleCustomField, deleteCustomField,
  openCustomFieldOptionModal, saveCustomFieldOption, deleteCustomFieldOption,
  customFieldForm, customFieldFormErrors, showCustomFieldModal, editingCustomField, customFieldOptionForm,
  customFieldOptionFormErrors,
  showCustomFieldOptionModal, editingCustomFieldOption, tagSearch, tagActive, tagListLoading, tagListError, tagSaving, tagActionId,
  loadTags, retryTagList, openTagModal, saveTag, toggleTag, deleteTag, tagForm, tagFormErrors, showTagModal, editingTag,
  brands,
  showAssetModal, assetModalMode, editingAsset, assetForm, activeDeviceTypes,
  assetFormLoading, assetFormLoadError, assetFormSaving, assetFormFieldErrors,
  retryAssetFormLoad, clearAssetFormErrors,
  assetCustomFieldSchema,
  assetCustomSchemaLoading, assetCustomSchemaError, retryAssetCustomSchema, updateAssetCustomFieldValue,
  syncAssetDeviceType, activeBrands, activeDataCenters, changeAssetDataCenter,
  assetRoomOptions, changeAssetRoom, assetRackOptions, changeAssetRack, setAssetRackMounted,
  saveAsset,
} satisfies PageContext;
const overlayAssetDetail = {
  page,
  showAssetDetail,
  detailAsset,
  detailLoading,
  detailError,
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
        <el-menu-item index="repairs" title="故障维修"
          ><el-icon><Warning /></el-icon
          ><template #title>故障维修</template></el-menu-item
        >
        <el-sub-menu
          index="settings"
          popper-class="ep-sidebar-submenu-popper ep-sidebar-submenu-popper--settings"
          ><template #title
            ><el-icon><Setting /></el-icon><span>系统设置</span></template
          ><el-menu-item index="settings-dictionaries"
            >数据字典</el-menu-item
          ><el-menu-item v-if="can('custom_fields.view')" index="settings-custom-fields"
            >自定义字段</el-menu-item
          ><el-menu-item v-if="can('tags.view')" index="settings-tags"
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
      <ApiErrorAlert :message="pageError" />
      <div class="app-route-shell" v-loading="loading" :aria-busy="loading ? 'true' : 'false'">
        <router-view v-slot="{ Component }">
          <component :is="Component" :context="pageContext" />
        </router-view>
      </div>
      <GlobalOverlayHost
        :asset-context="pageContext"
        :asset-detail="overlayAssetDetail"
        :assets="assetsApi"
        :facilities="facilities"
        :licenses="licensesApi"
        :repairs="repairs"
        :settings="settings"
        :auth="overlayAuth"
      />
    </el-main>
  </el-container>
</template>
