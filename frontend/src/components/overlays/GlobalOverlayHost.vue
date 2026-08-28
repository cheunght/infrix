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
import StatusTag from "../StatusTag.vue";
import type { Asset, AssetDetail, Page } from "../../types";
import type { AssetFormContext, PageContext, RequestFn } from "../../types/page-context";
import { statusTone } from "../../status";

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
    profileForm: Ref<{ first_name: string; last_name: string; email: string }>;
    profileLoading: Ref<boolean>;
    profileSaving: Ref<boolean>;
    profileError: Ref<string>;
    profileFormErrors: Ref<Record<string, string>>;
    roleName: Ref<string>;
    userIsActive: Ref<boolean>;
    lastLogin: Ref<string | null>;
    saveProfile: () => void | Promise<boolean>;
    changePassword: () => void | Promise<void>;
  };
}>();

const request = props.request;
const assetContext: AssetFormContext = props.assetContext;
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
  createFault,
  showRepairModal,
  selectedFault,
  repairForm,
  repairTimeError,
  repairSaving,
  repairError,
  saveRepair,
} = props.repairs;

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
  return fault?.reason?.trim() || fault?.description?.trim() || "故障记录";
});

const repairFaultDescription = computed(() => {
  const fault = selectedFault.value;
  const reason = fault?.reason?.trim() || "";
  const description = fault?.description?.trim() || "";
  return reason && description && reason !== description ? description : "";
});

const repairFaultStatusTone = computed(() => statusTone(selectedFault.value?.is_closed ? "completed" : "repair"));
const repairFaultStatusLabel = computed(() => selectedFault.value?.is_closed ? "已关闭" : "未关闭");
const repairCanManage = computed(() => props.assetContext.can("faults.manage"));
const repairReadOnly = computed(() => Boolean(selectedFault.value?.is_closed) || !repairCanManage.value);
const repairCanSubmit = computed(() => Boolean(selectedFault.value && !repairReadOnly.value));
const repairDialogTitle = computed(() => {
  if (!selectedFault.value) return "维修记录";
  if (selectedFault.value.is_closed) return "查看维修结果";
  return selectedFault.value.repair ? "处理维修" : "开始维修";
});
const repairDialogDescription = computed(() => {
  if (selectedFault.value?.is_closed) return "查看故障信息、维修过程和完成结果";
  if (!repairCanManage.value) return "查看当前故障和维修记录";
  return "补充维修过程；填写完成时间后将关闭该故障";
});

const faultFormRef = ref<FormInstance>();
const repairFormRef = ref<FormInstance>();
const faultFormRules: FormRules = {
  asset: [{ required: true, message: "请选择关联资产", trigger: "change" }],
  occurred_at: [{ required: true, message: "请选择故障发生时间", trigger: "change" }],
};
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
const repairFormRules: FormRules = {
  started_at: [repairTimeRule],
  finished_at: [repairTimeRule],
};
const repairSubmitLabel = computed(() => {
  if (!selectedFault.value?.repair) return "开始维修";
  return repairForm.value.finished_at.trim() ? "完成维修" : "保存维修";
});

const licenseFormRef = ref<FormInstance>();
const licenseFormRules: FormRules = {
  name: [{ required: true, message: "请输入软件名称", trigger: "blur" }],
  authorized_count: [
    { required: true, message: "请输入授权数", trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        if (!/^\d+$/.test(String(value ?? "").trim())) {
          callback(new Error("授权数必须是大于等于 0 的整数"));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
  used_count: [
    { required: true, message: "请输入已用数", trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        const used = String(value ?? "").trim();
        const authorized = String(licenseForm.value.authorized_count ?? "").trim();
        if (!/^\d+$/.test(used)) {
          callback(new Error("已用数必须是大于等于 0 的整数"));
          return;
        }
        if (/^\d+$/.test(authorized) && Number(used) > Number(authorized)) {
          callback(new Error("已用数不能超过授权数"));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
};

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

function formatRepairDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN");
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
    ? "厂商"
    : dictionarySection.value === "device-types"
      ? "类型"
      : "备件类型",
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
  roleName,
  userIsActive,
  lastLogin,
  saveProfile,
} = props.auth;

const usernameEditHelp = "编辑时用户名不可修改，密码请从“更多”中单独重置。";
const roleHelp = "每个账号只分配一个预设角色。";
const dictionaryStatusHelp = "已被资产使用的字典项不能删除，只能停用。";
const usedCountHelp = "已用授权数不能超过授权数。";
const expiryDateHelp = "不填写到期日期表示长期有效。";
const userResetPasswordHelp = "重置后该用户下次登录需要使用新密码。";
const repairFinishedAtHelp = "填写完成时间后故障自动关闭；清空完成时间会重新打开故障，其他维修记录会保留。";
const passwordChangeHelp = computed(() => `新密码至少 8 位。${passwordChangeRequired.value ? "首次登录必须完成修改后才能进入系统。" : ""}`);

const dictionaryFormRef = ref<FormInstance>();
const dataCenterFormRef = ref<FormInstance>();
const roomFormRef = ref<FormInstance>();
const passwordFormRef = ref<FormInstance>();
const profileFormRef = ref<FormInstance>();

const dictionaryFormRules = computed<FormRules>(() => ({
  name: [
    { required: true, whitespace: true, message: "请输入名称", trigger: "blur" },
    {
      max: dictionarySection.value === "device-types" ? 80 : 120,
      message: dictionarySection.value === "device-types" ? "设备类型名称不能超过 80 个字符" : "名称不能超过 120 个字符",
      trigger: "blur",
    },
  ],
  code: dictionarySection.value === "manufacturers"
    ? [{ max: 80, message: "厂商编码不能超过 80 个字符", trigger: "blur" }]
    : dictionarySection.value === "spare-categories"
      ? [
          { required: true, whitespace: true, message: "请输入备件类型编码", trigger: "blur" },
          { max: 80, message: "备件类型编码不能超过 80 个字符", trigger: "blur" },
        ]
      : [],
  color: dictionarySection.value === "device-types"
    ? [{ pattern: /^#[0-9A-Fa-f]{6}$/, message: "颜色必须是六位十六进制值，例如 #1677EF", trigger: ["blur", "change"] }]
    : [],
}));

const dataCenterFormRules: FormRules = {
  name: [
    { required: true, whitespace: true, message: "请输入数据中心名称", trigger: "blur" },
    { max: 120, message: "数据中心名称不能超过 120 个字符", trigger: "blur" },
  ],
  address: [{ max: 255, message: "地址不能超过 255 个字符", trigger: "blur" }],
};

const roomFormRules: FormRules = {
  data_center: [{ required: true, message: "请选择数据中心", trigger: "change" }],
  name: [
    { required: true, whitespace: true, message: "请输入机房名称", trigger: "blur" },
    { max: 120, message: "机房名称不能超过 120 个字符", trigger: "blur" },
  ],
  owner_name: [{ max: 120, message: "负责人不能超过 120 个字符", trigger: "blur" }],
  contact_phone: [{ max: 50, message: "联系方式不能超过 50 个字符", trigger: "blur" }],
};

const passwordFormRules: FormRules = {
  old_password: [{ required: true, message: "请输入原密码", trigger: "blur" }],
  new_password: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        const password = String(value || "");
        if (password && password.length < 8) callback(new Error("新密码至少需要 8 位"));
        else callback();
      },
      trigger: ["blur", "change"],
    },
  ],
  confirm_password: [
    { required: true, message: "请确认新密码", trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        if (String(value || "") !== String(passwordForm.value.new_password || "")) {
          callback(new Error("两次输入的新密码不一致"));
        } else {
          callback();
        }
      },
      trigger: ["blur", "change"],
    },
  ],
};

const profileFormRules: FormRules = {
  first_name: [{ max: 150, message: "名不能超过 150 个字符", trigger: ["blur", "change"] }],
  last_name: [{ max: 150, message: "姓不能超过 150 个字符", trigger: ["blur", "change"] }],
  email: [{ type: "email", message: "请输入有效邮箱", trigger: ["blur", "change"] }],
};

function formatProfileDateTime(value: string | null) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
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
    :title="editingUser ? '编辑用户' : '新增用户'"
    description="维护账号信息、角色和状态"
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
        <h3 class="form-dialog__section-title">账号信息</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="用户名" prop="username" required :error="userFormErrors.username">
            <el-input v-model="userForm.username" :disabled="!!editingUser" autocomplete="username" :validate-event="false" :prefix-icon="Edit" placeholder="请输入用户名" />
            <FieldHelp v-if="editingUser" :text="usernameEditHelp" />
          </el-form-item>
          <el-form-item label="邮箱" prop="email" :error="userFormErrors.email">
            <el-input v-model="userForm.email" type="email" autocomplete="email" :validate-event="false" :prefix-icon="Message" placeholder="请输入邮箱（可选）" />
          </el-form-item>
          <el-form-item label="姓" prop="last_name" required :error="userFormErrors.last_name">
            <el-input v-model="userForm.last_name" autocomplete="family-name" :validate-event="false" :prefix-icon="Edit" placeholder="请输入姓" />
          </el-form-item>
          <el-form-item label="名" prop="first_name" required :error="userFormErrors.first_name">
            <el-input v-model="userForm.first_name" autocomplete="given-name" :validate-event="false" :prefix-icon="Edit" placeholder="请输入名" />
          </el-form-item>
        </div>
      </section>
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">角色与状态</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="角色" prop="role_code" required :error="userFormErrors.role_code">
            <el-select v-model="userForm.role_code" class="user-account-role" placeholder="请选择角色" :validate-event="false" :disabled="!!editingUser && !canChangeUserRole(editingUser)">
              <template #prefix><el-icon><User /></el-icon></template>
              <el-option v-for="role in roles" :key="role.id" :label="role.name" :value="role.code" />
            </el-select>
            <FieldHelp :text="roleHelp" />
          </el-form-item>
          <el-form-item label="账号状态" class="user-account-status">
            <el-select v-model="userForm.is_active" :disabled="!!editingUser && !canChangeUserRole(editingUser)" aria-label="账号状态">
              <el-option label="启用" :value="true" />
              <el-option label="停用" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
      <section v-if="!editingUser" class="form-dialog__section">
        <h3 class="form-dialog__section-title">初始密码</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="初始密码" prop="password" required :error="userFormErrors.password">
            <el-input v-model="userForm.password" type="password" show-password autocomplete="new-password" :validate-event="false" :prefix-icon="Lock" placeholder="请输入密码（至少 8 位）" />
          </el-form-item>
          <el-form-item label="确认密码" prop="confirm_password" required>
            <el-input v-model="userForm.confirm_password" type="password" show-password autocomplete="new-password" :validate-event="false" :prefix-icon="Lock" placeholder="请再次输入密码" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="userSaving" @click="showUserModal = false">取消</el-button>
      <el-button type="primary" :loading="userSaving" :disabled="userSaving" @click="saveUser">保存用户</el-button>
    </template>
  </FormDialogShell>

  <ActionDialogShell
    v-model="showUserResetModal"
    title="重置用户密码"
    description="为指定用户设置新的登录密码"
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
      :title="`为 ${resettingUser.display_name || resettingUser.username} 设置新密码`"
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
        <h3 class="form-dialog__section-title">密码信息</h3>
        <el-form-item label="新密码" prop="new_password" :error="userResetFormErrors.new_password">
          <el-input v-model="userResetForm.new_password" type="password" show-password autocomplete="new-password" />
          <FieldHelp :text="userResetPasswordHelp" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirm_password" :error="userResetFormErrors.confirm_password">
          <el-input v-model="userResetForm.confirm_password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="userResetSaving" @click="showUserResetModal = false">取消</el-button>
      <el-button type="primary" :loading="userResetSaving" :disabled="userResetSaving" @click="submitUserReset">保存密码</el-button>
    </template>
  </ActionDialogShell>

  <FormDialogShell
    v-model="showProfileModal"
    title="个人设置"
    description="查看账号信息并更新个人资料"
    size="small"
    :loading="profileLoading"
    :show-close="!profileSaving"
    :close-on-click-modal="!profileSaving"
    :close-on-press-escape="!profileSaving"
    :close-disabled="profileSaving"
  >
    <div v-if="profileError" class="settings-state settings-state--error profile-state" role="alert">
      <div class="settings-state__copy"><strong>个人资料加载失败</strong><span>{{ profileError }}</span></div>
      <el-button type="primary" plain :loading="profileLoading" @click="loadProfile">重试</el-button>
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
        <h3 class="form-dialog__section-title">账号信息</h3>
        <div class="profile-readonly-grid">
          <div><span>用户名</span><strong>{{ username }}</strong></div>
          <div><span>角色</span><strong>{{ roleName || "—" }}</strong></div>
          <div><span>账号状态</span><strong>{{ userIsActive ? "启用" : "停用" }}</strong></div>
          <div><span>最后登录</span><strong>{{ formatProfileDateTime(lastLogin) }}</strong></div>
        </div>
      </section>
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">个人资料</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="姓" prop="last_name" :error="profileFormErrors.last_name">
            <el-input v-model="profileForm.last_name" autocomplete="family-name" maxlength="150" />
          </el-form-item>
          <el-form-item label="名" prop="first_name" :error="profileFormErrors.first_name">
            <el-input v-model="profileForm.first_name" autocomplete="given-name" maxlength="150" />
          </el-form-item>
          <el-form-item label="邮箱" prop="email" :error="profileFormErrors.email">
            <el-input v-model="profileForm.email" type="email" autocomplete="email" maxlength="254" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="profileSaving" @click="showProfileModal = false">取消</el-button>
      <el-button v-if="!profileError" type="primary" :loading="profileSaving" :disabled="profileSaving" @click="submitProfile">保存资料</el-button>
    </template>
  </FormDialogShell>

  <FormDialogShell
    v-model="showDictionaryModal"
    :title="`${editingDictionary ? '编辑' : '新增'}${dictionaryDialogLabel}`"
    :description="dictionarySection === 'manufacturers' ? '' : '维护字典名称、显示状态及业务属性'"
    size="small"
    :saving="dictionarySaving"
    :show-close="!dictionarySaving"
    :close-on-click-modal="!dictionarySaving"
    :close-on-press-escape="!dictionarySaving"
    :close-disabled="dictionarySaving"
  >
    <el-form ref="dictionaryFormRef" class="horizontal-form" :model="dictionaryForm" :rules="dictionaryFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitDictionary">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">基本信息</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="currentDictionaryLabel + '名称'" prop="name" required :error="dictionaryFormErrors.name">
            <el-input v-model="dictionaryForm.name" :maxlength="dictionarySection === 'device-types' ? 80 : 120" />
          </el-form-item>
          <el-form-item v-if="dictionarySection === 'manufacturers'" label="厂商编码" prop="code" :error="dictionaryFormErrors.code">
            <el-input v-model="dictionaryForm.code" maxlength="80" />
          </el-form-item>
          <el-form-item v-if="dictionarySection === 'spare-categories'" label="类型编码" prop="code" :error="dictionaryFormErrors.code">
            <el-input v-model="dictionaryForm.code" maxlength="80" />
          </el-form-item>
          <el-form-item v-if="dictionarySection === 'device-types'" label="类型颜色" prop="color" :error="dictionaryFormErrors.color">
            <div class="color-input">
              <el-color-picker v-model="dictionaryForm.color" />
              <el-input v-model="dictionaryForm.color" maxlength="7" />
            </div>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="dictionaryForm.is_active" aria-label="状态">
              <el-option label="启用" :value="true" />
              <el-option label="停用" :value="false" />
            </el-select>
            <FieldHelp :text="dictionaryStatusHelp" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="dictionarySaving" @click="showDictionaryModal = false">取消</el-button>
      <el-button type="primary" :loading="dictionarySaving" :disabled="dictionarySaving" @click="submitDictionary">保存{{ dictionaryDialogLabel }}</el-button>
    </template>
  </FormDialogShell>

  <FormDialogShell
    v-model="showLicenseModal"
    :title="editingLicense ? '编辑许可' : '新增许可'"
    description="维护许可额度、到期日期和备注"
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
        <h3 class="form-dialog__section-title">基本信息</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="软件名称" prop="name" required>
            <el-input v-model="licenseForm.name" maxlength="160" :validate-event="false" />
          </el-form-item>
          <el-form-item label="授权数" prop="authorized_count" required>
            <el-input-number v-model="authorizedCountValue" :min="0" :step="1" :precision="0" :value-on-clear="null" aria-label="授权数">
              <template #suffix>个</template>
            </el-input-number>
          </el-form-item>
          <el-form-item label="已用数" prop="used_count" required>
            <el-input-number v-model="usedCountValue" :min="0" :step="1" :precision="0" :value-on-clear="null" aria-label="已用数">
              <template #suffix>个</template>
            </el-input-number>
            <FieldHelp :text="usedCountHelp" />
          </el-form-item>
          <el-form-item label="厂商" prop="manufacturer_id">
            <el-select v-model="licenseForm.manufacturer_id" clearable filterable placeholder="未关联厂商" :validate-event="false">
              <el-option
                v-for="manufacturer in licenseManufacturerOptions"
                :key="manufacturer.id"
                :label="manufacturer.is_active ? manufacturer.name : `${manufacturer.name}（已停用）`"
                :value="String(manufacturer.id)"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="许可类型" prop="license_type">
            <el-input v-model="licenseForm.license_type" maxlength="80" placeholder="如：按核心、按用户" :validate-event="false" />
          </el-form-item>
          <el-form-item label="到期日期" prop="expiry_date">
            <el-date-picker v-model="licenseForm.expiry_date" type="date" value-format="YYYY-MM-DD" :validate-event="false" />
            <FieldHelp :text="expiryDateHelp" />
          </el-form-item>
          <el-form-item label="备注" prop="notes">
            <el-input v-model="licenseForm.notes" type="textarea" :rows="3" :validate-event="false" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="licenseSaving" @click="showLicenseModal = false">取消</el-button>
      <el-button type="primary" :loading="licenseSaving" :disabled="licenseSaving" @click="submitLicense">保存许可</el-button>
    </template>
  </FormDialogShell>

  <ActionDialogShell
    v-model="showPasswordModal"
    :title="passwordChangeRequired ? '首次登录请修改密码' : '修改密码'"
    description="更新当前账号的登录密码"
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
        <h3 class="form-dialog__section-title">密码信息</h3>
        <el-form-item label="原密码" prop="old_password" required :error="passwordFormErrors.old_password"><el-input v-model="passwordForm.old_password" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item label="新密码" prop="new_password" required :error="passwordFormErrors.new_password">
          <el-input v-model="passwordForm.new_password" type="password" show-password autocomplete="new-password" />
          <FieldHelp :text="passwordChangeHelp" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirm_password" required :error="passwordFormErrors.confirm_password"><el-input v-model="passwordForm.confirm_password" type="password" show-password autocomplete="new-password" /></el-form-item>
      </section>
    </el-form>
    <template #footer>
      <el-button v-if="!passwordChangeRequired" :disabled="passwordSaving" @click="showPasswordModal = false">取消</el-button>
      <el-button type="primary" :loading="passwordSaving" :disabled="passwordSaving" @click="submitPassword">保存密码</el-button>
    </template>
  </ActionDialogShell>

  <FormDialogShell
    v-model="showFaultModal"
    title="新增故障"
    description="记录故障资产、发生时间和故障现象"
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
        <el-form-item label="关联资产" prop="asset" required :validate-event="false">
          <AssetSelect
            v-model="faultForm.asset"
            :request="request"
            :selected-asset="faultSelectedAsset"
            placeholder="输入资产编号、名称或序列号搜索"
          />
        </el-form-item>
        <el-form-item label="发生时间" prop="occurred_at" required :validate-event="false"><el-date-picker v-model="faultForm.occurred_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" /></el-form-item>
        <el-form-item label="故障原因"><el-input v-model="faultForm.reason" placeholder="如：设备宕机、磁盘故障" /></el-form-item>
        <el-form-item label="故障描述"><el-input v-model="faultForm.description" type="textarea" :rows="4" placeholder="描述故障现象和影响" /></el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button :disabled="faultSaving" @click="showFaultModal = false">取消</el-button>
      <el-button type="primary" :loading="faultSaving" :disabled="faultSaving" @click="submitFault">保存故障</el-button>
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
            <span class="repair-action-context__label">故障</span>
            <strong :title="repairFaultSummary">{{ repairFaultSummary }}</strong>
          </div>
          <StatusTag :tone="repairFaultStatusTone" :label="repairFaultStatusLabel" />
        </div>
        <div class="repair-action-context__meta">
          发生时间：{{ formatRepairDateTime(selectedFault.occurred_at) }}
        </div>
        <p v-if="repairFaultDescription" class="repair-action-context__description">{{ repairFaultDescription }}</p>
      </div>
      <AssetSummary v-if="repairAssetSummary" :asset="repairAssetSummary" compact :show-status="true" :show-location="true" />
      <el-form-item label="维修服务商"><el-input v-model="repairForm.provider" :readonly="repairReadOnly" placeholder="请输入维修服务商" /></el-form-item>
      <el-form-item label="维修开始时间" prop="started_at"><el-date-picker v-model="repairForm.started_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" :disabled="repairReadOnly" /></el-form-item>
      <el-form-item label="维修完成时间" prop="finished_at">
        <el-date-picker v-model="repairForm.finished_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" :disabled="repairReadOnly" />
        <FieldHelp v-if="!repairReadOnly" :text="repairFinishedAtHelp" />
      </el-form-item>
      <el-form-item label="维修备注"><el-input v-model="repairForm.notes" type="textarea" :rows="4" :readonly="repairReadOnly" placeholder="记录维修过程、结果或其他说明" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="repairSaving" @click="showRepairModal = false">{{ repairReadOnly ? "关闭" : "取消" }}</el-button>
      <el-button v-if="repairCanSubmit" type="primary" :loading="repairSaving" :disabled="repairSaving" @click="submitRepair">{{ repairSubmitLabel }}</el-button>
    </template>
  </ActionDialogShell>

  <ActionDialogShell
    v-model="showImportDialog"
    title="资产批量导入"
    description="上传、预校验并确认导入资产台账"
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
      <el-step title="上传文件" />
      <el-step title="预览确认" />
      <el-step title="导入结果" />
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
        <div class="asset-import-upload__title">拖拽 .xlsx 或 .csv 文件到此处</div>
        <div class="asset-import-upload__hint">或点击选择文件，上传后由服务端执行完整校验</div>
      </el-upload>
      <div v-if="importFile" class="asset-import-file-bar">
        <div>
          <strong>{{ importFile.name }}</strong>
          <span>{{ (importFile.size / 1024 / 1024).toFixed(2) }} MB</span>
        </div>
        <el-button link type="primary" :disabled="importPreviewing || importing" @click="chooseAnotherImportFile">重新选择</el-button>
      </div>
      <div class="asset-import-upload__actions">
        <el-button link type="primary" :disabled="importPreviewing || importing" @click="downloadImportTemplate">下载导入模板</el-button>
        <span>模板包含字段说明和当前启用的自定义字段列</span>
      </div>
    </template>

    <template v-else-if="importStep === 'preview' && importPreview">
      <div class="asset-import-file-bar">
        <div>
          <strong>{{ importFile?.name || importPreview.filename }}</strong>
          <span v-if="importFile">{{ (importFile.size / 1024 / 1024).toFixed(2) }} MB</span>
        </div>
        <el-button link type="primary" :disabled="importPreviewing || importing" @click="chooseAnotherImportFile">重新选择</el-button>
      </div>
      <el-alert title="资产导入只支持新增；已存在编号、重复编号或任意异常行都会阻止整批确认。" type="info" :closable="false" show-icon />
      <div class="import-preview-summary">
        <StatusTag tone="info" :label="`共 ${importPreview.total} 行`" />
        <StatusTag tone="success" :label="`可导入 ${importPreview.valid} 行`" />
        <StatusTag tone="danger" :label="`异常 ${importPreview.invalid} 行`" />
        <el-radio-group v-model="importPreviewFilter" size="small" class="import-preview-filter">
          <el-radio-button label="all">全部</el-radio-button>
          <el-radio-button label="errors">仅看异常</el-radio-button>
        </el-radio-group>
      </div>
      <el-table class="action-dialog__table" :data="filteredImportRows" border stripe max-height="460" row-key="line" empty-text="没有符合当前筛选的行">
        <el-table-column prop="line" label="Excel 行号" width="88" />
        <el-table-column prop="asset_no" label="资产编号" min-width="150" />
        <el-table-column prop="name" label="设备名称" min-width="170" />
        <el-table-column prop="device_type" label="设备类型" min-width="120" />
        <el-table-column prop="location" label="位置" min-width="220" />
        <el-table-column prop="depreciation" label="折旧配置" min-width="230" />
        <el-table-column label="校验结果" width="112" fixed="right">
          <template #default="{ row }">
            <StatusTag :tone="row.valid ? 'success' : 'danger'" :label="row.valid ? '可导入' : '异常'" />
          </template>
        </el-table-column>
        <el-table-column label="异常详情" min-width="300">
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
          :title="importResult.errors.length ? '导入完成，存在失败明细' : '导入完成'"
          :sub-title="importResult.errors.length
            ? `成功导入 ${importResult.created} 条资产，另有 ${importResult.errors.length} 条失败。`
            : `成功导入 ${importResult.created} 条资产，本次为原子提交。`"
        />
        <el-alert
          v-if="assetListError"
          type="warning"
          :closable="false"
          show-icon
          title="导入已完成，但资产台账刷新失败，请重新加载。"
          :description="assetListError"
        />
        <div v-if="importResult.errors.length" class="import-error-list">
          <p v-for="item in importResult.errors" :key="item.line"><strong>第{{ item.line }}行：</strong>{{ importErrorText(item.detail) }}</p>
        </div>
      </section>
    </template>

    <template #footer>
      <el-button v-if="importStep !== 'result'" :disabled="importPreviewing || importing" @click="closeImportDialog">取消</el-button>
      <el-button v-if="importStep === 'preview'" type="primary" :loading="importing" :disabled="!importPreview?.valid || !!importPreview?.invalid || importPreviewing" @click="confirmImportPreview">确认导入</el-button>
      <el-button v-else-if="importStep === 'result'" type="primary" @click="closeImportDialog">完成</el-button>
    </template>
  </ActionDialogShell>

  <FormDialogShell
    v-model="showDataCenterModal"
    :title="editingDataCenter ? '编辑数据中心' : '新增数据中心'"
    description="维护数据中心名称、地址和状态"
    size="medium"
    :saving="dataCenterSaving"
    :show-close="!dataCenterSaving"
    :close-on-click-modal="!dataCenterSaving"
    :close-on-press-escape="!dataCenterSaving"
    :close-disabled="dataCenterSaving"
  >
    <el-form ref="dataCenterFormRef" class="horizontal-form" :model="dataCenterForm" :rules="dataCenterFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitDataCenter">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">基本信息</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="数据中心名称" prop="name" required :error="dataCenterFormErrors.name"><el-input v-model="dataCenterForm.name" maxlength="120" /></el-form-item>
          <el-form-item label="地址" prop="address" :error="dataCenterFormErrors.address"><el-input v-model="dataCenterForm.address" maxlength="255" /></el-form-item>
          <el-form-item label="状态">
            <el-select v-model="dataCenterForm.is_active" aria-label="状态">
              <el-option label="启用" :value="true" />
              <el-option label="停用" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="dataCenterSaving" @click="showDataCenterModal = false">取消</el-button>
      <el-button type="primary" :loading="dataCenterSaving" :disabled="dataCenterSaving" @click="submitDataCenter">保存数据中心</el-button>
    </template>
  </FormDialogShell>

  <FormDialogShell
    v-model="showRoomModal"
    :title="editingRoom ? '编辑机房' : '新增机房'"
    description="维护机房位置、负责人和状态"
    size="medium"
    :saving="roomSaving"
    :show-close="!roomSaving"
    :close-on-click-modal="!roomSaving"
    :close-on-press-escape="!roomSaving"
    :close-disabled="roomSaving"
  >
    <el-form ref="roomFormRef" class="horizontal-form" :model="roomForm" :rules="roomFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitRoom">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">基本信息</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="数据中心" prop="data_center" required :error="roomFormErrors.data_center">
            <el-select v-model="roomForm.data_center" placeholder="请选择数据中心">
              <el-option
                v-for="center in dataCenters"
                :key="center.id"
                :label="center.is_active ? center.name : `${center.name}（停用）`"
                :value="String(center.id)"
                :disabled="!center.is_active && String(center.id) !== roomForm.data_center"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="机房名称" prop="name" required :error="roomFormErrors.name"><el-input v-model="roomForm.name" maxlength="120" /></el-form-item>
          <el-form-item label="负责人" prop="owner_name" :error="roomFormErrors.owner_name"><el-input v-model="roomForm.owner_name" maxlength="120" /></el-form-item>
          <el-form-item label="联系电话" prop="contact_phone" :error="roomFormErrors.contact_phone"><el-input v-model="roomForm.contact_phone" maxlength="50" /></el-form-item>
          <el-form-item label="备注" :error="roomFormErrors.notes"><el-input v-model="roomForm.notes" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="状态">
            <el-select v-model="roomForm.is_active" aria-label="状态">
              <el-option label="启用" :value="true" />
              <el-option label="停用" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="roomSaving" @click="showRoomModal = false">取消</el-button>
      <el-button type="primary" :loading="roomSaving" :disabled="roomSaving" @click="submitRoom">保存机房</el-button>
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
    @edit="editCurrentAsset"
    @closed="detailAsset = null"
  />
</template>
