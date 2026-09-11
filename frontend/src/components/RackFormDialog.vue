<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { FormInstance, FormRules } from "element-plus";
import type { Rack, RackFormState, ServerRoom } from "../types";
import type { RackManagementContext } from "../page-context";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import { RACK_STATUS_OPTIONS, businessOptionLabel } from "../business-enums";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";

const props = defineProps<{ context: RackManagementContext }>();
const { t } = useI18n();
const context = props.context;
const {
  serverRooms,
  showRackModal,
  editingRack,
  rackForm,
  rackFormFieldErrors,
  rackSaving,
  clearRackFormErrors,
  saveRack,
} = context;

const formRef = ref<FormInstance>();
const formRules = computed<FormRules<RackFormState>>(() => ({
  room: [{ required: true, message: t("rackForm.roomRequired"), trigger: "submit" }],
  code: [
    {
      validator: (_rule, value, callback) => {
        if (!String(value ?? "").trim()) {
          callback(new Error(t("rackForm.codeRequired")));
          return;
        }
        callback();
      },
      trigger: "submit",
    },
  ],
  total_u: [
    { required: true, message: t("rackForm.totalURequired"), trigger: "submit" },
    {
      validator: (_rule, value, callback) => {
        const total = Number(value);
        if (!Number.isInteger(total) || total < 1 || total > 32767) {
          callback(new Error(t("rackForm.totalUInvalid")));
          return;
        }
        callback();
      },
      trigger: "submit",
    },
  ],
  status: [{ required: true, message: t("rackForm.statusRequired"), trigger: "submit" }],
}));

const currentRoom = computed(() => {
  const roomId = Number(rackForm.value.room);
  return serverRooms.value.find((room) => room.id === roomId) || null;
});
const availableRooms = computed(() => {
  const currentRoomId = Number(rackForm.value.room);
  return serverRooms.value
    .filter((room) => room.is_active || room.id === currentRoomId)
    .sort((left, right) => {
      const leftLabel = `${left.data_center_name} / ${left.name}`;
      const rightLabel = `${right.data_center_name} / ${right.name}`;
      return leftLabel.localeCompare(rightLabel);
    });
});
const currentRoomLabel = computed(() => {
  if (currentRoom.value) return `${currentRoom.value.data_center_name} / ${currentRoom.value.name}`;
  if (editingRack.value?.server_room_name) {
    return `${editingRack.value.data_center_name || t("common.unknownDataCenter")} / ${editingRack.value.server_room_name}`;
  }
  return t("rackForm.currentRoom");
});

function mapRoom(item: Record<string, unknown>): SearchableSelectOption {
  const room = item as unknown as ServerRoom;
  return {
    value: room.id,
    label: room.name,
    secondary: room.data_center_name || "",
    data: room,
  };
}

const selectedRoomOption = computed<SearchableSelectOption | null>(() => {
  const room = currentRoom.value;
  return room ? mapRoom(room as unknown as Record<string, unknown>) : null;
});

const currentHighestOccupiedU = computed(() => {
  const rack = editingRack.value as Rack | null;
  if (!rack?.allocations?.length) return 0;
  return Math.max(...rack.allocations.map((allocation) => allocation.end_u));
});
const currentHighestOccupiedUHelp = computed(() => t("rackForm.highestOccupiedU", { unit: currentHighestOccupiedU.value }));

function fieldError(field: string) {
  return rackFormFieldErrors.value[field];
}

function closeDialog() {
  if (rackSaving.value) return;
  showRackModal.value = false;
  editingRack.value = null;
  clearRackFormErrors();
}

async function submitRack() {
  if (rackSaving.value || !formRef.value) return;
  clearRackFormErrors();
  const valid = await formRef.value.validate().catch(() => false);
  if (valid === false) return;
  await saveRack();
}

watch(showRackModal, (open) => {
  if (open) nextTick(() => formRef.value?.clearValidate());
});
</script>

<template>
  <FormDialogShell
    v-model="showRackModal"
    :title="editingRack ? t('rackForm.editTitle') : t('rackForm.createTitle')"
    :description="t('rackForm.description')"
    size="medium"
    :saving="rackSaving"
    :close-on-click-modal="!rackSaving"
    :close-on-press-escape="!rackSaving"
    :show-close="!rackSaving"
    :close-disabled="rackSaving"
    @close="closeDialog"
  >
    <el-form
      ref="formRef"
      :model="rackForm"
      :rules="formRules"
      :validate-on-rule-change="false"
      label-position="right"
      class="horizontal-form"
      @submit.prevent="submitRack"
    >
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('rackForm.basicInfo') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('rackForm.room')" prop="room" :error="fieldError('room')">
            <SearchableSelect
              v-model="rackForm.room"
              :request="context.request"
              endpoint="/server-rooms/"
              :map-option="mapRoom"
              :placeholder="currentRoomLabel"
              :selected-option="selectedRoomOption"
              :base-query="{ is_active: true }"
            />
            <FieldHelp v-if="editingRack?.allocations?.length" :text="t('rackForm.locationCorrectionHelp')" />
          </el-form-item>
          <el-form-item :label="t('rack.rackCode')" prop="code" :error="fieldError('code')">
            <el-input v-model="rackForm.code" :validate-event="false" :placeholder="t('rackForm.codePlaceholder')" autocomplete="off" />
          </el-form-item>
          <el-form-item :label="t('rack.totalU')" prop="total_u" :error="fieldError('total_u')">
            <el-input-number v-model="rackForm.total_u" :min="1" :max="32767" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('rack.totalU')">
              <template #suffix>U</template>
            </el-input-number>
            <FieldHelp v-if="currentHighestOccupiedU" :text="currentHighestOccupiedUHelp" />
          </el-form-item>
          <el-form-item :label="t('rack.rackName')" prop="name" :error="fieldError('name')">
            <el-input v-model="rackForm.name" :validate-event="false" :placeholder="t('common.optional')" />
          </el-form-item>
          <el-form-item :label="t('common.type')" prop="rack_type" :error="fieldError('rack_type')">
            <el-input v-model="rackForm.rack_type" :validate-event="false" :placeholder="t('rackForm.typePlaceholder')" />
          </el-form-item>
          <el-form-item :label="t('common.status')" prop="status" :error="fieldError('status')">
            <el-select v-model="rackForm.status" :placeholder="t('rackForm.statusPlaceholder')">
              <el-option v-for="option in RACK_STATUS_OPTIONS" :key="option.value" :label="businessOptionLabel(RACK_STATUS_OPTIONS, option.value)" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('rack.owner')" prop="owner_name" :error="fieldError('owner_name')">
            <el-input v-model="rackForm.owner_name" :validate-event="false" :placeholder="t('common.optional')" />
          </el-form-item>
          <el-form-item :label="t('common.notes')" prop="notes" :error="fieldError('notes')">
            <el-input v-model="rackForm.notes" :validate-event="false" type="textarea" :rows="3" :placeholder="t('common.optional')" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="rackSaving" @click="closeDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="rackSaving" :disabled="rackSaving" @click="submitRack">{{ t('rackForm.save') }}</el-button>
    </template>
  </FormDialogShell>
</template>
