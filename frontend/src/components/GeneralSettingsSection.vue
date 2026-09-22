<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import { systemSettingDefinition, systemSettingHelp, systemSettingLabel, systemSettingOptionLabel } from "./system-settings-ui";

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
      <el-form-item :label="systemSettingLabel('default_page_size', t)" :error="errors.default_page_size">
        <el-select v-model="form.default_page_size" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control">
          <el-option v-for="option in (systemSettingDefinition('default_page_size')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('default_page_size', option, t)" :value="option.value" />
        </el-select>
        <div class="settings-system__help">{{ systemSettingHelp('default_page_size', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('default_asset_status', t)" :error="errors.default_asset_status">
        <el-select v-model="form.default_asset_status" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control">
          <el-option v-for="option in (systemSettingDefinition('default_asset_status')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('default_asset_status', option, t)" :value="option.value" />
        </el-select>
        <div class="settings-system__help">{{ systemSettingHelp('default_asset_status', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('default_locale', t)" :error="errors.default_locale">
        <el-select v-model="form.default_locale" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control">
          <el-option v-for="option in (systemSettingDefinition('default_locale')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('default_locale', option, t)" :value="option.value" />
        </el-select>
        <div class="settings-system__help">{{ systemSettingHelp('default_locale', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('date_format', t)" :error="errors.date_format">
        <el-select v-model="form.date_format" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control">
          <el-option v-for="option in (systemSettingDefinition('date_format')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('date_format', option, t)" :value="option.value" />
        </el-select>
        <div class="settings-system__help">{{ systemSettingHelp('date_format', t) }}</div>
      </el-form-item>
      <el-form-item :label="systemSettingLabel('currency', t)" :error="errors.currency">
        <el-select v-model="form.currency" :disabled="!context.can('settings.manage') || systemSettingsSaving" class="settings-system__control">
          <el-option v-for="option in (systemSettingDefinition('currency')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('currency', option, t)" :value="option.value" />
        </el-select>
        <div class="settings-system__help">{{ systemSettingHelp('currency', t) }}</div>
      </el-form-item>
    </div>
  </section>
</template>
