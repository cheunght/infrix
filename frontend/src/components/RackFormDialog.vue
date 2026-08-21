<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { Rack, RackFormState } from "../types";
import type { RackManagementContext } from "../types/page-context";

const props = defineProps<{ context: RackManagementContext }>();
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
const formRules: FormRules<RackFormState> = {
  room: [{ required: true, message: "请选择机房", trigger: "submit" }],
  code: [
    {
      validator: (_rule, value, callback) => {
        if (!String(value ?? "").trim()) {
          callback(new Error("请输入机柜编号"));
          return;
        }
        callback();
      },
      trigger: "submit",
    },
  ],
  total_u: [
    { required: true, message: "请输入总 U 位数", trigger: "submit" },
    {
      validator: (_rule, value, callback) => {
        const total = Number(value);
        if (!Number.isInteger(total) || total < 1 || total > 32767) {
          callback(new Error("总 U 位数必须是 1～32767 的整数"));
          return;
        }
        callback();
      },
      trigger: "submit",
    },
  ],
  status: [{ required: true, message: "请选择机柜状态", trigger: "submit" }],
};

const currentRoom = computed(() => {
  const roomId = Number(rackForm.value.room);
  return serverRooms.value.find((room) => room.id === roomId) || null;
});
const currentRoomLabel = computed(() => {
  if (currentRoom.value) return `${currentRoom.value.data_center_name} / ${currentRoom.value.name}`;
  if (editingRack.value?.server_room_name) {
    return `${editingRack.value.data_center_name || "未知数据中心"} / ${editingRack.value.server_room_name}`;
  }
  return "当前机房";
});

const currentHighestOccupiedU = computed(() => {
  const rack = editingRack.value as Rack | null;
  if (!rack?.allocations?.length) return 0;
  return Math.max(...rack.allocations.map((allocation) => allocation.end_u));
});

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
  <el-dialog
    v-model="showRackModal"
    class="rack-form-dialog"
    :title="editingRack ? '编辑机柜' : '新增机柜'"
    width="640px"
    destroy-on-close
    :close-on-click-modal="!rackSaving"
    :close-on-press-escape="!rackSaving"
    :show-close="!rackSaving"
    @close="closeDialog"
  >
    <el-form
      ref="formRef"
      :model="rackForm"
      :rules="formRules"
      :validate-on-rule-change="false"
      label-position="top"
      class="rack-form"
      @submit.prevent="submitRack"
    >
      <el-divider content-position="left">基本信息</el-divider>
      <div class="rack-form-grid">
        <el-form-item label="所属机房" prop="room" :error="fieldError('room')">
          <el-select v-model="rackForm.room" class="control-full" disabled :placeholder="currentRoomLabel">
            <el-option v-if="currentRoom" :label="currentRoomLabel" :value="String(currentRoom.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="机柜编号" prop="code" :error="fieldError('code')">
          <el-input v-model="rackForm.code" :validate-event="false" placeholder="例如 A01" autocomplete="off" />
        </el-form-item>
        <el-form-item label="机柜名称" prop="name" :error="fieldError('name')">
          <el-input v-model="rackForm.name" :validate-event="false" placeholder="可选" />
        </el-form-item>
        <el-form-item label="机柜类型" prop="rack_type" :error="fieldError('rack_type')">
          <el-input v-model="rackForm.rack_type" :validate-event="false" placeholder="例如 标准机柜" />
        </el-form-item>
      </div>

      <el-divider content-position="left">容量与状态</el-divider>
      <div class="rack-form-grid">
        <el-form-item label="总 U 位数" prop="total_u" :error="fieldError('total_u')">
          <el-input-number v-model="rackForm.total_u" :min="1" :max="32767" controls-position="right" class="control-full" />
          <small v-if="currentHighestOccupiedU" class="rack-form-hint">当前最高占用：U{{ currentHighestOccupiedU }}，容量不能小于该位置</small>
        </el-form-item>
        <el-form-item label="机柜状态" prop="status" :error="fieldError('status')">
          <el-select v-model="rackForm.status" class="control-full" placeholder="请选择状态">
            <el-option label="使用中" value="in_use" />
            <el-option label="预留" value="reserved" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
      </div>

      <el-divider content-position="left">责任信息</el-divider>
      <div class="rack-form-grid">
        <el-form-item label="负责人" prop="owner_name" :error="fieldError('owner_name')">
          <el-input v-model="rackForm.owner_name" :validate-event="false" placeholder="可选" />
        </el-form-item>
        <el-form-item label="备注" prop="notes" :error="fieldError('notes')" class="rack-form-span-2">
          <el-input v-model="rackForm.notes" :validate-event="false" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <div class="rack-form-footer">
        <el-button :disabled="rackSaving" @click="closeDialog">取消</el-button>
        <el-button type="primary" :loading="rackSaving" @click="submitRack">保存机柜</el-button>
      </div>
    </template>
  </el-dialog>
</template>
