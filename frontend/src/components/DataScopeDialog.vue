<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RequestFn } from "../page-context";
import type { ManagedUser, DataScopeBoundary, DataScopeRule } from "../types";
import { normalizeApiError } from "../error-handling";
import DataScopeBoundaryForm from "./DataScopeBoundaryForm.vue";
import FormDialogShell from "./FormDialogShell.vue";

interface RuleForm extends DataScopeRule { key: string }
interface ScopeForm extends DataScopeBoundary {
  revision: number;
  department_options?: { id: number; name: string }[];
  center_options?: { id: number; name: string }[];
  global_read: boolean;
  global_write: boolean;
  global_stock_metrics: boolean;
  rules: RuleForm[];
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
let nextRule = 0;
function addRule() {
  if (!form.value || saving.value || protectedAdmin.value || form.value.rules.length >= 20) return;
  form.value.rules.push({key:`new-${++nextRule}`,name:"",read_data_centers:[],write_data_centers:[],read_departments:[],write_departments:[],
    unlocated_read:false,unlocated_write:false,all_departments_read:false,all_departments_write:false,unowned_read:false,unowned_write:false});
}
function removeRule(index: number) {
  if (form.value && !saving.value && !protectedAdmin.value) form.value.rules.splice(index, 1);
}
watch(() => [props.modelValue, props.user?.id] as const, async ([open, id]) => {
  const version = ++generation;
  form.value = null;
  error.value = "";
  if (!open || !id) return;
  loading.value = true;
  try {
    const result = await props.request<Omit<ScopeForm, "rules"> & { rules?: DataScopeRule[] }>(`/users/${id}/data-scope/`);
    if (version === generation) form.value = {...result, rules:(result.rules || []).map((rule,index)=>({...rule,key:`saved-${rule.id ?? index}`}))};
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
    unowned_read: current.unowned_read, unowned_write: current.unowned_write,
    rules:current.rules.map(({id: _id, key: _key, ...rule})=>rule) };
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
  <FormDialogShell :model-value="modelValue" :title="`${t('dataScope.title')} · ${user?.username || ''}`" :description="t('dataScope.description')" size="large" :saving="saving" :show-close="!saving" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :close-disabled="saving" @update:model-value="emit('update:modelValue', $event)">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="protectedAdmin" :title="t('dataScope.adminHint')" type="info" :closable="false" />
    <el-form v-if="form" v-loading="loading" label-position="top" :disabled="saving || protectedAdmin">
      <el-alert :title="t('dataScope.ruleUnion')" type="info" :closable="false" />
      <section class="scope-rule">
        <h3>{{ t('dataScope.baseRule') }}</h3>
        <DataScopeBoundaryForm :boundary="form" :center-options="form.center_options || []" :department-options="form.department_options || []" :request="request" />
      </section>
      <section v-for="(rule,index) in form.rules" :key="rule.key" class="scope-rule">
        <div class="scope-rule__heading"><h3>{{ t('dataScope.additionalRule', {index:index+1}) }}</h3><el-button :disabled="saving || protectedAdmin" @click="removeRule(index)">{{ t('dataScope.removeRule') }}</el-button></div>
        <el-form-item :label="t('dataScope.ruleName')"><el-input v-model="rule.name" :maxlength="80" show-word-limit /></el-form-item>
        <DataScopeBoundaryForm :boundary="rule" :center-options="form.center_options || []" :department-options="form.department_options || []" :request="request" />
      </section>
      <el-form-item><el-button :disabled="saving || protectedAdmin || form.rules.length >= 20" @click="addRule">{{ t('dataScope.addRule') }}</el-button></el-form-item>
      <el-alert :title="t('dataScope.departmentIntersection')" type="info" :closable="false" />
      <el-form-item><el-checkbox v-model="form.global_read">{{ t('dataScope.globalRead') }}</el-checkbox><el-checkbox v-model="form.global_write">{{ t('dataScope.globalWrite') }}</el-checkbox></el-form-item>
      <el-form-item><el-checkbox v-model="form.global_stock_metrics">{{ t('dataScope.globalMetrics') }}</el-checkbox></el-form-item>
      <el-alert :title="t('dataScope.writeImpliesRead')" type="info" :closable="false" />
    </el-form>
    <p v-else-if="loading">{{ t('common.loading') }}</p>
    <template #footer><el-button :disabled="saving" @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" :disabled="!form || loading || saving || protectedAdmin" @click="save">{{ t('common.save') }}</el-button></template>
  </FormDialogShell>
</template>

<style scoped>
.scope-rule { margin: 16px 0; padding: 16px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.scope-rule__heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.scope-rule h3 { margin: 0 0 16px; font-size: 15px; }
</style>
