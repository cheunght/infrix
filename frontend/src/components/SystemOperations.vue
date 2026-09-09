<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import { normalizeApiError } from "../error-handling";
import { isAbortError } from "../api";
const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();
type Operations = {
  application: Record<string, string>;
  database: { status: string; engine: string; version: string | null; migrations: string; pending: number | null };
  smtp?: { status: string; digest_enabled: boolean };
  ldap?: { status: string };
  configuration_status?: string;
};
const data = ref<Operations | null>(null);
const busy = ref(false);
const error = ref("");
let generation = 0;
let requestController: AbortController | null = null;
onBeforeUnmount(() => {
  generation += 1;
  requestController?.abort();
});
async function load() {
  const current = ++generation;
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  busy.value = true;
  error.value = "";
  try {
    const result = await props.context.request<Operations>("/system/operations/", { signal: controller.signal });
    if (current === generation) data.value = result;
  } catch (cause) {
    if (current === generation && !isAbortError(cause)) {
      error.value = normalizeApiError(cause).message;
      data.value = null;
    }
  } finally {
    if (current === generation) {
      busy.value = false;
      requestController = null;
    }
  }
}
function state(value: string | undefined) { return t(`operations.${value || 'unavailable'}`); }
onMounted(load);
</script>
<template>
  <section v-loading="busy" class="settings-operations">
    <div class="settings-operations__toolbar">
      <el-button :disabled="busy" @click="load">{{ t('common.refresh') }}</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="data">
      <el-alert v-if="data.configuration_status" :title="state(data.configuration_status)" type="warning" :closable="false" />
      <el-descriptions :column="1" border>
        <el-descriptions-item :label="t('operations.application')">{{ data.application.product }} {{ data.application.version }} · {{ data.application.environment }} · {{ data.application.runtime }}</el-descriptions-item>
        <el-descriptions-item :label="t('operations.time')">{{ context.formatDateTime(data.application.time || null) }} · {{ data.application.timezone || '—' }}</el-descriptions-item>
        <el-descriptions-item :label="t('operations.database')">{{ state(data.database.status) }} · {{ data.database.engine }} {{ data.database.version || '' }}</el-descriptions-item>
        <el-descriptions-item :label="t('operations.migrations')">{{ state(data.database.migrations) }} · {{ data.database.pending ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="SMTP">{{ state(data.smtp?.status) }} <router-link to="/settings/system?tab=smtp">{{ t('nav.system') }}</router-link></el-descriptions-item>
        <el-descriptions-item label="LDAP / AD">{{ state(data.ldap?.status) }} <router-link to="/settings/organization?tab=ldap">{{ t('nav.organization') }}</router-link></el-descriptions-item>
      </el-descriptions>
      <p>{{ t('operations.readinessHelp') }}</p>
    </template>
  </section>
</template>
