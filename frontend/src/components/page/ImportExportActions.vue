<script setup lang="ts">
import { ArrowDown, Download, Loading, Upload } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";

defineProps<{ canImport: boolean; canExport: boolean; exporting: boolean }>();
const emit = defineEmits<{ import: []; export: [] }>();
const { t } = useI18n();
</script>

<template>
  <el-dropdown v-if="canImport && canExport" trigger="click">
    <el-button :aria-busy="exporting">
      <el-icon v-if="exporting" class="is-loading"><Loading /></el-icon>
      <span>{{ t('asset.importExport') }}</span><el-icon class="el-icon--right"><ArrowDown /></el-icon>
    </el-button>
    <template #dropdown><el-dropdown-menu>
      <el-dropdown-item :icon="Upload" @click="emit('import')">{{ t('common.import') }}</el-dropdown-item>
      <el-dropdown-item :icon="Download" :disabled="exporting" @click="emit('export')">{{ t(exporting ? 'asset.exporting' : 'common.export') }}</el-dropdown-item>
    </el-dropdown-menu></template>
  </el-dropdown>
  <el-button v-else-if="canImport" :icon="Upload" @click="emit('import')">{{ t('common.import') }}</el-button>
  <el-button v-else-if="canExport" :icon="Download" :loading="exporting" :disabled="exporting" @click="emit('export')">{{ t('common.export') }}</el-button>
</template>
