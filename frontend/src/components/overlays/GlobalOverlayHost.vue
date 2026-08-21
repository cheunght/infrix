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
import SearchField from "../SearchField.vue";
import type { AssetDetail, Page } from "../../types";
import type { AssetFormContext, PageContext } from "../../types/page-context";

type AssetsState = ReturnType<typeof useAssets>;
type FacilitiesState = ReturnType<typeof useFacilities>;
type LicensesState = ReturnType<typeof useLicenses>;
type RepairsState = ReturnType<typeof useRepairs>;
type SettingsState = ReturnType<typeof useSettings>;

const props = defineProps<{
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
    showPasswordModal: Ref<boolean>;
    passwordChangeRequired: Ref<boolean>;
    passwordForm: Ref<{ old_password: string; new_password: string }>;
    changePassword: () => void | Promise<void>;
  };
}>();

const assetContext: AssetFormContext = props.assetContext;
const {
  page,
  showAssetDetail,
  detailAsset,
  detailLoading,
  detailError,
} = props.assetDetail;

const {
  showImportResult,
  importResult,
  copyImportErrors,
  downloadImportErrors,
  importErrorText,
  showImportPreview,
  importPreview,
  cancelImportPreview,
  confirmImportPreview,
  openAssetEditor,
  retryAssetDetail,
} = props.assets;

const {
  showDataCenterModal,
  editingDataCenter,
  dataCenterForm,
  saveDataCenter,
  showRoomModal,
  editingRoom,
  roomForm,
  dataCenters,
  saveRoom,
} = props.facilities;

const {
  showLicenseModal,
  editingLicense,
  licenseForm,
  licenseSaving,
  saveLicense,
} = props.licenses;

const {
  showFaultModal,
  faultAssetSearch,
  faultAssetLoading,
  searchFaultAssets,
  faultAssetOptions,
  faultForm,
  faultSaving,
  createFault,
  showRepairModal,
  selectedFault,
  repairForm,
  repairSaving,
  saveRepair,
} = props.repairs;

const faultFormRef = ref<FormInstance>();
const repairFormRef = ref<FormInstance>();
const faultFormRules: FormRules = {
  asset: [{ required: true, message: "请选择故障资产", trigger: "change" }],
  occurred_at: [{ required: true, message: "请选择故障发生时间", trigger: "change" }],
};

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
  const valid = await repairFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveRepair();
}

const {
  showUserModal,
  editingUser,
  userForm,
  userFormRef,
  userFormRules,
  roles,
  saveUser,
  showRoleModal,
  editingRole,
  roleForm,
  saveRole,
  showDictionaryModal,
  editingDictionary,
  currentDictionaryLabel,
  dictionarySection,
  dictionaryForm,
  saveDictionary,
} = props.settings;

const {
  showPasswordModal,
  passwordChangeRequired,
  passwordForm,
  changePassword,
} = props.auth;

const canEditAsset = computed(() => props.assetContext.can("assets.manage"));

function editCurrentAsset() {
  const assetId = detailAsset.value?.id;
  if (assetId) void openAssetEditor(assetId);
}
</script>

<template>
  <AssetFormDialog :context="assetContext" />

  <el-dialog
    v-model="showUserModal"
    :title="editingUser ? '编辑用户' : '新增用户'"
    class="user-account-dialog"
    width="660px"
    destroy-on-close
  >
    <el-form
      ref="userFormRef"
      class="user-account-form"
      :model="userForm"
      :rules="userFormRules"
      :validate-on-rule-change="false"
      label-position="left"
      label-width="88px"
      @submit.prevent="saveUser"
    >
      <el-form-item label="用户名" prop="username" required>
        <el-input
          v-model="userForm.username"
          :disabled="!!editingUser"
          autocomplete="username"
          :validate-event="false"
          :prefix-icon="Edit"
          placeholder="请输入用户名"
        />
      </el-form-item>
      <el-form-item label="姓" prop="last_name" required>
        <el-input
          v-model="userForm.last_name"
          autocomplete="family-name"
          :validate-event="false"
          :prefix-icon="Edit"
          placeholder="请输入姓"
        />
      </el-form-item>
      <el-form-item label="名" prop="first_name" required>
        <el-input
          v-model="userForm.first_name"
          autocomplete="given-name"
          :validate-event="false"
          :prefix-icon="Edit"
          placeholder="请输入名"
        />
      </el-form-item>
      <el-form-item label="邮箱" prop="email">
        <el-input
          v-model="userForm.email"
          type="email"
          autocomplete="email"
          :validate-event="false"
          :prefix-icon="Message"
          placeholder="请输入邮箱（可选）"
        />
      </el-form-item>
      <el-form-item label="角色" prop="role_code" required>
        <el-select
          v-model="userForm.role_code"
          class="user-account-role"
          placeholder="请选择角色"
          :validate-event="false"
        >
          <template #prefix><el-icon><User /></el-icon></template>
          <el-option
            v-for="role in roles"
            :key="role.id"
            :label="role.name"
            :value="role.code"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="账号状态" class="user-account-status">
        <el-switch
          v-model="userForm.is_active"
          active-text="启用"
          inactive-text="停用"
        />
      </el-form-item>
      <el-divider class="user-account-divider" />
      <el-form-item
        :label="editingUser ? '重置密码' : '密码'"
        prop="password"
        :required="!editingUser"
      >
        <el-input
          v-model="userForm.password"
          type="password"
          show-password
          autocomplete="new-password"
          :validate-event="false"
          :prefix-icon="Lock"
          :placeholder="editingUser ? '留空表示不修改密码' : '请输入密码（至少 8 位）'"
        />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirm_password" :required="!editingUser">
        <el-input
          v-model="userForm.confirm_password"
          type="password"
          show-password
          autocomplete="new-password"
          :validate-event="false"
          :prefix-icon="Lock"
          placeholder="请再次输入密码"
        />
      </el-form-item>
      <p class="form-hint">每个账号只分配一个预设角色，权限由服务端强制校验。</p>
    </el-form>
    <template #footer>
      <el-button @click="showUserModal = false">取消</el-button>
      <el-button type="primary" @click="saveUser">保存用户</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showRoleModal"
    :title="editingRole ? '编辑角色' : '新增角色'"
    width="420px"
    destroy-on-close
  >
    <el-form label-position="top">
      <el-form-item label="角色名称" required>
        <el-input v-model="roleForm.name" maxlength="150" />
      </el-form-item>
      <p class="form-hint">角色可分配给用户，后续可在 Django 权限组中配置具体权限。</p>
    </el-form>
    <template #footer>
      <el-button @click="showRoleModal = false">取消</el-button>
      <el-button type="primary" @click="saveRole">保存角色</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showDictionaryModal"
    :title="`${editingDictionary ? '编辑' : '新增'}${currentDictionaryLabel}`"
    width="420px"
    destroy-on-close
  >
    <el-form label-position="top">
      <el-form-item :label="`${currentDictionaryLabel}名称`" required>
        <el-input v-model="dictionaryForm.name" maxlength="120" />
      </el-form-item>
      <el-form-item v-if="dictionarySection === 'device-types'" label="类型颜色">
        <div class="color-input">
          <el-color-picker v-model="dictionaryForm.color" />
          <el-input v-model="dictionaryForm.color" />
        </div>
      </el-form-item>
      <el-checkbox v-model="dictionaryForm.is_active">启用</el-checkbox>
      <p class="form-hint">已被资产使用的字典项不能删除，只能停用。</p>
    </el-form>
    <template #footer>
      <el-button @click="showDictionaryModal = false">取消</el-button>
      <el-button type="primary" @click="saveDictionary">保存{{ currentDictionaryLabel }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showLicenseModal"
    :title="editingLicense ? '编辑许可证' : '新增许可证'"
    width="520px"
    destroy-on-close
    :show-close="!licenseSaving"
    :close-on-click-modal="!licenseSaving"
    :close-on-press-escape="!licenseSaving"
    @open="clearLicenseValidation"
  >
    <el-form
      ref="licenseFormRef"
      :model="licenseForm"
      :rules="licenseFormRules"
      label-position="top"
      :validate-on-rule-change="false"
      @submit.prevent="submitLicense"
    >
      <el-form-item label="软件名称" prop="name" required>
        <el-input v-model="licenseForm.name" maxlength="160" :validate-event="false" />
      </el-form-item>
      <el-form-item label="厂商" prop="vendor">
        <el-input v-model="licenseForm.vendor" maxlength="120" :validate-event="false" />
      </el-form-item>
      <el-form-item label="许可类型" prop="license_type">
        <el-input v-model="licenseForm.license_type" maxlength="80" placeholder="如：按核心、按用户" :validate-event="false" />
      </el-form-item>
      <div class="form-grid license-form-grid">
        <el-form-item label="授权数" prop="authorized_count" required>
          <el-input v-model="licenseForm.authorized_count" type="number" min="0" :validate-event="false" />
        </el-form-item>
        <el-form-item label="已用数" prop="used_count" required>
          <el-input v-model="licenseForm.used_count" type="number" min="0" :validate-event="false" />
        </el-form-item>
      </div>
      <el-form-item label="到期日期" prop="expiry_date">
        <el-date-picker v-model="licenseForm.expiry_date" type="date" value-format="YYYY-MM-DD" :validate-event="false" />
      </el-form-item>
      <el-form-item label="备注" prop="notes">
        <el-input v-model="licenseForm.notes" type="textarea" :rows="3" :validate-event="false" />
      </el-form-item>
      <p class="form-hint">已用授权数不能超过授权数；不填写到期日期表示长期有效。</p>
    </el-form>
    <template #footer>
      <el-button :disabled="licenseSaving" @click="showLicenseModal = false">取消</el-button>
      <el-button type="primary" :loading="licenseSaving" :disabled="licenseSaving" @click="submitLicense">保存许可证</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showPasswordModal"
    :title="passwordChangeRequired ? '首次登录请修改密码' : '修改密码'"
    width="420px"
    destroy-on-close
    :show-close="!passwordChangeRequired"
    :close-on-click-modal="!passwordChangeRequired"
    :close-on-press-escape="!passwordChangeRequired"
  >
    <el-form label-position="top">
      <el-form-item label="原密码" required><el-input v-model="passwordForm.old_password" type="password" show-password /></el-form-item>
      <el-form-item label="新密码" required><el-input v-model="passwordForm.new_password" type="password" show-password /></el-form-item>
      <p class="form-hint">新密码至少 8 位。{{ passwordChangeRequired ? '首次登录必须完成修改后才能进入系统。' : '' }}</p>
    </el-form>
    <template #footer>
      <el-button v-if="!passwordChangeRequired" @click="showPasswordModal = false">取消</el-button>
      <el-button type="primary" @click="changePassword">保存密码</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="showFaultModal" title="登记故障" width="560px" destroy-on-close :close-on-click-modal="!faultSaving" :close-on-press-escape="!faultSaving">
    <el-form ref="faultFormRef" :model="faultForm" :rules="faultFormRules" label-position="top" :validate-on-rule-change="false">
      <el-form-item label="搜索资产">
        <SearchField
          class="itam-filter-search"
          v-model="faultAssetSearch"
          placeholder="输入资产编号、名称或序列号"
          aria-label="搜索故障资产"
          :loading="faultAssetLoading"
          @search="searchFaultAssets"
        />
      </el-form-item>
      <el-form-item label="资产" prop="asset" required :validate-event="false">
        <el-select v-model="faultForm.asset" placeholder="请选择搜索结果">
          <el-option
            v-for="asset in faultAssetOptions"
            :key="asset.id"
            :label="`${asset.asset_no} · ${asset.name}`"
            :value="String(asset.id)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="发生时间" prop="occurred_at" required :validate-event="false"><el-date-picker v-model="faultForm.occurred_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" /></el-form-item>
      <el-form-item label="故障原因"><el-input v-model="faultForm.reason" placeholder="如：设备宕机、磁盘故障" /></el-form-item>
      <el-form-item label="故障描述"><el-input v-model="faultForm.description" type="textarea" :rows="4" placeholder="描述故障现象和影响" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showFaultModal = false">取消</el-button>
      <el-button type="primary" :loading="faultSaving" :disabled="faultSaving" @click="submitFault">保存故障</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showRepairModal"
    :title="selectedFault?.repair ? '编辑维修记录' : '填写维修记录'"
    width="420px"
    destroy-on-close
  >
    <el-form ref="repairFormRef" :model="repairForm" label-position="top" :validate-on-rule-change="false">
      <el-alert
        :title="`${selectedFault?.asset_no || ''} · ${selectedFault?.asset_name || ''}`"
        type="info"
        :closable="false"
      />
      <el-form-item label="维修完成时间"><el-date-picker v-model="repairForm.finished_at" type="datetime" value-format="YYYY-MM-DDTHH:mm" /></el-form-item>
      <p class="form-hint">保存后故障自动关闭；清空完成时间会重新打开故障。</p>
    </el-form>
    <template #footer>
      <el-button @click="showRepairModal = false">取消</el-button>
      <el-button type="primary" :loading="repairSaving" :disabled="repairSaving" @click="submitRepair">保存维修记录</el-button>
    </template>
  </el-dialog>

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
      <el-alert title="重复资产编号不会更新已有资产，错误行和冲突行将在确认导入时跳过。" type="info" :closable="false" show-icon />
      <div class="import-preview-summary">
        <el-tag type="info">共 {{ importPreview.total }} 行</el-tag>
        <el-tag type="success">可导入 {{ importPreview.summary.ready }} 行</el-tag>
        <el-tag type="warning">冲突 {{ importPreview.summary.conflicts }} 行</el-tag>
        <el-tag type="danger">错误 {{ importPreview.summary.errors }} 行</el-tag>
      </div>
      <el-table :data="importPreview.rows" border stripe max-height="480" row-key="line" empty-text="没有可预览的资产">
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
              <div v-for="error in row.errors" :key="`${row.line}-${error.field}-${error.message}`">{{ error.label }}：{{ error.message }}</div>
            </div>
            <span v-if="!row.changes.length && !row.errors.length" class="muted-text">—</span>
          </template>
        </el-table-column>
      </el-table>
    </template>
    <template #footer>
      <el-button @click="cancelImportPreview">取消</el-button>
      <el-button type="primary" :disabled="!importPreview?.summary.ready" @click="confirmImportPreview">确认导入</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="showDataCenterModal" :title="editingDataCenter ? '编辑数据中心' : '新增数据中心'" width="460px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="数据中心名称" required><el-input v-model="dataCenterForm.name" maxlength="120" /></el-form-item>
      <el-form-item label="地址"><el-input v-model="dataCenterForm.address" maxlength="255" /></el-form-item>
      <el-checkbox v-model="dataCenterForm.is_active">启用</el-checkbox>
    </el-form>
    <template #footer>
      <el-button @click="showDataCenterModal = false">取消</el-button>
      <el-button type="primary" @click="saveDataCenter">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="showRoomModal" :title="editingRoom ? '编辑机房' : '新增机房'" width="520px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="数据中心" required>
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
      <el-form-item label="机房名称" required><el-input v-model="roomForm.name" /></el-form-item>
      <div class="form-grid">
        <el-form-item label="负责人"><el-input v-model="roomForm.owner_name" /></el-form-item>
        <el-form-item label="联系电话"><el-input v-model="roomForm.contact_phone" /></el-form-item>
      </div>
      <el-form-item label="备注"><el-input v-model="roomForm.notes" type="textarea" :rows="3" /></el-form-item>
      <el-checkbox v-model="roomForm.is_active">启用</el-checkbox>
    </el-form>
    <template #footer>
      <el-button @click="showRoomModal = false">取消</el-button>
      <el-button type="primary" @click="saveRoom">保存</el-button>
    </template>
  </el-dialog>

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
