<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import type { MenuInstance } from "element-plus";
import {
  ArrowDown,
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
import { isAbortError } from "./api";
import { normalizeApiError, type ActionMessageType } from "./error-handling";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import ApiErrorAlert from "./components/ApiErrorAlert.vue";
import SearchField from "./components/SearchField.vue";
import NotificationCenter from "./components/NotificationCenter.vue";
import LanguageSwitcher from "./components/LanguageSwitcher.vue";
import infrixMark from "./assets/infrix-mark.png";
import infrixWordmark from "./assets/infrix-wordmark.png";
import { hasCapability } from "./permissions";
import { statusLabel } from "./status";
import { currentLocale, elementPlusLocale, normalizeLocale, setLocale, type Locale } from "./i18n";
import { useI18n } from "vue-i18n";
import {
  routeForPage,
  type AssetConfigSection,
  type OrganizationTab,
  type RackSection,
  type SettingsSection,
} from "./router";
import {
  ensureElementPlusComponents,
  type ElementPlusComponentName,
} from "./element-plus-components";
import type {
  Page,
  AssetDetail,
  OperationalAlert,
} from "./types";
import type { PageContext } from "./page-context";

const globalOverlayElementComponents: readonly ElementPlusComponentName[] = [
  "ElAlert",
  "ElColorPicker",
  "ElDatePicker",
  "ElDialog",
  "ElDrawer",
  "ElEmpty",
  "ElInputNumber",
  "ElOption",
  "ElRadioButton",
  "ElRadioGroup",
  "ElSelect",
  "ElSkeleton",
  "ElStep",
  "ElSteps",
  "ElTable",
  "ElTableColumn",
  "ElTag",
  "ElUpload",
];
const GlobalOverlayHost = defineAsyncComponent(async () => {
  await ensureElementPlusComponents(globalOverlayElementComponents);
  return import("./components/overlays/GlobalOverlayHost.vue");
});

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const page = ref<Page>(route.meta.page || "dashboard");
const pageTitle = computed(() => {
  if (route.meta.page === "asset-config") {
    return assetConfigSection.value === "tags" ? t("nav.tags") : t("nav.customFields");
  }
  const titleKey = route.meta.titleKey;
  if (titleKey) return t(titleKey);
  return route.meta.title || t("nav.dashboard");
});
const loading = ref(false);
const authChecked = ref(false);
const authenticated = ref(false);
const bootstrapLoading = ref(false);
const bootstrapError = ref(false);
let bootstrapAttemptId = 0;
let bootstrapController: AbortController | null = null;
const passwordChangeRequired = ref(false);
const authSource = ref<"local" | "ldap">("local");
const isAdmin = ref(false);
const roleCode = ref("");
const permissions = ref<string[]>([]);
const can = (capability: string) => hasCapability(permissions.value, capability);
const hasBusinessCapability = computed(() => permissions.value.length > 0);
const sidebarCollapsed = ref(
  localStorage.getItem("infrix.sidebar.collapsed") === "1" ||
    (window.matchMedia?.("(max-width: 900px)").matches &&
      !localStorage.getItem("infrix.sidebar.collapsed")),
);
const sidebarMenu = ref<MenuInstance>();
const userName = ref("");
const username = ref("");
const userInitials = computed(() => {
  const label = String(userName.value || username.value || "").trim();
  if (!label) return "?";
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const first = Array.from(parts[0] || "")[0] || "";
    const last = Array.from(parts[parts.length - 1] || "")[0] || "";
    return `${first}${last}`.toUpperCase();
  }
  return Array.from(parts[0] || "?")[0]?.toUpperCase() || "?";
});
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
  dashboardError,
  dashboardUpdatedAt,
  loadDashboardData,
  refreshDashboard,
  maxDashboardStatusCount,
  dashboardBarPercent,
  dashboardDate,
  dashboardDateTime,
  dashboardAlertLevel,
} = useDashboard({ request, beginLoad, isCurrentLoad, can });
const showPasswordModal = ref(false);
const showProfileModal = ref(false);
const showAssetDetail = ref(false);
const detailAsset = ref<AssetDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
let openAssetDetail: (assetId: number) => Promise<void> = async () => {};
let invalidateAssetDetail: () => void = () => {};
const actionMessage = ref("");
const actionMessageType = ref<ActionMessageType | null>(null);
const pageError = ref("");
const accessDenied = ref(false);
const passwordForm = ref({ old_password: "", new_password: "", confirm_password: "" });
const passwordSaving = ref(false);
const passwordError = ref("");
const passwordFormErrors = ref<Record<string, string>>({});
const profileForm = ref<{ first_name: string; last_name: string; email: string; locale: Locale }>({
  first_name: "",
  last_name: "",
  email: "",
  locale: currentLocale.value,
});
const profileLoading = ref(false);
const profileSaving = ref(false);
const localeSaving = ref(false);
const profileError = ref("");
const profileFormErrors = ref<Record<string, string>>({});
const roleName = ref("");
const userIsActive = ref(false);
const lastLogin = ref<string | null>(null);
const viewportHeight = ref(window.innerHeight);
const settingsSection = ref<SettingsSection>("system");
const organizationTab = ref<OrganizationTab>("users");
const inventoryTaskId = ref<number | null>(null);
const assetConfigSection = ref<AssetConfigSection>("custom-fields");
const rackSection = ref<RackSection>("locations");
const facilities = useFacilities({
  request,
  can,
  beginLoad,
  isCurrentLoad,
  download,
  page,
  rackSection,
  showAssetDetail,
  detailAsset,
  viewportHeight,
  actionMessage,
  actionMessageType,
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
  exportingRackLayout,
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
  currentUsername: username,
  settingsSection,
  actionMessage,
  actionMessageType,
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
  ldapStatus,
  ldapConfiguration,
  ldapConfigurationForm,
  ldapConfigurationLoading,
  ldapConfigurationSaving,
  ldapConfigurationError,
  ldapConfigurationFormErrors,
  ldapConfigurationDirty,
  ldapStatusLoading,
  ldapStatusError,
  ldapDiagnosticLoading,
  ldapDiagnosticResult,
  ldapDiagnosticError,
  loadLdapStatus,
  retryLdapStatus,
  loadLdapConfiguration,
  retryLdapConfiguration,
  saveLdapConfiguration,
  resetLdapConfigurationForm,
  runLdapDiagnostics,
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
  customFieldOptionPage,
  customFieldOptionPageSize,
  customFieldOptionTotal,
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
  departments,
  departmentOptions,
  departmentCount,
  departmentPage,
  departmentPageSize,
  departmentSearch,
  departmentLoading,
  departmentError,
  departmentSaving,
  departmentActionId,
  departmentFormErrors,
  departmentForm,
  editingDepartment,
  showDepartmentModal,
  loadDepartments,
  searchDepartments,
  changeDepartmentPage,
  changeDepartmentPageSize,
  retryDepartments,
  openDepartmentModal,
  saveDepartment,
  deleteDepartment,
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
  changeCustomFieldOptionPage,
  changeCustomFieldOptionPageSize,
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
  userDeleteProtectionReason,
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
  bootstrapApplication: bootstrapAuthenticatedSession,
  bootstrapError,
  resetBootstrap: resetBootstrapState,
  authenticated,
  authChecked,
  passwordChangeRequired,
  authSource,
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
  actionMessageType,
  settingsSection,
  locale: currentLocale,
  setLocale,
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
  roleCode,
  roleName,
  userIsActive,
  lastLogin,
  saveProfile,
  changePassword,
};
const assetsApi = useAssets({
  can,
  request,
  download,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  authenticated,
  page,
  actionMessage,
  actionMessageType,
  dataCenters,
  departments,
  departmentLoading,
  departmentError,
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
  systemSettingsDefinitions,
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
  assetLookup,
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
  assetStatusOptions,
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
  can,
  request,
  download,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  actionMessage,
  actionMessageType,
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
  licenseFormError,
  licenseFormErrors,
  clearLicenseFormErrors,
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
  can,
  request,
  download,
  beginLoad,
  isCurrentLoad,
  confirmAction,
  assets,
  selectedAssetIds,
  actionMessage,
  actionMessageType,
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
  reopenRepair,
  exportRepairs,
  changeRepairPage,
  changeRepairPageSize,
  showRepairPartUsageModal,
  repairPartUsageForm,
  repairPartUsageItems,
  repairPartUsagePage,
  repairPartUsagePageSize,
  repairPartUsageTotal,
  repairPartUsageLoading,
  repairPartUsageError,
  repairPartUsageSaving,
  repairPartUsageOptions,
  repairPartUsageOptionsLoading,
  repairPartUsageOptionsError,
  repairPartUsageStocks,
  repairPartUsageStocksLoading,
  repairPartUsageStocksError,
  repairPartUsageSourceOptions,
  openRepairPartUsageModal,
  loadRepairPartUsageHistory,
  loadRepairPartUsageOptions,
  scheduleRepairPartUsagePartSearch,
  loadRepairPartUsageStocks,
  changeRepairPartUsageSource,
  changeRepairPartUsagePart,
  saveRepairPartUsage,
  retryRepairPartUsageHistory,
  changeRepairPartUsagePage,
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
  actionMessageType,
  can,
});
const {
  spareParts,
  sparePartCount,
  sparePage,
  sparePageSize,
  spareRooms,
  spareSearch,
  spareCategory,
  spareManufacturer,
  spareListDataCenter,
  spareListRoom,
  sparePartForm,
  sparePartFormError,
  sparePartFormErrors,
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
  spareOperationFormErrors,
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
  openSparePartModal,
  saveSparePart,
  deleteSparePart,
  openSpareOperation,
  saveSpareOperation,
  spareOperationLabel,
  stockLocations,
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
  { labelKey: "nav.dashboard", icon: "⌂", iconIndex: 0, page: "dashboard" as Page },
  { labelKey: "nav.assets", icon: "▤", iconIndex: 1, page: "ledger" as Page },
  { labelKey: "nav.racks", icon: "▦", iconIndex: 2, page: "racks" as Page },
  { labelKey: "nav.licenses", icon: "▣", iconIndex: 6, page: "licenses" as Page },
  { labelKey: "nav.inventory", icon: "✓", iconIndex: 5, page: "inventory" as Page },
  { labelKey: "nav.repairs", icon: "⚒", iconIndex: 4, page: "repairs" as Page },
  {
    labelKey: "nav.settings",
    icon: "⚙",
    iconIndex: 9,
    page: "settings" as Page,
    children: [
      { labelKey: "nav.system", section: "system" as const },
      { labelKey: "nav.dictionaries", section: "dictionaries" as const },
      { labelKey: "nav.organization", section: "organization" as const },
      { labelKey: "nav.audit", section: "audit" as const },
    ],
  },
  { labelKey: "nav.spareParts", icon: "", iconIndex: 0, page: "spares" as Page },
];

function closeTransientUi() {
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
  if (routePage === "settings") {
    settingsSection.value = route.meta.settingsSection || "system";
    if (settingsSection.value === "organization") {
      const requestedTab = routeQueryValue("tab");
      organizationTab.value = requestedTab === "roles" || requestedTab === "ldap" || requestedTab === "departments"
        ? requestedTab
        : "users";
      if (hasQueryKey("tab") && requestedTab !== "users" && requestedTab !== "roles" && requestedTab !== "ldap" && requestedTab !== "departments") {
        queryKeysToClear.push("tab");
      }
      if (!can("organization.manage")) organizationTab.value = "departments";
      if (organizationTab.value === "departments" && !can("settings.manage")) organizationTab.value = "users";
    }
  }
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
  if (routePage === "inventory") {
    const taskQuery = routeQueryValue("task");
    const taskId = positiveRouteQueryId(taskQuery);
    inventoryTaskId.value = taskId;
    if (hasQueryKey("task") && taskId === null) queryKeysToClear.push("task");
  } else {
    inventoryTaskId.value = null;
    if (hasQueryKey("task")) queryKeysToClear.push("task");
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
  if (routePage === "spares") {
    spareSearch.value = routeQueryValue("search");
  }
  return clearRouteQuery(queryKeysToClear);
}

function routeIsAllowed() {
  const routePage = route.meta.page || "dashboard";
  if (routePage === "dashboard") return can("dashboard.view");
  if (routePage === "ledger") return can("assets.view");
  if (routePage === "licenses") return can("licenses.view");
  if (routePage === "inventory") return can("inventory.view");
  if (routePage === "repairs") return can("faults.view");
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
  if (section === "dictionaries" && !can("settings.view")) return false;
  if (section === "organization" && !can("organization.manage") && !can("settings.manage")) return false;
  if (section === "audit" && !can("audit.view")) return false;
  if (section === "custom-fields" && !can("custom_fields.view")) return false;
  if (section === "tags" && !can("tags.view")) return false;
  if (section === "maintenance" && !can("system.reset")) return false;
  return true;
}

function firstAllowedRoute(): RouteLocationRaw | null {
  if (can("dashboard.view")) return routeForPage("dashboard");
  if (can("assets.view")) return routeForPage("ledger");
  if (can("custom_fields.view")) return routeForPage("asset-config", { assetConfigSection: "custom-fields" });
  if (can("tags.view")) return routeForPage("asset-config", { assetConfigSection: "tags" });
  if (can("spares.view")) return routeForPage("spares");
  if (can("racks.view")) return routeForPage("racks", { rackSection: "locations" });
  if (can("licenses.view")) return routeForPage("licenses");
  if (can("inventory.view")) return routeForPage("inventory");
  if (can("faults.view")) return routeForPage("repairs");
  if (can("settings.view")) return routeForPage("settings", { settingsSection: "system" });
  if (can("organization.manage") || can("settings.manage")) return routeForPage("settings", { settingsSection: "organization", organizationTab: can("organization.manage") ? organizationTab.value : "departments" });
  if (can("audit.view")) return routeForPage("settings", { settingsSection: "audit" });
  if (can("system.reset")) return routeForPage("settings", { settingsSection: "maintenance" });
  return null;
}

function ensureRouteAccess() {
  if (!authenticated.value) return true;
  if (routeIsAllowed()) {
    accessDenied.value = false;
    return true;
  }
  accessDenied.value = true;
  pageError.value = "";
  const fallback = firstAllowedRoute();
  if (fallback) {
    void router.replace(fallback);
    return false;
  }
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
  if (!can("assets.view")) return;
  navigateToRoute({ name: "assets", query });
}

function goToRepairs(query: Record<string, string> = {}) {
  if (!can("faults.view")) return;
  navigateToRoute({ name: "repairs", query });
}

function handleNotificationSelect(alert: OperationalAlert) {
  if (alert.kind === "maintenance" && alert.asset_id) {
    void openAssetDetail(alert.asset_id);
    return;
  }
  if (alert.kind === "license") {
    goToLicenses({ search: alert.name || alert.reference || "" });
    return;
  }
  if (alert.kind === "fault") {
    goToRepairs({ fault: String(alert.entity_id) });
    return;
  }
  if (alert.kind === "inventory") {
    navigateToRoute({ name: "inventory", query: { task: String(alert.entity_id) } }, true);
    return;
  }
  if (alert.kind === "spare") {
    goToSpares({ search: alert.code || alert.name || "" });
  }
}

function goToLicenses(query: Record<string, string> = {}) {
  if (!can("licenses.view")) return;
  navigateToRoute({ name: "licenses", query });
}

function goToSpares(query: Record<string, string> = {}) {
  if (!can("spares.view")) return;
  if (Object.prototype.hasOwnProperty.call(query, "search")) {
    spareSearch.value = query.search || "";
  }
  sparePage.value = 1;
  navigateToRoute({ name: "spares", query });
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
    "infrix.sidebar.collapsed",
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
        : page.value === "ledger"
          ? ["asset-menu"]
          : page.value === "spares"
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
  const normalizedMessage = message.trim();
  const isDelete = /^(确定删除|Delete)\b/.test(normalizedMessage);
  const dialogMessage = isDelete
    ? `${normalizedMessage.replace(/^(确定删除|Delete)\s*/, "").replace(/(?:吗？|\?)\s*$/, "")}\n${t("common.deleteWarning")}`
    : message;
  try {
    await ElMessageBox.confirm(dialogMessage, isDelete ? t("common.deleteConfirmTitle") : t("common.confirmAction"), {
      type: isDelete ? "error" : "warning",
      confirmButtonText: isDelete ? t("common.delete") : t("common.confirm"),
      cancelButtonText: t("common.cancel"),
      confirmButtonClass: isDelete ? "el-button--danger" : undefined,
    });
    return true;
  } catch {
    return false;
  }
}

async function persistLocalePreference(locale: Locale) {
  if (!authenticated.value || localeSaving.value) return;
  const previousLocale = profileForm.value.locale;
  localeSaving.value = true;
  profileForm.value.locale = locale;
  try {
    const user = await request<{ locale?: string }>("/auth/me/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    const savedLocale = normalizeLocale(user.locale || locale);
    profileForm.value.locale = savedLocale;
    setLocale(savedLocale);
  } catch {
    profileForm.value.locale = previousLocale;
    setLocale(previousLocale);
    actionMessageType.value = "error";
    actionMessage.value = t("auth.languageSaveFailed");
  } finally {
    localeSaving.value = false;
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
  if (!can("racks.view")) return;
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
function beginBootstrapAttempt() {
  bootstrapController?.abort();
  const controller = new AbortController();
  bootstrapController = controller;
  const id = ++bootstrapAttemptId;
  bootstrapLoading.value = true;
  bootstrapError.value = false;
  return { id, controller };
}
function isCurrentBootstrapAttempt(id: number, controller: AbortController) {
  return id === bootstrapAttemptId && bootstrapController === controller && !controller.signal.aborted;
}
function recordBootstrapFailure(id: number, controller: AbortController, error: unknown) {
  if (isCurrentBootstrapAttempt(id, controller) && !isAbortError(error)) {
    bootstrapError.value = true;
  }
}
function finishBootstrapAttempt(id: number, controller: AbortController) {
  if (id !== bootstrapAttemptId || bootstrapController !== controller) return;
  bootstrapLoading.value = false;
  bootstrapController = null;
}
function resetBootstrapState() {
  bootstrapController?.abort();
  bootstrapController = null;
  bootstrapAttemptId += 1;
  bootstrapLoading.value = false;
  bootstrapError.value = false;
}
async function loadAuthenticatedApplication(id: number, controller: AbortController) {
  try {
    await bootstrapApplication();
  } catch (error) {
    recordBootstrapFailure(id, controller, error);
  }
}
async function bootstrapAuthenticatedSession() {
  const attempt = beginBootstrapAttempt();
  try {
    await loadAuthenticatedApplication(attempt.id, attempt.controller);
  } finally {
    finishBootstrapAttempt(attempt.id, attempt.controller);
  }
}
async function runInitialBootstrap() {
  const attempt = beginBootstrapAttempt();
  authChecked.value = false;
  try {
    await loadCsrf(attempt.controller.signal);
    if (!isCurrentBootstrapAttempt(attempt.id, attempt.controller)) return;
    await checkAuth(attempt.controller.signal);
    if (!isCurrentBootstrapAttempt(attempt.id, attempt.controller)) return;
    if (authenticated.value && !passwordChangeRequired.value && hasBusinessCapability.value) {
      resetMainScroll();
      await loadAuthenticatedApplication(attempt.id, attempt.controller);
    }
  } catch (error) {
    recordBootstrapFailure(attempt.id, attempt.controller, error);
  } finally {
    if (isCurrentBootstrapAttempt(attempt.id, attempt.controller)) {
      authChecked.value = true;
      finishBootstrapAttempt(attempt.id, attempt.controller);
    }
  }
}
function retryBootstrap() {
  if (bootstrapLoading.value) return;
  void runInitialBootstrap();
}
function openRackAssetDetail(assetId: number, rackId: number) {
  if (!can("assets.view")) return;
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
      else if (settingsSection.value === "organization" && (can("organization.manage") || can("settings.manage"))) {
        if (organizationTab.value === "ldap") {
          await Promise.all([loadLdapConfiguration(version), loadLdapStatus(version)]);
        } else if (organizationTab.value === "departments") {
          await loadDepartments(version);
        } else {
          await loadOrganization(version);
        }
      }
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
      const normalized = normalizeApiError(error);
      pageError.value = normalized.kind === "unknown"
        ? t("common.dataLoadFailed")
        : normalized.message;
      actionMessageType.value = "error";
      actionMessage.value = pageError.value;
    }
  } finally {
    if (isCurrentLoad(version) && !usesLocalPageLoading) loading.value = false;
  }
}
function navigate(item: (typeof navItems)[number]) {
  closeTransientUi();
  if (item.page === "placeholder") placeholderTitle.value = t(item.labelKey);
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
  if (section === "organization" && !can("organization.manage") && !can("settings.manage")) {
    settingsSection.value = "system";
    return;
  }
  if (section === "organization" && !can("organization.manage")) organizationTab.value = "departments";
  if (section === "system" && !can("settings.view")) return;
  if (section === "audit" && !can("audit.view")) return;
  if (section === "maintenance" && !can("system.reset")) return;
  closeTransientUi();
  settingsSection.value = section;
  nextTick(() => sidebarMenu.value?.open("settings"));
  navigateToRoute(routeForPage("settings", {
    settingsSection: section,
    organizationTab: section === "organization" ? organizationTab.value : undefined,
  }), true);
}
function changeOrganizationTab(value: string) {
  if (!can("organization.manage") && !can("settings.manage")) return;
  if (value === "departments" && can("settings.manage")) {
    organizationTab.value = "departments";
  } else if (can("organization.manage")) {
    organizationTab.value = value === "roles" || value === "ldap" ? value : "users";
  } else {
    return;
  }
  const nextTab = organizationTab.value;
  navigateToRoute(routeForPage("settings", {
    settingsSection: "organization",
    organizationTab: nextTab,
  }), true);
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
  const isError = actionMessageType.value === "error";
  ElMessage({
    message,
    type: isError ? "error" : "success",
    duration: 3200,
    showClose: true,
  });
  actionMessage.value = "";
  actionMessageType.value = null;
});
let assetQrRouteRequest = 0;
watch(
  () => ({
    authChecked: authChecked.value,
    authenticated: authenticated.value,
    passwordChangeRequired: passwordChangeRequired.value,
    routeName: String(route.name || ""),
    assetId: routeQueryValue("asset_id"),
  }),
  async (state) => {
    const assetId = positiveRouteQueryId(state.assetId);
    if (
      !state.authChecked ||
      !state.authenticated ||
      state.passwordChangeRequired ||
      state.routeName !== "assets" ||
      !assetId
    ) return;
    const requestId = ++assetQrRouteRequest;
    const nextQuery = { ...route.query };
    delete nextQuery.asset_id;
    delete nextQuery.asset_no;
    await router.replace({ name: "assets", query: nextQuery });
    await nextTick();
    if (requestId !== assetQrRouteRequest || route.name !== "assets") return;
    await openAssetDetail(assetId);
  },
  { immediate: true },
);
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
  await runInitialBootstrap();
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", updateViewportHeight);
  apiClient.dispose();
  resetBootstrapState();
});

// Page components receive refs and handlers through this stable context. The
// shell keeps ownership of authentication/navigation while page-specific
// markup can evolve independently without changing API contracts.
const pageContext = {
  request,
  downloadFile: download,
  currentUsername: username,
  actionMessage,
  actionMessageType,
  inventoryTaskId,
  clearRouteQuery,
  updateRouteQuery,
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
  departments, departmentLoading, departmentError, retryDepartments,
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
  showRepairPartUsageModal, repairPartUsageForm, repairPartUsageItems, repairPartUsagePage,
  repairPartUsagePageSize, repairPartUsageTotal, repairPartUsageLoading, repairPartUsageError,
  repairPartUsageSaving, repairPartUsageOptions, repairPartUsageOptionsLoading, repairPartUsageOptionsError,
  repairPartUsageStocks, repairPartUsageStocksLoading, repairPartUsageStocksError,
  repairPartUsageSourceOptions, openRepairPartUsageModal, loadRepairPartUsageHistory,
  loadRepairPartUsageOptions, scheduleRepairPartUsagePartSearch, loadRepairPartUsageStocks,
  changeRepairPartUsageSource, changeRepairPartUsagePart, saveRepairPartUsage,
  retryRepairPartUsageHistory, changeRepairPartUsagePage,
  licenseKeyword, searchLicenses, licenseStatus, licenseManufacturer, licenseManufacturerOptions, licenseManufacturerFilterOptions, licenseListLoading, licenseListError,
  licenseFormError, licenseFormErrors, clearLicenseFormErrors, exportingLicenses,
  resetLicenseFilters, retryLicenseList, deletingLicenseId, exportLicenses,
  openLicenseModal, deleteLicense, licenses, licensePage,
  licensePageSize, licenseCount, changeLicensePage, changeLicensePageSize,
  spareParts, sparePartCount,
  sparePage, sparePageSize,
  spareSearch, spareCategory, spareManufacturer, spareListDataCenter, spareListRoom,
  spareRooms, spareCategories,
  sparePartForm, sparePartFormError, sparePartFormErrors, editingSparePart, showSparePartModal, spareSaving, deletingSparePartId,
  spareListLoading, spareListError, exportingSpares, openSparePartModal, saveSparePart,
  deleteSparePart, searchSpareParts, resetSpareFilters, retrySpareList, changeSparePage, changeSparePageSize, exportSpareParts, exportSpareTransactions,
  openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationError, spareOperationFormErrors, spareOperationCurrentQuantity, spareOperationLocationLabel,
  spareOperationLocationLocked, spareTransactionFilters, saveSpareOperation, spareOperationLabel,
  stockLocations, stockLocationLoadingByPart, stockLocationErrorByPart,
  stockLocationTotalsByPart, stockLocationLoadedByPart, loadStockLocations, transactionRows, transactionCount,
  transactionPage, transactionPageSize, transactionLoading, transactionError, loadTransactions,
  changeTransactionPage, changeTransactionPageSize,
  rackSection, serverRooms, openDataCenterModal, openRoomModal, deleteRoom, updateRoomStatus, racks, facilitySummary,
  locationSearch, locationType, locationStatus, locationDataCenter,
  locationManagementLoading, locationManagementError, dataCenterActionId,
  loadLocationManagement, retryLocationManagement,
  changeLocationSearch, changeLocationType, changeLocationStatus, changeLocationDataCenter, resetLocationFilters,
  updateDataCenterStatus, deleteDataCenter,
  showRackModal, editingRack, rackForm, rackFormFieldErrors, rackSaving, deletingRackId, updatingRackId, updatingRoomId, exportingRackLayout,
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
  inventoryHistoryItems, inventoryHistoryLatest, inventoryHistoryPage, inventoryHistoryPageSize,
  inventoryHistoryTotal, inventoryHistoryLoading, inventoryHistoryError, inventoryHistoryCanView,
  retryInventoryHistory, changeInventoryHistoryPage, changeInventoryHistoryPageSize,
  responsibilityHistoryItems, responsibilityHistoryPage, responsibilityHistoryPageSize,
  responsibilityHistoryTotal, responsibilityHistoryLoading, responsibilityHistoryError, responsibilityHistoryCanView,
  retryResponsibilityHistory, changeResponsibilityHistoryPage, changeResponsibilityHistoryPageSize,
  responsibilityUsers, responsibilityUsersLoading, responsibilityUsersError, loadResponsibilityUsers,
  responsibilityActionSaving, responsibilityActionError, responsibilityActionFieldErrors,
  clearResponsibilityActionErrors, clearResponsibilityActionFieldError, assignAsset, returnAsset, transferAsset,
  rackCount, rackPage, rackPageSize, changeRackPage,
  settingsSection, organizationTab, changeOrganizationTab, systemSettings, systemSettingsForm, systemSettingsDefinitions, systemSettingsLoading,
  systemSettingsSaving, systemSettingsError, systemSettingsFormErrors, systemSettingsDirty,
  ldapStatus, ldapConfiguration, ldapConfigurationForm, ldapConfigurationLoading, ldapConfigurationSaving,
  ldapConfigurationError, ldapConfigurationFormErrors, ldapConfigurationDirty,
  ldapStatusLoading, ldapStatusError, ldapDiagnosticLoading, ldapDiagnosticResult, ldapDiagnosticError,
  loadLdapStatus, retryLdapStatus, loadLdapConfiguration, retryLdapConfiguration, saveLdapConfiguration,
  resetLdapConfigurationForm, runLdapDiagnostics,
  loadSystemSettings, retrySystemSettings, resetSystemSettingsForm, saveSystemSettings,
  dictionarySection, dictionaryPage, dictionaryPageSize, dictionaryCount,
  dictionarySearch, dictionaryLoading, dictionaryError, dictionarySaving, dictionaryActionId,
  dictionaryFormErrors,
  showSystemResetDialog, systemResetConfirmation, systemResetConfirmationToken,
  systemResetSaving, systemResetError, openSystemResetDialog, closeSystemResetDialog, resetSystem,
  loadDictionaries, changeDictionarySection, searchDictionaries, changeDictionaryPage, changeDictionaryPageSize, retryDictionaries, currentDictionaryLabel,
  openDictionaryModal, currentDictionaryItems, toggleDictionary,
  dictionaryItemUsed, deleteDictionary, organizationLoading, organizationError,
  departmentOptions, departmentCount, departmentPage, departmentPageSize, departmentSearch,
  departmentSaving, departmentActionId, departmentFormErrors, departmentForm, editingDepartment,
  showDepartmentModal, loadDepartments, searchDepartments, changeDepartmentPage, changeDepartmentPageSize,
  openDepartmentModal, saveDepartment, deleteDepartment,
  userListError, roleListError, retryOrganization, users, userSearch, userPage, userPageSize, userCount,
  selectedUserIds, userBatchSaving, userBatchResult, showUserBatchResult,
  userFormErrors, userSaving, userPendingId, openUserModal,
  toggleUser, deleteUser, roles, retryUserList, handleUserSelection, clearUserSelection, batchUpdateUserStatus, closeUserBatchResult,
  searchUsers, changeUserPage, changeUserPageSize,
  showUserResetModal, resettingUser, userResetForm, userResetFormRef, userResetFormRules: userResetFormRules.value,
  userResetSaving, userResetFormErrors, openUserResetModal, resetUserPassword, userProtectionReason, userDeleteProtectionReason, canChangeUserRole,
  auditFilters, auditListLoading, auditListError,
  loadAuditLogs, retryAuditLogs, searchAuditLogs, auditLogs, auditPage, auditPageSize, auditCount,
  changeAuditPage, changeAuditPageSize,
  customFieldDeviceType, customFieldActive, customFieldTableItems, customFieldPage, customFieldPageSize, customFieldCount, customFieldListLoading, customFieldListError,
  customFieldOptionLoading, customFieldOptionError, customFieldOptionPage, customFieldOptionPageSize, customFieldOptionTotal,
  customFieldSaving, customFieldOptionSaving, changeCustomFieldOptionPage, changeCustomFieldOptionPageSize,
  customFieldActionId, customFieldOptionActionId, loadCustomFields, retryCustomFieldList, refreshCustomFieldList, changeCustomFieldPage, changeCustomFieldPageSize, loadCustomFieldOptions, retryCustomFieldOptions, customFields,
  openCustomFieldModal, saveCustomField, toggleCustomField, deleteCustomField,
  openCustomFieldOptionModal, saveCustomFieldOption, deleteCustomFieldOption,
  customFieldForm, customFieldFormErrors, showCustomFieldModal, editingCustomField, customFieldOptionForm,
  customFieldOptionFormErrors,
  showCustomFieldOptionModal, editingCustomFieldOption, tagSearch, tagActive, tagTableItems, tagPage, tagPageSize, tagCount, tagListLoading, tagListError, tagSaving, tagActionId,
  loadTags, retryTagList, refreshTagList, changeTagPage, changeTagPageSize, openTagModal, saveTag, toggleTag, deleteTag, tagForm, tagFormErrors, showTagModal, editingTag,
  manufacturers,
  showAssetModal, assetModalMode, editingAsset, assetForm, assetStatusOptions, activeDeviceTypes,
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
  inventoryHistory: {
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
  },
  responsibilityHistory: {
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
  },
};
const globalOverlayLoaded = ref(false);
const hasOpenGlobalOverlay = computed(() => Boolean(
  showAssetDetail.value ||
  showAssetModal.value ||
  showImportDialog.value ||
  showDataCenterModal.value ||
  showRoomModal.value ||
  showLicenseModal.value ||
  showFaultModal.value ||
  showRepairModal.value ||
  showUserModal.value ||
  showUserResetModal.value ||
  showProfileModal.value ||
  showDictionaryModal.value ||
  showPasswordModal.value,
));
watch(hasOpenGlobalOverlay, (isOpen) => {
  if (isOpen) globalOverlayLoaded.value = true;
}, { immediate: true });
</script>

<template>
  <el-config-provider :locale="elementPlusLocale">
  <div v-if="bootstrapError" class="loading-screen bootstrap-error-screen" role="alert">
    <el-result icon="error" :title="t('auth.bootstrapFailed')" :sub-title="t('auth.bootstrapFailedDescription')">
      <template #extra>
        <el-button type="primary" :loading="bootstrapLoading" :disabled="bootstrapLoading" @click="retryBootstrap">
          {{ t('common.retry') }}
        </el-button>
      </template>
    </el-result>
  </div>
  <div v-else-if="!authChecked" class="loading-screen">{{ t("common.checkingLogin") }}</div>
  <div v-else-if="!authenticated" class="login-screen">
    <div class="login-card">
      <div class="login-language-switcher"><LanguageSwitcher /></div>
      <div class="login-brand">
        <img class="login-brand-wordmark" :src="infrixWordmark" alt="Infrix" />
        <div class="login-brand-subtitle">{{ t('auth.productSubtitle') }}</div>
      </div>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item :label="t('auth.username')" required
          ><el-input
            v-model="username"
            :prefix-icon="User"
            autocomplete="username"
        /></el-form-item>
        <el-form-item :label="t('auth.password')" required
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
          >{{ t('auth.login') }}</el-button
        >
      </el-form>
      <small>{{ t('auth.loginHint') }}</small>
    </div>
  </div>
  <div v-else-if="!passwordChangeRequired && !hasBusinessCapability" class="loading-screen" role="status">
    <el-result icon="warning" :title="t('auth.noPermissionsTitle')" :sub-title="t('auth.noPermissionsDescription')">
      <template #extra>
        <el-button type="primary" @click="logout">{{ t('auth.logout') }}</el-button>
      </template>
    </el-result>
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
        <el-button
          class="ep-sidebar-collapse-button"
          text
          :title="sidebarCollapsed ? t('common.expandNavigation') : t('common.collapseNavigation')"
          :aria-label="sidebarCollapsed ? t('common.expandNavigation') : t('common.collapseNavigation')"
          @click="toggleSidebar"
          ><el-icon class="header-control-icon"
            ><Expand v-if="sidebarCollapsed" /><Fold v-else /></el-icon
        ></el-button>
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
        <el-menu-item v-if="can('dashboard.view')" index="dashboard"
          ><el-icon><House /></el-icon
          ><template #title>{{ t('nav.dashboard') }}</template></el-menu-item
        >
        <el-sub-menu
          v-if="can('assets.view') || can('custom_fields.view') || can('tags.view') || can('spares.view')"
          index="asset-menu"
          ><template #title><el-icon><Monitor /></el-icon><span>{{ t('nav.assets') }}</span></template
          ><el-menu-item v-if="can('assets.view')" index="asset-list">{{ t('nav.assetList') }}</el-menu-item
          ><el-menu-item v-if="can('spares.view')" index="spares">{{ t('nav.spareParts') }}</el-menu-item
          ><el-sub-menu
            v-if="can('custom_fields.view') || can('tags.view')"
            index="asset-config-menu"
          >
            <template #title>{{ t('nav.assetConfiguration') }}</template>
            <el-menu-item v-if="can('custom_fields.view')" index="asset-config-custom-fields"
              >{{ t('nav.customFields') }}</el-menu-item
            >
            <el-menu-item v-if="can('tags.view')" index="asset-config-tags"
              >{{ t('nav.tags') }}</el-menu-item
            >
          </el-sub-menu>
        </el-sub-menu>
        <el-sub-menu v-if="can('racks.view')" index="racks-menu">
          <template #title>
            <el-icon><OfficeBuilding /></el-icon>
            <span>{{ t('nav.racks') }}</span>
          </template>
          <el-menu-item index="racks-locations">{{ t('nav.locations') }}</el-menu-item>
          <el-menu-item index="racks-view">{{ t('nav.rackView') }}</el-menu-item>
        </el-sub-menu>
        <el-menu-item v-if="can('licenses.view')" index="licenses"
          ><el-icon><Key /></el-icon
          ><template #title>{{ t('nav.licenses') }}</template></el-menu-item
        >
        <el-menu-item v-if="can('inventory.view')" index="inventory"
          ><el-icon><Checked /></el-icon
          ><template #title>{{ t('nav.inventory') }}</template></el-menu-item
        >
        <el-menu-item v-if="can('faults.view')" index="repairs"
          ><el-icon><Warning /></el-icon
          ><template #title>{{ t('nav.repairs') }}</template></el-menu-item
        >
        <el-sub-menu
          v-if="can('settings.view') || can('organization.manage') || can('settings.manage') || can('audit.view') || can('system.reset')"
          index="settings"
          ><template #title
            ><el-icon><Setting /></el-icon><span>{{ t('nav.settings') }}</span></template
          ><el-menu-item v-if="can('settings.view')" index="settings-system"
            >{{ t('nav.system') }}</el-menu-item
          ><el-menu-item v-if="can('settings.view')" index="settings-dictionaries"
            >{{ t('nav.dictionaries') }}</el-menu-item
          ><el-menu-item v-if="can('organization.manage') || can('settings.manage')" index="settings-organization"
            >{{ t('nav.organization') }}</el-menu-item
          ><el-menu-item v-if="can('audit.view')" index="settings-audit"
            >{{ t('nav.audit') }}</el-menu-item
          ><el-menu-item v-if="can('system.reset')" index="settings-maintenance"
            >{{ t('nav.maintenance') }}</el-menu-item
          ></el-sub-menu
        >
      </el-menu>
    </el-aside>
    <el-container class="shell-main">
      <el-header class="app-header"
        ><div class="page-heading"><h1>{{ pageTitle }}</h1></div>
        <div class="header-tools">
          <SearchField
            class="ep-global-search"
            v-model="assetLookup"
            :placeholder="t('asset.searchPlaceholder')"
            :aria-label="t('asset.title')"
            @search="lookupAsset"
          />
          <NotificationCenter
            v-if="can('dashboard.view')"
            :request="request"
            :can="can"
            :username="username"
            @select="handleNotificationSelect"
          />
          <LanguageSwitcher :disabled="localeSaving" @change="persistLocalePreference" />
          <el-dropdown class="user-menu" trigger="click"
            ><el-button
              class="user-menu__trigger"
              text
              :aria-label="userName || t('common.currentUser')"
              :title="userName || t('common.currentUser')"
              ><span class="user-menu__content"
                ><span class="user-menu__avatar" aria-hidden="true">{{ userInitials }}</span
                ><span class="user-menu__identity"
                  ><span class="user-menu__name">{{ userName || t('common.currentUser') }}</span></span
                ><el-icon class="user-menu__chevron" aria-hidden="true"><ArrowDown /></el-icon
              ></span
            ></el-button
            ><template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item @click="openProfileSettings"
                  >{{ t('auth.profile') }}</el-dropdown-item
                ><el-dropdown-item v-if="authSource !== 'ldap'" @click="openPasswordModal"
                  >{{ t('auth.changePassword') }}</el-dropdown-item
                ><el-dropdown-item divided @click="logout"
                  >{{ t('auth.logout') }}</el-dropdown-item
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
            <el-result v-if="accessDenied" icon="403" :title="t('api.forbidden')" />
            <router-view v-else v-slot="{ Component }">
              <component :is="Component" :context="pageContext" />
            </router-view>
          </div>
        </div>
        <GlobalOverlayHost
          v-if="globalOverlayLoaded"
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
  </el-config-provider>
</template>
