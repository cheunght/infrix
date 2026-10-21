<script setup lang="ts">
import { proxyRefs } from "vue";
import { useI18n } from "vue-i18n";
import FormDialogShell from "./FormDialogShell.vue";
import type { RackCapacityPlanning } from "../composables/useRackCapacityPlanning";
import { formatSystemDateTime } from "../system-settings";
import type { PositionRange } from "../composables/useRackOperations";

const props = defineProps<{
  planning: RackCapacityPlanning;
  rackIds: number[];
  rackLabel: (id: number) => string;
}>();
const { t } = useI18n();
const p = proxyRefs(props.planning);
const { height, quantity } = props.planning;
const ranges = (spans: PositionRange[]) =>
  spans.map((span) => `U${span.start_u}–U${span.end_u}`).join("、") ||
  t("rackOps.noSpace");
</script>

<template>
  <FormDialogShell
    :model-value="p.visible"
    :title="t('rackPlan.title')"
    :description="t('rackPlan.description')"
    :error="p.error"
    size="large"
    @update:model-value="!$event && p.close()"
  >
    <p class="rack-capacity-candidates">
      {{ t("rackPlan.candidates") }}：{{ rackIds.map(rackLabel).join(" → ") }}
    </p>
    <div class="rack-operation-form">
      <label class="rack-operation-field"
        ><span>{{ t("rackOps.height") }}</span
        ><el-input-number
          v-model="height"
          :min="1"
          :max="32767"
          :precision="0"
          :aria-label="t('rackOps.height')"
      /></label>
      <label class="rack-operation-field"
        ><span>{{ t("rackPlan.quantity") }}</span
        ><el-input-number
          v-model="quantity"
          :min="1"
          :max="500"
          :precision="0"
          :aria-label="t('rackPlan.quantity')"
      /></label>
    </div>
    <p class="rack-comparison-hint rack-capacity-policy">
      {{ t("rackPlan.policy") }}
    </p>
    <el-alert
      v-if="p.coolingDown"
      :title="t('rackCompare.maintenance')"
      type="warning"
      :closable="false"
    />
    <div v-if="p.result" class="rack-capacity-results" aria-live="polite">
      <p>
        {{
          t("rackPlan.demand", {
            quantity: p.result.quantity,
            height: p.result.height_u,
          })
        }}
      </p>
      <el-alert
        :type="p.result.unallocated_quantity ? 'warning' : 'success'"
        :title="
          t('rackPlan.summary', {
            allocated: p.result.allocated_quantity,
            quantity: p.result.quantity,
            remaining: p.result.unallocated_quantity,
          })
        "
        :closable="false"
      />
      <p v-if="p.result.excluded_racks">
        {{ t("rackPlan.excluded", { count: p.result.excluded_racks }) }}
      </p>
      <p class="rack-comparison-hint">
        {{ t("rackPlan.generated") }}：{{
          formatSystemDateTime(p.result.generated_at)
        }}
      </p>
      <section
        v-for="plan in p.result.plans"
        :key="plan.rack_id"
        class="rack-capacity-result"
        :aria-label="rackLabel(plan.rack_id)"
      >
        <h3>{{ rackLabel(plan.rack_id) }}</h3>
        <p v-if="plan.status === 'restricted'">
          {{ t("rackPlan.restricted") }}
        </p>
        <p v-else-if="plan.status === 'unavailable'">
          {{ t("rackCompare.cannotReceive") }}
        </p>
        <template v-else-if="plan.status === 'ready'">
          <dl class="rack-comparison-metrics rack-capacity-metrics">
            <div>
              <dt>{{ t("rackPlan.capacity") }}</dt>
              <dd>{{ plan.capacity }}</dd>
            </div>
            <div>
              <dt>{{ t("rackPlan.assigned") }}</dt>
              <dd>{{ plan.planned_quantity }}</dd>
            </div>
            <div>
              <dt>{{ t("rackPlan.freeAfter") }}</dt>
              <dd>{{ plan.free_u_before }}U → {{ plan.free_u_after }}U</dd>
            </div>
            <div>
              <dt>{{ t("rackPlan.utilizationAfter") }}</dt>
              <dd>{{ plan.utilization_after }}%</dd>
            </div>
          </dl>
          <details v-if="plan.placements.length" open>
            <summary>{{ t("rackPlan.positions") }}</summary>
            <ol class="rack-capacity-positions">
              <li v-for="position in plan.placements" :key="position.sequence">
                {{ t("rackPlan.device", { sequence: position.sequence }) }} ·
                U{{ position.start_u }}–U{{ position.end_u }}
              </li>
            </ol>
          </details>
          <p>
            {{ t("rackPlan.rangesAfter") }}：{{
              ranges(plan.available_ranges_after)
            }}
          </p>
          <p>
            {{ t("rackPlan.gapsAfter") }}：{{
              plan.gap_ranges_after
                .map((span) => `U${span.start_u}`)
                .join("、") || t("common.notAvailable")
            }}
          </p>
        </template>
      </section>
    </div>
    <template #footer>
      <el-button @click="p.close()">{{ t("common.close") }}</el-button>
      <el-button
        type="primary"
        :loading="p.loading"
        :disabled="!p.valid || p.loading || p.coolingDown"
        @click="p.generate()"
        >{{ t("rackPlan.generate") }}</el-button
      >
    </template>
  </FormDialogShell>
</template>
