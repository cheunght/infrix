<script setup lang="ts">
import { computed, onMounted, proxyRefs, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import { normalizeApiError } from "../error-handling";
import type { PageContext } from "../page-context";
import type { CustomFieldSet, DictionaryItem } from "../types";
import FormDialogShell from "./FormDialogShell.vue";
import PagedTable from "./PagedTable.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import SearchField from "./SearchField.vue";
import StatusTag from "./StatusTag.vue";
import TableIconButton from "./TableIconButton.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";

const props = defineProps<{ context: PageContext }>();
const c = proxyRefs(props.context);
const { t } = useI18n();

type FormState = { name: string; color: string; default_fieldset: string; is_active: boolean };
const emptyForm = (): FormState => ({ name: "", color: "#1677EF", default_fieldset: "", is_active: true });
const rows = ref<DictionaryItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const active = ref("");
const loading = ref(false);
const error = ref("");
const saving = ref(false);
const actionId = ref<number | null>(null);
const showModal = ref(false);
const editing = ref<DictionaryItem | null>(null);
const form = ref<FormState>(emptyForm());
const formErrors = ref<Record<string, string>>({});
const formRef = ref<FormInstance>();
const canManage = computed(() => c.can("settings.manage"));
const rules = computed<FormRules>(() => ({
  name: [{ required: true, whitespace: true, message: t("overlay.enterName"), trigger: "blur" }],
  color: [{ pattern: /^#[0-9A-Fa-f]{6}$/, message: t("overlay.colorInvalid"), trigger: ["blur", "change"] }],
}));

function mapFieldset(item: Record<string, unknown>): SearchableSelectOption {
  const fieldset = item as unknown as CustomFieldSet;
  return { value: fieldset.id, label: fieldset.name, secondary: fieldset.description || "", data: fieldset };
}

async function loadRows() {
  loading.value = true;
  error.value = "";
  const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize.value), is_active: active.value || "all" });
  if (search.value.trim()) params.set("search", search.value.trim());
  try {
    const payload = await c.request<PageResult<DictionaryItem>>(`/device-types/?${params}`);
    rows.value = pageItems(payload);
    total.value = pageTotal(payload);
  } catch (loadError) {
    error.value = normalizeApiError(loadError).message;
  } finally {
    loading.value = false;
  }
}

function openModal(row?: DictionaryItem) {
  editing.value = row || null;
  form.value = row ? {
    name: row.name,
    color: row.color || "#1677EF",
    default_fieldset: row.default_fieldset == null ? "" : String(row.default_fieldset),
    is_active: row.is_active,
  } : emptyForm();
  formErrors.value = {};
  showModal.value = true;
}

async function save() {
  if (!canManage.value || saving.value) return;
  if (await formRef.value?.validate().catch(() => false) !== true) return;
  saving.value = true;
  formErrors.value = {};
  try {
    await c.request(editing.value ? `/device-types/${editing.value.id}/` : "/device-types/", {
      method: editing.value ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.value.name.trim(),
        color: form.value.color.trim().toUpperCase(),
        default_fieldset: form.value.default_fieldset ? Number(form.value.default_fieldset) : null,
        is_active: form.value.is_active,
      }),
    });
    showModal.value = false;
    await loadRows();
  } catch (saveError) {
    const normalized = normalizeApiError(saveError);
    formErrors.value = Object.fromEntries(Object.entries(normalized.fieldErrors).map(([key, messages]) => [key, messages.join("；")]));
    if (!Object.keys(formErrors.value).length) error.value = normalized.message;
  } finally {
    saving.value = false;
  }
}

async function toggle(row: DictionaryItem) {
  if (!canManage.value || actionId.value) return;
  actionId.value = row.id;
  try {
    await c.request(`/device-types/${row.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !row.is_active }) });
    await loadRows();
  } catch (actionError) { error.value = normalizeApiError(actionError).message; }
  finally { actionId.value = null; }
}

async function remove(row: DictionaryItem) {
  if (!canManage.value || actionId.value || (row.assets_count || 0) > 0) return;
  if (!(await c.confirmAction(t("settings.dictionaryDeleteConfirm", { item: t("settings.deviceType"), name: row.name })))) return;
  actionId.value = row.id;
  try {
    await c.request(`/device-types/${row.id}/`, { method: "DELETE" });
    await loadRows();
  } catch (actionError) { error.value = normalizeApiError(actionError).message; }
  finally { actionId.value = null; }
}

onMounted(() => { void loadRows(); });
</script>

<template>
  <PageContainer>
    <template #toolbar>
      <PageToolbar>
        <template #search><SearchField v-model="search" :loading="loading" :placeholder="t('settings.searchDictionary', { item: t('settings.deviceType') })" @search="page = 1; loadRows()" /></template>
        <template #filters><el-select v-model="active" clearable :placeholder="t('common.status')" :disabled="loading" @change="page = 1; loadRows()"><el-option :label="t('status.active')" value="true" /><el-option :label="t('status.inactive')" value="false" /></el-select></template>
        <template #primary><el-button v-if="canManage" type="primary" :disabled="saving" @click="openModal()">{{ t('settings.addType') }}</el-button></template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><template #default><el-button link type="danger" @click="loadRows">{{ t('common.retry') }}</el-button></template></el-alert>
      <PagedTable v-else v-model:current-page="page" v-model:page-size="pageSize" :total="total" @update:current-page="(value) => { page = value; loadRows(); }" @update:page-size="(value) => { pageSize = value; page = 1; loadRows(); }">
        <el-table v-loading="loading" :data="rows" table-layout="fixed">
          <template #empty><el-empty :image-size="56" :description="search || active ? t('settings.noMatchingDictionary', { item: t('settings.deviceType') }) : t('settings.noDictionary', { item: t('settings.deviceType') })" /></template>
          <el-table-column prop="name" :label="t('settings.deviceType')" min-width="220" />
          <el-table-column :label="t('settings.color')" width="120"><template #default="{ row }"><span class="color-chip" :style="{ background: row.color || '#1677EF' }" />{{ row.color || '#1677EF' }}</template></el-table-column>
          <el-table-column prop="default_fieldset_name" :label="t('settings.defaultFieldset')" min-width="180"><template #default="{ row }">{{ row.default_fieldset_name || t('settings.noDefaultFieldset') }}</template></el-table-column>
          <el-table-column prop="assets_count" :label="t('settings.assetCount')" width="100" />
          <el-table-column :label="t('common.status')" width="100"><template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template></el-table-column>
          <el-table-column v-if="canManage" :label="t('common.operation')" width="132" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="actionId === row.id" @click="openModal(row)" /><TableIconButton :icon="row.is_active ? CircleClose : CircleCheck" :label="row.is_active ? t('status.inactive') : t('status.active')" :disabled="actionId === row.id" @click="toggle(row)" /><TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" :disabled="actionId === row.id || (row.assets_count || 0) > 0" @click="remove(row)" /></div></template></el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell v-model="showModal" :title="editing ? t('common.edit') : t('settings.addType')" :saving="saving" :close-disabled="saving">
    <el-form ref="formRef" :model="form" :rules="rules" class="horizontal-form" label-position="right">
      <el-form-item :label="t('settings.deviceType')" prop="name" required :error="formErrors.name"><el-input v-model="form.name" maxlength="120" /></el-form-item>
      <el-form-item :label="t('settings.color')" prop="color" :error="formErrors.color"><el-input v-model="form.color" maxlength="7" /></el-form-item>
      <el-form-item :label="t('settings.defaultFieldset')" prop="default_fieldset" :error="formErrors.default_fieldset"><SearchableSelect v-model="form.default_fieldset" :request="c.request" endpoint="/custom-fieldsets/" :map-option="mapFieldset" :base-query="{ is_active: true }" clearable /></el-form-item>
      <el-form-item :label="t('common.status')"><el-switch v-model="form.is_active" /></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="showModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button></template>
  </FormDialogShell>
</template>
