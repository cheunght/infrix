import type { ComputedRef, Ref } from "vue";
import type { RackSection, SettingsSection } from "./router";
import type {
  Asset,
  AssetCustomFilter,
  AssetDetail,
  CustomField,
  CustomFieldForm,
  CustomFieldOption,
  CustomFieldSchema,
  DataCenter,
  DashboardOverview,
  DashboardStatus,
  DictionaryItem,
  FacilitySummary,
  FaultEvent,
  InventoryInspector,
  InventoryItem,
  InventoryTask,
  ManagedUser,
  Rack,
  RackFormState,
  RackStatus,
  Role,
  ServerRoom,
  SoftwareLicense,
  SparePart,
  SpareStock,
  SpareTransaction,
  Tag,
} from "./types";

export type RequestFn = <T>(path: string, options?: RequestInit) => Promise<T>;
export type CapabilityFn = (capability: string) => boolean;
export type ActionFn = (...args: never[]) => void | Promise<void>;

export interface AssetFormState {
  asset_no: string;
  name: string;
  asset_type: string;
  manufacturer_id: string;
  model: string;
  device_type: string;
  manufacturer_model: string;
  serial_number: string;
  purpose: string;
  status: string;
  owner_name: string;
  notes: string;
  rack_mounted: boolean;
  asset_data_center: string;
  data_center: string;
  server_room_id: string;
  rack_id: string;
  rack_total_u: string;
  rack_start_u: string;
  rack_end_u: string;
  business_ip: string;
  management_ip: string;
  oob_ip: string;
  purchase_date: string;
  supplier: string;
  purchase_order_no: string;
  purchase_amount: string;
  depreciation_enabled: boolean;
  depreciation_start_date: string;
  depreciation_years: number | null;
  residual_rate: string;
  maintenance_provider: string;
  maintenance_contract_no: string;
  maintenance_start_date: string;
  maintenance_expiry_date: string;
  tags: string[];
  custom_values: Record<string, unknown>;
}

export interface DashboardContext {
  dashboard: Ref<DashboardOverview | null>;
  dashboardLoading: Ref<boolean>;
  dashboardError: Ref<string>;
  dashboardUpdatedAt: Ref<string | null>;
  refreshDashboard: () => void | Promise<boolean>;
  handleMenuSelect: (index: string) => void;
  openAssetDetail: (assetId: number) => void | Promise<void>;
  goToAssets: (query?: Record<string, string>) => void;
  goToRepairs: (query?: Record<string, string>) => void;
  goToLicenses: (query?: Record<string, string>) => void;
  openNewAssetModal: () => void | Promise<void>;
  openRackSection: (section: RackSection | string, query?: Record<string, string>) => void;
  assetSearch: Ref<string>;
  searchLedger: () => void | Promise<void>;
  can: CapabilityFn;
  dashboardDate: (value: string) => string;
  dashboardDateTime: (value: string) => string;
}

export interface AssetFilters {
  status: string;
  deviceType: string;
  tag: string[];
  manufacturer: string;
  model: string;
  dataCenter: string;
  warranty: string;
}

export interface AssetLedgerColumnOption {
  key: string;
  label: string;
  required?: boolean;
  dynamic?: boolean;
  field?: CustomFieldSchema;
  scopeLabel?: string;
  width?: number;
}

export interface AssetLedgerContext {
  loading: Ref<boolean>;
  assetListLoading: Ref<boolean>;
  assetListError: Ref<string>;
  exportingAssets: Ref<boolean>;
  assetSearch: Ref<string>;
  searchLedger: () => void | Promise<void>;
  assetFilters: AssetFilters;
  resetAssetFilters: () => void | Promise<void>;
  assetTagFilter: Ref<string[]>;
  draftCustomFilters: Ref<AssetCustomFilter[]>;
  appliedCustomFilters: Ref<AssetCustomFilter[]>;
  applyAssetCustomFilters: (filters: AssetCustomFilter[]) => void | Promise<void>;
  assetFilterCustomFieldSchema: Ref<CustomFieldSchema[]>;
  assetFilterCustomSchemaLoading: Ref<boolean>;
  assetFilterCustomSchemaError: Ref<string>;
  retryAssetFilterCustomSchema: () => void | Promise<void>;
  manufacturers: Ref<DictionaryItem[]>;
  deviceTypes: Ref<DictionaryItem[]>;
  dataCenters: Ref<DataCenter[]>;
  tags: Ref<Tag[]>;
  tagListLoading: Ref<boolean>;
  tagListError: Ref<string>;
  retryTagList: () => void | Promise<boolean>;
  assetColumnOptions: AssetLedgerColumnOption[];
  assetDynamicColumnOptions: ComputedRef<AssetLedgerColumnOption[]>;
  visibleAssetColumns: Ref<string[]>;
  toggleAssetColumn: (key: string) => void;
  resetAssetColumns: () => void;
  visibleAssetColumnOptions: ComputedRef<AssetLedgerColumnOption[]>;
  assetListCustomSchemaLoading: Ref<boolean>;
  assetListCustomSchemaError: Ref<string>;
  retryAssetListCustomSchema: () => void | Promise<void>;
  can: CapabilityFn;
  openNewAssetModal: () => void | Promise<void>;
  selectedAssetIds: Ref<number[]>;
  deleteSelectedAssets: () => void | Promise<void>;
  exportAssets: () => void | Promise<void>;
  registerFaultFromSelection: () => void | Promise<void>;
  downloadImportTemplate: () => void | Promise<void>;
  openImportDialog: () => void;
  assets: Ref<Asset[]>;
  handleElementAssetSelection: (rows: Asset[]) => void;
  openAssetDetail: (assetId: number) => void | Promise<void>;
  assetValue: (asset: Asset, key: string) => string;
  openAssetClone: (assetId: number) => void | Promise<void>;
  openAssetEditor: (assetId: number) => void | Promise<void>;
  deleteAsset: (asset: Asset) => void | Promise<void>;
  assetPage: Ref<number>;
  assetPageSize: Ref<number>;
  assetCount: Ref<number>;
  changeAssetPage: (page: number) => void | Promise<void>;
  changeAssetPageSize: (size: number) => void | Promise<void>;
}

export interface AssetFormContext {
  showAssetModal: Ref<boolean>;
  assetModalMode: Ref<string>;
  editingAsset: Ref<Asset | null>;
  assetForm: Ref<AssetFormState>;
  assetFormLoading: Ref<boolean>;
  assetFormLoadError: Ref<string>;
  assetFormSaving: Ref<boolean>;
  assetFormFieldErrors: Ref<Record<string, string>>;
  retryAssetFormLoad: () => void | Promise<void>;
  clearAssetFormErrors: () => void;
  assetCustomSchemaLoading: Ref<boolean>;
  assetCustomSchemaError: Ref<string>;
  retryAssetCustomSchema: () => void | Promise<void>;
  depreciationStartTouched: Ref<boolean>;
  enableDepreciation: () => void;
  markDepreciationStartTouched: () => void;
  syncDepreciationStartFromPurchase: () => void;
  activeDeviceTypes: ComputedRef<DictionaryItem[]>;
  syncAssetDeviceType: () => void | Promise<void>;
  manufacturerOptions: ComputedRef<DictionaryItem[]>;
  activeDataCenters: ComputedRef<DataCenter[]>;
  changeAssetDataCenter: () => void | Promise<void>;
  assetRoomOptions: Ref<ServerRoom[]>;
  changeAssetRoom: () => void | Promise<void>;
  assetRackOptions: Ref<Rack[]>;
  changeAssetRack: () => void | Promise<void>;
  setAssetRackMounted: (value: boolean) => void;
  assetCustomFieldSchema: Ref<CustomFieldSchema[]>;
  updateAssetCustomFieldValue: (key: string, value: unknown) => void;
  tags: Ref<Tag[]>;
  tagListLoading: Ref<boolean>;
  tagListError: Ref<string>;
  retryTagList: () => void | Promise<boolean>;
  saveAsset: () => void | Promise<void>;
}

export interface RackManagementContext {
  serverRooms: Ref<ServerRoom[]>;
  showRackModal: Ref<boolean>;
  editingRack: Ref<Rack | null>;
  rackForm: Ref<RackFormState>;
  rackFormFieldErrors: Ref<Record<string, string>>;
  rackSaving: Ref<boolean>;
  deletingRackId: Ref<number | null>;
  updatingRackId: Ref<number | null>;
  openRackModal: (rack?: Rack, room?: ServerRoom) => void;
  saveRack: () => void | Promise<void>;
  deleteRack: (rack: Rack) => void | Promise<void>;
  updateRackStatus: (rack: Rack, status: RackStatus) => void | Promise<void>;
  clearRackFormErrors: () => void;
}

export interface RackSharedContext extends RackFiltersContext, RackListContext, RackCanvasContext, RackInspectorContext, RackManagementContext {
  rackSection: Ref<RackSection>;
  dataCenters: Ref<DataCenter[]>;
  racks: Ref<Rack[]>;
  facilitySummary: Ref<FacilitySummary | null>;
  rackManagementLoading: Ref<boolean>;
  dataCenterManagementError: Ref<string>;
  roomManagementError: Ref<string>;
  rackManagementError: Ref<string>;
  roomManagementSearch: Ref<string>;
  roomManagementDataCenter: Ref<string>;
  roomManagementPage: Ref<number>;
  roomManagementPageSize: Ref<number>;
  roomManagementCount: Ref<number>;
  changeRoomManagementSearch: () => void | Promise<void>;
  changeRoomManagementDataCenter: () => void | Promise<void>;
  changeRoomManagementPage: (page: number) => void | Promise<void>;
  resetRoomManagementFilters: () => void | Promise<void>;
  rackListLoading: Ref<boolean>;
  rackCanvasLoading: Ref<boolean>;
  rackListError: Ref<string>;
  rackCanvasError: Ref<string>;
  can: CapabilityFn;
  openDataCenterModal: (center?: DataCenter) => void | Promise<void>;
  openRoomModal: (room?: ServerRoom) => void | Promise<void>;
  openRackSection: (section: RackSection | string, query?: Record<string, string>) => void;
  selectRack: (rack: Rack) => void;
  rackDetailOpen: Ref<boolean>;
  rackViewStyle: ComputedRef<Record<string, string>>;
  detailAsset: Ref<AssetDetail | null>;
  detailLoading: Ref<boolean>;
  detailError: Ref<string>;
  retryAssetDetail: () => void | Promise<void>;
  closeAssetDetail: () => void;
  deleteRoom: (room: ServerRoom) => void | Promise<void>;
  updatingRoomId: Ref<number | null>;
  updateRoomStatus: (room: ServerRoom, isActive: boolean) => void | Promise<void>;
  rackUsedU: (rack: Rack) => number;
  rackUtilization: (rack: Rack) => number;
  rackUtilizationColor: (rack: Rack) => string;
  rackBodyStyle: (rack: Rack) => Record<string, string>;
  rackGapUnavailable: (rack: Rack, u: number) => boolean;
  rackAllocationStyle: (rack: Rack, allocation: Rack["allocations"][number]) => Record<string, string>;
  focusedRackId: Ref<number | null>;
  focusedRack: ComputedRef<Rack | null>;
  visibleRacks: ComputedRef<Rack[]>;
  displayedRacks: ComputedRef<Rack[]>;
  rackViewTitle: ComputedRef<string>;
  deviceTypes: Ref<DictionaryItem[]>;
  openRackAssetDetail: (assetId: number, rackId: number) => void | Promise<void>;
  rackCount: Ref<number>;
  rackPage: Ref<number>;
  changeRackPage: (page: number) => void | Promise<void>;
  retryRackView: () => void | Promise<void>;
  retryRackManagement: () => void | Promise<void>;
  hasRackFilters: ComputedRef<boolean>;
}

export interface RackFiltersContext {
  dataCenters: Ref<DataCenter[]>;
  selectedDataCenter: Ref<string>;
  changeDataCenter: () => void | Promise<void>;
  selectedRoom: Ref<string>;
  changeRoom: () => void | Promise<void>;
  roomOptions: ComputedRef<Array<{ id: string; name: string; data_center_name?: string }>>;
  selectedRack: Ref<string>;
  changeRackFilter: () => void | Promise<void>;
  rackOptions: ComputedRef<string[]>;
  selectedRackDeviceType: Ref<string>;
  deviceTypes: Ref<DictionaryItem[]>;
  resetRackFilters: () => void | Promise<void>;
  exportRackLayout: () => void | Promise<void>;
}

export interface RackListContext {
  visibleRacks: ComputedRef<Rack[]>;
  focusedRack: ComputedRef<Rack | null>;
  selectRack: (rack: Rack) => void;
  rackUtilization: (rack: Rack) => number;
  rackUtilizationColor: (rack: Rack) => string;
  rackUsedU: (rack: Rack) => number;
  rackCount: Ref<number>;
  rackPage: Ref<number>;
  rackPageSize: Ref<number>;
  changeRackPage: (page: number) => void | Promise<void>;
  rackListLoading: Ref<boolean>;
  rackListError: Ref<string>;
  hasRackFilters: ComputedRef<boolean>;
  resetRackFilters: () => void | Promise<void>;
  retryRackView: () => void | Promise<void>;
}

export interface RackCanvasContext {
  rackViewTitle: ComputedRef<string>;
  focusedRack: ComputedRef<Rack | null>;
  displayedRacks: ComputedRef<Rack[]>;
  rackDetailOpen: Ref<boolean>;
  deviceTypes: Ref<DictionaryItem[]>;
  rackUtilization: (rack: Rack) => number;
  rackBodyStyle: (rack: Rack) => Record<string, string>;
  rackGapUnavailable: (rack: Rack, u: number) => boolean;
  rackAllocationStyle: (rack: Rack, allocation: Rack["allocations"][number]) => Record<string, string>;
  focusedRackId: Ref<number | null>;
  openRackAssetDetail: (assetId: number, rackId: number) => void | Promise<void>;
  detailAsset: Ref<AssetDetail | null>;
  rackCanvasLoading: Ref<boolean>;
  rackCanvasError: Ref<string>;
  hasRackFilters: ComputedRef<boolean>;
  resetRackFilters: () => void | Promise<void>;
  retryRackView: () => void | Promise<void>;
}

export interface RackInspectorContext {
  rackDetailOpen: Ref<boolean>;
  detailAsset: Ref<AssetDetail | null>;
  detailLoading: Ref<boolean>;
  detailError: Ref<string>;
  retryAssetDetail: () => void | Promise<void>;
  closeAssetDetail: () => void;
}

export interface LicenseContext {
  loading: Ref<boolean>;
  licenseListLoading: Ref<boolean>;
  licenseListError: Ref<string>;
  exportingLicenses: Ref<boolean>;
  licenseKeyword: Ref<string>;
  searchLicenses: () => void | Promise<void>;
  licenseStatus: Ref<string>;
  licenseManufacturer: Ref<string>;
  licenseManufacturerOptions: ComputedRef<DictionaryItem[]>;
  licenseManufacturerFilterOptions: ComputedRef<DictionaryItem[]>;
  resetLicenseFilters: () => void | Promise<void>;
  retryLicenseList: () => void | Promise<void>;
  exportLicenses: () => void | Promise<void>;
  can: CapabilityFn;
  openLicenseModal: (license?: SoftwareLicense) => void | Promise<void>;
  deleteLicense: (license: SoftwareLicense) => void | Promise<void>;
  deletingLicenseId: Ref<number | null>;
  licenses: Ref<SoftwareLicense[]>;
  licensePage: Ref<number>;
  licensePageSize: Ref<number>;
  licenseCount: Ref<number>;
  changeLicensePage: (page: number) => void | Promise<void>;
  changeLicensePageSize: (size: number) => void | Promise<void>;
}

export interface RepairContext {
  repairListLoading: Ref<boolean>;
  repairListError: Ref<string>;
  exportingRepairs: Ref<boolean>;
  repairKeyword: Ref<string>;
  searchRepairs: () => void | Promise<void>;
  repairStatus: Ref<string>;
  repairStart: Ref<string>;
  repairEnd: Ref<string>;
  onRepairStatusChange: () => void | Promise<void>;
  onRepairDateChange: () => void | Promise<void>;
  resetRepairFilters: () => void | Promise<void>;
  retryRepairList: () => void | Promise<void>;
  exportRepairs: () => void | Promise<void>;
  can: CapabilityFn;
  openFaultModal: () => void | Promise<void>;
  openAssetDetail: (assetId: number) => void | Promise<void>;
  repairRows: Ref<FaultEvent[]>;
  openRepairModal: (fault: FaultEvent) => void | Promise<void>;
  repairPage: Ref<number>;
  repairPageSize: Ref<number>;
  repairCount: Ref<number>;
  changeRepairPage: (page: number) => void | Promise<void>;
  changeRepairPageSize: (size: number) => void | Promise<void>;
}

export interface SpareContext {
  loading: Ref<boolean>;
  can: CapabilityFn;
  spareParts: Ref<SparePart[]>;
  sparePartCount: Ref<number>;
  sparePage: Ref<number>;
  sparePageSize: Ref<number>;
  spareSearch: Ref<string>;
  spareType: Ref<string>;
  spareActive: Ref<string>;
  spareListDataCenter: Ref<string>;
  spareListRoom: Ref<string>;
  spareRooms: Ref<ServerRoom[]>;
  sparePartForm: Ref<Record<string, string | number | boolean>>;
  editingSparePart: Ref<SparePart | null>;
  showSparePartModal: Ref<boolean>;
  spareSaving: Ref<boolean>;
  deletingSparePartId: Ref<number | null>;
  updatingSparePartId: Ref<number | null>;
  spareListLoading: Ref<boolean>;
  spareListError: Ref<string>;
  exportingSpares: Ref<boolean>;
  openSparePartModal: (part?: SparePart) => void;
  saveSparePart: () => void | Promise<boolean>;
  toggleSparePart: (part: SparePart) => void | Promise<void>;
  deleteSparePart: (part: SparePart) => void | Promise<void>;
  searchSpareParts: () => void | Promise<void>;
  changeSparePage: (page: number) => void | Promise<void>;
  changeSparePageSize: (size: number) => void | Promise<void>;
  resetSpareFilters: () => void | Promise<void>;
  retrySpareList: () => void | Promise<void>;
  exportSpareParts: () => void | Promise<void>;
  exportSpareTransactions: (partId: number) => void | Promise<void>;
  openSpareOperation: (part: SparePart, type?: string, location?: { data_center: number; server_room: number | null; quantity: number; label: string }) => void;
  spareOperationType: Ref<string>;
  spareOperationForm: Ref<Record<string, string>>;
  showSpareOperationModal: Ref<boolean>;
  spareOperationSaving: Ref<boolean>;
  spareOperationCurrentQuantity: Ref<number | null>;
  spareOperationLocationLabel: Ref<string>;
  spareOperationLocationLocked: Ref<boolean>;
  saveSpareOperation: () => void | Promise<boolean>;
  spareOperationLabel: (type: string) => string;
  dataCenters: Ref<DataCenter[]>;
  manufacturers: Ref<DictionaryItem[]>;
  request: RequestFn;
  spareStocks: Ref<SpareStock[]>;
  spareTransactions: Ref<SpareTransaction[]>;
  spareStockCount: Ref<number>;
  spareTransactionCount: Ref<number>;
  stockLocations: Ref<Record<number, SpareStock[]>>;
  stockLoading: Ref<Record<number, boolean>>;
  stockLocationLoadingByPart: Ref<Record<number, boolean>>;
  stockLocationErrorByPart: Ref<Record<number, string>>;
  stockLocationTotalsByPart: Ref<Record<number, number>>;
  stockLocationLoadedByPart: Ref<Record<number, boolean>>;
  loadStockLocations: (partId: number) => void | Promise<void>;
  transactionRows: Ref<SpareTransaction[]>;
  transactionCount: Ref<number>;
  transactionPage: Ref<number>;
  transactionPageSize: Ref<number>;
  transactionLoading: Ref<boolean>;
  transactionError: Ref<string>;
  loadTransactions: (partId: number) => void | Promise<void>;
  changeTransactionPage: (page: number, partId: number) => void;
  changeTransactionPageSize: (size: number, partId: number) => void;
}

export interface InventoryContext {
  request: RequestFn;
  downloadFile: (path: string, filename?: string) => Promise<void>;
  can: CapabilityFn;
  currentUsername: Ref<string>;
  openAssetDetail: (assetId: number) => void | Promise<void>;
  refreshOpenAssetDetail?: (assetId: number) => Promise<boolean | null>;
  dataCenters: Ref<DataCenter[]>;
  serverRooms: Ref<ServerRoom[]>;
}

export interface SettingsContext extends CustomFieldContext, TagContext {
  loading: Ref<boolean>;
  settingsSection: Ref<SettingsSection>;
  can: CapabilityFn;
  dictionarySection: Ref<string>;
  dictionarySearch: Ref<string>;
  loadDictionaries: () => void | Promise<boolean>;
  retryDictionaries: () => void | Promise<boolean>;
  dictionaryLoading: Ref<boolean>;
  dictionaryError: Ref<string>;
  dictionarySaving: Ref<boolean>;
  dictionaryActionId: Ref<number | null>;
  dictionaryFormErrors: Ref<Record<string, string>>;
  currentDictionaryLabel: ComputedRef<string>;
  openDictionaryModal: (item?: DictionaryItem | DataCenter) => void;
  currentDictionaryItems: ComputedRef<DictionaryItem[]>;
  toggleDictionary: (item: DictionaryItem) => void | Promise<void>;
  deleteDictionary: (item: DictionaryItem) => void | Promise<void>;
  dictionaryItemUsed: (item: DictionaryItem) => boolean;
  isAdmin: Ref<boolean>;
  currentUsername: Ref<string>;
  organizationLoading: Ref<boolean>;
  organizationError: ComputedRef<string>;
  userListError: Ref<string>;
  roleListError: Ref<string>;
  retryOrganization: () => void | Promise<boolean>;
  users: Ref<ManagedUser[]>;
  userSearch: Ref<string>;
  userPage: Ref<number>;
  userPageSize: Ref<number>;
  userCount: Ref<number>;
  searchUsers: () => void | Promise<void>;
  retryUserList: () => void | Promise<boolean>;
  changeUserPage: (page: number) => void | Promise<void>;
  changeUserPageSize: (size: number) => void | Promise<void>;
  openUserModal: (user?: ManagedUser) => void;
  toggleUser: (user: ManagedUser) => void | Promise<void>;
  deleteUser: (user: ManagedUser) => void | Promise<void>;
  openUserResetModal: (user: ManagedUser) => void;
  resetUserPassword: () => void | Promise<void>;
  userProtectionReason: (user: ManagedUser) => string;
  canChangeUserRole: (user: ManagedUser) => boolean;
  userSaving: Ref<boolean>;
  userPendingId: Ref<number | null>;
  userFormErrors: Ref<Record<string, string>>;
  showUserResetModal: Ref<boolean>;
  resettingUser: Ref<ManagedUser | null>;
  userResetForm: Ref<{ new_password: string; confirm_password: string }>;
  userResetFormRef: Ref<import("element-plus").FormInstance | undefined>;
  userResetFormRules: import("element-plus").FormRules;
  userResetSaving: Ref<boolean>;
  userResetFormErrors: Ref<Record<string, string>>;
  roles: Ref<Role[]>;
  auditFilters: Ref<Record<string, string>>;
  auditListLoading: Ref<boolean>;
  auditListError: Ref<string>;
  loadAuditLogs: () => void | Promise<boolean>;
  retryAuditLogs: () => void | Promise<boolean>;
  searchAuditLogs: () => void | Promise<void>;
  auditLogs: Ref<import("./types").AuditLog[]>;
  formatDateTime: (value: string | null) => string;
  auditPage: Ref<number>;
  auditPageSize: Ref<number>;
  auditCount: Ref<number>;
  changeAuditPage: (page: number) => void | Promise<void>;
  changeAuditPageSize: (size: number) => void | Promise<void>;
}

export interface CustomFieldContext {
  loading: Ref<boolean>;
  customFieldDeviceType: Ref<string>;
  customFieldActive: Ref<string>;
  loadCustomFields: () => void | Promise<boolean>;
  retryCustomFieldList: () => void | Promise<boolean>;
  customFieldListLoading: Ref<boolean>;
  customFieldListError: Ref<string>;
  deviceTypes: Ref<DictionaryItem[]>;
  can: CapabilityFn;
  openCustomFieldModal: (field?: CustomField) => void;
  customFields: Ref<CustomField[]>;
  showCustomFieldModal: Ref<boolean>;
  editingCustomField: Ref<CustomField | null>;
  customFieldForm: Ref<CustomFieldForm>;
  customFieldFormErrors: Ref<Record<string, string>>;
  saveCustomField: () => void | Promise<void>;
  customFieldSaving: Ref<boolean>;
  toggleCustomField: (field: CustomField) => void | Promise<void>;
  deleteCustomField: (field: CustomField) => void | Promise<void>;
  customFieldActionId: Ref<number | null>;
  customFieldOptionForm: Ref<Record<string, string | number | boolean>>;
  customFieldOptionFormErrors: Ref<Record<string, string>>;
  customFieldOptionLoading: Ref<boolean>;
  customFieldOptionError: Ref<string>;
  showCustomFieldOptionModal: Ref<boolean>;
  editingCustomFieldOption: Ref<CustomFieldOption | null>;
  openCustomFieldOptionModal: (field?: CustomField | null, option?: CustomFieldOption) => void;
  loadCustomFieldOptions: (field?: CustomField | null) => void | Promise<boolean>;
  retryCustomFieldOptions: () => void | Promise<boolean>;
  saveCustomFieldOption: () => void | Promise<void>;
  customFieldOptionSaving: Ref<boolean>;
  customFieldOptionActionId: Ref<number | null>;
  deleteCustomFieldOption: (option: CustomFieldOption) => void | Promise<void>;
}

export interface TagContext {
  loading: Ref<boolean>;
  tagSearch: Ref<string>;
  tagActive: Ref<string>;
  loadTags: () => void | Promise<boolean>;
  retryTagList: () => void | Promise<boolean>;
  tagListLoading: Ref<boolean>;
  tagListError: Ref<string>;
  can: CapabilityFn;
  openTagModal: (tag?: Tag) => void;
  tags: Ref<Tag[]>;
  showTagModal: Ref<boolean>;
  editingTag: Ref<Tag | null>;
  tagForm: Ref<Record<string, string | boolean>>;
  tagFormErrors: Ref<Record<string, string>>;
  saveTag: () => void | Promise<void>;
  tagSaving: Ref<boolean>;
  toggleTag: (tag: Tag) => void | Promise<void>;
  deleteTag: (tag: Tag) => void | Promise<void>;
  tagActionId: Ref<number | null>;
}

export interface AppPageContext extends DashboardContext, AssetLedgerContext, AssetFormContext, RackSharedContext, LicenseContext, RepairContext, SpareContext, InventoryContext, SettingsContext, CustomFieldContext, TagContext {
}

/** Public name used by the shell when injecting page context. */
export type PageContext = AppPageContext;
