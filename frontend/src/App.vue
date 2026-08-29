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
import type { MenuInstance } from "element-plus";
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
import { useGlobalSearch, type GlobalSearchModule } from "./composables/useGlobalSearch";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import GlobalOverlayHost from "./components/overlays/GlobalOverlayHost.vue";
import ApiErrorAlert from "./components/ApiErrorAlert.vue";
import GlobalSearch from "./components/GlobalSearch.vue";
import infrixMark from "./assets/infrix-mark.png";
import infrixWordmark from "./assets/infrix-wordmark.png";
import { hasCapability } from "./permissions";
import { statusLabel } from "./status";
import {
  routeForPage,
  type AssetConfigSection,
  type RackSection,
  type SettingsSection,
} from "./router";
import type {
  Page,
  Asset,
  AssetDetail,
  FaultEvent,
  Rack,
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
const sidebarMenu = ref<MenuInstance>();
const userName = ref("");
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
  query: globalSearchQuery,
  state: globalSearchState,
  focus: focusGlobalSearch,
  close: closeGlobalSearch,
} = useGlobalSearch({ request, can });
const {
  dashboard,
  dashboardLoading,
  dashboardError,
  dashboardUpdatedAt,
  loadDashboardData,
  refreshDashboard,
  maxDashboardStatusCount,
  dashboardBarPercent,
  dashboardDate,
  dashboardDateTime,
  dashboardAlertLevel,
} = useDashboard({ request, beginLoad, isCurrentLoad });
const showPasswordModal = ref(false);
const showProfileModal = ref(false);
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
const passwordError = ref("");
const passwordFormErrors = ref<Record<string, string>>({});
const profileForm = ref({ first_name: "", last_name: "", email: "" });
const profileLoading = ref(false);
const profileSaving = ref(false);
const profileError = ref("");
const profileFormErrors = ref<Record<string, string>>({});
const roleName = ref("");
const userIsActive = ref(false);
const lastLogin = ref<string | null>(null);
const viewportHeight = ref(window.innerHeight);
const settingsSection = ref<SettingsSection>("system");
const assetConfigSection = ref<AssetConfigSection>("custom-fields");
const rackSection = ref<RackSection>("locations");
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
  clearRouteQuery,
  updateRouteQuery,
  reload: () => load(),
  confirmAction,
});
const {
  dataCenters,
  serverRooms,
  racks,
  facilitySummary,
  locationSearch,
  locationType,
  locationStatus,
  locationDataCenter,
  locationManagementLoading,
  locationManagementError,
  dataCenterActionId,
  loadLocationManagement,
  retryLocationManagement,
  changeLocationSearch,
  changeLocationType,
  changeLocationStatus,
  changeLocationDataCenter,
  resetLocationFilters,
  rackListLoading,
  rackCanvasLoading,
  rackListError,
  rackCanvasError,
  selectedDataCenter,
  selectedRoom,
  selectedRack,
  selectedRackDeviceTypeId,
  focusedRackId,
  rackCount,
  rackPage,
  rackPageSize,
  showDataCenterModal,
  showRoomModal,
  showRackModal,
  editingRack,
  rackForm,
  rackFormFieldErrors,
  rackSaving,
  deletingRackId,
  updatingRackId,
  updatingRoomId,
  loadDataCenters,
  loadRackManagement,
  loadRackView,
  openDataCenterModal,
  updateDataCenterStatus,
  deleteDataCenter,
  openRoomModal,
  deleteRoom,
  updateRoomStatus,
  openRackModal,
  saveRack,
  deleteRack,
  updateRackStatus,
  clearRackFormErrors,
  exportRackLayout,
  visibleRacks,
  roomOptions,
  hasRackFilters,
  focusedRack,
  rackDetailOpen,
  displayedRacks,
  rackBodyStyle,
  rackAllocationStyle,
  rackUsedU,
  rackGapUnavailable,
  rackUtilization,
  rackUtilizationColor,
  selectRack,
  retryRackView,
  changeDataCenter,
  changeRackFilter,
  resetRackFilters,
  changeRackPage,
} = facilities;
const settings = useSettings({
  request,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  reload: () => window.location.reload(),
  can,
  isAdmin,
  currentUsername: username,
  settingsSection,
  actionMessage,
});
const {
  systemSettings,
  systemSettingsForm,
  systemSettingsDefinitions,
  systemSettingsLoading,
  systemSettingsSaving,
  systemSettingsError,
  systemSettingsFormErrors,
  systemSettingsDirty,
  loadSystemSettings,
  retrySystemSettings,
  resetSystemSettingsForm,
  saveSystemSettings,
  manufacturers,
  deviceTypes,
  spareCategories,
  customFields,
  customFieldTableItems,
  customFieldCount,
  customFieldPage,
  customFieldPageSize,
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
  tagTableItems,
  tagCount,
  tagPage,
  tagPageSize,
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
  userPendingId,
  userFormErrors,
  roles,
  userSearch,
  userPage,
  userPageSize,
  userCount,
  selectedUserIds,
  userBatchSaving,
  userBatchResult,
  showUserBatchResult,
  showUserModal,
  editingUser,
  userForm,
  userFormRef,
  userFormRules,
  showUserResetModal,
  resettingUser,
  userResetForm,
  userResetFormRef,
  userResetFormRules,
  userResetSaving,
  userResetFormErrors,
  dictionarySection,
  dictionaryPage,
  dictionaryPageSize,
  dictionaryCount,
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
  refreshCustomFieldList,
  changeCustomFieldPage,
  changeCustomFieldPageSize,
  loadCustomFieldOptions,
  retryCustomFieldOptions,
  loadTags,
  retryTagList,
  refreshTagList,
  changeTagPage,
  changeTagPageSize,
  loadOrganization,
  retryOrganization,
  loadUsers,
  retryUserList,
  handleUserSelection,
  clearUserSelection,
  batchUpdateUserStatus,
  closeUserBatchResult,
  searchUsers,
  changeUserPage,
  changeUserPageSize,
  loadAuditLogs,
  retryAuditLogs,
  openUserModal,
  saveUser,
  openUserResetModal,
  resetUserPassword,
  userProtectionReason,
  canChangeUserRole,
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
  changeDictionarySection,
  searchDictionaries,
  changeDictionaryPage,
  changeDictionaryPageSize,
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
  showSystemResetDialog,
  systemResetConfirmation,
  systemResetConfirmationToken,
  systemResetSaving,
  systemResetError,
  openSystemResetDialog,
  closeSystemResetDialog,
  resetSystem,
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
  passwordError,
  passwordFormErrors,
  showProfileModal,
  profileForm,
  profileLoading,
  profileSaving,
  profileError,
  profileFormErrors,
  roleName,
  userIsActive,
  lastLogin,
  actionMessage,
  settingsSection,
});
const { checkAuth, login, logout, loadProfile, saveProfile, changePassword, openPasswordModal } = auth;
const overlayAuth = {
  username,
  loadProfile,
  showPasswordModal,
  passwordChangeRequired,
  passwordForm,
  passwordSaving,
  passwordError,
  passwordFormErrors,
  showProfileModal,
  profileForm,
  profileLoading,
  profileSaving,
  profileError,
  profileFormErrors,
  roleName,
  userIsActive,
  lastLogin,
  saveProfile,
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
  manufacturers,
  deviceTypes,
  tags,
  loadRackManagement: async () => { await loadRackManagement(); },
  goToLedger: () => navigateToRoute(routeForPage("ledger"), true),
  clearRouteQuery,
  updateRouteQuery,
  showAssetDetail,
  detailAsset,
  detailLoading,
  detailError,
  closeAssetDetail,
  statusLabel,
});
const {
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
  assetFilters,
  assetListLoading,
  assetListError,
  exportingAssets,
  assetTagFilter,
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
  depreciationStartTouched,
  enableDepreciation,
  markDepreciationStartTouched,
  syncDepreciationStartFromPurchase,
  updateAssetCustomFieldValue,
  manufacturerOptions,
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
  closeAssetBatchDeleteResult,
  handleElementAssetSelection,
  clearAssetSelection,
  exportAssets,
  assetValue,
  downloadImportTemplate,
  showImportDialog,
  openImportDialog,
  searchLedger,
  changeAssetSort,
  syncFiltersFromQuery: syncAssetFiltersFromQuery,
  resetAssetFilters,
  changeAssetPage,
  changeAssetPageSize,
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
  download,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  actionMessage,
  manufacturers,
  clearRouteQuery,
});
const {
  licenses,
  licenseCount,
  licensePage,
  licensePageSize,
  licenseKeyword,
  licenseStatus,
  licenseManufacturer,
  licenseManufacturerOptions,
  licenseManufacturerFilterOptions,
  licenseListLoading,
  licenseListError,
  exportingLicenses,
  resetLicenseFilters,
  retryLicenseList,
  exportLicenses,
  deletingLicenseId,
  showLicenseModal,
  editingLicense,
  licenseForm,
  loadLicenses,
  searchLicenses,
  syncFiltersFromQuery: syncLicenseFiltersFromQuery,
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
  clearRouteQuery,
});
const {
  repairListLoading,
  repairListError,
  exportingRepairs,
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
  repairForm,
  openFaultModal,
  registerFaultFromSelection,
  openRepairModal,
  loadRepairs,
  searchRepairs,
  onRepairStatusChange,
  onRepairDateChange,
  syncFiltersFromQuery: syncRepairFiltersFromQuery,
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
  download,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  dataCenters,
  spareCategories,
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
  spareCategory,
  spareManufacturer,
  spareListDataCenter,
  spareListRoom,
  spareDataCenter,
  spareRoom,
  spareSelectedPart,
  sparePartForm,
  showSparePartModal,
  spareSaving,
  deletingSparePartId,
  spareListLoading,
  spareListError,
  exportingSpares,
  editingSparePart,
  spareOperationType,
  spareOperationForm,
  showSpareOperationModal,
  spareOperationSaving,
  spareOperationError,
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
  exportSpareParts,
  exportSpareTransactions,
  selectSparePart,
  changeSpareStockPage,
  changeSpareStockPageSize,
  changeSpareTransactionPage,
  changeSpareTransactionPageSize,
  openSparePartModal,
  saveSparePart,
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
      { label: "系统参数", section: "system" as const },
      { label: "数据字典", section: "dictionaries" as const },
      { label: "组织权限", section: "organization" as const, adminOnly: true },
      { label: "操作日志", section: "audit" as const },
    ],
  },
  { label: "备件管理", icon: "", iconIndex: 0, page: "spares" as Page },
];

function closeTransientUi() {
  closeGlobalSearch();
  closeAssetDetail();
  showAssetModal.value = false;
  showFaultModal.value = false;
  showRepairModal.value = false;
  showImportDialog.value = false;
  showDataCenterModal.value = false;
  showRoomModal.value = false;
  showRackModal.value = false;
  showLicenseModal.value = false;
  showSparePartModal.value = false;
  showSpareOperationModal.value = false;
}

function routeQueryValue(key: string): string {
  const value = route.query[key];
  return (Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "")).trim();
}

function positiveRouteQueryId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function syncRouteState(): boolean {
  const routePage = route.meta.page || "dashboard";
  const rackFilterQueryKeys = ["room", "rack", "rack_code", "device_type"];
  const locationQueryKeys = ["data_center", "search", "type", "status"];
  const rackSectionQueryKeys = [...locationQueryKeys, ...rackFilterQueryKeys];
  const queryKeysToClear: string[] = [];
  const hasQueryKey = (key: string) =>
    Object.prototype.hasOwnProperty.call(route.query, key);
  page.value = routePage;
  if (routePage === "settings")
    settingsSection.value = route.meta.settingsSection || "system";
  if (routePage === "asset-config") {
    const assetConfigQuery = routeQueryValue("tab");
    assetConfigSection.value = assetConfigQuery === "tags"
      ? "tags"
      : assetConfigQuery === "custom-fields" || can("custom_fields.view")
        ? "custom-fields"
        : "tags";
    if (hasQueryKey("tab") && assetConfigQuery !== "tags" && assetConfigQuery !== "custom-fields") {
      queryKeysToClear.push("tab");
    }
  }
  if (routePage === "racks") {
    rackSection.value = route.meta.rackSection || "locations";
  }
  if (routePage === "racks" && rackSection.value === "view") {
    const dataCenterQuery = positiveRouteQueryId(routeQueryValue("data_center"));
    const roomQuery = positiveRouteQueryId(routeQueryValue("room"));
    const rackQuery = positiveRouteQueryId(routeQueryValue("rack"));
    if (hasQueryKey("data_center") && dataCenterQuery === null) queryKeysToClear.push("data_center");
    if (hasQueryKey("room") && roomQuery === null) queryKeysToClear.push("room");
    if (hasQueryKey("rack") && rackQuery === null) queryKeysToClear.push("rack");
    if (hasQueryKey("rack_code") && !routeQueryValue("rack_code")) {
      queryKeysToClear.push("rack_code");
    }
    const deviceTypeQuery = positiveRouteQueryId(routeQueryValue("device_type"));
    if (hasQueryKey("device_type") && deviceTypeQuery === null) queryKeysToClear.push("device_type");
    selectedDataCenter.value = dataCenterQuery ? String(dataCenterQuery) : "";
    selectedRoom.value = roomQuery ? String(roomQuery) : "";
    selectedRack.value = routeQueryValue("rack_code");
    selectedRackDeviceTypeId.value = deviceTypeQuery ? String(deviceTypeQuery) : "";
    focusedRackId.value = rackQuery;
    for (const key of ["search"]) {
      if (hasQueryKey(key)) queryKeysToClear.push(key);
    }
  } else if (routePage === "racks" && rackSection.value === "locations") {
    const dataCenterQuery = positiveRouteQueryId(routeQueryValue("data_center"));
    if (hasQueryKey("data_center") && dataCenterQuery === null) queryKeysToClear.push("data_center");
    locationDataCenter.value = dataCenterQuery ? String(dataCenterQuery) : "";
    locationSearch.value = routeQueryValue("search");
    const locationTypeQuery = routeQueryValue("type");
    locationType.value = locationTypeQuery === "data-center" || locationTypeQuery === "room"
      ? locationTypeQuery
      : "";
    if (hasQueryKey("type") && locationType.value === "" && locationTypeQuery !== "") {
      queryKeysToClear.push("type");
    }
    const locationStatusQuery = routeQueryValue("status");
    locationStatus.value = locationStatusQuery === "active" || locationStatusQuery === "inactive"
      ? locationStatusQuery
      : "";
    if (hasQueryKey("status") && locationStatus.value === "" && locationStatusQuery !== "") {
      queryKeysToClear.push("status");
    }
    for (const key of rackFilterQueryKeys) {
      if (hasQueryKey(key)) queryKeysToClear.push(key);
    }
    selectedDataCenter.value = "";
    selectedRoom.value = "";
    selectedRack.value = "";
    selectedRackDeviceTypeId.value = "";
    focusedRackId.value = null;
  } else {
    // These refs are route-positioning state. Leaving the Rack View, or
    // returning to it without its query, must not resurrect the old target.
    selectedDataCenter.value = "";
    selectedRoom.value = "";
    selectedRack.value = "";
    selectedRackDeviceTypeId.value = "";
    focusedRackId.value = null;
    if (routePage === "racks") {
      for (const key of rackSectionQueryKeys) {
        if (hasQueryKey(key)) queryKeysToClear.push(key);
      }
    }
  }
  if (routePage === "ledger") syncAssetFiltersFromQuery(route.query);
  if (routePage === "repairs") syncRepairFiltersFromQuery(route.query);
  if (routePage === "licenses") syncLicenseFiltersFromQuery(route.query);
  pageTitle.value = routePage === "asset-config"
    ? assetConfigSection.value === "tags" ? "资产管理 / 标签管理" : "资产管理 / 自定义字段"
    : route.meta.title || "仪表盘";
  return clearRouteQuery(queryKeysToClear);
}

function routeIsAllowed() {
  const routePage = route.meta.page || "dashboard";
  if (routePage === "spares" && !can("spares.view")) return false;
  if (
    routePage === "racks" &&
    !can("racks.view")
  ) {
    return false;
  }
  if (routePage === "asset-config") {
    const requestedSection = routeQueryValue("tab");
    const section = requestedSection === "tags"
      ? "tags"
      : requestedSection === "custom-fields" || can("custom_fields.view")
        ? "custom-fields"
        : "tags";
    return can(section === "tags" ? "tags.view" : "custom_fields.view");
  }
  if (routePage !== "settings") return true;
  const section = route.meta.settingsSection || "system";
  if (section === "system" && !can("settings.view")) return false;
  if (section === "organization" && !isAdmin.value) return false;
  if (section === "audit" && !can("audit.view")) return false;
  if (section === "custom-fields" && !can("custom_fields.view")) return false;
  if (section === "tags" && !can("tags.view")) return false;
  if (section === "maintenance" && !can("system.reset")) return false;
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
    const queryNormalized = syncRouteState();
    if (reloadIfSame && authenticated.value && !queryNormalized) void load();
    return;
  }
  void router.push(location);
}

function clearRouteQuery(keys: string[]): boolean {
  const routeName = route.name;
  if (!routeName) return false;
  const nextQuery = { ...route.query };
  let changed = false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(nextQuery, key)) {
      delete nextQuery[key];
      changed = true;
    }
  }
  if (changed) void router.replace({ name: routeName, query: nextQuery });
  return changed;
}

function updateRouteQuery(updates: Record<string, string | undefined>): boolean {
  const routeName = route.name;
  if (!routeName) return false;
  const nextQuery = { ...route.query };
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      if (String(nextQuery[key] ?? "") !== value) {
        nextQuery[key] = value;
        changed = true;
      }
    } else if (Object.prototype.hasOwnProperty.call(nextQuery, key)) {
      delete nextQuery[key];
      changed = true;
    }
  }
  if (changed) void router.replace({ name: routeName, query: nextQuery });
  return changed;
}

function goToAssets(query: Record<string, string> = {}) {
  navigateToRoute({ name: "assets", query });
}

function goToRepairs(query: Record<string, string> = {}) {
  navigateToRoute({ name: "repairs", query });
}

async function handleGlobalSearchAsset(asset: Asset) {
  closeGlobalSearch();
  await openAssetDetail(asset.id);
}

function handleGlobalSearchRack(rack: Rack) {
  closeGlobalSearch();
  openRackSection("view", {
    room: String(rack.room),
    rack: String(rack.id),
    rack_code: rack.code,
  });
}

function handleGlobalSearchFault(fault: FaultEvent) {
  closeGlobalSearch();
  goToRepairs({ fault: String(fault.id) });
}

function handleGlobalSearchViewAll(module: GlobalSearchModule) {
  const search = globalSearchQuery.value.trim();
  if (!search) return;
  closeGlobalSearch();
  if (module === "assets") {
    goToAssets({ search });
    return;
  }
  if (module === "racks") {
    openRackSection("view", { rack_code: search });
    return;
  }
  goToRepairs({ search, is_closed: "false" });
}

function goToLicenses(query: Record<string, string> = {}) {
  navigateToRoute({ name: "licenses", query });
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
  if (!sidebarCollapsed.value) openActiveSidebarSubmenu();
}
function openActiveSidebarSubmenu() {
  const submenuIndexes =
    page.value === "settings"
      ? ["settings"]
      : page.value === "asset-config"
        ? ["asset-menu", "asset-config-menu"]
        : page.value === "ledger" || page.value === "spares"
          ? ["asset-menu"]
          : page.value === "racks"
            ? ["racks-menu"]
            : [];
  if (submenuIndexes.length) {
    nextTick(() => submenuIndexes.forEach((index) => sidebarMenu.value?.open(index)));
  }
}

function totalPages(total: number, size: number) {
  return Math.max(1, Math.ceil(total / size));
}
async function confirmAction(message: string) {
  const isDelete = message.trim().startsWith("确定删除");
  const dialogMessage = isDelete
    ? `${message.trim().replace(/^确定/, "").replace(/吗？(?=\s*(?:\n|$))/, "？")}\n删除后无法恢复，是否继续？`
    : message;
  try {
    await ElMessageBox.confirm(dialogMessage, isDelete ? "删除确认" : "确认操作", {
      type: isDelete ? "error" : "warning",
      confirmButtonText: isDelete ? "删除" : "确定",
      cancelButtonText: "取消",
      confirmButtonClass: isDelete ? "el-button--danger" : undefined,
    });
    return true;
  } catch {
    return false;
  }
}
function facilitySectionQuery(section: RackSection): Record<string, string> {
  if (section !== "view") {
    return {
      ...(locationDataCenter.value ? { data_center: locationDataCenter.value } : {}),
      ...(locationSearch.value.trim() ? { search: locationSearch.value.trim() } : {}),
      ...(locationType.value ? { type: locationType.value } : {}),
      ...(locationStatus.value ? { status: locationStatus.value } : {}),
    };
  }
  return {
    ...(selectedDataCenter.value ? { data_center: selectedDataCenter.value } : {}),
    ...(selectedRoom.value ? { room: selectedRoom.value } : {}),
    ...(focusedRackId.value ? { rack: String(focusedRackId.value) } : {}),
    ...(selectedRack.value.trim() ? { rack_code: selectedRack.value.trim() } : {}),
    ...(selectedRackDeviceTypeId.value ? { device_type: selectedRackDeviceTypeId.value } : {}),
  };
}

function openRackSection(section: RackSection | string, query: Record<string, string> = {}) {
  const normalized: RackSection = section === "view"
    ? "view"
    : "locations";
  rackSection.value = normalized;
  const hasExplicitQuery = Object.keys(query).length > 0;
  if (hasExplicitQuery && normalized === "locations") {
    if (!Object.prototype.hasOwnProperty.call(query, "search")) locationSearch.value = "";
    if (!Object.prototype.hasOwnProperty.call(query, "type")) locationType.value = "";
    if (!Object.prototype.hasOwnProperty.call(query, "status")) locationStatus.value = "";
    if (!Object.prototype.hasOwnProperty.call(query, "data_center")) locationDataCenter.value = "";
  }
  if (hasExplicitQuery && normalized === "view") rackPage.value = 1;
  const targetQuery = hasExplicitQuery ? query : facilitySectionQuery(normalized);
  navigateToRoute(
    {
      name: normalized === "view" ? "racks-view" : "racks-locations",
      query: targetQuery,
    },
    true,
  );
}
async function bootstrapApplication() {
  await loadSystemSettings();
  applySystemSettingsDefaults();
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
  const usesLocalPageLoading = page.value === "dashboard" || page.value === "settings" || page.value === "asset-config" || page.value === "spares" || page.value === "racks";
  loading.value = !usesLocalPageLoading;
  pageError.value = "";
  try {
    if (page.value === "ledger") await loadAssets(version);
    if (page.value === "dashboard") {
      await loadDashboardData(version);
    }
    if (page.value === "racks" && rackSection.value === "locations") {
      await loadLocationManagement(version);
    } else if (page.value === "racks") {
      await loadRackView(version);
    }
    if (page.value === "repairs") await loadRepairs(version);
    if (page.value === "licenses") await loadLicenses(version);
    if (page.value === "spares") await loadSpareData(version);
    if (page.value === "asset-config") {
      await Promise.all([loadCustomFields(version), loadTags(version)]);
    }
    if (page.value === "settings") {
      if (settingsSection.value === "system" && can("settings.view"))
        await loadSystemSettings(version);
      else if (settingsSection.value === "organization" && isAdmin.value)
        await loadOrganization(version);
      else if (settingsSection.value === "audit" && can("audit.view"))
        await loadAuditLogs(version);
      else if (settingsSection.value === "dictionaries")
        await loadDictionaries(version);
      else if (settingsSection.value === "custom-fields")
        await loadCustomFields(version);
      else if (settingsSection.value === "tags")
        await loadTags(version);
      else if (settingsSection.value === "maintenance") {
        // System maintenance has no list data to load.
      } else await loadSystemSettings(version);
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
  if (item.page === "racks") {
    rackPage.value = 1;
    openRackSection("locations");
    return;
  }
  if (item.page === "settings") {
    settingsSection.value = "system";
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
  if (section === "custom-fields" || section === "tags") {
    openAssetConfiguration(section);
    return;
  }
  if (section === "organization" && !isAdmin.value) {
    settingsSection.value = "system";
    return;
  }
  if (section === "system" && !can("settings.view")) return;
  if (section === "audit" && !can("audit.view")) return;
  if (section === "maintenance" && !can("system.reset")) return;
  closeTransientUi();
  settingsSection.value = section;
  nextTick(() => sidebarMenu.value?.open("settings"));
  navigateToRoute(routeForPage("settings", { settingsSection: section }), true);
}
function openAssetConfiguration(section: AssetConfigSection) {
  if (section === "custom-fields" && !can("custom_fields.view")) return;
  if (section === "tags" && !can("tags.view")) return;
  closeTransientUi();
  assetConfigSection.value = section;
  nextTick(() => openActiveSidebarSubmenu());
  navigateToRoute(routeForPage("asset-config", { assetConfigSection: section }), true);
}
function openProfileSettings() {
  showProfileModal.value = true;
  void loadProfile();
}
const activeMenu = computed(() =>
  page.value === "settings"
    ? `settings-${settingsSection.value}`
    : page.value === "asset-config"
      ? `asset-config-${assetConfigSection.value}`
    : page.value === "racks"
      ? `racks-${rackSection.value === "view" ? "view" : "locations"}`
      : page.value === "ledger"
        ? "asset-list"
        : page.value,
);
function handleMenuSelect(index: string) {
  if (index === "asset-config-menu") {
    openAssetConfiguration("custom-fields");
    return;
  }
  if (index.startsWith("asset-config-")) {
    openAssetConfiguration(index.endsWith("-tags") ? "tags" : "custom-fields");
    return;
  }
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
  if (index === "racks-menu" || index === "racks") {
    const racksItem = navItems.find((entry) => entry.page === "racks");
    if (racksItem) navigate(racksItem);
    nextTick(() => sidebarMenu.value?.open("racks-menu"));
    return;
  }
  if (index.startsWith("racks-")) {
    openRackSection(
      index === "racks-view" ? "view" : "locations",
    );
    return;
  }
  if (index.startsWith("settings-")) {
    openSettingsSection(
      index.slice(9) as SettingsSection,
    );
    return;
  }
  const item = navItems.find((entry) => entry.page === index);
  if (item) navigate(item);
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
    const queryNormalized = syncRouteState();
    closeTransientUi();
    if (!authenticated.value || !ensureRouteAccess()) return;
    if (!sidebarCollapsed.value) openActiveSidebarSubmenu();
    if (queryNormalized) return;
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
  window.addEventListener("resize", updateViewportHeight);
  await loadCsrf();
  await checkAuth();
  if (authenticated.value && !passwordChangeRequired.value) {
    resetMainScroll();
    await bootstrapApplication();
  }
});
onBeforeUnmount(() => {
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
  goToAssets, goToRepairs, goToLicenses,
  dashboardLoading, dashboardError, dashboardUpdatedAt, refreshDashboard,
  openAssetDetail, refreshOpenAssetDetail, openRackSection,
  assetSearch, searchLedger, assetSortField, assetSortOrder, changeAssetSort, assetColumnOptions, assetDynamicColumnOptions, visibleAssetColumns,
  assetFilters, assetListLoading, assetListError, exportingAssets, resetAssetFilters,
  draftCustomFilters, appliedCustomFilters, applyAssetCustomFilters,
  assetFilterCustomFieldSchema, assetFilterCustomSchemaLoading, assetFilterCustomSchemaError,
  retryAssetFilterCustomSchema,
  assetTagFilter, tags, assetListCustomSchemaLoading, assetListCustomSchemaError,
  retryAssetListCustomSchema,
  toggleAssetColumn, resetAssetColumns, visibleAssetColumnOptions, can,
  openNewAssetModal, selectedAssetIds, assetBatchDeleteSaving, assetBatchDeleteResult, showAssetBatchDeleteResult,
  deleteSelectedAssets, closeAssetBatchDeleteResult, exportAssets,
  registerFaultFromSelection, downloadImportTemplate, openImportDialog,
  handleElementAssetSelection, clearAssetSelection, assetValue, openAssetClone, openAssetEditor,
  deleteAsset, assetPage, assetPageSize, assetCount, changeAssetPage,
  changeAssetPageSize,
  repairListLoading, repairListError,
  repairKeyword, searchRepairs, repairStatus, repairStart, repairEnd,
  onRepairStatusChange, onRepairDateChange, resetRepairFilters, retryRepairList,
  exportRepairs, exportingRepairs, openFaultModal, repairRows, openRepairModal, formatDateTime,
  repairPage, repairPageSize, repairCount, changeRepairPage,
  changeRepairPageSize,
  licenseKeyword, searchLicenses, licenseStatus, licenseManufacturer, licenseManufacturerOptions, licenseManufacturerFilterOptions, licenseListLoading, licenseListError, exportingLicenses,
  resetLicenseFilters, retryLicenseList, deletingLicenseId, exportLicenses,
  openLicenseModal, deleteLicense, licenses, licensePage,
  licensePageSize, licenseCount, changeLicensePage, changeLicensePageSize,
  spareParts, spareStocks, spareTransactions, sparePartCount, spareStockCount, spareTransactionCount,
  sparePage, sparePageSize,
  spareSearch, spareCategory, spareManufacturer, spareListDataCenter, spareListRoom,
  spareRooms, spareCategories,
  sparePartForm, editingSparePart, showSparePartModal, spareSaving, deletingSparePartId,
  spareListLoading, spareListError, exportingSpares, openSparePartModal, saveSparePart,
  deleteSparePart, searchSpareParts, resetSpareFilters, retrySpareList, changeSparePage, changeSparePageSize, exportSpareParts, exportSpareTransactions,
  openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationError, spareOperationCurrentQuantity, spareOperationLocationLabel,
  spareOperationLocationLocked, spareTransactionFilters, saveSpareOperation, spareOperationLabel,
  stockLocations, stockLoading, stockLocationLoadingByPart, stockLocationErrorByPart,
  stockLocationTotalsByPart, stockLocationLoadedByPart, loadStockLocations, transactionRows, transactionCount,
  transactionPage, transactionPageSize, transactionLoading, transactionError, loadTransactions,
  changeTransactionPage, changeTransactionPageSize,
  rackSection, serverRooms, openDataCenterModal, openRoomModal, deleteRoom, updateRoomStatus, racks, facilitySummary,
  locationSearch, locationType, locationStatus, locationDataCenter,
  locationManagementLoading, locationManagementError, dataCenterActionId,
  loadLocationManagement, retryLocationManagement,
  changeLocationSearch, changeLocationType, changeLocationStatus, changeLocationDataCenter, resetLocationFilters,
  updateDataCenterStatus, deleteDataCenter,
  showRackModal, editingRack, rackForm, rackFormFieldErrors, rackSaving, deletingRackId, updatingRackId, updatingRoomId,
  openRackModal, saveRack, deleteRack, updateRackStatus, clearRackFormErrors,
  dataCenters, selectedDataCenter, changeDataCenter,
  rackListLoading, rackCanvasLoading, rackListError, rackCanvasError,
  changeRackFilter, selectedRoom,
  roomOptions, selectedRack, hasRackFilters, selectedRackDeviceTypeId, deviceTypes,
  resetRackFilters, retryRackView, exportRackLayout, displayedRacks,
  rackUtilization, rackUtilizationColor, rackUsedU, focusedRackId, focusedRack, visibleRacks, selectRack,
  rackBodyStyle,
  rackAllocationStyle, rackGapUnavailable, openRackAssetDetail,
  rackDetailOpen, detailAsset, detailLoading, detailError, retryAssetDetail, closeAssetDetail,
  rackCount, rackPage, rackPageSize, changeRackPage,
  settingsSection, systemSettings, systemSettingsForm, systemSettingsDefinitions, systemSettingsLoading,
  systemSettingsSaving, systemSettingsError, systemSettingsFormErrors, systemSettingsDirty,
  loadSystemSettings, retrySystemSettings, resetSystemSettingsForm, saveSystemSettings,
  dictionarySection, dictionaryPage, dictionaryPageSize, dictionaryCount,
  dictionarySearch, dictionaryLoading, dictionaryError, dictionarySaving, dictionaryActionId,
  dictionaryFormErrors,
  showSystemResetDialog, systemResetConfirmation, systemResetConfirmationToken,
  systemResetSaving, systemResetError, openSystemResetDialog, closeSystemResetDialog, resetSystem,
  loadDictionaries, changeDictionarySection, searchDictionaries, changeDictionaryPage, changeDictionaryPageSize, retryDictionaries, currentDictionaryLabel,
  openDictionaryModal, currentDictionaryItems, toggleDictionary,
  dictionaryItemUsed, deleteDictionary, isAdmin, organizationLoading, organizationError,
  userListError, roleListError, retryOrganization, users, userSearch, userPage, userPageSize, userCount,
  selectedUserIds, userBatchSaving, userBatchResult, showUserBatchResult,
  userFormErrors, userSaving, userPendingId, openUserModal,
  toggleUser, deleteUser, roles, retryUserList, handleUserSelection, clearUserSelection, batchUpdateUserStatus, closeUserBatchResult,
  searchUsers, changeUserPage, changeUserPageSize,
  showUserResetModal, resettingUser, userResetForm, userResetFormRef, userResetFormRules,
  userResetSaving, userResetFormErrors, openUserResetModal, resetUserPassword, userProtectionReason, canChangeUserRole,
  auditFilters, auditListLoading, auditListError,
  loadAuditLogs, retryAuditLogs, searchAuditLogs, auditLogs, auditPage, auditPageSize, auditCount,
  changeAuditPage, changeAuditPageSize,
  customFieldDeviceType, customFieldActive, customFieldTableItems, customFieldPage, customFieldPageSize, customFieldCount, customFieldListLoading, customFieldListError,
  customFieldOptionLoading, customFieldOptionError, customFieldSaving, customFieldOptionSaving,
  customFieldActionId, customFieldOptionActionId, loadCustomFields, retryCustomFieldList, refreshCustomFieldList, changeCustomFieldPage, changeCustomFieldPageSize, loadCustomFieldOptions, retryCustomFieldOptions, customFields,
  openCustomFieldModal, saveCustomField, toggleCustomField, deleteCustomField,
  openCustomFieldOptionModal, saveCustomFieldOption, deleteCustomFieldOption,
  customFieldForm, customFieldFormErrors, showCustomFieldModal, editingCustomField, customFieldOptionForm,
  customFieldOptionFormErrors,
  showCustomFieldOptionModal, editingCustomFieldOption, tagSearch, tagActive, tagTableItems, tagPage, tagPageSize, tagCount, tagListLoading, tagListError, tagSaving, tagActionId,
  loadTags, retryTagList, refreshTagList, changeTagPage, changeTagPageSize, openTagModal, saveTag, toggleTag, deleteTag, tagForm, tagFormErrors, showTagModal, editingTag,
  manufacturers,
  showAssetModal, assetModalMode, editingAsset, assetForm, activeDeviceTypes,
  assetFormLoading, assetFormLoadError, assetFormSaving, assetFormFieldErrors,
  retryAssetFormLoad, clearAssetFormErrors,
  assetCustomFieldSchema,
  assetCustomSchemaLoading, assetCustomSchemaError, retryAssetCustomSchema, updateAssetCustomFieldValue,
  depreciationStartTouched, enableDepreciation, markDepreciationStartTouched, syncDepreciationStartFromPurchase,
  syncAssetDeviceType, manufacturerOptions, activeDataCenters, changeAssetDataCenter,
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
    >
      <div class="sidebar-brand">
        <img
          v-show="sidebarCollapsed"
          class="sidebar-brand-icon"
          :src="infrixMark"
          alt="Infrix"
        />
        <img
          v-show="!sidebarCollapsed"
          class="sidebar-wordmark"
          :src="infrixWordmark"
          alt="Infrix"
        />
      </div>
      <el-menu
        ref="sidebarMenu"
        class="ep-sidebar-menu"
        :default-active="activeMenu"
        :unique-opened="true"
        :collapse="sidebarCollapsed"
        :collapse-transition="true"
        popper-effect="light"
        @select="handleMenuSelect"
      >
        <el-menu-item index="dashboard"
          ><el-icon><House /></el-icon
          ><template #title>仪表盘</template></el-menu-item
        >
        <el-sub-menu
          index="asset-menu"
          ><template #title><el-icon><Monitor /></el-icon><span>资产管理</span></template
          ><el-menu-item index="asset-list">资产列表</el-menu-item
          ><el-sub-menu
            v-if="can('custom_fields.view') || can('tags.view')"
            index="asset-config-menu"
          >
            <template #title>资产配置</template>
            <el-menu-item v-if="can('custom_fields.view')" index="asset-config-custom-fields"
              >自定义字段</el-menu-item
            >
            <el-menu-item v-if="can('tags.view')" index="asset-config-tags"
              >标签管理</el-menu-item
            >
          </el-sub-menu>
          <el-menu-item v-if="can('spares.view')" index="spares">备件管理</el-menu-item
        ></el-sub-menu
        >
        <el-sub-menu v-if="can('racks.view')" index="racks-menu">
          <template #title>
            <el-icon><OfficeBuilding /></el-icon>
            <span>机房资源</span>
          </template>
          <el-menu-item index="racks-locations">位置管理</el-menu-item>
          <el-menu-item index="racks-view">机柜视图</el-menu-item>
        </el-sub-menu>
        <el-menu-item index="licenses"
          ><el-icon><Key /></el-icon
          ><template #title>软件许可</template></el-menu-item
        >
        <el-menu-item index="inventory"
          ><el-icon><Checked /></el-icon
          ><template #title>盘点中心</template></el-menu-item
        >
        <el-menu-item index="repairs"
          ><el-icon><Warning /></el-icon
          ><template #title>故障维修</template></el-menu-item
        >
        <el-sub-menu
          index="settings"
          ><template #title
            ><el-icon><Setting /></el-icon><span>系统设置</span></template
          ><el-menu-item v-if="can('settings.view')" index="settings-system"
            >系统参数</el-menu-item
          ><el-menu-item index="settings-dictionaries"
            >数据字典</el-menu-item
          ><el-menu-item v-if="isAdmin" index="settings-organization"
            >组织权限</el-menu-item
          ><el-menu-item v-if="can('audit.view')" index="settings-audit"
            >操作日志</el-menu-item
          ><el-menu-item v-if="can('system.reset')" index="settings-maintenance"
            >系统维护</el-menu-item
          ></el-sub-menu
        >
      </el-menu>
    </el-aside>
    <el-container class="shell-main">
      <el-header class="app-header"
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
          <GlobalSearch
            v-model="globalSearchQuery"
            :state="globalSearchState"
            @focus="focusGlobalSearch"
            @close="closeGlobalSearch"
            @select-asset="handleGlobalSearchAsset"
            @select-rack="handleGlobalSearchRack"
            @select-fault="handleGlobalSearchFault"
            @view-all="handleGlobalSearchViewAll"
          />
          <el-dropdown trigger="click"
            ><el-button text
              ><el-avatar :size="30" :icon="User" /><span
                class="ep-user-name"
                >{{ userName || "当前用户" }}</span
              ></el-button
            ><template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item @click="openProfileSettings"
                  >个人设置</el-dropdown-item
                ><el-dropdown-item @click="openPasswordModal"
                  >修改密码</el-dropdown-item
                ><el-dropdown-item divided @click="logout"
                  >退出登录</el-dropdown-item
                ></el-dropdown-menu
              ></template
            ></el-dropdown
          >
        </div></el-header
      >
      <el-main class="main ep-main" :class="{ 'dashboard-host': page === 'dashboard' }">
        <div class="app-route-shell" v-loading="loading" :aria-busy="loading ? 'true' : 'false'">
          <ApiErrorAlert :message="pageError" />
          <div class="app-route-view">
            <router-view v-slot="{ Component }">
              <component :is="Component" :context="pageContext" />
            </router-view>
          </div>
        </div>
        <GlobalOverlayHost
          :request="request"
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
  </el-container>
</template>
