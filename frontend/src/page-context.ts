import type { ComputedRef, Ref } from "vue";
import type { RackSection, SettingsSection } from "./router";
import type {
  Asset,
  AssetDetail,
  CustomField,
  CustomFieldOption,
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
  brand: string;
  model: string;
  device_type: string;
  brand_model: string;
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
  handleMenuSelect: (index: string) => void;
  openAssetDetail: (assetId: number) => void | Promise<void>;
  openNewAssetModal: () => void | Promise<void>;
  openRackSection: (section: RackSection | string) => void;
  assetSearch: Ref<string>;
  searchLedger: () => void | Promise<void>;
  can: CapabilityFn;
  dashboardDate: (value: string) => string;
  dashboardDateTime: (value: string) => string;
}

export interface AssetLedgerContext {
  loading: Ref<boolean>;
  assetSearch: Ref<string>;
  searchLedger: () => void | Promise<void>;
  assetTagFilter: Ref<string>;
  tags: Ref<Tag[]>;
  assetColumnOptions: Array<{ key: string; label: string }>;
  visibleAssetColumns: Ref<string[]>;
  toggleAssetColumn: (key: string) => void;
  resetAssetColumns: () => void;
  visibleAssetColumnOptions: ComputedRef<Array<{ key: string; label: string }>>;
  can: CapabilityFn;
  openNewAssetModal: () => void | Promise<void>;
  selectedAssetIds: Ref<number[]>;
  deleteSelectedAssets: () => void | Promise<void>;
  exportAssets: () => void | Promise<void>;
  registerFaultFromSelection: () => void | Promise<void>;
  downloadImportTemplate: () => void;
  onElementUploadChange: (file: { raw?: File }) => void | Promise<void>;
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
  activeDeviceTypes: ComputedRef<DictionaryItem[]>;
  syncAssetDeviceType: () => void | Promise<void>;
  activeBrands: ComputedRef<DictionaryItem[]>;
  activeDataCenters: ComputedRef<DataCenter[]>;
  changeAssetDataCenter: () => void | Promise<void>;
  assetRoomOptions: Ref<ServerRoom[]>;
  changeAssetRoom: () => void | Promise<void>;
  assetRackOptions: Ref<Rack[]>;
  changeAssetRack: () => void | Promise<void>;
  setAssetRackMounted: (value: boolean) => void;
  assetCustomFieldSchema: Ref<CustomField[]>;
  tags: Ref<Tag[]>;
  saveAsset: () => void | Promise<void>;
}

export interface RackSharedContext extends RackFiltersContext, RackListContext, RackCanvasContext, RackInspectorContext {
  rackSection: Ref<RackSection>;
  dataCenters: Ref<DataCenter[]>;
  serverRooms: Ref<ServerRoom[]>;
  racks: Ref<Rack[]>;
  facilitySummary: Ref<FacilitySummary | null>;
  can: CapabilityFn;
  openDataCenterModal: (center?: DataCenter) => void | Promise<void>;
  openRoomModal: (room?: ServerRoom) => void | Promise<void>;
  openRackSection: (section: RackSection | string) => void;
  selectRack: (rack: Rack) => void;
  rackDetailOpen: Ref<boolean>;
  rackViewStyle: ComputedRef<Record<string, string>>;
  detailAsset: Ref<AssetDetail | null>;
  detailLoading: Ref<boolean>;
  detailError: Ref<string>;
  closeAssetDetail: () => void;
  deleteRoom: (room: ServerRoom) => void | Promise<void>;
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
}

export interface RackFiltersContext {
  dataCenters: Ref<DataCenter[]>;
  selectedDataCenter: Ref<string>;
  changeDataCenter: () => void | Promise<void>;
  selectedRoom: Ref<string>;
  changeRoom: () => void | Promise<void>;
  roomOptions: ComputedRef<Array<{ id: string; name: string }>>;
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
  changeRackPage: (page: number) => void | Promise<void>;
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
}

export interface RackInspectorContext {
  rackDetailOpen: Ref<boolean>;
  detailAsset: Ref<AssetDetail | null>;
  detailLoading: Ref<boolean>;
  detailError: Ref<string>;
  closeAssetDetail: () => void;
}

export interface LicenseContext {
  loading: Ref<boolean>;
  licenseKeyword: Ref<string>;
  searchLicenses: () => void | Promise<void>;
  licenseStatus: Ref<string>;
  can: CapabilityFn;
  openLicenseModal: (license?: SoftwareLicense) => void | Promise<void>;
  deleteLicense: (license: SoftwareLicense) => void | Promise<void>;
  licenses: Ref<SoftwareLicense[]>;
  licensePage: Ref<number>;
  licensePageSize: Ref<number>;
  licenseCount: Ref<number>;
  changeLicensePage: (page: number) => void | Promise<void>;
  changeLicensePageSize: (size: number) => void | Promise<void>;
}

export interface RepairContext {
  loading: Ref<boolean>;
  repairKeyword: Ref<string>;
  searchRepairs: () => void | Promise<void>;
  repairStatus: Ref<string>;
  repairStart: Ref<string>;
  repairEnd: Ref<string>;
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
  openSparePartModal: (part?: SparePart) => void;
  saveSparePart: () => void | Promise<void>;
  toggleSparePart: (part: SparePart) => void | Promise<void>;
  deleteSparePart: (part: SparePart) => void | Promise<void>;
  searchSpareParts: () => void | Promise<void>;
  changeSparePage: (page: number) => void | Promise<void>;
  changeSparePageSize: (size: number) => void | Promise<void>;
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
  brands: Ref<DictionaryItem[]>;
  request: RequestFn;
  spareStocks: Ref<SpareStock[]>;
  spareTransactions: Ref<SpareTransaction[]>;
  spareStockCount: Ref<number>;
  spareTransactionCount: Ref<number>;
  stockLocations: Ref<Record<number, SpareStock[]>>;
  stockLoading: Ref<Record<number, boolean>>;
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
  openAssetDetail: (assetId: number) => void | Promise<void>;
  dataCenters: Ref<DataCenter[]>;
  serverRooms: Ref<ServerRoom[]>;
}

export interface SettingsContext extends CustomFieldContext, TagContext {
  loading: Ref<boolean>;
  settingsSection: Ref<SettingsSection>;
  can: CapabilityFn;
  dictionarySection: Ref<string>;
  dictionarySearch: Ref<string>;
  loadDictionaries: () => void | Promise<void>;
  currentDictionaryLabel: ComputedRef<string>;
  openDictionaryModal: (item?: DictionaryItem | DataCenter) => void;
  currentDictionaryItems: ComputedRef<DictionaryItem[]>;
  toggleDictionary: (item: DictionaryItem) => void | Promise<void>;
  deleteDictionary: (item: DictionaryItem) => void | Promise<void>;
  dictionaryItemUsed: (item: DictionaryItem) => boolean;
  isAdmin: Ref<boolean>;
  users: Ref<ManagedUser[]>;
  openUserModal: (user?: ManagedUser) => void;
  toggleUser: (user: ManagedUser) => void | Promise<void>;
  deleteUser: (user: ManagedUser) => void | Promise<void>;
  roles: Ref<Role[]>;
  openRoleModal: (role?: Role) => void;
  deleteRole: (role: Role) => void | Promise<void>;
  auditFilters: Ref<Record<string, string>>;
  loadAuditLogs: () => void | Promise<void>;
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
  loadCustomFields: () => void | Promise<void>;
  deviceTypes: Ref<DictionaryItem[]>;
  can: CapabilityFn;
  openCustomFieldModal: (field?: CustomField) => void;
  customFields: Ref<CustomField[]>;
  showCustomFieldModal: Ref<boolean>;
  editingCustomField: Ref<CustomField | null>;
  customFieldForm: Ref<Record<string, string | number | boolean>>;
  saveCustomField: () => void | Promise<void>;
  toggleCustomField: (field: CustomField) => void | Promise<void>;
  deleteCustomField: (field: CustomField) => void | Promise<void>;
  customFieldOptionForm: Ref<Record<string, string | number | boolean>>;
  showCustomFieldOptionModal: Ref<boolean>;
  editingCustomFieldOption: Ref<CustomFieldOption | null>;
  openCustomFieldOptionModal: (field?: CustomField | null, option?: CustomFieldOption) => void;
  saveCustomFieldOption: () => void | Promise<void>;
  deleteCustomFieldOption: (option: CustomFieldOption) => void | Promise<void>;
}

export interface TagContext {
  loading: Ref<boolean>;
  tagSearch: Ref<string>;
  tagActive: Ref<string>;
  loadTags: () => void | Promise<void>;
  can: CapabilityFn;
  openTagModal: (tag?: Tag) => void;
  tags: Ref<Tag[]>;
  showTagModal: Ref<boolean>;
  editingTag: Ref<Tag | null>;
  tagForm: Ref<Record<string, string | boolean>>;
  saveTag: () => void | Promise<void>;
  toggleTag: (tag: Tag) => void | Promise<void>;
  deleteTag: (tag: Tag) => void | Promise<void>;
}

export interface AppPageContext extends DashboardContext, AssetLedgerContext, AssetFormContext, RackSharedContext, LicenseContext, RepairContext, SpareContext, InventoryContext, SettingsContext, CustomFieldContext, TagContext {
}

/** Public name used by the shell when injecting page context. */
export type PageContext = AppPageContext;
