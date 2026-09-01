<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Check, Compass } from "@element-plus/icons-vue";
import { loadLocaleMessages, setLocale, SUPPORTED_LOCALES, type Locale } from "../i18n";

withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ change: [locale: Locale] }>();

const { t, locale } = useI18n();

async function changeLocale(value: string | number | object) {
  await loadLocaleMessages(value);
  const locale = setLocale(value);
  emit("change", locale);
}
</script>

<template>
  <el-dropdown class="language-switcher" trigger="click" @command="changeLocale">
    <el-button
      class="language-switcher__trigger"
      text
      :disabled="disabled"
      :aria-label="t('auth.languagePreference')"
      :title="t('auth.languagePreference')"
    >
      <el-icon class="header-control-icon"><Compass /></el-icon>
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
