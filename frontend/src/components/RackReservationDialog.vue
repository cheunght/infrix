<script setup lang="ts">
import { computed, proxyRefs } from "vue";
import { ElPopconfirm } from "element-plus";
import { useI18n } from "vue-i18n";
import FormDialogShell from "./FormDialogShell.vue";
import type { RackReservations } from "../composables/useRackReservations";
import type { RackOperations } from "../composables/useRackOperations";
import type { RackSharedContext } from "../page-context";
import type { RackUnitReservation } from "../types";
import { formatSystemDateTime } from "../system-settings";

const props = defineProps<{
  manager: RackReservations;
  operations: RackOperations;
  context: RackSharedContext;
}>();
const { t } = useI18n();
const r = proxyRefs(props.manager);
const available = computed(
  () =>
    r.options?.available_ranges
      ?.map((span) => `U${span.start_u}–U${span.end_u}`)
      .join("、") || t("rackOps.noSpace"),
);
function consume(row: RackUnitReservation) {
  const rack = r.rack;
  if (!rack || r.busy) return;
  r.close();
  void props.operations.open("mount", null, rack, row.start_u, row);
}
</script>

<template>
  <FormDialogShell
    :model-value="r.visible"
    :title="`${t('rackReserve.title')} · ${r.rack?.code || ''}`"
    :error="r.error"
    :saving="r.busy"
    :close-disabled="r.busy"
    size="large"
    @update:model-value="!$event && r.close()"
  >
    <p class="rack-reservation-policy">{{ t("rackReserve.policy") }}</p>
    <el-alert
      v-if="r.coolingDown"
      :title="t('rackCompare.maintenance')"
      type="warning"
      :closable="false"
    />
    <section
      v-if="context.can('racks.manage')"
      class="rack-reservation-create"
      :aria-label="t('rackReserve.create')"
    >
      <strong>{{ t("rackReserve.create") }}</strong>
      <div class="rack-reservation-fields">
        <label
          ><span>{{ t("asset.startU") }}</span
          ><el-input-number
            v-model="r.start"
            :min="1"
            :max="r.rack?.total_u || 32767"
            :precision="0"
            :disabled="r.busy || r.uncertain"
            :aria-label="t('asset.startU')"
        /></label>
        <label
          ><span>{{ t("rackReserve.height") }}</span
          ><el-input-number
            v-model="r.height"
            :min="1"
            :max="r.rack?.total_u || 32767"
            :precision="0"
            :disabled="r.busy || r.uncertain"
            :aria-label="t('rackReserve.height')"
        /></label>
        <label class="rack-reservation-purpose"
          ><span>{{ t("rackReserve.purpose") }}</span
          ><el-input
            v-model="r.purpose"
            maxlength="200"
            :disabled="r.busy || r.uncertain"
            :aria-label="t('rackReserve.purpose')"
            :placeholder="t('rackReserve.purposePlaceholder')"
        /></label>
      </div>
      <p>{{ t("rackOps.available") }}：{{ available }}</p>
      <div class="rack-reservation-confirm">
        <span v-if="r.start && r.height"
          >{{ t("rackReserve.preview") }}：U{{ r.start }}–U{{ r.end }} ·
          {{ r.height }}U</span
        ><el-button
          type="primary"
          :loading="r.busy"
          :disabled="!r.valid"
          @click="r.create"
          >{{ t("rackReserve.create") }}</el-button
        >
      </div>
    </section>
    <div class="rack-reservation-list-heading">
      <strong>{{ t("rackReserve.records") }}</strong>
      <el-select
        v-model="r.status"
        :disabled="r.busy || r.loading || r.coolingDown"
        :aria-label="t('rackReserve.filter')"
        @change="r.changeStatus"
      >
        <el-option
          v-for="state in ['active', 'released', 'consumed', 'all']"
          :key="state"
          :value="state"
          :label="t(`rackReserve.${state}`)"
        />
      </el-select>
      <el-button
        :disabled="r.busy || r.loading || r.coolingDown"
        @click="r.refresh"
        >{{ t("common.refresh") }}</el-button
      >
    </div>
    <el-skeleton v-if="r.loading" :rows="4" animated />
    <div v-else-if="r.rows.length" class="rack-reservation-records">
      <article
        v-for="row in r.rows"
        :key="row.id"
        class="rack-reservation-record"
      >
        <div class="rack-reservation-record-title">
          <strong>U{{ row.start_u }}–U{{ row.end_u }} · {{ row.units }}U</strong
          ><el-tag :type="row.status === 'active' ? 'warning' : 'info'">{{
            t(`rackReserve.${row.status}`)
          }}</el-tag>
        </div>
        <p>{{ row.purpose }}</p>
        <small
          >{{ t("rackReserve.created") }}：{{
            row.created_by_name || t("common.notAvailable")
          }}
          · {{ formatSystemDateTime(row.created_at) }}</small
        >
        <small v-if="row.closed_at"
          >{{ t("rackReserve.closed") }}：{{
            row.closed_by_name || t("common.notAvailable")
          }}
          · {{ formatSystemDateTime(row.closed_at) }}</small
        >
        <div
          v-if="row.status === 'active'"
          class="rack-reservation-record-actions"
        >
          <el-button
            v-if="
              context.can('assets.manage') &&
              context.can('assets.view') &&
              context.can('racks.manage')
            "
            :disabled="
              r.busy ||
              r.uncertain ||
              r.coolingDown ||
              !r.options?.accepts_assets ||
              operations.busy.value
            "
            @click="consume(row)"
            >{{ t("rackReserve.consume") }}</el-button
          >
          <el-popconfirm
            v-if="context.can('racks.manage')"
            :title="
              t('rackReserve.releaseConfirm', {
                start: row.start_u,
                end: row.end_u,
              })
            "
            @confirm="r.release(row)"
            ><template #reference
              ><el-button
                :disabled="r.busy || r.uncertain || r.coolingDown"
                type="danger"
                plain
                >{{ t("rackReserve.release") }}</el-button
              ></template
            ></el-popconfirm
          >
        </div>
      </article>
    </div>
    <el-empty
      v-else-if="!r.error"
      :image-size="48"
      :description="t('rackReserve.empty')"
    />
    <el-pagination
      v-if="r.total > 30"
      :current-page="r.page"
      :page-size="30"
      :total="r.total"
      layout="prev, pager, next"
      :disabled="r.busy || r.loading || r.coolingDown"
      @update:current-page="r.changePage"
    />
    <template #footer
      ><el-button :disabled="r.busy" @click="r.close">{{
        t("common.close")
      }}</el-button></template
    >
  </FormDialogShell>
</template>

<style scoped>
.rack-reservation-policy {
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  margin: 0 0 16px;
}
.rack-reservation-create {
  padding: 16px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  margin-bottom: 24px;
}
.rack-reservation-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;
}
.rack-reservation-fields label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.rack-reservation-fields .el-input-number {
  width: 100%;
}
.rack-reservation-purpose {
  grid-column: 1 / -1;
}
.rack-reservation-confirm,
.rack-reservation-list-heading,
.rack-reservation-record-title,
.rack-reservation-record-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
}
.rack-reservation-list-heading {
  margin: 16px 0;
  justify-content: flex-start;
}
.rack-reservation-list-heading .el-select {
  width: 130px;
  margin-left: auto;
}
.rack-reservation-record {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 16px 0;
  overflow-wrap: anywhere;
}
.rack-reservation-record p {
  margin: 10px 0;
}
.rack-reservation-record small {
  display: block;
  color: var(--el-text-color-secondary);
  margin: 4px 0;
}
.rack-reservation-record-actions {
  justify-content: flex-end;
  margin-top: 12px;
}
@media (max-width: 480px) {
  .rack-reservation-fields {
    grid-template-columns: 1fr;
  }
  .rack-reservation-list-heading .el-select {
    margin-left: 0;
  }
}
</style>
