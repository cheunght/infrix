<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import {
  systemSettingDefinition,
  systemSettingHelp,
  systemSettingLabel,
  systemSettingOptionLabel,
} from "./system-settings-ui";

const props = defineProps<{ context: SettingsContext }>();
const context = props.context;
const { t } = useI18n();
const form = context.systemSettingsForm;
const errors = context.systemSettingsFormErrors;
const systemSettingsSaving = context.systemSettingsSaving;
const systemSettings = context.systemSettings;
const systemSmtpTesting = context.systemSmtpTesting;
const systemSmtpTestRecipient = context.systemSmtpTestRecipient;
const smtpTestRecipientError = computed(() => {
  const value = systemSmtpTestRecipient.value.trim();
  return value && !/^\S+@\S+\.\S+$/.test(value)
    ? t("validation.invalidEmail")
    : "";
});
</script>

<template>
  <section class="settings-system__section">
    <div class="settings-system__form">
      <el-form-item
        :label="systemSettingLabel('smtp_enabled', t)"
        :error="errors.smtp_enabled"
      >
        <el-switch
          v-model="form.smtp_enabled"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
        />
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_enabled", t) }}
        </div>
      </el-form-item>
      <el-form-item
        :label="systemSettingLabel('smtp_security_mode', t)"
        :error="errors.smtp_security_mode"
      >
        <el-select
          v-model="form.smtp_security_mode"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
          class="settings-system__control"
        >
          <el-option
            v-for="option in systemSettingDefinition('smtp_security_mode')
              ?.options || []"
            :key="String(option.value)"
            :label="systemSettingOptionLabel('smtp_security_mode', option, t)"
            :value="option.value"
          />
        </el-select>
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_security_mode", t) }}
        </div>
      </el-form-item>
      <el-form-item
        :label="systemSettingLabel('smtp_host', t)"
        :error="errors.smtp_host"
      >
        <el-input
          v-model="form.smtp_host"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
          autocomplete="off"
        />
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_host", t) }}
        </div>
      </el-form-item>
      <el-form-item
        :label="systemSettingLabel('smtp_port', t)"
        :error="errors.smtp_port"
      >
        <el-input-number
          v-model="form.smtp_port"
          :min="1"
          :max="65535"
          :step="1"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
          class="settings-system__control"
        />
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_port", t) }}
        </div>
      </el-form-item>
      <el-form-item
        :label="systemSettingLabel('smtp_username', t)"
        :error="errors.smtp_username"
      >
        <el-input
          v-model="form.smtp_username"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
          autocomplete="username"
        />
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_username", t) }}
        </div>
      </el-form-item>
      <el-form-item
        :label="t('settings.smtpPassword')"
        :error="errors.smtp_password"
      >
        <el-input
          v-model="form.smtp_password"
          type="password"
          show-password
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
          autocomplete="new-password"
          :placeholder="
            systemSettings?.smtp_password_configured
              ? t('settings.smtpPasswordKeep')
              : t('settings.smtpPasswordPlaceholder')
          "
        />
        <div class="settings-system__help">
          {{
            systemSettings?.smtp_password_configured
              ? t("settings.smtpPasswordConfigured")
              : t("settings.smtpPasswordNotConfigured")
          }}
        </div>
      </el-form-item>
      <el-form-item
        :label="systemSettingLabel('smtp_from_email', t)"
        :error="errors.smtp_from_email"
      >
        <el-input
          v-model="form.smtp_from_email"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
          autocomplete="email"
        />
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_from_email", t) }}
        </div>
      </el-form-item>
      <el-form-item
        :label="systemSettingLabel('smtp_from_name', t)"
        :error="errors.smtp_from_name"
      >
        <el-input
          v-model="form.smtp_from_name"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
        />
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_from_name", t) }}
        </div>
      </el-form-item>
      <el-form-item
        :label="systemSettingLabel('smtp_timeout', t)"
        :error="errors.smtp_timeout"
      >
        <el-input-number
          v-model="form.smtp_timeout"
          :min="1"
          :max="120"
          :step="1"
          :disabled="!context.can('settings.manage') || systemSettingsSaving"
          class="settings-system__control"
        />
        <div class="settings-system__help">
          {{ systemSettingHelp("smtp_timeout", t) }}
        </div>
      </el-form-item>
      <el-form-item
        class="settings-system__smtp-test-item"
        :label="t('settings.smtpTestRecipient')"
        :error="smtpTestRecipientError"
      >
        <div class="settings-system__smtp-test-controls">
          <div class="settings-system__smtp-test-row">
            <el-input
              v-model="systemSmtpTestRecipient"
              type="email"
              :disabled="!context.can('settings.manage') || systemSmtpTesting"
              autocomplete="email"
              :placeholder="t('settings.smtpTestRecipientPlaceholder')"
            />
            <el-button
              v-if="context.can('settings.manage')"
              type="primary"
              plain
              :loading="systemSmtpTesting"
              :disabled="systemSmtpTesting"
              @click="context.testSystemSmtp"
              >{{ t("settings.smtpTest") }}</el-button
            >
          </div>
          <div class="settings-system__help">
            {{ t("settings.smtpTestRecipientHelp") }}
          </div>
        </div>
      </el-form-item>
    </div>
  </section>
</template>
