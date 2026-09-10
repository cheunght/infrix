<script setup lang="ts">
import { computed, onMounted, proxyRefs, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import { normalizeApiError } from "../error-handling";
import type { PageContext } from "../page-context";
import type { AssetModel, DictionaryItem } from "../types";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import SearchField from "./SearchField.vue";
import PagedTable from "./PagedTable.vue";
import StatusTag from "./StatusTag.vue";
import FormDialogShell from "./FormDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";

const props = defineProps<{ context: PageContext }>();
const { t } = useI18n();
const c = proxyRefs(props.context);

type ModelForm = {
  name: string;
  manufacturer: string;
  device_type: string;
  model_number: string;
  default_warranty_months: number | null;
  expected_life_months: number | null;
  is_active: boolean;
};

const emptyForm = (): ModelForm => ({
  name: "",
  manufacturer: "",
  device_type: "",
  model_number: "",
  default_warranty_months: null,
  expected_life_months: null,
  is_active: true,
});

const rows = ref<AssetModel[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const active = ref("");
const loading = ref(false);
const error = ref("");
const actionId = ref<number | null>(null);
const saving = ref(false);
const showModal = ref(false);
const editing = ref<AssetModel | null>(null);
const form = ref<ModelForm>(emptyForm());
const formErrors = ref<Record<string, string>>({});
const formRef = ref<FormInstance>();
const manufacturers = ref<DictionaryItem[]>([]);
const deviceTypes = ref<DictionaryItem[]>([]);

const canManage = computed(() => c.can("settings.manage"));
const formRules = computed<FormRules>(() => ({
  name: [{ required: true, whitespace: true, message: t("assetModel.nameRequired"), trigger: "blur" }],
  default_warranty_months: [{ validator: (_rule, value, callback) => validateMonths(value, callback), trigger: ["blur", "change"] }],
  expected_life_months: [{ validator: (_rule, value, callback) => validateMonths(value, callback), trigger: ["blur", "change"] }],
}));

function validateMonths(value: unknown, callback: (error?: Error) => void) {
  if (value === null || value === undefined || value === "") return callback();
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return callback(new Error(t("assetModel.monthsInvalid")));
  callback();
}

function monthText(value: number | null | undefined): string {
  return value == null ? t("assetModel.unset") : `${value} ${t("common.months")}`;
}

async function loadReferences() {
  const [manufacturerResult, deviceTypeResult] = await Promise.all([
    c.request<PageResult<DictionaryItem>>("/manufacturers/?page=1&page_size=100&is_active=all"),
    c.request<PageResult<DictionaryItem>>("/device-types/?page=1&page_size=100&is_active=all"),
  ]);
  manufacturers.value = pageItems(manufacturerResult);
  deviceTypes.value = pageItems(deviceTypeResult);
}

async function loadModels() {
  if (!c.can("settings.view")) return;
  loading.value = true;
  error.value = "";
  const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize.value), is_active: active.value || "all" });
  if (search.value.trim()) params.set("search", search.value.trim());
  try {
    const payload = await c.request<PageResult<AssetModel>>(`/asset-models/?${params.toString()}`);
    rows.value = pageItems(payload);
    total.value = pageTotal(payload);
  } catch (loadError) {
    const normalized = normalizeApiError(loadError);
    error.value = normalized.kind === "unknown" ? t("assetModel.loadFailed") : normalized.message;
    rows.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

async function loadAll() {
  await Promise.all([loadReferences().catch(() => undefined), loadModels()]);
}

function searchModels() {
  page.value = 1;
  void loadModels();
}

function changePage(next: number) {
  page.value = next;
  void loadModels();
}

function changePageSize(next: number) {
  pageSize.value = next;
  page.value = 1;
  void loadModels();
}

function openModal(model?: AssetModel) {
  editing.value = model || null;
  form.value = model
    ? {
        name: model.name,
        manufacturer: model.manufacturer == null ? "" : String(model.manufacturer),
        device_type: model.device_type == null ? "" : String(model.device_type),
        model_number: model.model_number || "",
        default_warranty_months: model.default_warranty_months,
        expected_life_months: model.expected_life_months,
        is_active: model.is_active,
      }
    : emptyForm();
  formErrors.value = {};
  showModal.value = true;
}

function fieldError(field: string): string {
  return formErrors.value[field] || "";
}

async function saveModel() {
  if (!canManage.value || saving.value) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  saving.value = true;
  formErrors.value = {};
  try {
    const body = {
      name: form.value.name.trim(),
      manufacturer: form.value.manufacturer ? Number(form.value.manufacturer) : null,
      device_type: form.value.device_type ? Number(form.value.device_type) : null,
      model_number: form.value.model_number.trim(),
      default_warranty_months: form.value.default_warranty_months,
      expected_life_months: form.value.expected_life_months,
      is_active: form.value.is_active,
    };
    await c.request(editing.value ? `/asset-models/${editing.value.id}/` : "/asset-models/", {
      method: editing.value ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    showModal.value = false;
    await loadModels();
  } catch (saveError) {
    const normalized = normalizeApiError(saveError);
    formErrors.value = Object.fromEntries(Object.entries(normalized.fieldErrors).map(([key, messages]) => [key, messages.join("；")]));
    if (!Object.keys(formErrors.value).length) error.value = normalized.kind === "unknown" ? t("assetModel.saveFailed") : normalized.message;
  } finally {
    saving.value = false;
  }
}

async function toggleModel(model: AssetModel) {
  if (!canManage.value || actionId.value) return;
  actionId.value = model.id;
  try {
    await c.request(`/asset-models/${model.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !model.is_active }),
    });
    await loadModels();
  } catch (toggleError) {
    error.value = normalizeApiError(toggleError).message || t("assetModel.saveFailed");
  } finally {
    actionId.value = null;
  }
}

async function deleteModel(model: AssetModel) {
  if (!canManage.value || actionId.value || (model.assets_count || 0) > 0) return;
  if (!(await c.confirmAction(t("assetModel.deleteConfirm", { name: model.name })))) return;
  actionId.value = model.id;
  try {
    await c.request(`/asset-models/${model.id}/`, { method: "DELETE" });
    await loadModels();
  } catch (deleteError) {
    error.value = normalizeApiError(deleteError).message || t("assetModel.deleteFailed");
  } finally {
    actionId.value = null;
  }
}

onMounted(() => void loadAll());
</script>

<template>
  <PageContainer>
    <template #toolbar>
      <PageToolbar>
        <template #search>
          <SearchField v-model="search" :loading="loading" :placeholder="t('assetModel.searchPlaceholder')" :aria-label="t('assetModel.searchPlaceholder')" @search="searchModels" />
        </template>
        <template #filters>
          <div class="page-toolbar__filter-group">
            <el-select v-model="active" clearable :placeholder="t('common.status')" :disabled="loading" @change="searchModels">
              <el-option :label="t('status.active')" value="true" />
              <el-option :label="t('status.inactive')" value="false" />
            </el-select>
          </div>
        </template>
        <template #primary>
          <el-button v-if="canManage" type="primary" :disabled="saving" @click="openModal()">{{ t('assetModel.add') }}</el-button>
        </template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false">
        <template #default><el-button link type="danger" :loading="loading" @click="loadAll">{{ t('common.retry') }}</el-button></template>
      </el-alert>
      <PagedTable v-else v-model:current-page="page" v-model:page-size="pageSize" :total="total" @update:current-page="changePage" @update:page-size="changePageSize">
        <el-table v-loading="loading" :data="rows" table-layout="fixed">
          <template #empty>
            <el-empty :image-size="56" :description="search.trim() || active ? t('assetModel.noMatch') : t('assetModel.empty')">
              <el-button v-if="search.trim() || active" link type="primary" @click="search = ''; active = ''; searchModels">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
          </template>
          <el-table-column prop="name" :label="t('assetModel.name')" min-width="180" show-overflow-tooltip />
          <el-table-column prop="manufacturer_name" :label="t('assetModel.manufacturer')" min-width="140" show-overflow-tooltip />
          <el-table-column prop="device_type_name" :label="t('assetModel.category')" min-width="130" show-overflow-tooltip />
          <el-table-column prop="model_number" :label="t('assetModel.modelNumber')" min-width="150" show-overflow-tooltip />
          <el-table-column :label="t('assetModel.defaultWarranty')" min-width="135"><template #default="{ row }">{{ monthText(row.default_warranty_months) }}</template></el-table-column>
          <el-table-column :label="t('assetModel.expectedLife')" min-width="145"><template #default="{ row }">{{ monthText(row.expected_life_months) }}</template></el-table-column>
          <el-table-column :label="t('assetModel.assetsCount')" width="100"><template #default="{ row }">{{ row.assets_count || 0 }}</template></el-table-column>
          <el-table-column :label="t('assetModel.status')" width="100"><template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template></el-table-column>
          <el-table-column v-if="canManage" :label="t('common.operation')" width="142" fixed="right">
            <template #default="{ row }">
              <div class="ep-table-actions">
                <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="actionId === row.id || saving" @click="openModal(row)" />
                <TableIconButton :icon="row.is_active ? CircleClose : CircleCheck" :label="row.is_active ? t('status.inactive') : t('status.active')" :disabled="actionId === row.id" @click="toggleModel(row)" />
                <TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" :disabled="actionId === row.id || (row.assets_count || 0) > 0" @click="deleteModel(row)" />
              </div>
            </template>
          </el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell v-model="showModal" :title="editing ? t('assetModel.editTitle') : t('assetModel.createTitle')" :description="t('assetModel.description')" size="medium" :saving="saving" :show-close="!saving" :close-disabled="saving" :close-on-click-modal="!saving" :close-on-press-escape="!saving">
    <el-form ref="formRef" class="horizontal-form" :model="form" :rules="formRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="saveModel">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('assetModel.title') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('assetModel.name')" prop="name" required :error="fieldError('name')"><el-input v-model="form.name" maxlength="160" /></el-form-item>
          <el-form-item :label="t('assetModel.modelNumber')" :error="fieldError('model_number')"><el-input v-model="form.model_number" maxlength="160" /></el-form-item>
          <el-form-item :label="t('assetModel.manufacturer')"><el-select v-model="form.manufacturer" clearable :placeholder="t('assetModel.unset')"><el-option v-for="item in manufacturers" :key="item.id" :label="item.name" :value="String(item.id)" /></el-select></el-form-item>
          <el-form-item :label="t('assetModel.category')"><el-select v-model="form.device_type" clearable :placeholder="t('assetModel.unset')"><el-option v-for="item in deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" /></el-select></el-form-item>
          <el-form-item :label="t('assetModel.defaultWarranty')" prop="default_warranty_months" :error="fieldError('default_warranty_months')"><el-input-number v-model="form.default_warranty_months" :min="0" :precision="0" :step="1" :value-on-clear="null" /></el-form-item>
          <el-form-item :label="t('assetModel.expectedLife')" prop="expected_life_months" :error="fieldError('expected_life_months')"><el-input-number v-model="form.expected_life_months" :min="0" :precision="0" :step="1" :value-on-clear="null" /></el-form-item>
          <el-form-item :label="t('assetModel.status')"><el-select v-model="form.is_active"><el-option :label="t('status.active')" :value="true" /><el-option :label="t('status.inactive')" :value="false" /></el-select></el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="showModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" :disabled="saving || !canManage" @click="saveModel">{{ t('common.save') }}</el-button></template>
  </FormDialogShell>
</template>
