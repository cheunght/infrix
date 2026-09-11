<script setup lang="ts">
import { computed, onMounted, proxyRefs, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Download, Edit, Upload } from "@element-plus/icons-vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import { normalizeApiError } from "../error-handling";
import type { PageContext } from "../page-context";
import type { AssetModel, CustomFieldSet, DictionaryItem } from "../types";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import SearchField from "./SearchField.vue";
import PagedTable from "./PagedTable.vue";
import StatusTag from "./StatusTag.vue";
import FormDialogShell from "./FormDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import ToolbarIconButton from "./page/ToolbarIconButton.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";

type ModelImportRow = { line: number; name: string; valid: boolean; errors: unknown };
type ModelImportPreview = { total: number; valid: number; invalid: number; rows: ModelImportRow[] };

const props = defineProps<{ context: PageContext }>();
const { t } = useI18n();
const c = proxyRefs(props.context);

type ModelForm = {
  name: string;
  manufacturer: string;
  device_type: string;
  fieldset: string;
  model_number: string;
  default_warranty_months: number | null;
  expected_life_months: number | null;
  notes: string;
  is_active: boolean;
};

const emptyForm = (): ModelForm => ({
  name: "",
  manufacturer: "",
  device_type: "",
  fieldset: "",
  model_number: "",
  default_warranty_months: null,
  expected_life_months: null,
  notes: "",
  is_active: true,
});

const rows = ref<AssetModel[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const active = ref("");
const filterManufacturer = ref("");
const filterDeviceType = ref("");
const filterFieldset = ref("");
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
const fieldsets = ref<CustomFieldSet[]>([]);
const exporting = ref(false);
const showImportModal = ref(false);
const importFile = ref<File | null>(null);
const importFileInput = ref<HTMLInputElement>();
const importPreview = ref<ModelImportPreview | null>(null);
const importPreviewing = ref(false);
const importing = ref(false);
const importError = ref("");

function mapDictionary(item: Record<string, unknown>): SearchableSelectOption {
  const value = item as unknown as DictionaryItem;
  return { value: value.id, label: value.name, secondary: value.code || "", disabled: value.is_active === false, data: value };
}

function mapFieldset(item: Record<string, unknown>): SearchableSelectOption {
  const value = item as unknown as CustomFieldSet;
  return { value: value.id, label: value.name, secondary: value.description || "", disabled: value.is_active === false, data: value };
}

function keepDeviceTypeOption(option: SearchableSelectOption | SearchableSelectOption[] | null) {
  const selected = Array.isArray(option) ? option[0] : option;
  const deviceType = selected?.data as DictionaryItem | undefined;
  if (deviceType && !deviceTypes.value.some((item) => item.id === deviceType.id)) {
    deviceTypes.value = [...deviceTypes.value, deviceType];
  }
}

const inheritedFieldsetName = computed(() => {
  const item = deviceTypes.value.find((entry) => String(entry.id) === form.value.device_type) as (DictionaryItem & { default_fieldset_name?: string }) | undefined;
  return item?.default_fieldset_name || t("assetModel.unset");
});

const selectedManufacturerOption = computed<SearchableSelectOption | null>(() => {
  const item = manufacturers.value.find((entry) => String(entry.id) === form.value.manufacturer);
  return item ? mapDictionary(item as unknown as Record<string, unknown>) : null;
});
const selectedDeviceTypeOption = computed<SearchableSelectOption | null>(() => {
  const item = deviceTypes.value.find((entry) => String(entry.id) === form.value.device_type);
  return item ? mapDictionary(item as unknown as Record<string, unknown>) : null;
});
const selectedFieldsetOption = computed<SearchableSelectOption | null>(() => {
  const item = fieldsets.value.find((entry) => String(entry.id) === form.value.fieldset);
  return item ? mapFieldset(item as unknown as Record<string, unknown>) : null;
});

const canManage = computed(() => c.can("settings.manage"));
const formRules = computed<FormRules>(() => ({
  name: [{ required: true, whitespace: true, message: t("assetModel.nameRequired"), trigger: "blur" }],
  manufacturer: [{ required: true, message: t("assetModel.manufacturerRequired"), trigger: "change" }],
  device_type: [{ required: true, message: t("assetModel.deviceTypeRequired"), trigger: "change" }],
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

async function loadModels() {
  if (!c.can("settings.view")) return;
  loading.value = true;
  error.value = "";
  const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize.value), is_active: active.value || "all" });
  if (search.value.trim()) params.set("search", search.value.trim());
  if (filterManufacturer.value) params.set("manufacturer", filterManufacturer.value);
  if (filterDeviceType.value) params.set("device_type", filterDeviceType.value);
  if (filterFieldset.value) params.set("fieldset", filterFieldset.value);
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
  await loadModels();
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
        fieldset: model.fieldset == null ? "" : String(model.fieldset),
        model_number: model.model_number || "",
        default_warranty_months: model.default_warranty_months,
        expected_life_months: model.expected_life_months,
        notes: model.notes || "",
        is_active: model.is_active,
      }
    : emptyForm();
  formErrors.value = {};
  showModal.value = true;
}

function fieldError(field: string): string {
  return formErrors.value[field] || "";
}

function openFieldsetManagement() {
  c.openAssetConfiguration("fieldsets");
}

function openDeviceTypeManagement() {
  c.openAssetConfiguration("device-types");
}

function openManufacturerManagement() {
  c.openDictionarySection("manufacturers");
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
      manufacturer: Number(form.value.manufacturer),
      device_type: Number(form.value.device_type),
      fieldset: form.value.fieldset ? Number(form.value.fieldset) : null,
      model_number: form.value.model_number.trim(),
      default_warranty_months: form.value.default_warranty_months,
      expected_life_months: form.value.expected_life_months,
      notes: form.value.notes.trim(),
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

function openImport() {
  importFile.value = null;
  importPreview.value = null;
  importError.value = "";
  showImportModal.value = true;
}

function importErrorText(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(importErrorText).filter(Boolean).join("；");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(importErrorText).filter(Boolean).join("；");
  return String(value);
}

async function chooseImportFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0] || null;
  if (!selected) return;
  importFile.value = selected;
  importPreview.value = null;
  importError.value = "";
  const body = new FormData();
  body.append("file", selected);
  importPreviewing.value = true;
  try {
    importPreview.value = await c.request<ModelImportPreview>("/asset-models/import/preview/", { method: "POST", body });
  } catch (previewError) {
    importError.value = normalizeApiError(previewError).message || t("assetModel.previewFailed");
  } finally {
    importPreviewing.value = false;
    if (importFileInput.value) importFileInput.value.value = "";
  }
}

async function confirmImport() {
  if (!importFile.value || !importPreview.value?.valid || importPreview.value.invalid || importing.value) return;
  const body = new FormData();
  body.append("file", importFile.value);
  importing.value = true;
  importError.value = "";
  try {
    const result = await c.request<{ created: number }>("/asset-models/import/", { method: "POST", body });
    showImportModal.value = false;
    ElMessage.success(t("assetModel.importSuccess", { count: result.created }));
    await loadModels();
  } catch (commitError) {
    importError.value = normalizeApiError(commitError).message || t("assetModel.importFailed");
  } finally {
    importing.value = false;
  }
}

async function downloadTemplate() {
  try {
    await c.downloadFile("/asset-models/import/template/", "infrix-asset-model-import.xlsx");
  } catch (downloadError) {
    importError.value = normalizeApiError(downloadError).message || t("assetModel.importFailed");
  }
}

async function exportModels() {
  if (exporting.value) return;
  exporting.value = true;
  const params = new URLSearchParams();
  if (search.value.trim()) params.set("search", search.value.trim());
  if (active.value) params.set("is_active", active.value);
  if (filterManufacturer.value) params.set("manufacturer", filterManufacturer.value);
  if (filterDeviceType.value) params.set("device_type", filterDeviceType.value);
  if (filterFieldset.value) params.set("fieldset", filterFieldset.value);
  try {
    await c.downloadFile(`/reports/asset-models/export/${params.size ? `?${params}` : ""}`, "infrix-asset-models.xlsx");
  } catch (exportError) {
    error.value = normalizeApiError(exportError).message || t("assetModel.exportFailed");
  } finally {
    exporting.value = false;
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
            <SearchableSelect v-model="filterManufacturer" :request="c.request" endpoint="/manufacturers/" :map-option="mapDictionary" :base-query="{ is_active: 'all' }" :placeholder="t('assetModel.manufacturer')" :disabled="loading" @update:model-value="searchModels" />
            <SearchableSelect v-model="filterDeviceType" :request="c.request" endpoint="/device-types/" :map-option="mapDictionary" :base-query="{ is_active: 'all' }" :placeholder="t('assetModel.category')" :disabled="loading" @update:model-value="searchModels" />
            <SearchableSelect v-model="filterFieldset" :request="c.request" endpoint="/custom-fieldsets/" :map-option="mapFieldset" :base-query="{ is_active: 'all' }" :placeholder="t('assetModel.fieldset')" :disabled="loading" @update:model-value="searchModels" />
            <el-select v-model="active" clearable :placeholder="t('common.status')" :disabled="loading" @change="searchModels">
              <el-option :label="t('status.active')" value="true" />
              <el-option :label="t('status.inactive')" value="false" />
            </el-select>
          </div>
        </template>
        <template v-if="canManage" #actions>
          <ToolbarIconButton :icon="Upload" :label="t('assetModel.import')" @click="openImport" />
          <ToolbarIconButton :icon="Download" :label="t('assetModel.export')" :loading="exporting" :disabled="exporting" @click="exportModels" />
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
            <el-empty :image-size="56" :description="search.trim() || active || filterManufacturer || filterDeviceType || filterFieldset ? t('assetModel.noMatch') : t('assetModel.empty')">
              <el-button v-if="search.trim() || active || filterManufacturer || filterDeviceType || filterFieldset" link type="primary" @click="search = ''; active = ''; filterManufacturer = ''; filterDeviceType = ''; filterFieldset = ''; searchModels">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
          </template>
          <el-table-column :label="t('assetModel.name')" min-width="170"><template #default="{ row }"><div class="asset-model-cell"><strong>{{ row.name }}</strong><span>{{ row.model_number || t('assetModel.unset') }}</span></div></template></el-table-column>
          <el-table-column prop="manufacturer_name" :label="t('assetModel.manufacturer')" min-width="120" show-overflow-tooltip />
          <el-table-column prop="device_type_name" :label="t('assetModel.category')" min-width="120" show-overflow-tooltip />
          <el-table-column :label="t('assetModel.fieldset')" min-width="170"><template #default="{ row }"><div class="asset-model-cell"><strong>{{ row.effective_fieldset?.name || t('assetModel.unset') }}</strong><span>{{ row.fieldset ? t('assetModel.fieldsetSpecified') : t('assetModel.fieldsetInherited') }}</span></div></template></el-table-column>
          <el-table-column :label="t('assetModel.lifecycleDefaults')" min-width="170"><template #default="{ row }"><div class="asset-model-cell"><span>{{ t('assetModel.warrantyShort') }}：{{ monthText(row.default_warranty_months) }}</span><span>{{ t('assetModel.lifeShort') }}：{{ monthText(row.expected_life_months) }}</span></div></template></el-table-column>
          <el-table-column :label="t('assetModel.assetsCount')" width="90" align="center"><template #default="{ row }">{{ row.assets_count || 0 }}</template></el-table-column>
          <el-table-column :label="t('assetModel.status')" width="88"><template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template></el-table-column>
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
          <el-form-item :label="t('assetModel.manufacturer')" prop="manufacturer" required :error="fieldError('manufacturer')"><SearchableSelect v-model="form.manufacturer" :request="c.request" endpoint="/manufacturers/" :map-option="mapDictionary" :base-query="{ is_active: true }" :selected-option="selectedManufacturerOption" :placeholder="t('assetModel.unset')" /><el-button link type="primary" size="small" @click="openManufacturerManagement">{{ t('assetModel.manageManufacturers') }}</el-button></el-form-item>
          <el-form-item :label="t('assetModel.category')" prop="device_type" required :error="fieldError('device_type')"><SearchableSelect v-model="form.device_type" :request="c.request" endpoint="/device-types/" :map-option="mapDictionary" :base-query="{ is_active: true }" :selected-option="selectedDeviceTypeOption" :placeholder="t('assetModel.unset')" @select="keepDeviceTypeOption" /><el-button link type="primary" size="small" @click="openDeviceTypeManagement">{{ t('assetModel.manageDeviceTypes') }}</el-button></el-form-item>
          <el-form-item :label="t('assetModel.fieldset')" :error="fieldError('fieldset')"><SearchableSelect v-model="form.fieldset" :request="c.request" endpoint="/custom-fieldsets/" :map-option="mapFieldset" :base-query="{ is_active: true }" :selected-option="selectedFieldsetOption" clearable :placeholder="t('assetModel.inheritFieldset')" /><div v-if="!form.fieldset && form.device_type" class="asset-model-inherited-hint">{{ t('assetModel.inheritedFieldsetHint', { name: inheritedFieldsetName }) }}</div><el-button link type="primary" size="small" @click="openFieldsetManagement">{{ t('assetModel.manageFieldsets') }}</el-button></el-form-item>
          <el-form-item :label="t('assetModel.defaultWarranty')" prop="default_warranty_months" :error="fieldError('default_warranty_months')"><el-input-number v-model="form.default_warranty_months" :min="0" :precision="0" :step="1" :value-on-clear="null" /></el-form-item>
          <el-form-item :label="t('assetModel.expectedLife')" prop="expected_life_months" :error="fieldError('expected_life_months')"><el-input-number v-model="form.expected_life_months" :min="0" :precision="0" :step="1" :value-on-clear="null" /></el-form-item>
          <el-form-item :label="t('common.notes')" :error="fieldError('notes')"><el-input v-model="form.notes" type="textarea" :rows="3" /></el-form-item>
          <el-form-item :label="t('assetModel.status')"><el-select v-model="form.is_active"><el-option :label="t('status.active')" :value="true" /><el-option :label="t('status.inactive')" :value="false" /></el-select></el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="showModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" :disabled="saving || !canManage" @click="saveModel">{{ t('common.save') }}</el-button></template>
  </FormDialogShell>

  <FormDialogShell v-model="showImportModal" :title="t('assetModel.importTitle')" :description="t('assetModel.importHint')" size="medium" :saving="importing || importPreviewing" :close-disabled="importing || importPreviewing">
    <div class="asset-model-import">
      <input ref="importFileInput" class="asset-model-import__input" type="file" accept=".xlsx" @change="chooseImportFile" />
      <div class="asset-model-import__actions">
        <el-button :loading="importPreviewing" :disabled="importing" @click="importFileInput?.click()">{{ t('assetModel.chooseFile') }}</el-button>
        <el-button link type="primary" :disabled="importing" @click="downloadTemplate">{{ t('assetModel.downloadTemplate') }}</el-button>
        <span v-if="importFile">{{ importFile.name }}</span>
      </div>
      <el-alert v-if="importError" :title="importError" type="error" show-icon :closable="false" />
      <template v-if="importPreview">
        <el-alert :title="t('assetModel.previewSummary', importPreview)" :type="importPreview.invalid ? 'warning' : 'success'" show-icon :closable="false" />
        <div v-if="importPreview.rows.length" class="asset-model-import__preview">
          <div v-for="row in importPreview.rows" :key="row.line" class="asset-model-import__row" :class="{ 'asset-model-import__row--invalid': !row.valid }">
            <span>#{{ row.line }}</span><strong>{{ row.name || '—' }}</strong><span>{{ row.valid ? t('assetModel.ready') : importErrorText(row.errors) }}</span>
          </div>
        </div>
      </template>
    </div>
    <template #footer><el-button :disabled="importing || importPreviewing" @click="showImportModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="importing" :disabled="!importPreview?.valid || !!importPreview.invalid || importPreviewing" @click="confirmImport">{{ t('assetModel.import') }}</el-button></template>
  </FormDialogShell>
</template>

<style scoped>
.asset-model-inherited-hint { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.asset-model-cell { display: grid; gap: 3px; min-width: 0; line-height: 1.35; }
.asset-model-cell strong, .asset-model-cell span { min-width: 0; overflow-wrap: anywhere; }
.asset-model-cell strong { font-weight: 600; color: var(--el-text-color-primary); }
.asset-model-cell span { color: var(--el-text-color-secondary); font-size: 12px; }
.asset-model-import { display: grid; gap: 14px; min-width: 0; }
.asset-model-import__input { display: none; }
.asset-model-import__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; }
.asset-model-import__actions span { min-width: 0; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.asset-model-import__preview { max-height: 320px; overflow-y: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.asset-model-import__row { display: grid; grid-template-columns: 52px minmax(120px, .7fr) minmax(0, 1fr); gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--el-border-color-lighter); align-items: start; }
.asset-model-import__row:last-child { border-bottom: 0; }
.asset-model-import__row--invalid { color: var(--el-color-danger); }
@media (max-width: 640px) { .asset-model-import__row { grid-template-columns: 42px minmax(0, 1fr); } .asset-model-import__row > :last-child { grid-column: 1 / -1; } }
</style>
