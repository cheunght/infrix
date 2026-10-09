<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RequestFn } from "../page-context";
import type { ManagedUser } from "../types";
import { normalizeApiError } from "../error-handling";
import SearchableSelect from "./SearchableSelect.vue";
import FormDialogShell from "./FormDialogShell.vue";

interface ScopeForm {
  revision: number;
  department_options?: { id: number; name: string }[];
  read_departments: number[];
  write_departments: number[];
  all_departments_read: boolean;
  all_departments_write: boolean;
  unowned_read: boolean;
  unowned_write: boolean;
  center_options?: { id: number; name: string }[];
  read_data_centers: number[];
  write_data_centers: number[];
  global_read: boolean;
  global_write: boolean;
  unlocated_read: boolean;
  unlocated_write: boolean;
  global_stock_metrics: boolean;
}
const props = defineProps<{ modelValue: boolean; user: ManagedUser | null; request: RequestFn }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();
const { t } = useI18n();
const form = ref<ScopeForm | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
let generation = 0;
const protectedAdmin = computed(() => Boolean(props.user?.is_superuser || props.user?.roles.some(role => role.code === "system_admin")));
const selectedReadOptions = computed(() => (form.value?.center_options || []).filter(center => form.value?.read_data_centers.includes(center.id)).map(center => ({ value: center.id, label: center.name })));
const selectedWriteOptions = computed(() => (form.value?.center_options || []).filter(center => form.value?.write_data_centers.includes(center.id)).map(center => ({ value: center.id, label: center.name })));
const selectedReadDepartments = computed(() => (form.value?.department_options || []).filter(department => form.value?.read_departments?.includes(department.id)).map(department => ({ value: department.id, label: department.name })));
const selectedWriteDepartments = computed(() => (form.value?.department_options || []).filter(department => form.value?.write_departments?.includes(department.id)).map(department => ({ value: department.id, label: department.name })));
const centerOption = (item: Record<string, unknown>) => ({ value: Number(item.id), label: String(item.name) });
watch(() => [props.modelValue, props.user?.id] as const, async ([open, id]) => {
  const version = ++generation;
  form.value = null;
  error.value = "";
  if (!open || !id) return;
  loading.value = true;
  try {
    const result = await props.request<ScopeForm>(`/users/${id}/data-scope/`);
    if (version === generation) form.value = result;
  } catch (cause) {
    if (version === generation) error.value = normalizeApiError(cause).message;
  } finally {
    if (version === generation) loading.value = false;
  }
});
async function save() {
  if (!form.value || !props.user || saving.value) return;
  saving.value = true;
  error.value = "";
  const current = form.value;
  const { revision } = current;
  const payload = { read_data_centers: current.read_data_centers, write_data_centers: current.write_data_centers,
    global_read: current.global_read, global_write: current.global_write, unlocated_read: current.unlocated_read,
    unlocated_write: current.unlocated_write, global_stock_metrics: current.global_stock_metrics,
    read_departments: current.read_departments, write_departments: current.write_departments,
    all_departments_read: current.all_departments_read, all_departments_write: current.all_departments_write,
    unowned_read: current.unowned_read, unowned_write: current.unowned_write };
  try {
    await props.request(`/users/${props.user.id}/data-scope/`, {
      method: "PUT", headers: { "Content-Type": "application/json", "If-Match": `"${revision}"` },
      body: JSON.stringify(payload),
    });
    emit("update:modelValue", false);
  } catch (cause) {
    error.value = normalizeApiError(cause).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <FormDialogShell :model-value="modelValue" :title="`${t('dataScope.title')} · ${user?.username || ''}`" :description="t('dataScope.description')" size="medium" :saving="saving" :show-close="!saving" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :close-disabled="saving" @update:model-value="emit('update:modelValue', $event)">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="protectedAdmin" :title="t('dataScope.adminHint')" type="info" :closable="false" />
    <el-form v-if="form" v-loading="loading" label-position="top" :disabled="saving || protectedAdmin">
      <el-form-item :label="t('dataScope.readCenters')"><SearchableSelect v-model="form.read_data_centers" :selected-options="selectedReadOptions" :request="request" endpoint="/data-centers/" :map-option="centerOption" :base-query="{ is_active: 'all' }" multiple clearable /></el-form-item>
      <el-form-item :label="t('dataScope.writeCenters')"><SearchableSelect v-model="form.write_data_centers" :selected-options="selectedWriteOptions" :request="request" endpoint="/data-centers/" :map-option="centerOption" :base-query="{ is_active: 'all' }" multiple clearable /></el-form-item>
      <el-form-item><el-checkbox v-model="form.unlocated_read">{{ t('dataScope.unlocatedRead') }}</el-checkbox><el-checkbox v-model="form.unlocated_write">{{ t('dataScope.unlocatedWrite') }}</el-checkbox></el-form-item>
      <el-form-item :label="t('dataScope.readDepartments')"><SearchableSelect v-model="form.read_departments" :selected-options="selectedReadDepartments" :request="request" endpoint="/departments/" :map-option="centerOption" multiple clearable /></el-form-item>
      <el-form-item :label="t('dataScope.writeDepartments')"><SearchableSelect v-model="form.write_departments" :selected-options="selectedWriteDepartments" :request="request" endpoint="/departments/" :map-option="centerOption" multiple clearable /></el-form-item>
      <el-form-item><el-checkbox v-model="form.all_departments_read">{{ t('dataScope.allDepartmentsRead') }}</el-checkbox><el-checkbox v-model="form.all_departments_write">{{ t('dataScope.allDepartmentsWrite') }}</el-checkbox></el-form-item>
      <el-form-item><el-checkbox v-model="form.unowned_read">{{ t('dataScope.unownedRead') }}</el-checkbox><el-checkbox v-model="form.unowned_write">{{ t('dataScope.unownedWrite') }}</el-checkbox></el-form-item>
      <el-alert :title="t('dataScope.departmentIntersection')" type="info" :closable="false" />
      <el-form-item><el-checkbox v-model="form.global_read">{{ t('dataScope.globalRead') }}</el-checkbox><el-checkbox v-model="form.global_write">{{ t('dataScope.globalWrite') }}</el-checkbox></el-form-item>
      <el-form-item><el-checkbox v-model="form.global_stock_metrics">{{ t('dataScope.globalMetrics') }}</el-checkbox></el-form-item>
      <el-alert :title="t('dataScope.writeImpliesRead')" type="info" :closable="false" />
    </el-form>
    <p v-else-if="loading">{{ t('common.loading') }}</p>
    <template #footer><el-button :disabled="saving" @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" :disabled="!form || loading || saving || protectedAdmin" @click="save">{{ t('common.save') }}</el-button></template>
  </FormDialogShell>
</template>
