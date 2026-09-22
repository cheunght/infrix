<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import type { SystemSettingsForm } from "../types";
import type { SystemSettingsTab } from "../router";
import { SYSTEM_SETTING_DEFINITIONS } from "../system-settings-config";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import BrandingSettings from "./BrandingSettings.vue";
import GeneralSettingsSection from "./GeneralSettingsSection.vue";
import SecuritySettingsSection from "./SecuritySettingsSection.vue";
import SmtpSettingsSection from "./SmtpSettingsSection.vue";
import NotificationsSettingsSection from "./NotificationsSettingsSection.vue";

const props = defineProps<{ context: SettingsContext }>();
const context = props.context;
const { t } = useI18n();

type BrandingSettingsHandle = {
  busy: boolean;
  ready: boolean;
  save: (reset?: boolean) => Promise<void>;
};

const brandingSettingsRef = ref<BrandingSettingsHandle | null>(null);
const brandingBusy = computed(() => brandingSettingsRef.value?.busy ?? true);
const brandingReady = computed(() => brandingSettingsRef.value?.ready ?? false);
const systemSettings = context.systemSettings;
const systemSettingsForm = context.systemSettingsForm;
const systemSettingsErrors = context.systemSettingsFormErrors;
const systemSettingsTab = context.systemSettingsTab;
// Context is a plain object of refs; template expressions only unwrap top-level refs.
const systemSettingsLoading = context.systemSettingsLoading;
const systemSettingsSaving = context.systemSettingsSaving;
const systemSettingsError = context.systemSettingsError;
const smtpTestRecipientError = computed(() => {
  const value = context.systemSmtpTestRecipient.value.trim();
  return value && !/^\S+@\S+\.\S+$/.test(value);
});
const systemSettingsCategories = computed<Array<{ value: SystemSettingsTab; label: string }>>(() => [
  { value: "general", label: t("settings.generalSection") },
  { value: "security", label: t("settings.securitySection") },
  { value: "smtp", label: t("settings.smtpSection") },
  { value: "notifications", label: t("settings.notificationsSection") },
  { value: "branding", label: t("branding.title") },
]);

const fieldsByCategory: Record<Exclude<SystemSettingsTab, "branding">, readonly (keyof SystemSettingsForm)[]> = {
  general: SYSTEM_SETTING_DEFINITIONS.filter((item) => item.section === "general").map((item) => item.key as keyof SystemSettingsForm),
  security: SYSTEM_SETTING_DEFINITIONS.filter((item) => item.section === "security").map((item) => item.key as keyof SystemSettingsForm),
  smtp: [
    ...SYSTEM_SETTING_DEFINITIONS.filter((item) => item.section === "smtp").map((item) => item.key as keyof SystemSettingsForm),
    "smtp_password",
  ],
  notifications: SYSTEM_SETTING_DEFINITIONS.filter((item) => item.section === "notifications").map((item) => item.key as keyof SystemSettingsForm),
};

const systemSettingsCategoryDirty = computed<Record<SystemSettingsTab, boolean>>(() => {
  const result: Record<SystemSettingsTab, boolean> = { general: false, security: false, smtp: false, notifications: false, branding: false };
  if (!systemSettings.value) return result;
  const baseline = systemSettings.value as unknown as Record<string, unknown>;
  for (const category of ["general", "security", "smtp", "notifications"] as const) {
    result[category] = fieldsByCategory[category].some((key) =>
      key === "smtp_password"
        ? Boolean(systemSettingsForm.value.smtp_password)
        : JSON.stringify(systemSettingsForm.value[key]) !== JSON.stringify(baseline[key]),
    );
  }
  return result;
});

const systemSettingsCategoryErrors = computed<Record<SystemSettingsTab, boolean>>(() => {
  const result: Record<SystemSettingsTab, boolean> = { general: false, security: false, smtp: false, notifications: false, branding: false };
  for (const category of ["general", "security", "smtp", "notifications"] as const) {
    result[category] = fieldsByCategory[category].some((key) => Boolean(systemSettingsErrors.value[key]));
  }
  result.smtp = result.smtp || Boolean(smtpTestRecipientError.value);
  return result;
});

const currentSystemSettingsKeys = computed<readonly (keyof SystemSettingsForm)[]>(() =>
  systemSettingsTab.value === "branding" ? [] : fieldsByCategory[systemSettingsTab.value],
);
const currentSystemSettingsDirty = computed(() => systemSettingsCategoryDirty.value[systemSettingsTab.value]);
const systemSettingsTabItems = computed<PageTabItem[]>(() => systemSettingsCategories.value.map((category) => ({
  ...category,
  status: systemSettingsCategoryErrors.value[category.value]
    ? "error"
    : systemSettingsCategoryDirty.value[category.value]
      ? "warning"
      : undefined,
  statusLabel: systemSettingsCategoryErrors.value[category.value]
    ? t("settings.categoryHasErrors")
    : systemSettingsCategoryDirty.value[category.value]
      ? t("settings.categoryHasUnsavedChanges")
      : undefined,
})));

function resetCurrentSystemSettingsForm() {
  context.resetSystemSettingsForm(currentSystemSettingsKeys.value);
}

function saveCurrentSystemSettings() {
  return context.saveSystemSettings(currentSystemSettingsKeys.value);
}

function saveBranding(reset = false) {
  void brandingSettingsRef.value?.save(reset);
}
</script>

<template>
  <PageContainer>
    <template #subnav>
      <PageTabs v-model="systemSettingsTab" :items="systemSettingsTabItems" @update:model-value="context.changeSystemSettingsTab" />
    </template>
    <PageContent surface>
      <PageToolbar v-if="systemSettings" class="settings-form-toolbar">
        <template #primary>
          <div v-if="systemSettingsTab !== 'branding'" class="settings-system__actions">
            <el-button :disabled="!currentSystemSettingsDirty || systemSettingsSaving" @click="resetCurrentSystemSettingsForm">{{ t('settings.restoreUnsaved') }}</el-button>
            <el-button v-if="context.can('settings.manage')" type="primary" :loading="systemSettingsSaving" :disabled="!currentSystemSettingsDirty || systemSettingsSaving" @click="saveCurrentSystemSettings">{{ t('settings.saveSettings') }}</el-button>
          </div>
          <div v-else class="settings-system__actions">
            <el-button :disabled="brandingBusy || !brandingReady || !context.can('settings.manage')" @click="saveBranding(true)">{{ t('branding.restore') }}</el-button>
            <el-button type="primary" :disabled="brandingBusy || !brandingReady || !context.can('settings.manage')" @click="saveBranding()">{{ t('branding.save') }}</el-button>
          </div>
        </template>
      </PageToolbar>
      <div v-loading="systemSettingsLoading" class="settings-system">
        <el-alert v-if="systemSettingsError" :title="t('common.dataLoadFailed')" type="error" show-icon :closable="false">
          <template #default>
            <span>{{ systemSettingsError }}</span>
            <el-button link type="danger" :loading="systemSettingsLoading" @click="context.retrySystemSettings">{{ t('common.retry') }}</el-button>
          </template>
        </el-alert>
        <template v-else-if="systemSettings">
          <el-alert v-if="!context.can('settings.manage')" class="settings-system__readonly-alert" :title="t('settings.readOnlyAccount')" :description="t('settings.readOnlySettings')" type="info" show-icon :closable="false" />
          <el-form label-position="top" @submit.prevent="saveCurrentSystemSettings">
            <GeneralSettingsSection v-if="systemSettingsTab === 'general'" :context="context" />
            <SecuritySettingsSection v-else-if="systemSettingsTab === 'security'" :context="context" />
            <SmtpSettingsSection v-else-if="systemSettingsTab === 'smtp'" :context="context" />
            <NotificationsSettingsSection v-else-if="systemSettingsTab === 'notifications'" :context="context" />
            <BrandingSettings v-else ref="brandingSettingsRef" :context="context" />
          </el-form>
        </template>
      </div>
    </PageContent>
  </PageContainer>
</template>
