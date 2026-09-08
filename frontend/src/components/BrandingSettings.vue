<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import type { UploadFile } from "element-plus";
import type { SettingsContext } from "../page-context";
import { applyBranding, type Branding } from "../branding";
import { normalizeApiError } from "../error-handling";
import { isAbortError } from "../api";

const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();
const name = ref("");
const saved = ref<Branding | null>(null);
const busy = ref(false);
const error = ref("");
const fields = ref<Record<string, string[]>>({});
const files = ref<Partial<Record<string, File>>>({});
const kinds = ["logo", "compact_logo", "favicon"] as const;
const uploadKey = ref(0);
let generation = 0;
let loadController: AbortController | null = null;
onBeforeUnmount(() => {
  generation += 1;
  loadController?.abort();
});
function accept(value: Branding) {
  saved.value = value;
  name.value = value.display_name;
  files.value = {};
  uploadKey.value += 1;
}
async function load() {
  const current = ++generation;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  error.value = "";
  busy.value = true;
  try {
    // Tab query navigation can restart page loads after this component mounts.
    // Keep this read scoped to the component instead of the page load signal.
    const value = await props.context.request<Branding>("/system/settings/branding/", { signal: controller.signal });
    if (current === generation) accept(value);
  } catch (cause) {
    if (current === generation && !isAbortError(cause)) error.value = normalizeApiError(cause).message;
  } finally {
    if (current === generation) {
      busy.value = false;
      loadController = null;
    }
  }
}
function select(kind: string, file: UploadFile) {
  if (file.raw) files.value[kind] = file.raw;
}
function clearPreview(kind: typeof kinds[number]) {
  if (saved.value) saved.value = { ...saved.value, [kind]: null };
}
async function save(reset = false) {
  if (busy.value) return;
  const current = ++generation;
  busy.value = true;
  error.value = "";
  fields.value = {};
  const body = new FormData();
  if (reset) body.append("reset", "true");
  else {
    body.append("display_name", name.value);
    for (const kind of kinds) if (files.value[kind]) body.append(kind, files.value[kind]!);
  }
  try {
    const value = await props.context.request<Branding>("/system/settings/branding/", { method: "PATCH", body });
    applyBranding(value);
    if (current === generation) {
      accept(value);
      ElMessage.success(t("common.saveSuccess"));
    }
  } catch (cause) {
    if (current === generation) {
      const normalized = normalizeApiError(cause);
      fields.value = normalized.fieldErrors;
      error.value = normalized.message;
    }
  } finally {
    if (current === generation) busy.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div v-loading="busy" class="settings-branding">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-button v-if="!saved && !busy" @click="load">{{ t('common.retry') }}</el-button>
    <template v-if="saved">
      <p class="settings-branding__description">{{ t('branding.description') }}</p>
      <el-form-item :label="t('branding.displayName')" :error="fields.display_name?.join('；')">
        <el-input v-model="name" :maxlength="80" :disabled="busy || !context.can('settings.manage')" />
      </el-form-item>
      <el-form-item v-for="kind in kinds" :key="kind" :label="t(`branding.${kind}`)" :error="fields[kind]?.join('；')">
        <div class="settings-branding__upload">
          <img v-if="saved[kind]" class="settings-branding__preview" :src="saved[kind]!" :alt="t(`branding.${kind}`)" @error="clearPreview(kind)" />
          <el-upload :key="`${kind}-${uploadKey}`" :auto-upload="false" :limit="1" :accept="kind === 'favicon' ? '.png' : '.png,.jpg,.jpeg,.webp'" :disabled="busy || !context.can('settings.manage')" :on-change="(file: UploadFile) => select(kind, file)" :on-remove="() => { delete files[kind]; }">
            <el-button :disabled="busy || !context.can('settings.manage')">{{ t('common.upload') }}</el-button>
            <template #tip><div class="el-upload__tip">{{ t('branding.uploadHelp') }}</div></template>
          </el-upload>
        </div>
      </el-form-item>
      <div class="settings-branding__actions">
        <el-button :disabled="busy || !context.can('settings.manage')" @click="save(true)">{{ t('branding.restore') }}</el-button>
        <el-button type="primary" :disabled="busy || !context.can('settings.manage')" @click="save()">{{ t('branding.save') }}</el-button>
      </div>
    </template>
  </div>
</template>
