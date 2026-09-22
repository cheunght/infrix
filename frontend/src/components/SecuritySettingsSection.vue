<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import { systemSettingHelp, systemSettingLabel } from "./system-settings-ui";

const props = defineProps<{ context: SettingsContext }>();
const context = props.context;
const { t } = useI18n();
const form = context.systemSettingsForm;
const errors = context.systemSettingsFormErrors;
const systemSettingsSaving = context.systemSettingsSaving;
</script>

<template>
  <section class="settings-system__section">
    <div class="settings-system__form">
      <el-form-item :label="systemSettingLabel('password_min_length', t)" :error="errors.password_min_length">
        <el-input-number v-model="form.password_min_length" :min="8" :max="128" :step="1" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
        <div class="settings-system__help">{{ systemSettingHelp('password_min_length', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('password_expiry_days', t)" :error="errors.password_expiry_days">
        <el-input-number v-model="form.password_expiry_days" :min="0" :max="3650" :step="1" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
        <div class="settings-system__help">{{ systemSettingHelp('password_expiry_days', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('login_max_attempts', t)" :error="errors.login_max_attempts">
        <el-input-number v-model="form.login_max_attempts" :min="1" :max="100" :step="1" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
        <div class="settings-system__help">{{ systemSettingHelp('login_max_attempts', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('login_window_seconds', t)" :error="errors.login_window_seconds">
        <el-input-number v-model="form.login_window_seconds" :min="1" :max="86400" :step="60" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
        <div class="settings-system__help">{{ systemSettingHelp('login_window_seconds', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('login_lock_seconds', t)" :error="errors.login_lock_seconds">
        <el-input-number v-model="form.login_lock_seconds" :min="1" :max="86400" :step="60" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
        <div class="settings-system__help">{{ systemSettingHelp('login_lock_seconds', t) }}</div>
      </el-form-item>
    </div>
  </section>
</template>
