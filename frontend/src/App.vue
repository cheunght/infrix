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
import AssetDetailDrawer from "./components/AssetDetailDrawer.vue";
import AssetFormDialog from "./components/AssetFormDialog.vue";
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
const passwordForm = ref({ old_password: "", new_password: "" });
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
  refreshDictionaries: () => loadDictionaries(),
  reload: () => load(),
  confirmAction,
});
const {
  dataCenters,
  serverRooms,
  racks,
  facilitySummary,
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
  loadDataCenters,
  loadRackManagement,
  loadServerRooms,
  loadRackView,
  openDataCenterModal,
  saveDataCenter,
  openRoomModal,
  saveRoom,
  deleteRoom,
  exportRackLayout,
  visibleRacks,
  roomOptions,
  rackOptions,
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
  customFieldForm,
  customFieldOptionForm,
  editingCustomField,
  editingCustomFieldOption,
  showCustomFieldModal,
  showCustomFieldOptionModal,
  tags,
  tagSearch,
  tagActive,
  tagForm,
  editingTag,
  showTagModal,
  users,
  roles,
  showUserModal,
  editingUser,
  userForm,
  userFormRef,
  userFormRules,
  roleForm,
  editingRole,
  showRoleModal,
  dictionarySection,
  dictionarySearch,
  showDictionaryModal,
  editingDictionary,
  dictionaryForm,
  auditLogs,
  auditCount,
  auditPage,
  auditPageSize,
  auditFilters,
  loadDictionaries,
  loadCustomFields,
  loadTags,
  loadOrganization,
  loadAuditLogs,
  openUserModal,
  saveUser,
  toggleUser,
  deleteUser,
  openRoleModal,
  saveRole,
  deleteRole,
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
  actionMessage,
  settingsSection,
});
const { checkAuth, login, logout, changePassword } = auth;
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
  assetTagFilter,
  assetCustomFilterField,
  assetCustomFilterValue,
  assetLookup,
  assetColumnOptions,
  visibleAssetColumns,
  visibleAssetColumnOptions,
  toggleAssetColumn,
  resetAssetColumns,
  showAssetModal,
  editingAsset,
  assetModalMode,
  assetForm,
  assetCustomFieldSchema,
  activeBrands,
  activeDeviceTypes,
  activeDataCenters,
  assetRoomOptions,
  assetRackOptions,
  loadAssets,
  openAssetEditor,
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
});
const {
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
  if (section === "custom-fields" && !can("custom_fields.manage")) return false;
  if (section === "tags" && !can("tags.manage")) return false;
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
  loading.value = true;
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
    if (isCurrentLoad(version)) loading.value = false;
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
  loading, dashboard, assets,
  dashboardDate, dashboardDateTime, handleMenuSelect,
  dashboardLoading,
  openAssetDetail, openRackSection,
  assetSearch, searchLedger, assetColumnOptions, visibleAssetColumns,
  assetTagFilter, tags,
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
  sparePage, sparePageSize,
  spareSearch, spareType, spareActive, spareListDataCenter, spareListRoom,
  spareRooms,
  sparePartForm, editingSparePart, showSparePartModal, openSparePartModal, saveSparePart, toggleSparePart,
  deleteSparePart, searchSpareParts, changeSparePage, changeSparePageSize,
  openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationCurrentQuantity, spareOperationLocationLabel,
  spareOperationLocationLocked, saveSpareOperation, spareOperationLabel,
  stockLocations, stockLoading, loadStockLocations, transactionRows, transactionCount,
  transactionPage, transactionPageSize, transactionLoading, transactionError, loadTransactions,
  changeTransactionPage, changeTransactionPageSize,
  rackSection, serverRooms, openDataCenterModal, openRoomModal, deleteRoom, racks,
  dataCenters, selectedDataCenter, changeDataCenter, changeRoom,
  facilitySummary,
  changeRackFilter, selectedRoom,
  roomOptions, selectedRack, rackOptions, selectedRackDeviceType, deviceTypes,
  resetRackFilters, exportRackLayout, rackViewTitle, displayedRacks,
  rackUtilization, rackUtilizationColor, rackUsedU, focusedRackId, focusedRack, visibleRacks, selectRack,
  rackViewStyle, rackBodyStyle,
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
  customFieldDeviceType, customFieldActive, loadCustomFields, customFields,
  openCustomFieldModal, saveCustomField, toggleCustomField, deleteCustomField,
  openCustomFieldOptionModal, saveCustomFieldOption, deleteCustomFieldOption,
  customFieldForm, showCustomFieldModal, editingCustomField, customFieldOptionForm,
  showCustomFieldOptionModal, editingCustomFieldOption, tagSearch, tagActive,
  loadTags, openTagModal, saveTag, toggleTag, deleteTag, tagForm, showTagModal, editingTag,
  brands,
  showAssetModal, assetModalMode, editingAsset, assetForm, activeDeviceTypes,
  assetCustomFieldSchema,
  syncAssetDeviceType, activeBrands, activeDataCenters, changeAssetDataCenter,
  assetRoomOptions, changeAssetRoom, assetRackOptions, changeAssetRack, setAssetRackMounted,
  saveAsset,
} satisfies PageContext;
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
        <router-view v-slot="{ Component }">
          <component :is="Component" :context="pageContext" />
        </router-view>
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
