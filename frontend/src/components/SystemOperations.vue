<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { SystemMaintenanceDependencies } from "../page-context";
import type { SystemOperations } from "../composables/useSystemMaintenance";

const props = defineProps<{
  context: SystemMaintenanceDependencies;
  status: SystemOperations | null;
  loading: boolean;
  error: string;
}>();
const { t } = useI18n();
const context = props.context;

function state(value: string | undefined) {
  return t(`operations.${value || "unavailable"}`);
}
</script>

<template>
  <section v-loading="loading" class="settings-operations">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="status">
      <el-alert v-if="status.configuration_status" :title="state(status.configuration_status)" type="warning" :closable="false" />
      <el-descriptions :column="1" border>
        <el-descriptions-item :label="t('operations.application')">{{ status.application.product }} {{ status.application.version }} · {{ status.application.environment }} · {{ status.application.runtime }}</el-descriptions-item>
        <el-descriptions-item :label="t('operations.time')">{{ context.formatDateTime(status.application.time || null) }} · {{ status.application.timezone || '—' }}</el-descriptions-item>
        <el-descriptions-item :label="t('operations.database')">{{ state(status.database.status) }} · {{ status.database.engine }} {{ status.database.version || '' }}</el-descriptions-item>
        <el-descriptions-item :label="t('operations.migrations')">{{ state(status.database.migrations) }} · {{ status.database.pending ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="SMTP">{{ state(status.smtp?.status) }} <router-link to="/settings/system?tab=smtp">{{ t('nav.system') }}</router-link></el-descriptions-item>
        <el-descriptions-item label="LDAP / AD">{{ state(status.ldap?.status) }} <router-link to="/settings/organization?tab=ldap">{{ t('nav.organization') }}</router-link></el-descriptions-item>
      </el-descriptions>
      <p>{{ t('operations.readinessHelp') }}</p>
    </template>
  </section>
</template>
