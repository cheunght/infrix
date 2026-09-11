<script setup lang="ts">
import { computed, onMounted, proxyRefs, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowDown, ArrowUp, CircleCheck, CircleClose, Delete, Edit, Rank } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import { normalizeApiError } from "../error-handling";
import type { PageContext } from "../page-context";
import type { CustomField, CustomFieldSet, CustomFieldSetItem } from "../types";
import FormDialogShell from "./FormDialogShell.vue";
import PagedTable from "./PagedTable.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import SearchField from "./SearchField.vue";
import StatusTag from "./StatusTag.vue";
import TableIconButton from "./TableIconButton.vue";

const props = defineProps<{ context: PageContext }>();
const c = proxyRefs(props.context);
const { t } = useI18n();

type FormState = { name: string; description: string; is_active: boolean; items: CustomFieldSetItem[] };
const emptyForm = (): FormState => ({ name: "", description: "", is_active: true, items: [] });
const rows = ref<CustomFieldSet[]>([]);
const fields = ref<CustomField[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const active = ref("");
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const formErrors = ref<Record<string, string>>({});
const showModal = ref(false);
const editing = ref<CustomFieldSet | null>(null);
const form = ref<FormState>(emptyForm());
const formRef = ref<FormInstance>();
const draggedIndex = ref<number | null>(null);
const canManage = computed(() => c.can("custom_fields.manage"));
const availableFields = computed(() => {
  const selectedIds = new Set(form.value.items.map((item) => item.field));
  return fields.value.filter((field) => (field.is_active || selectedIds.has(field.id)) && !selectedIds.has(field.id));
});
const rules = computed<FormRules>(() => ({
  name: [{ required: true, whitespace: true, message: t("customFieldSet.nameRequired"), trigger: "blur" }],
}));

async function loadFieldsets() {
  loading.value = true;
  error.value = "";
  const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize.value), is_active: active.value || "all" });
  if (search.value.trim()) params.set("search", search.value.trim());
  try {
    const payload = await c.request<PageResult<CustomFieldSet>>(`/custom-fieldsets/?${params}`);
    rows.value = pageItems(payload);
    total.value = pageTotal(payload);
  } catch (loadError) {
    error.value = normalizeApiError(loadError).message;
  } finally {
    loading.value = false;
  }
}

async function loadFields() {
  try {
    const loaded: CustomField[] = [];
    let nextPage = 1;
    let expectedTotal = 0;
    do {
      const payload = await c.request<PageResult<CustomField>>(`/custom-fields/?page=${nextPage}&page_size=100&is_active=all`);
      loaded.push(...pageItems(payload));
      expectedTotal = pageTotal(payload);
      nextPage += 1;
    } while (loaded.length < expectedTotal);
    fields.value = loaded;
  } catch (loadError) {
    fields.value = [];
    error.value = normalizeApiError(loadError).message;
  }
}

async function loadAll() {
  await Promise.all([loadFieldsets(), loadFields()]);
}

function openModal(fieldset?: CustomFieldSet) {
  editing.value = fieldset || null;
  form.value = fieldset ? {
    name: fieldset.name,
    description: fieldset.description || "",
    is_active: fieldset.is_active,
    items: fieldset.items.map((item, index) => ({ ...item, sort_order: index })),
  } : emptyForm();
  formErrors.value = {};
  showModal.value = true;
}

function selected(fieldId: number) {
  return form.value.items.some((item) => item.field === fieldId);
}

function toggleField(field: CustomField, checked: boolean) {
  if (checked) {
    form.value.items.push({ field: field.id, field_name: field.name, field_type: field.field_type, field_is_active: field.is_active, required: false, group: "", sort_order: form.value.items.length });
  } else {
    form.value.items = form.value.items.filter((item) => item.field !== field.id);
  }
  normalizeOrder();
}

function normalizeOrder() {
  form.value.items.forEach((item, index) => { item.sort_order = index; });
}

function move(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= form.value.items.length) return;
  const [item] = form.value.items.splice(index, 1);
  form.value.items.splice(target, 0, item);
  normalizeOrder();
}

function dropAt(index: number) {
  if (draggedIndex.value == null || draggedIndex.value === index) return;
  const [item] = form.value.items.splice(draggedIndex.value, 1);
  form.value.items.splice(index, 0, item);
  draggedIndex.value = null;
  normalizeOrder();
}

function fieldName(item: CustomFieldSetItem) {
  return item.field_name || fields.value.find((field) => field.id === item.field)?.name || `#${item.field}`;
}

function removeField(index: number) {
  form.value.items.splice(index, 1);
  normalizeOrder();
}

async function save() {
  if (!canManage.value || saving.value || await formRef.value?.validate().catch(() => false) !== true) return;
  saving.value = true;
  formErrors.value = {};
  try {
    const body = {
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      is_active: form.value.is_active,
      items: form.value.items.map((item, index) => ({
        field: item.field,
        required: item.required,
        group: item.group.trim(),
        sort_order: index,
      })),
    };
    await c.request<CustomFieldSet>(editing.value ? `/custom-fieldsets/${editing.value.id}/` : "/custom-fieldsets/", {
      method: editing.value ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    showModal.value = false;
    await loadFieldsets();
  } catch (saveError) {
    const normalized = normalizeApiError(saveError);
    formErrors.value = Object.fromEntries(Object.entries(normalized.fieldErrors).map(([key, messages]) => [key, messages.join("；")]));
    if (!Object.keys(formErrors.value).length) error.value = normalized.message;
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(fieldset: CustomFieldSet) {
  if (!canManage.value) return;
  try {
    await c.request(`/custom-fieldsets/${fieldset.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !fieldset.is_active }) });
    await loadFieldsets();
  } catch (actionError) { error.value = normalizeApiError(actionError).message; }
}

async function remove(fieldset: CustomFieldSet) {
  if (!canManage.value || fieldset.models_count || fieldset.device_types_count) return;
  if (!(await c.confirmAction(t("customFieldSet.deleteConfirm", { name: fieldset.name })))) return;
  try {
    await c.request(`/custom-fieldsets/${fieldset.id}/`, { method: "DELETE" });
    await loadFieldsets();
  } catch (actionError) { error.value = normalizeApiError(actionError).message; }
}

onMounted(() => void loadAll());
</script>

<template>
  <PageContainer>
    <template #toolbar>
      <PageToolbar>
        <template #search><SearchField v-model="search" :loading="loading" :placeholder="t('customFieldSet.search')" @search="page = 1; loadFieldsets()" /></template>
        <template #filters><el-select v-model="active" clearable :placeholder="t('common.status')" @change="page = 1; loadFieldsets()"><el-option :label="t('status.active')" value="true" /><el-option :label="t('status.inactive')" value="false" /></el-select></template>
        <template #primary><el-button v-if="canManage" type="primary" @click="openModal()">{{ t('customFieldSet.add') }}</el-button></template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><template #default><el-button link type="danger" @click="loadAll">{{ t('common.retry') }}</el-button></template></el-alert>
      <PagedTable v-else v-model:current-page="page" v-model:page-size="pageSize" :total="total" @update:current-page="loadFieldsets" @update:page-size="page = 1; loadFieldsets()">
        <el-table v-loading="loading" :data="rows" table-layout="fixed">
          <template #empty><el-empty :image-size="56" :description="t('customFieldSet.empty')" /></template>
          <el-table-column prop="name" :label="t('common.name')" min-width="180" />
          <el-table-column prop="description" :label="t('common.description')" min-width="220" show-overflow-tooltip />
          <el-table-column :label="t('customFieldSet.fieldsCount')" width="100"><template #default="{ row }">{{ row.items.length }}</template></el-table-column>
          <el-table-column prop="models_count" :label="t('customFieldSet.modelsCount')" width="110" />
          <el-table-column prop="device_types_count" :label="t('customFieldSet.deviceTypesCount')" width="130" />
          <el-table-column prop="assets_count" :label="t('customFieldSet.assetsCount')" width="110" />
          <el-table-column :label="t('common.status')" width="96"><template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template></el-table-column>
          <el-table-column v-if="canManage" :label="t('common.operation')" width="142" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" @click="openModal(row)" /><TableIconButton :icon="row.is_active ? CircleClose : CircleCheck" :label="row.is_active ? t('status.inactive') : t('status.active')" @click="toggleStatus(row)" /><TableIconButton :icon="Delete" :label="row.models_count || row.device_types_count ? t('customFieldSet.deleteBlocked') : t('common.delete')" type="danger" :disabled="row.models_count > 0 || row.device_types_count > 0" @click="remove(row)" /></div></template></el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell v-model="showModal" :title="editing ? t('customFieldSet.edit') : t('customFieldSet.create')" :description="t('customFieldSet.help')" size="large" :saving="saving" :close-disabled="saving">
    <el-form ref="formRef" :model="form" :rules="rules" class="horizontal-form" label-position="right">
      <section class="form-dialog__section"><div class="horizontal-form__rows"><el-form-item :label="t('common.name')" prop="name" required :error="formErrors.name"><el-input v-model="form.name" maxlength="120" /></el-form-item><el-form-item :label="t('common.description')" :error="formErrors.description"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item><el-form-item :label="t('common.status')"><el-switch v-model="form.is_active" /></el-form-item></div></section>
      <section class="form-dialog__section"><h3 class="form-dialog__section-title">{{ t('customFieldSet.members') }}</h3><div class="fieldset-library"><el-checkbox v-for="field in availableFields" :key="field.id" :model-value="selected(field.id)" @change="toggleField(field, Boolean($event))">{{ field.name }} <span class="fieldset-library__code">{{ field.key }}</span></el-checkbox></div></section>
      <section v-if="form.items.length" class="form-dialog__section"><h3 class="form-dialog__section-title">{{ t('customFieldSet.orderAndRules') }}</h3><div class="fieldset-items"><div v-for="(item, index) in form.items" :key="item.field" class="fieldset-item" @dragover.prevent @drop="dropAt(index)"><button type="button" class="fieldset-item__handle" :aria-label="t('customFieldSet.dragToReorder')" draggable="true" @dragstart="draggedIndex = index"><el-icon aria-hidden="true"><Rank /></el-icon></button><div class="fieldset-item__identity"><strong>{{ fieldName(item) }}</strong><span>{{ fields.find((field) => field.id === item.field)?.key }}</span></div><el-input v-model="item.group" :placeholder="t('customFieldSet.group')" /><el-checkbox v-model="item.required">{{ t('customFieldSet.required') }}</el-checkbox><div class="ep-table-actions"><TableIconButton :icon="ArrowUp" :label="t('customFieldSet.moveUp')" :disabled="index === 0" @click="move(index, -1)" /><TableIconButton :icon="ArrowDown" :label="t('customFieldSet.moveDown')" :disabled="index === form.items.length - 1" @click="move(index, 1)" /><TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" @click="removeField(index)" /></div></div></div></section>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="showModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button></template>
  </FormDialogShell>
</template>

<style scoped>
.fieldset-library { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; }
.fieldset-library__code, .fieldset-item__identity span { color: var(--el-text-color-secondary); font-size: 12px; }
.fieldset-items { display: grid; gap: 8px; }
.fieldset-item { display: grid; grid-template-columns: 28px minmax(160px, 1fr) minmax(140px, .8fr) auto auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-blank); }
.fieldset-item__identity { min-width: 0; display: grid; gap: 2px; }
.fieldset-item__handle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; color: var(--el-text-color-secondary); background: transparent; cursor: grab; }
.fieldset-item__handle:focus-visible, .fieldset-item__handle:hover { color: var(--el-color-primary); background: var(--el-color-primary-light-9); outline: none; }
@media (max-width: 720px) { .fieldset-library { grid-template-columns: 1fr; } .fieldset-item { grid-template-columns: 1fr; } }
</style>
