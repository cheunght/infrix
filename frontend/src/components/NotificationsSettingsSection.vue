<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import type { PersonOption as PersonOptionType } from "../types";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";
import { systemSettingHelp, systemSettingLabel } from "./system-settings-ui";

const props = defineProps<{ context: SettingsContext }>();
const context = props.context;
const { t } = useI18n();
const form = context.systemSettingsForm;
const errors = context.systemSettingsFormErrors;
const systemSettingsSaving = context.systemSettingsSaving;
const simpleNotificationFields = ["notify_open_faults", "notify_overdue_inventory", "notify_low_spare_stock"] as const;

function mapDigestPerson(item: Record<string, unknown>): SearchableSelectOption {
  const person = item as unknown as PersonOptionType;
  const email = person.notification_email || person.email || person.account_email || "";
  return {
    value: person.id,
    label: person.display_name || person.name,
    secondary: [person.employee_no, person.department_name, email].filter(Boolean).join(" · "),
    disabled: person.is_active === false || !email,
    data: person,
  };
}
</script>

<template>
  <section class="settings-system__section">
    <div class="settings-system__notification-sections">
      <section class="settings-system__notification-section">
        <header class="settings-system__notification-section-heading settings-system__notification-section-heading--with-control">
          <div class="settings-system__notification-section-heading-copy">
            <h2>{{ t('settings.emailDigestSection') }}</h2>
            <p>{{ t('settings.emailDigestSectionDescription') }}</p>
          </div>
          <div class="settings-system__notification-section-switch">
            <el-form-item class="settings-system__notification-form-item" :error="errors.email_digest_enabled">
              <el-switch v-model="form.email_digest_enabled" :disabled="!context.can('settings.manage') || systemSettingsSaving" :aria-label="t('operations.emailEnabled')" />
            </el-form-item>
            <span class="settings-system__notification-switch-label">{{ form.email_digest_enabled ? t('status.enabled') : t('status.disabled') }}</span>
          </div>
        </header>
        <div class="settings-system__digest-grid">
          <el-form-item :label="t('operations.recipients')" :error="errors.email_digest_people">
            <SearchableSelect
              v-model="form.email_digest_people"
              multiple
              collapse-tags
              :max-collapse-tags="3"
              :request="context.request"
              endpoint="/people/"
              :map-option="mapDigestPerson"
              :base-query="{ is_active: 'all', email_configured: true }"
              :disabled="!context.can('settings.manage') || systemSettingsSaving"
              :placeholder="t('operations.peoplePlaceholder')"
              :aria-label="t('operations.recipients')"
            />
            <div class="settings-system__help">{{ t('operations.emailHelp') }}</div>
          </el-form-item>
          <el-form-item :label="t('operations.additionalRecipients')" :error="errors.email_digest_recipients">
            <el-select v-model="form.email_digest_recipients" multiple filterable allow-create default-first-option :reserve-keyword="false" :disabled="!context.can('settings.manage') || systemSettingsSaving" />
            <div class="settings-system__help">{{ t('operations.additionalEmailHelp') }}</div>
          </el-form-item>
          <el-form-item class="settings-system__digest-full-width" :label="t('operations.applicationUrl')" :error="errors.application_url">
            <el-input v-model="form.application_url" :disabled="!context.can('settings.manage') || systemSettingsSaving" />
          </el-form-item>
        </div>
      </section>

      <section class="settings-system__notification-section">
        <header class="settings-system__notification-section-heading">
          <h2>{{ t('settings.inAppNotificationsSection') }}</h2>
          <p>{{ t('settings.inAppNotificationsSectionDescription') }}</p>
        </header>
        <div class="settings-system__notification-list">
          <div class="settings-system__notification-row">
            <div class="settings-system__notification-copy">
              <div class="settings-system__notification-title">{{ systemSettingLabel('notify_maintenance', t) }}</div>
              <div class="settings-system__help">{{ systemSettingHelp('notify_maintenance', t) }}</div>
            </div>
            <div class="settings-system__notification-field">
              <div class="settings-system__notification-field-label">{{ systemSettingLabel('maintenance_expiry_days', t) }}</div>
              <el-form-item class="settings-system__notification-form-item" :error="errors.maintenance_expiry_days">
                <el-input-number v-model="form.maintenance_expiry_days" :min="0" :max="3650" :step="1" :disabled="!context.can('settings.manage') || systemSettingsSaving" />
              </el-form-item>
              <div class="settings-system__help">{{ systemSettingHelp('maintenance_expiry_days', t) }}</div>
            </div>
            <div class="settings-system__notification-switch">
              <el-form-item class="settings-system__notification-form-item" :error="errors.notify_maintenance">
                <el-switch v-model="form.notify_maintenance" :disabled="!context.can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel('notify_maintenance', t)" />
              </el-form-item>
              <span class="settings-system__notification-switch-label">{{ form.notify_maintenance ? t('status.enabled') : t('status.disabled') }}</span>
            </div>
          </div>

          <div class="settings-system__notification-row">
            <div class="settings-system__notification-copy">
              <div class="settings-system__notification-title">{{ systemSettingLabel('notify_license_expiry', t) }}</div>
              <div class="settings-system__help">{{ systemSettingHelp('notify_license_expiry', t) }}</div>
            </div>
            <div class="settings-system__notification-field">
              <div class="settings-system__notification-field-label">{{ systemSettingLabel('license_expiry_days', t) }}</div>
              <el-form-item class="settings-system__notification-form-item" :error="errors.license_expiry_days">
                <el-input-number v-model="form.license_expiry_days" :min="0" :max="3650" :step="1" :disabled="!context.can('settings.manage') || systemSettingsSaving" />
              </el-form-item>
              <div class="settings-system__help">{{ systemSettingHelp('license_expiry_days', t) }}</div>
            </div>
            <div class="settings-system__notification-switch">
              <el-form-item class="settings-system__notification-form-item" :error="errors.notify_license_expiry">
                <el-switch v-model="form.notify_license_expiry" :disabled="!context.can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel('notify_license_expiry', t)" />
              </el-form-item>
              <span class="settings-system__notification-switch-label">{{ form.notify_license_expiry ? t('status.enabled') : t('status.disabled') }}</span>
            </div>
          </div>

          <div v-for="key in simpleNotificationFields" :key="key" class="settings-system__notification-row settings-system__notification-row--without-field">
            <div class="settings-system__notification-copy settings-system__notification-copy--wide">
              <div class="settings-system__notification-title">{{ systemSettingLabel(key, t) }}</div>
              <div class="settings-system__help">{{ systemSettingHelp(key, t) }}</div>
            </div>
            <div class="settings-system__notification-switch">
              <el-form-item class="settings-system__notification-form-item" :error="errors[key]">
                <el-switch v-model="form[key]" :disabled="!context.can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel(key, t)" />
              </el-form-item>
              <span class="settings-system__notification-switch-label">{{ form[key] ? t('status.enabled') : t('status.disabled') }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
