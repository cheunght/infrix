<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Check, Compass } from "@element-plus/icons-vue";
import { localeLabel, setLocale, SUPPORTED_LOCALES, type Locale } from "../i18n";

const { t, locale } = useI18n();

function changeLocale(value: string | number | object) {
  setLocale(value);
}
</script>

<template>
  <el-dropdown class="language-switcher" trigger="click" @command="changeLocale">
    <el-button class="language-switcher__trigger" text :aria-label="t('auth.languagePreference')">
      <el-icon><Compass /></el-icon>
      <span>{{ localeLabel(locale as Locale) }}</span>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="item in SUPPORTED_LOCALES"
          :key="item"
          :command="item"
          :disabled="item === locale"
        >
          <span class="language-switcher__option">
            <span>{{ item === 'zh-CN' ? t('auth.simplifiedChinese') : t('auth.english') }}</span>
            <el-icon v-if="item === locale"><Check /></el-icon>
          </span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
