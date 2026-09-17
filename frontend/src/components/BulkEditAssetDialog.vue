<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { normalizeApiError } from "../error-handling";
import type { RequestFn } from "../page-context";
import type {
  Asset,
  AssetBulkEditResponse,
  AssetModel,
  DataCenter,
  DictionaryItem,
  Rack,
  ServerRoom,
  Tag,
} from "../types";
import ActionDialogShell from "./ActionDialogShell.vue";
import SearchableSelect, { type SearchableSelectOption, type SearchableSelectValue } from "./SearchableSelect.vue";

const props = defineProps<{
  modelValue: boolean;
  selectedAssets: Asset[];
  request: RequestFn;
  can: (capability: string) => boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  completed: [result: AssetBulkEditResponse];
  unknown: [];
}>();

const { t } = useI18n();

type ChangeKey = "model" | "location" | "tags" | "purpose";

const form = reactive({
  modelEnabled: false,
  modelMode: "set" as "set" | "clear",
  modelId: "",
  clearDeviceTypeId: "",
  clearManufacturerId: "",
  clearModelText: "",
  locationEnabled: false,
  locationAction: "set" as "set" | "clear",
  dataCenterId: "",
  roomId: "",
  rackId: "",
  startU: "",
  endU: "",
  tagsEnabled: false,
  tagsMode: "add" as "add" | "remove" | "replace",
  tagIds: [] as string[],
  purposeEnabled: false,
  purposeAction: "set" as "set" | "clear",
  purpose: "",
});

const selectedModelOption = ref<SearchableSelectOption | null>(null);
const selectedClearDeviceTypeOption = ref<SearchableSelectOption | null>(null);
const selectedClearManufacturerOption = ref<SearchableSelectOption | null>(null);
const selectedDataCenterOption = ref<SearchableSelectOption | null>(null);
const selectedRoomOption = ref<SearchableSelectOption | null>(null);
const selectedRackOption = ref<SearchableSelectOption | null>(null);
const selectedTagOptions = ref<SearchableSelectOption[]>([]);
const pending = ref(false);
const error = ref("");
const step = ref<"form" | "result">("form");
const result = ref<AssetBulkEditResponse | null>(null);

const selectedCount = computed(() => props.selectedAssets.length);
const enabledChangeCount = computed(() => [
  form.modelEnabled,
  form.locationEnabled,
  form.tagsEnabled,
  form.purposeEnabled,
].filter(Boolean).length);
const failures = computed(() => (result.value?.results || []).filter((item) => !item.success));
const tagModeLabel = computed(() => ({
  add: t("asset.bulkEditTagsAdd"),
  remove: t("asset.bulkEditTagsRemove"),
  replace: t("asset.bulkEditTagsReplace"),
}[form.tagsMode]));

function selectedOptionLabel(option: SearchableSelectOption | null, fallback: string): string {
  return option?.label || fallback || t("common.notAvailable");
}

const changeSummary = computed(() => {
  const summary: string[] = [];
  if (form.modelEnabled) {
    summary.push(form.modelMode === "set"
      ? `${t("asset.bulkEditModel")} → ${selectedOptionLabel(selectedModelOption.value, form.modelId)}`
      : `${t("asset.bulkEditModel")} → ${t("asset.bulkEditClear")}`);
  }
  if (form.locationEnabled) {
    summary.push(form.locationAction === "set"
      ? `${t("asset.bulkEditLocation")} → ${[
        selectedOptionLabel(selectedDataCenterOption.value, form.dataCenterId),
        selectedOptionLabel(selectedRoomOption.value, form.roomId),
        selectedOptionLabel(selectedRackOption.value, form.rackId),
      ].join(" / ")} · U${form.startU || "—"}–U${form.endU || "—"}`
      : `${t("asset.bulkEditLocation")} → ${t("asset.bulkEditLocationClear")}`);
  }
  if (form.tagsEnabled) {
    const labels = selectedTagOptions.value.map((option) => option.label).filter(Boolean);
    summary.push(`${t("asset.bulkEditTags")} → ${tagModeLabel.value}${labels.length ? `：${labels.join("、")}` : ""}`);
  }
  if (form.purposeEnabled) {
    summary.push(form.purposeAction === "set"
      ? `${t("asset.bulkEditPurpose")} → ${form.purpose.trim() || t("common.notAvailable")}`
      : `${t("asset.bulkEditPurpose")} → ${t("asset.bulkEditClear")}`);
  }
  return summary;
});

function valueAsString(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined): string {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected == null ? "" : String(selected);
}

function valuesAsStrings(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined): string[] {
  return (Array.isArray(value) ? value : value == null ? [] : [value]).map(String);
}

function mapModel(item: Record<string, unknown>): SearchableSelectOption {
  const model = item as unknown as AssetModel;
  return {
    value: String(model.id),
    label: model.name,
    secondary: [model.model_number, model.manufacturer_name, model.device_type_name].filter(Boolean).join(" · "),
    data: model,
  };
}

function mapDictionary(item: Record<string, unknown>): SearchableSelectOption {
  const dictionary = item as unknown as DictionaryItem;
  return {
    value: String(dictionary.id),
    label: dictionary.name,
    secondary: dictionary.code || "",
    data: dictionary,
  };
}

function mapDataCenter(item: Record<string, unknown>): SearchableSelectOption {
  const center = item as unknown as DataCenter;
  return { value: String(center.id), label: center.name, secondary: center.address || "", data: center };
}

function mapRoom(item: Record<string, unknown>): SearchableSelectOption {
  const room = item as unknown as ServerRoom;
  return { value: String(room.id), label: room.name, secondary: room.data_center_name || "", data: room };
}

function mapRack(item: Record<string, unknown>): SearchableSelectOption {
  const rack = item as unknown as Rack;
  return {
    value: String(rack.id),
    label: rack.code,
    secondary: [rack.name, rack.server_room_name, rack.data_center_name].filter(Boolean).join(" · "),
    data: rack,
  };
}

function mapTag(item: Record<string, unknown>): SearchableSelectOption {
  const tag = item as unknown as Tag;
  return { value: String(tag.id), label: tag.name, data: tag };
}

function handleModel(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined, option?: SearchableSelectOption | SearchableSelectOption[] | null) {
  form.modelId = valueAsString(value);
  if (option !== undefined) selectedModelOption.value = Array.isArray(option) ? option[0] || null : option;
  if (!form.modelId) selectedModelOption.value = null;
}

function handleClearDeviceType(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined, option?: SearchableSelectOption | SearchableSelectOption[] | null) {
  form.clearDeviceTypeId = valueAsString(value);
  if (option !== undefined) selectedClearDeviceTypeOption.value = Array.isArray(option) ? option[0] || null : option;
  if (!form.clearDeviceTypeId) selectedClearDeviceTypeOption.value = null;
}

function handleClearManufacturer(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined, option?: SearchableSelectOption | SearchableSelectOption[] | null) {
  form.clearManufacturerId = valueAsString(value);
  if (option !== undefined) selectedClearManufacturerOption.value = Array.isArray(option) ? option[0] || null : option;
  if (!form.clearManufacturerId) selectedClearManufacturerOption.value = null;
}

function handleDataCenter(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined, option?: SearchableSelectOption | SearchableSelectOption[] | null) {
  form.dataCenterId = valueAsString(value);
  if (option !== undefined) selectedDataCenterOption.value = Array.isArray(option) ? option[0] || null : option;
  if (!form.dataCenterId) selectedDataCenterOption.value = null;
  form.roomId = "";
  form.rackId = "";
  selectedRoomOption.value = null;
  selectedRackOption.value = null;
}

function handleRoom(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined, option?: SearchableSelectOption | SearchableSelectOption[] | null) {
  form.roomId = valueAsString(value);
  if (option !== undefined) selectedRoomOption.value = Array.isArray(option) ? option[0] || null : option;
  if (!form.roomId) selectedRoomOption.value = null;
  form.rackId = "";
  selectedRackOption.value = null;
}

function handleRack(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined, option?: SearchableSelectOption | SearchableSelectOption[] | null) {
  form.rackId = valueAsString(value);
  if (option !== undefined) selectedRackOption.value = Array.isArray(option) ? option[0] || null : option;
  if (!form.rackId) selectedRackOption.value = null;
}

function handleTags(value: SearchableSelectValue | SearchableSelectValue[] | null | undefined, option?: SearchableSelectOption | SearchableSelectOption[] | null) {
  form.tagIds = valuesAsStrings(value);
  if (option !== undefined) selectedTagOptions.value = Array.isArray(option) ? option : option ? [option] : [];
  if (!form.tagIds.length) selectedTagOptions.value = [];
}

function resetForm() {
  Object.assign(form, {
    modelEnabled: false,
    modelMode: "set",
    modelId: "",
    clearDeviceTypeId: "",
    clearManufacturerId: "",
    clearModelText: "",
    locationEnabled: false,
    locationAction: "set",
    dataCenterId: "",
    roomId: "",
    rackId: "",
    startU: "",
    endU: "",
    tagsEnabled: false,
    tagsMode: "add",
    tagIds: [],
    purposeEnabled: false,
    purposeAction: "set",
    purpose: "",
  });
  selectedModelOption.value = null;
  selectedClearDeviceTypeOption.value = null;
  selectedClearManufacturerOption.value = null;
  selectedDataCenterOption.value = null;
  selectedRoomOption.value = null;
  selectedRackOption.value = null;
  selectedTagOptions.value = [];
  error.value = "";
  step.value = "form";
  result.value = null;
}

function validationError(): string {
  if (!selectedCount.value) return t("asset.bulkEditNoSelection");
  if (selectedCount.value > 100) return t("asset.bulkEditLimit");
  if (!enabledChangeCount.value) return t("asset.bulkEditSelectField");
  if (form.modelEnabled) {
    if (form.modelMode === "set" && !form.modelId) return t("asset.bulkEditModelRequired");
    if (form.modelMode === "clear" && !form.clearDeviceTypeId) return t("asset.bulkEditDeviceTypeRequired");
  }
  if (form.locationEnabled && form.locationAction === "set") {
    if (!form.dataCenterId || !form.roomId || !form.rackId) return t("asset.bulkEditLocationRequired");
    const start = Number(form.startU);
    const end = Number(form.endU);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return t("asset.bulkEditURangeInvalid");
  }
  return "";
}

function buildChanges() {
  return {
    model: {
      enabled: form.modelEnabled,
      mode: form.modelMode,
      asset_model: form.modelId ? Number(form.modelId) : undefined,
      device_type: form.clearDeviceTypeId ? Number(form.clearDeviceTypeId) : undefined,
      manufacturer: form.clearManufacturerId ? Number(form.clearManufacturerId) : null,
      model_text: form.clearModelText.trim(),
    },
    location: {
      enabled: form.locationEnabled,
      action: form.locationAction,
      data_center: form.dataCenterId ? Number(form.dataCenterId) : undefined,
      server_room: form.roomId ? Number(form.roomId) : undefined,
      rack: form.rackId ? Number(form.rackId) : undefined,
      start_u: form.startU ? Number(form.startU) : undefined,
      end_u: form.endU ? Number(form.endU) : undefined,
    },
    tags: {
      enabled: form.tagsEnabled,
      mode: form.tagsMode,
      values: form.tagIds.map(Number),
    },
    purpose: {
      enabled: form.purposeEnabled,
      action: form.purposeAction,
      value: form.purpose.trim(),
    },
  };
}

async function submit() {
  if (pending.value) return;
  const validation = validationError();
  if (validation) {
    error.value = validation;
    return;
  }
  pending.value = true;
  error.value = "";
  try {
    const payload = await props.request<AssetBulkEditResponse>("/assets/bulk-edit/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: props.selectedAssets.map((asset) => asset.id),
        changes: buildChanges(),
      }),
    });
    result.value = payload;
    step.value = "result";
    emit("completed", payload);
  } catch (cause) {
    const normalized = normalizeApiError(cause);
    error.value = normalized.kind === "unknown"
      ? t("asset.bulkEditNetworkUnknown")
      : normalized.message || t("asset.bulkEditFailed");
    if (normalized.kind === "unknown") emit("unknown");
  } finally {
    pending.value = false;
  }
}

function close() {
  if (pending.value) return;
  emit("update:modelValue", false);
}

watch(() => props.modelValue, (open) => {
  if (open) resetForm();
});

const modelQuery = computed(() => ({ is_active: true }));
const deviceTypeQuery = computed(() => ({ is_active: true }));
const manufacturerQuery = computed(() => ({ is_active: true }));
const dataCenterQuery = computed(() => ({ is_active: true }));
const roomQuery = computed(() => ({ is_active: true, data_center: form.dataCenterId || undefined }));
const rackQuery = computed(() => ({ is_active: true, room: form.roomId || undefined, status: "in_use" }));
</script>

<template>
  <ActionDialogShell
    :model-value="modelValue"
    :title="t('asset.bulkEditTitle')"
    :description="t('asset.bulkEditDescription', { count: selectedCount })"
    size="large"
    :pending="pending"
    :error="error"
    :close-disabled="pending"
    :show-close="!pending"
    :close-on-click-modal="!pending"
    :close-on-press-escape="!pending"
    @update:model-value="emit('update:modelValue', $event)"
    @close="close"
  >
    <template v-if="step === 'form'">
      <div class="bulk-edit-asset__selected" aria-live="polite">
        <strong>{{ t('asset.bulkEditSelected', { count: selectedCount }) }}</strong>
        <div class="bulk-edit-asset__asset-list">
          <el-tag v-for="asset in selectedAssets" :key="asset.id" type="info">{{ asset.asset_no || `ID ${asset.id}` }}</el-tag>
        </div>
      </div>

      <div v-if="changeSummary.length" class="bulk-edit-asset__review" aria-live="polite">
        <strong>{{ t('asset.bulkEditReviewTitle', { count: selectedCount }) }}</strong>
        <ul>
          <li v-for="item in changeSummary" :key="item">{{ item }}</li>
        </ul>
        <p>{{ t('asset.bulkEditReviewHint') }}</p>
      </div>

      <div class="bulk-edit-asset__fields">
        <section class="bulk-edit-asset__field" :class="{ 'is-enabled': form.modelEnabled }">
          <label class="bulk-edit-asset__check"><input v-model="form.modelEnabled" type="checkbox" /><span>{{ t('asset.bulkEditModel') }}</span></label>
          <div v-if="form.modelEnabled" class="bulk-edit-asset__controls">
            <el-radio-group v-model="form.modelMode" size="small">
              <el-radio-button label="set">{{ t('asset.bulkEditSet') }}</el-radio-button>
              <el-radio-button label="clear">{{ t('asset.bulkEditLocationClear') }}</el-radio-button>
            </el-radio-group>
            <SearchableSelect
              v-if="form.modelMode === 'set'"
              :model-value="form.modelId"
              :request="request"
              endpoint="/asset-models/"
              :map-option="mapModel"
              :selected-option="selectedModelOption"
              :base-query="modelQuery"
              :placeholder="t('asset.bulkEditModelPlaceholder')"
              :aria-label="t('asset.bulkEditModel')"
              @update:model-value="handleModel"
              @select="(option) => handleModel(form.modelId, option)"
            />
            <template v-else>
              <SearchableSelect
                :model-value="form.clearDeviceTypeId"
                :request="request"
                endpoint="/device-types/"
                :map-option="mapDictionary"
                :selected-option="selectedClearDeviceTypeOption"
                :base-query="deviceTypeQuery"
                :placeholder="t('asset.bulkEditDeviceTypePlaceholder')"
                :aria-label="t('asset.deviceType')"
                @update:model-value="handleClearDeviceType"
                @select="(option) => handleClearDeviceType(form.clearDeviceTypeId, option)"
              />
              <SearchableSelect
                :model-value="form.clearManufacturerId"
                :request="request"
                endpoint="/manufacturers/"
                :map-option="mapDictionary"
                :selected-option="selectedClearManufacturerOption"
                :base-query="manufacturerQuery"
                :placeholder="t('asset.manufacturer')"
                :aria-label="t('asset.manufacturer')"
                clearable
                @update:model-value="handleClearManufacturer"
                @select="(option) => handleClearManufacturer(form.clearManufacturerId, option)"
              />
              <el-input v-model="form.clearModelText" :placeholder="t('asset.bulkEditModelTextPlaceholder')" maxlength="160" />
            </template>
          </div>
        </section>

        <section class="bulk-edit-asset__field" :class="{ 'is-enabled': form.locationEnabled }">
          <label class="bulk-edit-asset__check"><input v-model="form.locationEnabled" type="checkbox" /><span>{{ t('asset.bulkEditLocation') }}</span></label>
          <div v-if="form.locationEnabled" class="bulk-edit-asset__controls">
            <el-radio-group v-model="form.locationAction" size="small">
              <el-radio-button label="set">{{ t('asset.bulkEditSet') }}</el-radio-button>
              <el-radio-button label="clear">{{ t('asset.bulkEditClear') }}</el-radio-button>
            </el-radio-group>
            <template v-if="form.locationAction === 'set'">
              <SearchableSelect
                :model-value="form.dataCenterId"
                :request="request"
                endpoint="/data-centers/"
                :map-option="mapDataCenter"
                :selected-option="selectedDataCenterOption"
                :base-query="dataCenterQuery"
                :placeholder="t('location.dataCenter')"
                :aria-label="t('location.dataCenter')"
                @update:model-value="handleDataCenter"
                @select="(option) => handleDataCenter(form.dataCenterId, option)"
              />
              <SearchableSelect
                :model-value="form.roomId"
                :request="request"
                endpoint="/server-rooms/"
                :map-option="mapRoom"
                :selected-option="selectedRoomOption"
                :base-query="roomQuery"
                :placeholder="t('location.room')"
                :aria-label="t('location.room')"
                :disabled="!form.dataCenterId"
                @update:model-value="handleRoom"
                @select="(option) => handleRoom(form.roomId, option)"
              />
              <SearchableSelect
                :model-value="form.rackId"
                :request="request"
                endpoint="/racks/"
                :map-option="mapRack"
                :selected-option="selectedRackOption"
                :base-query="rackQuery"
                :placeholder="t('location.rack')"
                :aria-label="t('location.rack')"
                :disabled="!form.roomId"
                @update:model-value="handleRack"
                @select="(option) => handleRack(form.rackId, option)"
              />
              <div class="bulk-edit-asset__u-range">
                <el-input v-model="form.startU" inputmode="numeric" :placeholder="t('asset.startU')" />
                <span aria-hidden="true">–</span>
                <el-input v-model="form.endU" inputmode="numeric" :placeholder="t('asset.endU')" />
              </div>
            </template>
            <p v-else class="bulk-edit-asset__hint">{{ t('asset.bulkEditClearLocationHint') }}</p>
          </div>
        </section>

        <section class="bulk-edit-asset__field" :class="{ 'is-enabled': form.tagsEnabled }">
          <label class="bulk-edit-asset__check"><input v-model="form.tagsEnabled" type="checkbox" /><span>{{ t('asset.bulkEditTags') }}</span></label>
          <div v-if="form.tagsEnabled" class="bulk-edit-asset__controls">
            <el-select v-model="form.tagsMode" :aria-label="t('asset.bulkEditTagsMode')">
              <el-option :label="t('asset.bulkEditTagsAdd')" value="add" />
              <el-option :label="t('asset.bulkEditTagsRemove')" value="remove" />
              <el-option :label="t('asset.bulkEditTagsReplace')" value="replace" />
            </el-select>
            <SearchableSelect
              :model-value="form.tagIds"
              :request="request"
              endpoint="/tags/"
              :map-option="mapTag"
              :selected-options="selectedTagOptions"
              :base-query="{ is_active: true }"
              :placeholder="t('asset.bulkEditTagsPlaceholder')"
              :aria-label="t('asset.bulkEditTags')"
              multiple
              clearable
              collapse-tags
              :max-collapse-tags="3"
              @update:model-value="handleTags"
              @select="(option) => handleTags(form.tagIds, option)"
            />
          </div>
        </section>

        <section class="bulk-edit-asset__field" :class="{ 'is-enabled': form.purposeEnabled }">
          <label class="bulk-edit-asset__check"><input v-model="form.purposeEnabled" type="checkbox" /><span>{{ t('asset.bulkEditPurpose') }}</span></label>
          <div v-if="form.purposeEnabled" class="bulk-edit-asset__controls">
            <el-radio-group v-model="form.purposeAction" size="small">
              <el-radio-button label="set">{{ t('asset.bulkEditSet') }}</el-radio-button>
              <el-radio-button label="clear">{{ t('asset.bulkEditClear') }}</el-radio-button>
            </el-radio-group>
            <el-input v-if="form.purposeAction === 'set'" v-model="form.purpose" :placeholder="t('asset.bulkEditPurposePlaceholder')" maxlength="255" />
          </div>
        </section>
      </div>
    </template>

    <section v-else class="action-dialog__result">
      <el-alert
        :type="result?.failed ? 'warning' : 'success'"
        :closable="false"
        :title="t('asset.bulkEditSummary', { succeeded: result?.succeeded || 0, failed: result?.failed || 0 })"
      />
      <el-table v-if="failures.length" :data="failures" table-layout="fixed" class="batch-result-table">
        <el-table-column prop="asset_no" :label="t('asset.code')" min-width="160" />
        <el-table-column prop="reason" :label="t('asset.failedReason')" min-width="260" show-overflow-tooltip />
      </el-table>
    </section>

    <template #footer>
      <el-button :disabled="pending" @click="close">{{ step === 'result' ? t('common.close') : t('common.cancel') }}</el-button>
      <el-button v-if="step === 'form'" type="primary" :loading="pending" :disabled="pending || !selectedCount" @click="submit">
        {{ t('asset.bulkEditSubmit', { count: selectedCount }) }}
      </el-button>
    </template>
  </ActionDialogShell>
</template>

<style scoped>
.bulk-edit-asset__selected {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
}

.bulk-edit-asset__asset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 112px;
  overflow-y: auto;
}

.bulk-edit-asset__review {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--el-border-radius-base);
  background: var(--el-color-primary-light-9);
}

.bulk-edit-asset__review ul {
  margin: 0;
  padding-left: 20px;
}

.bulk-edit-asset__review p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.bulk-edit-asset__fields {
  display: grid;
  gap: 12px;
}

.bulk-edit-asset__field {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
}

.bulk-edit-asset__field.is-enabled {
  border-color: var(--el-color-primary-light-5);
}

.bulk-edit-asset__check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-primary);
  font-weight: 600;
  cursor: pointer;
}

.bulk-edit-asset__check input {
  width: 16px;
  height: 16px;
  accent-color: var(--el-color-primary);
}

.bulk-edit-asset__controls {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.bulk-edit-asset__controls > .searchable-select,
.bulk-edit-asset__controls > .el-input,
.bulk-edit-asset__controls > .el-select {
  min-width: 0;
  width: 100%;
}

.bulk-edit-asset__controls > .el-radio-group + .searchable-select,
.bulk-edit-asset__controls > .el-radio-group + .el-input,
.bulk-edit-asset__controls > .el-radio-group + .el-select {
  grid-column: 2;
}

.bulk-edit-asset__controls > .searchable-select + .searchable-select,
.bulk-edit-asset__controls > .searchable-select + .el-input,
.bulk-edit-asset__controls > .el-input + .el-input {
  grid-column: 2;
}

.bulk-edit-asset__u-range {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  grid-column: 2;
  gap: 8px;
}

.bulk-edit-asset__hint {
  grid-column: 2;
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media (max-width: 640px) {
  .bulk-edit-asset__controls {
    grid-template-columns: minmax(0, 1fr);
  }

  .bulk-edit-asset__controls > .searchable-select,
  .bulk-edit-asset__controls > .el-input,
  .bulk-edit-asset__controls > .el-select,
  .bulk-edit-asset__controls > .el-radio-group + .searchable-select,
  .bulk-edit-asset__controls > .el-radio-group + .el-input,
  .bulk-edit-asset__controls > .el-radio-group + .el-select,
  .bulk-edit-asset__controls > .searchable-select + .searchable-select,
  .bulk-edit-asset__controls > .searchable-select + .el-input,
  .bulk-edit-asset__controls > .el-input + .el-input,
  .bulk-edit-asset__u-range,
  .bulk-edit-asset__hint {
    grid-column: 1;
  }
}
</style>
