<script setup lang="ts">
import { computed, ref } from "vue";
import { Edit, Lock, Message, User } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import type { Ref } from "vue";
import type { useAssets } from "../../composables/useAssets";
import type { useFacilities } from "../../composables/useFacilities";
import type { useLicenses } from "../../composables/useLicenses";
import type { useRepairs } from "../../composables/useRepairs";
import type { useSettings } from "../../composables/useSettings";
import AssetDetailDrawer from "../AssetDetailDrawer.vue";
import AssetFormDialog from "../AssetFormDialog.vue";
import ActionDialogShell from "../ActionDialogShell.vue";
import FieldHelp from "../FieldHelp.vue";
import FormDialogShell from "../FormDialogShell.vue";
import AssetSelect from "../AssetSelect.vue";
import AssetSummary from "../AssetSummary.vue";
import PagedTable from "../PagedTable.vue";
import StatusTag from "../StatusTag.vue";
import type { Asset, AssetDetail, Page } from "../../types";
import type { AssetFormContext, PageContext, RequestFn } from "../../page-context";
import { statusTone } from "../../status";
import { currentLocale, type Locale } from "../../i18n";
import { useI18n } from "vue-i18n";
import {
  businessOptionLabel,
  businessOptionTone,
  roleLabel,
  spareUnitLabel,
} from "../../business-enums";

type AssetsState = ReturnType<typeof useAssets>;
type FacilitiesState = ReturnType<typeof useFacilities>;
type LicensesState = ReturnType<typeof useLicenses>;
type RepairsState = ReturnType<typeof useRepairs>;
type SettingsState = ReturnType<typeof useSettings>;

const props = defineProps<{
  request: RequestFn;
  assetContext: PageContext;
  assetDetail: {
    page: Ref<Page>;
    showAssetDetail: Ref<boolean>;
    detailAsset: Ref<AssetDetail | null>;
    detailLoading: Ref<boolean>;
    detailError: Ref<string>;
  };
  assets: AssetsState;
  facilities: FacilitiesState;
  licenses: LicensesState;
  repairs: RepairsState;
  settings: SettingsState;
  auth: {
    username: Ref<string>;
    loadProfile: () => void | Promise<boolean>;
    showPasswordModal: Ref<boolean>;
    passwordChangeRequired: Ref<boolean>;
    passwordForm: Ref<{ old_password: string; new_password: string; confirm_password: string }>;
    passwordSaving: Ref<boolean>;
    passwordError: Ref<string>;
    passwordFormErrors: Ref<Record<string, string>>;
    showProfileModal: Ref<boolean>;
    profileForm: Ref<{ first_name: string; last_name: string; email: string; locale: Locale }>;
    profileLoading: Ref<boolean>;
    profileSaving: Ref<boolean>;
    profileError: Ref<string>;
    profileFormErrors: Ref<Record<string, string>>;
    roleCode: Ref<string>;
    roleName: Ref<string>;
    userIsActive: Ref<boolean>;
    lastLogin: Ref<string | null>;
    saveProfile: () => void | Promise<boolean>;
    changePassword: () => void | Promise<void>;
  };
}>();

const { t } = useI18n();

const request = props.request;
const assetContext: AssetFormContext = props.assetContext;
const assetResponsibilityContext = props.assets;
const {
  page,
  showAssetDetail,
  detailAsset,
  detailLoading,
  detailError,
} = props.assetDetail;

const {
  importFile,
  assetListError,
  showImportDialog,
  importStep,
  importPreviewFilter,
  importPreviewError,
  importPreviewing,
  importing,
  importResult,
  importPreview,
  filteredImportRows,
  copyImportErrors,
  downloadImportErrors,
  downloadImportTemplate,
  onElementUploadChange,
  chooseAnotherImportFile,
  closeImportDialog,
  confirmImportPreview,
  importErrorText,
  openAssetEditor,
  retryAssetDetail,
} = props.assets;

const {
  showDataCenterModal,
  editingDataCenter,
  dataCenterForm,
  dataCenterSaving,
  dataCenterFormErrors,
  saveDataCenter,
  showRoomModal,
  editingRoom,
  roomForm,
  roomSaving,
  roomFormErrors,
  dataCenters,
  saveRoom,
} = props.facilities;

const {
  showLicenseModal,
  editingLicense,
  licenseForm,
  licenseManufacturerOptions,
  licenseSaving,
  saveLicense,
} = props.licenses;

function numberFromText(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const authorizedCountValue = computed<number | null>({
  get: () => numberFromText(licenseForm.value.authorized_count),
  set: (value) => {
    licenseForm.value.authorized_count = value == null ? "" : String(value);
  },
});

const usedCountValue = computed<number | null>({
  get: () => numberFromText(licenseForm.value.used_count),
  set: (value) => {
    licenseForm.value.used_count = value == null ? "" : String(value);
  },
});

const {
  showFaultModal,
  faultForm,
  faultSaving,
  faultError,
  faultFormErrors,
  createFault,
  showRepairModal,
  selectedFault,
  repairForm,
  repairTimeError,
  repairSaving,
  repairError,
  repairFormErrors,
  saveRepair,
  reopenRepair,
  showRepairPartUsageModal,
  repairPartUsageForm,
  repairPartUsageItems,
  repairPartUsagePage,
  repairPartUsagePageSize,
  repairPartUsageTotal,
  repairPartUsageLoading,
  repairPartUsageError,
  repairPartUsageSaving,
  repairPartUsageFormErrors,
  repairPartUsageOptions,
  repairPartUsageOptionsLoading,
  repairPartUsageOptionsError,
  repairPartUsageStocks,
  repairPartUsageStocksLoading,
  repairPartUsageStocksError,
  repairPartUsageSourceOptions,
  openRepairPartUsageModal,
  loadRepairPartUsageOptions,
  scheduleRepairPartUsagePartSearch,
  loadRepairPartUsageStocks,
  changeRepairPartUsageSource,
  changeRepairPartUsagePart,
  saveRepairPartUsage,
  retryRepairPartUsageHistory,
  changeRepairPartUsagePage,
} = props.repairs;

const repairPartUsageAvailableSourceOptions = computed(() => repairPartUsageSourceOptions.filter(
  (option) => option.value !== "internal_stock" || props.assetContext.can("spares.manage"),
));

const faultSelectedAsset = computed<Asset | null>(() => {
  const assetId = Number(faultForm.value.asset);
  if (!Number.isInteger(assetId) || assetId <= 0) return null;
  return props.assets.assets.value.find((asset) => asset.id === assetId) || null;
});

const repairAssetSummary = computed(() => {
  const fault = selectedFault.value;
  if (!fault) return null;
  const asset = props.assets.assets.value.find((item) => item.id === fault.asset);
  return asset
    ? { ...asset, asset_no: fault.asset_no, name: fault.asset_name }
    : fault;
});

const repairFaultSummary = computed(() => {
  const fault = selectedFault.value;
  return fault?.reason?.trim() || fault?.description?.trim() || t("overlay.faultRecord");
});

const repairFaultDescription = computed(() => {
  const fault = selectedFault.value;
  const reason = fault?.reason?.trim() || "";
  const description = fault?.description?.trim() || "";
  return reason && description && reason !== description ? description : "";
});

const repairFaultStatusTone = computed(() => statusTone(selectedFault.value?.is_closed ? "completed" : "repair"));
const repairFaultStatusLabel = computed(() => selectedFault.value?.is_closed ? t("status.closed") : t("status.open"));
const repairCanManage = computed(() => props.assetContext.can("faults.manage"));
const repairReadOnly = computed(() => Boolean(selectedFault.value?.is_closed) || !repairCanManage.value);
const repairCanSubmit = computed(() => Boolean(selectedFault.value && !repairReadOnly.value));
const repairCanReopen = computed(() => Boolean(
  selectedFault.value?.is_closed && selectedFault.value.repair && repairCanManage.value,
));
const repairPartUsageCanManage = computed(() => Boolean(
  selectedFault.value && !selectedFault.value.is_closed && repairCanManage.value,
));
const repairPartUsageSelectedPart = computed(() => {
  const partId = Number(repairPartUsageForm.value.spare_part_id);
  return repairPartUsageOptions.value.find((part) => part.id === partId) || null;
});
const repairPartUsageSelectedStock = computed(() => {
  const stockId = Number(repairPartUsageForm.value.spare_stock_id);
  return repairPartUsageStocks.value.find((stock) => stock.id === stockId) || null;
});
const repairPartUsageQuantity = computed<number | null>({
  get: () => repairPartUsageForm.value.quantity,
  set: (value) => {
    repairPartUsageForm.value.quantity = value == null ? null : Number(value);
  },
});
const repairPartUsageStockImpact = computed(() => {
  const stock = repairPartUsageSelectedStock.value;
  const quantity = Number(repairPartUsageForm.value.quantity || 0);
  if (!stock || !quantity) return "";
  return t("repair.partUsageStockImpact", {
    current: stock.quantity,
    remaining: Math.max(stock.quantity - quantity, 0),
    unit: spareUnitLabel(repairPartUsageSelectedPart.value?.unit || "piece"),
  });
});
const repairDialogTitle = computed(() => {
  if (!selectedFault.value) return t("overlay.repairRecord");
  if (selectedFault.value.is_closed) return t("repair.viewResult");
  return selectedFault.value.repair ? t("repair.process") : t("repair.start");
});
const repairDialogDescription = computed(() => {
  if (selectedFault.value?.is_closed) return t("overlay.repairClosedDescription");
  if (!repairCanManage.value) return t("overlay.repairReadOnlyDescription");
  return t("overlay.repairEditDescription");
});

const faultFormRef = ref<FormInstance>();
const repairFormRef = ref<FormInstance>();
const repairPartUsageFormRef = ref<FormInstance>();
const faultFormRules = computed<FormRules>(() => ({
  asset: [{ required: true, message: t("overlay.selectRelatedAsset"), trigger: "change" }],
  occurred_at: [{ required: true, message: t("overlay.selectFaultTime"), trigger: "change" }],
}));
const repairTimeRule = {
  validator: (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
    const error = repairTimeError();
    if (error) {
      callback(new Error(error));
      return;
    }
    callback();
  },
  trigger: ["change", "blur"],
};
const repairFormRules = computed<FormRules>(() => ({
  started_at: [repairTimeRule],
  finished_at: [repairTimeRule],
}));
const repairPartUsageFormRules = computed<FormRules>(() => ({
  source: [{ required: true, message: t("repair.partUsageSourceRequired"), trigger: "change" }],
  spare_part_id: [
    {
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        if (repairPartUsageForm.value.source === "internal_stock" && !String(value || "").trim()) {
          callback(new Error(t("repair.partUsagePartRequired")));
          return;
        }
        callback();
      },
      trigger: "change",
    },
  ],
  part_name: [
    {
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        if (repairPartUsageForm.value.source === "vendor_provided" && !String(value || "").trim()) {
          callback(new Error(t("repair.partUsageNameRequired")));
          return;
        }
        callback();
      },
      trigger: ["change", "blur"],
    },
  ],
  spare_stock_id: [
    {
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        if (repairPartUsageForm.value.source === "internal_stock" && !String(value || "").trim()) {
          callback(new Error(t("repair.partUsageStockRequired")));
          return;
        }
        callback();
      },
      trigger: "change",
    },
  ],
  quantity: [
    {
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        const quantity = Number(value);
        if (!Number.isInteger(quantity) || quantity < 1) {
          callback(new Error(t("repair.partUsageQuantityInvalid")));
          return;
        }
        const stock = repairPartUsageSelectedStock.value;
        if (repairPartUsageForm.value.source === "internal_stock" && stock && quantity > stock.quantity) {
          callback(new Error(t("repair.partUsageQuantityExceedsStock")));
          return;
        }
        callback();
      },
      trigger: ["change", "blur"],
    },
  ],
}));
const repairSubmitLabel = computed(() => {
  if (!selectedFault.value?.repair) return t("repair.start");
  return repairForm.value.finished_at.trim() ? t("overlay.completeRepair") : t("overlay.saveRepair");
});

const licenseFormRef = ref<FormInstance>();
const licenseFormRules = computed<FormRules>(() => ({
  name: [{ required: true, message: t("overlay.enterSoftwareName"), trigger: "blur" }],
  authorized_count: [
    { required: true, message: t("overlay.enterAuthorizedCount"), trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        if (!/^\d+$/.test(String(value ?? "").trim())) {
          callback(new Error(t("overlay.authorizedCountInteger")));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
  used_count: [
    { required: true, message: t("overlay.enterUsedCount"), trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        const used = String(value ?? "").trim();
        const authorized = String(licenseForm.value.authorized_count ?? "").trim();
        if (!/^\d+$/.test(used)) {
          callback(new Error(t("overlay.usedCountInteger")));
          return;
        }
        if (/^\d+$/.test(authorized) && Number(used) > Number(authorized)) {
          callback(new Error(t("overlay.usedCountExceedsAuthorized")));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
}));

async function submitLicense() {
  const valid = await licenseFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveLicense();
}

function clearLicenseValidation() {
  licenseFormRef.value?.clearValidate();
}

async function submitFault() {
  const valid = await faultFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await createFault();
}

async function submitRepair() {
  if (repairReadOnly.value) return;
  const valid = await repairFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveRepair();
}

async function submitRepairPartUsage() {
  const valid = await repairPartUsageFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveRepairPartUsage();
}

function repairPartUsageOptionLabel(part: { code: string; name: string; model?: string }) {
  return [part.code, part.name, part.model].filter(Boolean).join(" · ");
}

function repairPartUsageStockLabel(stock: {
  data_center_name: string;
  server_room_name: string | null;
  quantity: number;
  part: number;
}) {
  const location = [stock.data_center_name, stock.server_room_name || t("spare.centerStock")].filter(Boolean).join(" / ");
  const unit = repairPartUsageSelectedPart.value?.unit || "piece";
  return `${location} · ${stock.quantity} ${spareUnitLabel(unit)}`;
}

function repairPartUsageOrigin(row: {
  source: string;
  stock_data_center_name: string;
  stock_server_room_name: string;
  vendor_name: string;
}) {
  if (row.source === "internal_stock") {
    return [row.stock_data_center_name, row.stock_server_room_name || t("spare.centerStock")].filter(Boolean).join(" / ") || t("common.notAvailable");
  }
  return row.vendor_name || t("common.notAvailable");
}

function formatRepairPartUsageDateTime(value: string | null | undefined): string {
  if (!value) return t("common.notAvailable");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("common.notAvailable") : date.toLocaleString(currentLocale.value);
}

function formatRepairDateTime(value: string | null | undefined): string {
  if (!value) return t("common.notAvailable");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("common.notAvailable") : date.toLocaleString(currentLocale.value);
}

const {
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
  userResetError,
  userResetFormErrors,
  resetUserPassword,
  canChangeUserRole,
  userSaving,
  userFormErrors,
  roles,
  saveUser,
  showDictionaryModal,
  editingDictionary,
  currentDictionaryLabel,
  dictionarySection,
  dictionaryForm,
  dictionaryFormErrors,
  dictionarySaving,
  saveDictionary,
} = props.settings;

const dictionaryDialogLabel = computed(() =>
  dictionarySection.value === "manufacturers"
    ? t("settings.manufacturer")
    : dictionarySection.value === "device-types"
      ? t("settings.dictionaryType")
      : t("settings.spareCategory"),
);

const {
  username,
  loadProfile,
  showPasswordModal,
  passwordChangeRequired,
  passwordForm,
  passwordSaving,
  passwordError,
  passwordFormErrors,
  changePassword,
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
} = props.auth;

const localizedRoleName = computed(() => roleLabel(roleCode.value, roleName.value || roleCode.value));

const usernameEditHelp = computed(() => t("overlay.usernameEditHelp"));
const roleHelp = computed(() => t("overlay.roleHelp"));
const dictionaryStatusHelp = computed(() => t("overlay.dictionaryStatusHelp"));
const usedCountHelp = computed(() => t("overlay.usedCountHelp"));
const expiryDateHelp = computed(() => t("overlay.expiryDateHelp"));
const userResetPasswordHelp = computed(() => t("overlay.userResetPasswordHelp"));
const repairFinishedAtHelp = computed(() => t("overlay.repairFinishedAtHelp"));
const passwordChangeHelp = computed(() => passwordChangeRequired.value
  ? `${t("auth.passwordHint")} ${t("auth.firstLoginHint")}`
  : t("auth.passwordHint"));

const dictionaryFormRef = ref<FormInstance>();
const dataCenterFormRef = ref<FormInstance>();
const roomFormRef = ref<FormInstance>();
const passwordFormRef = ref<FormInstance>();
const profileFormRef = ref<FormInstance>();

const dictionaryFormRules = computed<FormRules>(() => ({
  name: [
    { required: true, whitespace: true, message: t("overlay.enterName"), trigger: "blur" },
    {
      max: dictionarySection.value === "device-types" ? 80 : 120,
      message: dictionarySection.value === "device-types" ? t("overlay.deviceTypeNameMax") : t("overlay.nameMax"),
      trigger: "blur",
    },
  ],
  code: dictionarySection.value === "manufacturers"
    ? [{ max: 80, message: t("overlay.manufacturerCodeMax"), trigger: "blur" }]
    : dictionarySection.value === "spare-categories"
      ? [
          { required: true, whitespace: true, message: t("overlay.enterSpareCategoryCode"), trigger: "blur" },
          { max: 80, message: t("overlay.spareCategoryCodeMax"), trigger: "blur" },
        ]
      : [],
  color: dictionarySection.value === "device-types"
    ? [{ pattern: /^#[0-9A-Fa-f]{6}$/, message: t("overlay.colorInvalid"), trigger: ["blur", "change"] }]
    : [],
}));

const dataCenterFormRules = computed<FormRules>(() => ({
  name: [
    { required: true, whitespace: true, message: t("overlay.enterDataCenterName"), trigger: "blur" },
    { max: 120, message: t("overlay.dataCenterNameMax"), trigger: "blur" },
  ],
  address: [{ max: 255, message: t("overlay.addressMax"), trigger: "blur" }],
}));

const roomFormRules = computed<FormRules>(() => ({
  data_center: [{ required: true, message: t("overlay.selectDataCenter"), trigger: "change" }],
  name: [
    { required: true, whitespace: true, message: t("overlay.enterRoomName"), trigger: "blur" },
    { max: 120, message: t("overlay.roomNameMax"), trigger: "blur" },
  ],
  owner_name: [{ max: 120, message: t("overlay.ownerMax"), trigger: "blur" }],
  contact_phone: [{ max: 50, message: t("overlay.contactMax"), trigger: "blur" }],
}));

const passwordFormRules = computed<FormRules>(() => ({
  old_password: [{ required: true, message: t("overlay.enterOldPassword"), trigger: "blur" }],
  new_password: [
    { required: true, message: t("overlay.enterNewPassword"), trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        const password = String(value || "");
        if (password && password.length < 8) callback(new Error(t("validation.passwordMin")));
        else callback();
      },
      trigger: ["blur", "change"],
    },
  ],
  confirm_password: [
    { required: true, message: t("overlay.confirmNewPassword"), trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        if (String(value || "") !== String(passwordForm.value.new_password || "")) {
          callback(new Error(t("validation.newPasswordMismatch")));
        } else {
          callback();
        }
      },
      trigger: ["blur", "change"],
    },
  ],
}));

const profileFormRules = computed<FormRules>(() => ({
  first_name: [{ max: 150, message: t("overlay.firstNameMax"), trigger: ["blur", "change"] }],
  last_name: [{ max: 150, message: t("overlay.lastNameMax"), trigger: ["blur", "change"] }],
  email: [{ type: "email", message: t("validation.invalidEmail"), trigger: ["blur", "change"] }],
}));

function formatProfileDateTime(value: string | null) {
  if (!value) return t("overlay.noRecords");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(currentLocale.value);
}

async function submitDictionary() {
  const valid = await dictionaryFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveDictionary();
}

async function submitDataCenter() {
  const valid = await dataCenterFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveDataCenter();
}

async function submitRoom() {
  const valid = await roomFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveRoom();
}

async function submitPassword() {
  const valid = await passwordFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await changePassword();
}

async function submitProfile() {
  const valid = await profileFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveProfile();
}

async function submitUserReset() {
  const valid = await userResetFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await resetUserPassword();
}

const canEditAsset = computed(() => props.assetContext.can("assets.manage"));

function editCurrentAsset() {
  const assetId = detailAsset.value?.id;
  if (assetId) void openAssetEditor(assetId);
}

function importRowErrorText(row: { errors: Array<{ label: string; message: string }> }) {
  return row.errors.map((error) => `${error.label}：${error.message}`).join("；");
}
</script>

<template>
  <AssetFormDialog :context="assetContext" />

  <FormDialogShell
    v-model="showUserModal"
    :title="editingUser ? t('settings.editUser') : t('settings.addUser')"
    :description="t('overlay.userDialogDescription')"
    size="medium"
    :saving="userSaving"
    :show-close="!userSaving"
    :close-on-click-modal="!userSaving"
    :close-on-press-escape="!userSaving"
    :close-disabled="userSaving"
  >
    <el-form
      ref="userFormRef"
      :model="userForm"
      :rules="userFormRules"
      :validate-on-rule-change="false"
      label-position="right"
      class="horizontal-form user-account-form"
      @submit.prevent="saveUser"
    >
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.accountInformation') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('auth.username')" prop="username" required :error="userFormErrors.username">
            <el-input v-model="userForm.username" :disabled="!!editingUser" autocomplete="username" :validate-event="false" :prefix-icon="Edit" :placeholder="t('overlay.enterUsername')" />
            <FieldHelp v-if="editingUser" :text="usernameEditHelp" />
          </el-form-item>
          <el-form-item :label="t('auth.email')" prop="email" :error="userFormErrors.email">
            <el-input v-model="userForm.email" type="email" autocomplete="email" :validate-event="false" :prefix-icon="Message" :placeholder="t('overlay.enterEmailOptional')" />
          </el-form-item>
          <el-form-item :label="t('auth.lastName')" prop="last_name" required :error="userFormErrors.last_name">
            <el-input v-model="userForm.last_name" autocomplete="family-name" :validate-event="false" :prefix-icon="Edit" :placeholder="t('overlay.enterLastName')" />
          </el-form-item>
          <el-form-item :label="t('auth.firstName')" prop="first_name" required :error="userFormErrors.first_name">
            <el-input v-model="userForm.first_name" autocomplete="given-name" :validate-event="false" :prefix-icon="Edit" :placeholder="t('overlay.enterFirstName')" />
          </el-form-item>
        </div>
      </section>
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.roleAndStatus') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('settings.role')" prop="role_code" required :error="userFormErrors.role_code">
            <el-select v-model="userForm.role_code" class="user-account-role" :placeholder="t('overlay.selectRole')" :validate-event="false" :disabled="!!editingUser && !canChangeUserRole(editingUser)">
              <template #prefix><el-icon><User /></el-icon></template>
              <el-option v-for="role in roles" :key="role.id" :label="roleLabel(role.code, role.name)" :value="role.code" />
            </el-select>
            <FieldHelp :text="roleHelp" />
          </el-form-item>
          <el-form-item :label="t('overlay.accountStatus')" class="user-account-status">
            <el-select v-model="userForm.is_active" :disabled="!!editingUser && !canChangeUserRole(editingUser)" :aria-label="t('overlay.accountStatus')">
              <el-option :label="t('status.active')" :value="true" />
              <el-option :label="t('status.inactive')" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
      <section v-if="!editingUser" class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.initialPassword') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('overlay.initialPassword')" prop="password" required :error="userFormErrors.password">
            <el-input v-model="userForm.password" type="password" show-password autocomplete="new-password" :validate-event="false" :prefix-icon="Lock" :placeholder="t('overlay.enterPasswordMin')" />
          </el-form-item>
          <el-form-item :label="t('auth.confirmPassword')" prop="confirm_password" required>
            <el-input v-model="userForm.confirm_password" type="password" show-password autocomplete="new-password" :validate-event="false" :prefix-icon="Lock" :placeholder="t('overlay.enterPasswordAgain')" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="userSaving" @click="showUserModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="userSaving" :disabled="userSaving" @click="saveUser">{{ t('overlay.saveUser') }}</el-button>
    </template>
  </FormDialogShell>

  <ActionDialogShell
    v-model="showUserResetModal"
    :title="t('overlay.resetUserPassword')"
    :description="t('overlay.resetUserPasswordDescription')"
    size="small"
    :pending="userResetSaving"
    :error="userResetError"
    :show-close="!userResetSaving"
    :close-on-click-modal="!userResetSaving"
    :close-on-press-escape="!userResetSaving"
    :close-disabled="userResetSaving"
  >
    <el-alert
      v-if="resettingUser"
      :title="t('overlay.setPasswordFor', { name: resettingUser.display_name || resettingUser.username })"
      type="info"
      :closable="false"
      class="user-reset-alert"
    />
    <el-form
      ref="userResetFormRef"
      :model="userResetForm"
      :rules="userResetFormRules"
      label-position="top"
      :validate-on-rule-change="false"
      @submit.prevent="submitUserReset"
    >
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.passwordInformation') }}</h3>
        <el-form-item :label="t('auth.newPassword')" prop="new_password" :error="userResetFormErrors.new_password">
          <el-input v-model="userResetForm.new_password" type="password" show-password autocomplete="new-password" />
          <FieldHelp :text="userResetPasswordHelp" />
        </el-form-item>
        <el-form-item :label="t('overlay.confirmNewPassword')" prop="confirm_password" :error="userResetFormErrors.confirm_password">
          <el-input v-model="userResetForm.confirm_password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="userResetSaving" @click="showUserResetModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="userResetSaving" :disabled="userResetSaving" @click="submitUserReset">{{ t('auth.savePassword') }}</el-button>
    </template>
  </ActionDialogShell>

  <FormDialogShell
    v-model="showProfileModal"
    :title="t('auth.profileTitle')"
    :description="t('auth.profileDescription')"
    size="small"
    :loading="profileLoading"
    :show-close="!profileSaving"
    :close-on-click-modal="!profileSaving"
    :close-on-press-escape="!profileSaving"
    :close-disabled="profileSaving"
  >
    <div v-if="profileError" class="settings-state settings-state--error profile-state" role="alert">
      <div class="settings-state__copy"><strong>{{ t('auth.profileLoadFailed') }}</strong><span>{{ profileError }}</span></div>
      <el-button type="primary" plain :loading="profileLoading" @click="loadProfile">{{ t('auth.retryProfile') }}</el-button>
    </div>
    <el-form
      v-else
      ref="profileFormRef"
      class="horizontal-form profile-form"
      :model="profileForm"
      :rules="profileFormRules"
      label-position="right"
      :validate-on-rule-change="false"
      @submit.prevent="submitProfile"
    >
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('auth.accountInfo') }}</h3>
        <div class="profile-readonly-grid">
          <div><span>{{ t('auth.username') }}</span><strong>{{ username }}</strong></div>
          <div><span>{{ t('settings.role') }}</span><strong>{{ localizedRoleName || t('common.notAvailable') }}</strong></div>
          <div><span>{{ t('common.status') }}</span><strong>{{ userIsActive ? t('status.active') : t('status.inactive') }}</strong></div>
          <div><span>{{ t('auth.lastLogin') }}</span><strong>{{ formatProfileDateTime(lastLogin) }}</strong></div>
        </div>
      </section>
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('auth.personalInfo') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('auth.lastName')" prop="last_name" :error="profileFormErrors.last_name">
            <el-input v-model="profileForm.last_name" autocomplete="family-name" maxlength="150" />
          </el-form-item>
          <el-form-item :label="t('auth.firstName')" prop="first_name" :error="profileFormErrors.first_name">
            <el-input v-model="profileForm.first_name" autocomplete="given-name" maxlength="150" />
          </el-form-item>
          <el-form-item :label="t('auth.email')" prop="email" :error="profileFormErrors.email">
            <el-input v-model="profileForm.email" type="email" autocomplete="email" maxlength="254" />
          </el-form-item>
          <el-form-item :label="t('auth.language')" prop="locale">
            <el-select v-model="profileForm.locale" :aria-label="t('auth.languagePreference')">
              <el-option value="zh-CN" :label="t('auth.simplifiedChinese')" />
              <el-option value="en-US" :label="t('auth.english')" />
            </el-select>
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="profileSaving" @click="showProfileModal = false">{{ t('common.cancel') }}</el-button>
      <el-button v-if="!profileError" type="primary" :loading="profileSaving" :disabled="profileSaving" @click="submitProfile">{{ t('auth.saveProfile') }}</el-button>
    </template>
  </FormDialogShell>

  <FormDialogShell
    v-model="showDictionaryModal"
    :title="`${editingDictionary ? t('common.edit') : t('common.add')}${dictionaryDialogLabel}`"
    :description="dictionarySection === 'manufacturers' ? '' : t('overlay.dictionaryDialogDescription')"
    size="small"
    :saving="dictionarySaving"
    :show-close="!dictionarySaving"
    :close-on-click-modal="!dictionarySaving"
    :close-on-press-escape="!dictionarySaving"
    :close-disabled="dictionarySaving"
  >
    <el-form ref="dictionaryFormRef" class="horizontal-form" :model="dictionaryForm" :rules="dictionaryFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitDictionary">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.basicInformation') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="`${currentDictionaryLabel}${t('overlay.nameSuffix')}`" prop="name" required :error="dictionaryFormErrors.name">
            <el-input v-model="dictionaryForm.name" :maxlength="dictionarySection === 'device-types' ? 80 : 120" />
          </el-form-item>
          <el-form-item v-if="dictionarySection === 'manufacturers'" :label="t('settings.manufacturerCode')" prop="code" :error="dictionaryFormErrors.code">
            <el-input v-model="dictionaryForm.code" maxlength="80" />
          </el-form-item>
          <el-form-item v-if="dictionarySection === 'spare-categories'" :label="t('settings.typeCode')" prop="code" :error="dictionaryFormErrors.code">
            <el-input v-model="dictionaryForm.code" maxlength="80" />
          </el-form-item>
          <el-form-item v-if="dictionarySection === 'device-types'" :label="t('overlay.typeColor')" prop="color" :error="dictionaryFormErrors.color">
            <div class="color-input">
              <el-color-picker v-model="dictionaryForm.color" />
              <el-input v-model="dictionaryForm.color" maxlength="7" />
            </div>
          </el-form-item>
          <el-form-item :label="t('common.status')">
            <el-select v-model="dictionaryForm.is_active" :aria-label="t('common.status')">
              <el-option :label="t('status.active')" :value="true" />
              <el-option :label="t('status.inactive')" :value="false" />
            </el-select>
            <FieldHelp :text="dictionaryStatusHelp" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="dictionarySaving" @click="showDictionaryModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="dictionarySaving" :disabled="dictionarySaving" @click="submitDictionary">{{ t('overlay.saveItem', { item: dictionaryDialogLabel }) }}</el-button>
    </template>
  </FormDialogShell>

  <FormDialogShell
    v-model="showLicenseModal"
    :title="editingLicense ? t('overlay.editLicense') : t('overlay.addLicense')"
    :description="t('overlay.licenseDialogDescription')"
    size="medium"
    :saving="licenseSaving"
    :show-close="!licenseSaving"
    :close-on-click-modal="!licenseSaving"
    :close-on-press-escape="!licenseSaving"
    :close-disabled="licenseSaving"
    @open="clearLicenseValidation"
  >
    <el-form
      ref="licenseFormRef"
      :model="licenseForm"
      :rules="licenseFormRules"
      label-position="right"
      class="horizontal-form"
      :validate-on-rule-change="false"
      @submit.prevent="submitLicense"
    >
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.basicInformation') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('license.softwareName')" prop="name" required>
            <el-input v-model="licenseForm.name" maxlength="160" :validate-event="false" />
          </el-form-item>
          <el-form-item :label="t('license.authorizedCount')" prop="authorized_count" required>
            <el-input-number v-model="authorizedCountValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('license.authorizedCount')">
              <template #suffix>{{ t('common.units') }}</template>
            </el-input-number>
          </el-form-item>
          <el-form-item :label="t('license.usedCount')" prop="used_count" required>
            <el-input-number v-model="usedCountValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('license.usedCount')">
              <template #suffix>{{ t('common.units') }}</template>
            </el-input-number>
            <FieldHelp :text="usedCountHelp" />
          </el-form-item>
          <el-form-item :label="t('license.vendor')" prop="manufacturer_id">
            <el-select v-model="licenseForm.manufacturer_id" clearable filterable :placeholder="t('assetForm.unlinkedManufacturer')" :validate-event="false">
              <el-option
                v-for="manufacturer in licenseManufacturerOptions"
                :key="manufacturer.id"
                :label="manufacturer.is_active ? manufacturer.name : `${manufacturer.name} (${t('status.inactive')})`"
                :value="String(manufacturer.id)"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('license.licenseType')" prop="license_type">
            <el-input v-model="licenseForm.license_type" maxlength="80" :placeholder="t('overlay.licenseTypePlaceholder')" :validate-event="false" />
          </el-form-item>
          <el-form-item :label="t('license.expiryDate')" prop="expiry_date">
            <el-date-picker v-model="licenseForm.expiry_date" type="date" value-format="YYYY-MM-DD" :validate-event="false" />
            <FieldHelp :text="expiryDateHelp" />
          </el-form-item>
          <el-form-item :label="t('common.notes')" prop="notes">
            <el-input v-model="licenseForm.notes" type="textarea" :rows="3" :validate-event="false" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="licenseSaving" @click="showLicenseModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="licenseSaving" :disabled="licenseSaving" @click="submitLicense">{{ t('overlay.saveLicense') }}</el-button>
    </template>
  </FormDialogShell>

  <ActionDialogShell
    v-model="showPasswordModal"
    :title="passwordChangeRequired ? t('auth.forcePasswordChangeTitle') : t('auth.changePassword')"
    :description="t('overlay.passwordDialogDescription')"
    size="small"
    :pending="passwordSaving"
    :error="passwordError"
    :show-close="!passwordChangeRequired && !passwordSaving"
    :close-on-click-modal="!passwordChangeRequired && !passwordSaving"
    :close-on-press-escape="!passwordChangeRequired && !passwordSaving"
    :close-disabled="passwordSaving"
  >
    <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordFormRules" label-position="top" :validate-on-rule-change="false" @submit.prevent="submitPassword">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.passwordInformation') }}</h3>
        <el-form-item :label="t('auth.oldPassword')" prop="old_password" required :error="passwordFormErrors.old_password"><el-input v-model="passwordForm.old_password" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item :label="t('auth.newPassword')" prop="new_password" required :error="passwordFormErrors.new_password">
          <el-input v-model="passwordForm.new_password" type="password" show-password autocomplete="new-password" />
          <FieldHelp :text="passwordChangeHelp" />
        </el-form-item>
        <el-form-item :label="t('overlay.confirmNewPassword')" prop="confirm_password" required :error="passwordFormErrors.confirm_password"><el-input v-model="passwordForm.confirm_password" type="password" show-password autocomplete="new-password" /></el-form-item>
      </section>
    </el-form>
    <template #footer>
      <el-button v-if="!passwordChangeRequired" :disabled="passwordSaving" @click="showPasswordModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="passwordSaving" :disabled="passwordSaving" @click="submitPassword">{{ t('auth.savePassword') }}</el-button>
    </template>
  </ActionDialogShell>

  <FormDialogShell
    v-model="showFaultModal"
    :title="t('repair.addFault')"
    :description="t('overlay.faultDialogDescription')"
    size="medium"
    :saving="faultSaving"
    :error="faultError"
    :show-close="!faultSaving"
    :close-on-click-modal="!faultSaving"
    :close-on-press-escape="!faultSaving"
    :close-disabled="faultSaving"
  >
    <el-form ref="faultFormRef" class="horizontal-form fault-form" :model="faultForm" :rules="faultFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitFault">
      <div class="horizontal-form__rows">
        <el-form-item :label="t('repair.asset')" prop="asset" required :validate-event="false" :error="faultFormErrors.asset">
          <AssetSelect
            v-model="faultForm.asset"
            :request="request"
            :selected-asset="faultSelectedAsset"
            :placeholder="t('assetSelect.placeholder')"
          />
        </el-form-item>
        <el-form-item :label="t('repair.occurredAt')" prop="occurred_at" required :validate-event="false" :error="faultFormErrors.occurred_at"><el-date-picker v-model="faultForm.occurred_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" /></el-form-item>
        <el-form-item :label="t('overlay.faultReason')" :error="faultFormErrors.reason"><el-input v-model="faultForm.reason" :placeholder="t('overlay.faultReasonPlaceholder')" /></el-form-item>
        <el-form-item :label="t('overlay.faultDescription')" :error="faultFormErrors.description"><el-input v-model="faultForm.description" type="textarea" :rows="4" :placeholder="t('overlay.faultDescriptionPlaceholder')" /></el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button :disabled="faultSaving" @click="showFaultModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="faultSaving" :disabled="faultSaving" @click="submitFault">{{ t('overlay.saveFault') }}</el-button>
    </template>
  </FormDialogShell>

  <ActionDialogShell
    v-model="showRepairModal"
    :title="repairDialogTitle"
    :description="repairDialogDescription"
    size="medium"
    :pending="repairSaving"
    :error="repairError"
    :show-close="!repairSaving"
    :close-on-click-modal="!repairSaving"
    :close-on-press-escape="!repairSaving"
    :close-disabled="repairSaving"
  >
    <el-form ref="repairFormRef" class="repair-action-form" :class="{ 'repair-action-form--readonly': repairReadOnly }" :model="repairForm" :rules="repairFormRules" label-position="top" :validate-on-rule-change="false">
      <div v-if="selectedFault" class="repair-action-context">
        <div class="repair-action-context__heading">
          <div class="repair-action-context__fault">
            <span class="repair-action-context__label">{{ t('repair.fault') }}</span>
            <strong :title="repairFaultSummary">{{ repairFaultSummary }}</strong>
          </div>
          <StatusTag :tone="repairFaultStatusTone" :label="repairFaultStatusLabel" />
        </div>
        <div class="repair-action-context__meta">
          {{ t('overlay.occurredAtValue', { value: formatRepairDateTime(selectedFault.occurred_at) }) }}
        </div>
        <p v-if="repairFaultDescription" class="repair-action-context__description">{{ repairFaultDescription }}</p>
      </div>
      <AssetSummary v-if="repairAssetSummary" :asset="repairAssetSummary" compact :show-status="true" :show-location="true" />
      <section class="repair-part-usage-panel" :aria-labelledby="'repair-part-usage-title'">
        <div class="repair-part-usage-panel__header">
          <div>
            <h3 id="repair-part-usage-title" class="repair-part-usage-panel__title">{{ t('repair.partUsageHistory') }}</h3>
            <p class="repair-part-usage-panel__hint">{{ t('repair.partUsageHistoryHint') }}</p>
          </div>
          <el-button v-if="repairPartUsageCanManage" type="primary" plain size="small" @click="openRepairPartUsageModal">
            {{ t('repair.recordPartUsage') }}
          </el-button>
        </div>
        <el-alert v-if="repairPartUsageError" type="error" :closable="false" show-icon>
          <template #default>
            <div class="repair-part-usage-panel__error">
              <span>{{ repairPartUsageError }}</span>
              <el-button link type="danger" @click="retryRepairPartUsageHistory">{{ t('common.retry') }}</el-button>
            </div>
          </template>
        </el-alert>
        <div v-if="repairPartUsageLoading" class="repair-part-usage-panel__loading">{{ t('common.loading') }}</div>
        <PagedTable
          v-if="repairPartUsageItems.length || repairPartUsageLoading"
          class="repair-part-usage-paged-table"
          :current-page="repairPartUsagePage"
          :page-size="repairPartUsagePageSize"
          :total="repairPartUsageTotal"
          :disabled="repairPartUsageLoading"
          hide-on-single-page
          layout="prev, pager, next"
          @update:current-page="changeRepairPartUsagePage"
        >
          <el-table
            v-if="!repairPartUsageLoading"
            :data="repairPartUsageItems"
            size="small"
            class="repair-part-usage-table"
            row-key="id"
          >
            <el-table-column :label="t('repair.partUsageTime')" min-width="154">
              <template #default="{ row }">{{ formatRepairPartUsageDateTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column :label="t('repair.partUsageSource')" min-width="92">
              <template #default="{ row }">
                <StatusTag :tone="businessOptionTone(repairPartUsageSourceOptions, row.source)" :label="businessOptionLabel(repairPartUsageSourceOptions, row.source)" />
              </template>
            </el-table-column>
            <el-table-column :label="t('repair.partUsagePart')" min-width="180">
              <template #default="{ row }">
                <div class="repair-part-usage-table__part" :title="repairPartUsageOptionLabel({ code: row.part_code, name: row.part_name, model: row.part_model })">
                  <strong>{{ row.part_code }}</strong>
                  <span>{{ row.part_name }}<template v-if="row.part_model"> · {{ row.part_model }}</template></span>
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="t('repair.partUsageQuantity')" width="92" align="right">
              <template #default="{ row }">{{ row.quantity }} {{ spareUnitLabel(row.unit) }}</template>
            </el-table-column>
            <el-table-column :label="t('repair.partUsageOrigin')" min-width="150">
              <template #default="{ row }"><span :title="repairPartUsageOrigin(row)">{{ repairPartUsageOrigin(row) }}</span></template>
            </el-table-column>
            <el-table-column :label="t('repair.partUsageOperator')" min-width="110">
              <template #default="{ row }">{{ row.operator_name || t('common.notAvailable') }}</template>
            </el-table-column>
            <el-table-column :label="t('common.notes')" min-width="180">
              <template #default="{ row }"><span class="repair-part-usage-table__notes">{{ row.notes || t('common.notAvailable') }}</span></template>
            </el-table-column>
          </el-table>
        </PagedTable>
        <el-empty v-else-if="!repairPartUsageError" :description="t('repair.noPartUsage')" :image-size="56" />
      </section>
      <el-form-item :label="t('overlay.repairProvider')" :error="repairFormErrors.provider"><el-input v-model="repairForm.provider" :readonly="repairReadOnly" :placeholder="t('overlay.repairProviderPlaceholder')" /></el-form-item>
      <el-form-item :label="t('overlay.repairStartedAt')" prop="started_at" :error="repairFormErrors.started_at"><el-date-picker v-model="repairForm.started_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" :disabled="repairReadOnly" /></el-form-item>
      <el-form-item :label="t('overlay.repairFinishedAt')" prop="finished_at" :error="repairFormErrors.finished_at">
        <el-date-picker v-model="repairForm.finished_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" :disabled="repairReadOnly" />
        <FieldHelp v-if="!repairReadOnly" :text="repairFinishedAtHelp" />
      </el-form-item>
      <el-form-item :label="t('common.notes')" :error="repairFormErrors.notes"><el-input v-model="repairForm.notes" type="textarea" :rows="4" :readonly="repairReadOnly" :placeholder="t('overlay.repairNotesPlaceholder')" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="repairSaving" @click="showRepairModal = false">{{ repairReadOnly ? t('common.close') : t('common.cancel') }}</el-button>
      <el-button v-if="repairCanReopen" type="primary" :loading="repairSaving" :disabled="repairSaving" @click="reopenRepair">{{ t('repair.reopen') }}</el-button>
      <el-button v-if="repairCanSubmit" type="primary" :loading="repairSaving" :disabled="repairSaving" @click="submitRepair">{{ repairSubmitLabel }}</el-button>
    </template>
  </ActionDialogShell>

  <ActionDialogShell
    v-model="showRepairPartUsageModal"
    :title="t('repair.recordPartUsage')"
    :description="t('repair.partUsageDialogDescription')"
    size="medium"
    :pending="repairPartUsageSaving"
    :error="repairPartUsageError"
    :show-close="!repairPartUsageSaving"
    :close-on-click-modal="!repairPartUsageSaving"
    :close-on-press-escape="!repairPartUsageSaving"
    :close-disabled="repairPartUsageSaving"
  >
    <el-form
      ref="repairPartUsageFormRef"
      class="repair-part-usage-form"
      :model="repairPartUsageForm"
      :rules="repairPartUsageFormRules"
      label-position="top"
      :validate-on-rule-change="false"
      @submit.prevent="submitRepairPartUsage"
    >
      <el-alert :title="t('repair.partUsageImmutableHint')" type="info" :closable="false" show-icon />
      <el-alert
        :title="t(repairPartUsageForm.source === 'internal_stock' ? 'repair.partUsageInternalImpact' : 'repair.partUsageVendorImpact')"
        :type="repairPartUsageForm.source === 'internal_stock' ? 'warning' : 'info'"
        :closable="false"
        show-icon
      />
      <el-form-item :label="t('repair.partUsageSource')" prop="source" required :error="repairPartUsageFormErrors.source">
        <el-select v-model="repairPartUsageForm.source" class="repair-part-usage-form__wide" @change="changeRepairPartUsageSource">
          <el-option
            v-for="option in repairPartUsageAvailableSourceOptions"
            :key="option.value"
            :label="businessOptionLabel(repairPartUsageAvailableSourceOptions, option.value)"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <template v-if="repairPartUsageForm.source === 'internal_stock'">
        <el-form-item :label="t('repair.partUsagePart')" prop="spare_part_id" required :error="repairPartUsageFormErrors.spare_part_id">
          <el-select
            v-model="repairPartUsageForm.spare_part_id"
            class="repair-part-usage-form__wide"
            filterable
            remote
            clearable
            reserve-keyword
            :loading="repairPartUsageOptionsLoading"
            :remote-method="scheduleRepairPartUsagePartSearch"
            :placeholder="t('repair.partUsagePartPlaceholder')"
            @change="changeRepairPartUsagePart"
          >
            <el-option
              v-for="part in repairPartUsageOptions"
              :key="part.id"
              :label="repairPartUsageOptionLabel(part)"
              :value="String(part.id)"
            />
          </el-select>
          <div v-if="repairPartUsageOptionsError" class="repair-part-usage-form__inline-error">
            <span>{{ repairPartUsageOptionsError }}</span>
            <el-button link type="danger" @click="loadRepairPartUsageOptions()">{{ t('common.retry') }}</el-button>
          </div>
        </el-form-item>
        <el-form-item :label="t('repair.partUsageStock')" prop="spare_stock_id" required :error="repairPartUsageFormErrors.spare_stock_id">
          <el-select
            v-model="repairPartUsageForm.spare_stock_id"
            class="repair-part-usage-form__wide"
            clearable
            :disabled="!repairPartUsageForm.spare_part_id || repairPartUsageStocksLoading"
            :loading="repairPartUsageStocksLoading"
            :placeholder="repairPartUsageForm.spare_part_id ? t('repair.partUsageStockPlaceholder') : t('repair.partUsageSelectPartFirst')"
          >
            <el-option
              v-for="stock in repairPartUsageStocks"
              :key="stock.id"
              :label="repairPartUsageStockLabel(stock)"
              :value="String(stock.id)"
            />
          </el-select>
          <div v-if="repairPartUsageStocksError" class="repair-part-usage-form__inline-error">
            <span>{{ repairPartUsageStocksError }}</span>
            <el-button link type="danger" @click="loadRepairPartUsageStocks()">{{ t('common.retry') }}</el-button>
          </div>
        </el-form-item>
      </template>
      <template v-else>
        <el-form-item :label="t('repair.partUsageName')" prop="part_name" required :error="repairPartUsageFormErrors.part_name">
          <el-input v-model="repairPartUsageForm.part_name" maxlength="160" :placeholder="t('repair.partUsageNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('repair.partUsageModel')" prop="part_model" :error="repairPartUsageFormErrors.part_model">
          <el-input v-model="repairPartUsageForm.part_model" maxlength="160" :placeholder="t('repair.partUsageModelPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('repair.partUsageCode')" prop="part_code" :error="repairPartUsageFormErrors.part_code">
          <el-input v-model="repairPartUsageForm.part_code" maxlength="80" :placeholder="t('repair.partUsageCodePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('repair.partUsageVendor')" prop="vendor_name" :error="repairPartUsageFormErrors.vendor_name">
          <el-input v-model="repairPartUsageForm.vendor_name" maxlength="160" :placeholder="t('repair.partUsageVendorPlaceholder')" />
        </el-form-item>
      </template>
      <el-form-item :label="t('repair.partUsageQuantity')" prop="quantity" required :error="repairPartUsageFormErrors.quantity">
        <el-input-number
          v-model="repairPartUsageQuantity"
          :min="1"
          :max="repairPartUsageForm.source === 'internal_stock' && repairPartUsageSelectedStock ? repairPartUsageSelectedStock.quantity : undefined"
          :step="1"
          :precision="0"
          :value-on-clear="null"
          :disabled="repairPartUsageForm.source === 'internal_stock' && !repairPartUsageSelectedStock"
        />
      </el-form-item>
      <el-alert v-if="repairPartUsageStockImpact" :title="repairPartUsageStockImpact" type="warning" :closable="false" show-icon />
      <el-form-item :label="t('common.notes')" prop="notes" :error="repairPartUsageFormErrors.notes">
        <el-input v-model="repairPartUsageForm.notes" type="textarea" :rows="3" maxlength="2000" :placeholder="t('repair.partUsageNotesPlaceholder')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="repairPartUsageSaving" @click="showRepairPartUsageModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="repairPartUsageSaving" :disabled="repairPartUsageSaving" @click="submitRepairPartUsage">{{ t('repair.savePartUsage') }}</el-button>
    </template>
  </ActionDialogShell>

  <ActionDialogShell
    v-model="showImportDialog"
    :title="t('asset.importAssets')"
    :description="t('overlay.importDialogDescription')"
    size="large"
    class="asset-import-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="!importPreviewing && !importing"
    :loading="importPreviewing"
    :pending="importPreviewing || importing"
    :close-disabled="importPreviewing || importing"
    @close="closeImportDialog"
  >
    <el-steps :active="importStep === 'upload' ? 0 : importStep === 'preview' ? 1 : 2" simple finish-status="success" class="asset-import-steps">
      <el-step :title="t('overlay.uploadFile')" />
      <el-step :title="t('overlay.previewConfirm')" />
      <el-step :title="t('overlay.importResult')" />
    </el-steps>
    <el-alert v-if="importPreviewError" :title="importPreviewError" type="error" :closable="false" show-icon class="asset-import-alert" />

    <template v-if="importStep === 'upload'">
      <el-upload
        class="asset-import-upload"
        drag
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        :auto-upload="false"
        :show-file-list="false"
        :disabled="importPreviewing || importing"
        :on-change="onElementUploadChange"
      >
        <div class="asset-import-upload__icon">⇧</div>
        <div class="asset-import-upload__title">{{ t('overlay.dropImportFile') }}</div>
        <div class="asset-import-upload__hint">{{ t('overlay.selectImportFileHint') }}</div>
      </el-upload>
      <div v-if="importFile" class="asset-import-file-bar">
        <div>
          <strong>{{ importFile.name }}</strong>
          <span>{{ (importFile.size / 1024 / 1024).toFixed(2) }} MB</span>
        </div>
        <el-button link type="primary" :disabled="importPreviewing || importing" @click="chooseAnotherImportFile">{{ t('common.chooseAnother') }}</el-button>
      </div>
      <div class="asset-import-upload__actions">
        <el-button link type="primary" :disabled="importPreviewing || importing" @click="downloadImportTemplate">{{ t('common.downloadTemplate') }}</el-button>
        <span>{{ t('overlay.importTemplateHint') }}</span>
      </div>
    </template>

    <template v-else-if="importStep === 'preview' && importPreview">
      <div class="asset-import-file-bar">
        <div>
          <strong>{{ importFile?.name || importPreview.filename }}</strong>
          <span v-if="importFile">{{ (importFile.size / 1024 / 1024).toFixed(2) }} MB</span>
        </div>
        <el-button link type="primary" :disabled="importPreviewing || importing" @click="chooseAnotherImportFile">{{ t('common.chooseAnother') }}</el-button>
      </div>
      <el-alert :title="t('overlay.importValidationNotice')" type="info" :closable="false" show-icon />
      <div class="import-preview-summary">
        <StatusTag tone="info" :label="t('overlay.importTotalRows', { count: importPreview.total })" />
        <StatusTag tone="success" :label="t('overlay.importValidRows', { count: importPreview.valid })" />
        <StatusTag tone="danger" :label="t('overlay.importInvalidRows', { count: importPreview.invalid })" />
        <el-radio-group v-model="importPreviewFilter" size="small" class="import-preview-filter">
          <el-radio-button label="all">{{ t('common.all') }}</el-radio-button>
          <el-radio-button label="errors">{{ t('overlay.onlyErrors') }}</el-radio-button>
        </el-radio-group>
      </div>
      <el-table class="action-dialog__table" :data="filteredImportRows" border stripe max-height="460" row-key="line" :empty-text="t('overlay.importNoMatchingRows')">
        <el-table-column prop="line" :label="t('overlay.excelRow')" width="88" />
        <el-table-column prop="asset_no" :label="t('asset.code')" min-width="150" />
        <el-table-column prop="name" :label="t('asset.name')" min-width="170" />
        <el-table-column prop="device_type" :label="t('asset.deviceType')" min-width="120" />
        <el-table-column prop="location" :label="t('common.location')" min-width="220" />
        <el-table-column prop="depreciation" :label="t('asset.depreciation')" min-width="230" />
        <el-table-column :label="t('overlay.validationResult')" width="112" fixed="right">
          <template #default="{ row }">
            <StatusTag :tone="row.valid ? 'success' : 'danger'" :label="row.valid ? t('overlay.importable') : t('overlay.invalid')" />
          </template>
        </el-table-column>
        <el-table-column :label="t('overlay.errorDetails')" min-width="300">
          <template #default="{ row }">
            <span v-if="row.errors.length" class="import-preview-errors import-preview-errors--summary">{{ importRowErrorText(row) }}</span>
            <span v-else class="muted-text">—</span>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template v-else>
      <section class="action-dialog__result">
        <el-result
          :icon="importResult.errors.length ? 'warning' : 'success'"
          :title="importResult.errors.length ? t('overlay.importCompletedWithErrors') : t('overlay.importCompleted')"
          :sub-title="importResult.errors.length
            ? t('overlay.importCreatedWithErrors', { created: importResult.created, failed: importResult.errors.length })
            : t('overlay.importCreatedAtomic', { created: importResult.created })"
        />
        <el-alert
          v-if="assetListError"
          type="warning"
          :closable="false"
          show-icon
          :title="t('overlay.importRefreshFailed')"
          :description="assetListError"
        />
        <div v-if="importResult.errors.length" class="import-error-list">
          <p v-for="item in importResult.errors" :key="item.line"><strong>{{ t('overlay.importErrorLine', { line: item.line }) }}</strong>{{ importErrorText(item.detail) }}</p>
          <div class="import-error-actions">
            <el-button link type="primary" size="small" @click="copyImportErrors">{{ t('asset.copyImportErrors') }}</el-button>
            <el-button link type="primary" size="small" @click="downloadImportErrors">{{ t('asset.downloadImportErrors') }}</el-button>
          </div>
        </div>
      </section>
    </template>

    <template #footer>
      <el-button v-if="importStep !== 'result'" :disabled="importPreviewing || importing" @click="closeImportDialog">{{ t('common.cancel') }}</el-button>
      <el-button v-if="importStep === 'preview'" type="primary" :loading="importing" :disabled="!importPreview?.valid || !!importPreview?.invalid || importPreviewing" @click="confirmImportPreview">{{ t('overlay.confirmImport') }}</el-button>
      <el-button v-else-if="importStep === 'result'" type="primary" @click="closeImportDialog">{{ t('common.done') }}</el-button>
    </template>
  </ActionDialogShell>

  <FormDialogShell
    v-model="showDataCenterModal"
    :title="editingDataCenter ? t('overlay.editDataCenter') : t('location.createDataCenter')"
    :description="t('overlay.dataCenterDialogDescription')"
    size="medium"
    :saving="dataCenterSaving"
    :show-close="!dataCenterSaving"
    :close-on-click-modal="!dataCenterSaving"
    :close-on-press-escape="!dataCenterSaving"
    :close-disabled="dataCenterSaving"
  >
    <el-form ref="dataCenterFormRef" class="horizontal-form" :model="dataCenterForm" :rules="dataCenterFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitDataCenter">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.basicInformation') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('overlay.dataCenterName')" prop="name" required :error="dataCenterFormErrors.name"><el-input v-model="dataCenterForm.name" maxlength="120" /></el-form-item>
          <el-form-item :label="t('common.address')" prop="address" :error="dataCenterFormErrors.address"><el-input v-model="dataCenterForm.address" maxlength="255" /></el-form-item>
          <el-form-item :label="t('common.status')">
            <el-select v-model="dataCenterForm.is_active" :aria-label="t('common.status')">
              <el-option :label="t('status.active')" :value="true" />
              <el-option :label="t('status.inactive')" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="dataCenterSaving" @click="showDataCenterModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="dataCenterSaving" :disabled="dataCenterSaving" @click="submitDataCenter">{{ t('overlay.saveDataCenter') }}</el-button>
    </template>
  </FormDialogShell>

  <FormDialogShell
    v-model="showRoomModal"
    :title="editingRoom ? t('overlay.editRoom') : t('location.createRoom')"
    :description="t('overlay.roomDialogDescription')"
    size="medium"
    :saving="roomSaving"
    :show-close="!roomSaving"
    :close-on-click-modal="!roomSaving"
    :close-on-press-escape="!roomSaving"
    :close-disabled="roomSaving"
  >
    <el-form ref="roomFormRef" class="horizontal-form" :model="roomForm" :rules="roomFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitRoom">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('overlay.basicInformation') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('common.dataCenter')" prop="data_center" required :error="roomFormErrors.data_center">
            <el-select v-model="roomForm.data_center" :placeholder="t('overlay.selectDataCenter')">
              <el-option
                v-for="center in dataCenters"
                :key="center.id"
                :label="center.is_active ? center.name : `${center.name} (${t('status.inactive')})`"
                :value="String(center.id)"
                :disabled="!center.is_active && String(center.id) !== roomForm.data_center"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('overlay.roomName')" prop="name" required :error="roomFormErrors.name"><el-input v-model="roomForm.name" maxlength="120" /></el-form-item>
          <el-form-item :label="t('rack.owner')" prop="owner_name" :error="roomFormErrors.owner_name"><el-input v-model="roomForm.owner_name" maxlength="120" /></el-form-item>
          <el-form-item :label="t('overlay.contactPhone')" prop="contact_phone" :error="roomFormErrors.contact_phone"><el-input v-model="roomForm.contact_phone" maxlength="50" /></el-form-item>
          <el-form-item :label="t('common.notes')" :error="roomFormErrors.notes"><el-input v-model="roomForm.notes" type="textarea" :rows="3" /></el-form-item>
          <el-form-item :label="t('common.status')">
            <el-select v-model="roomForm.is_active" :aria-label="t('common.status')">
              <el-option :label="t('status.active')" :value="true" />
              <el-option :label="t('status.inactive')" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="roomSaving" @click="showRoomModal = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="roomSaving" :disabled="roomSaving" @click="submitRoom">{{ t('overlay.saveRoom') }}</el-button>
    </template>
  </FormDialogShell>

  <AssetDetailDrawer
    v-if="page !== 'racks'"
    v-model="showAssetDetail"
    :asset="detailAsset"
    :loading="detailLoading"
    :error="detailError"
    :can-edit="canEditAsset"
    :retry="retryAssetDetail"
    :responsibility-context="assetResponsibilityContext"
    :responsibility-history-context="assetResponsibilityContext"
    :inventory-history-context="assetResponsibilityContext"
    @edit="editCurrentAsset"
    @closed="detailAsset = null"
  />
</template>
