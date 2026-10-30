<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRackHints } from "../composables/useRackHints";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    heading: string;
    subtitle?: string;
    fields?: Array<{ label: string; value: string }>;
    placement?: "bottom-start" | "right-start";
    disabled?: boolean;
    fitToAnchor?: boolean;
  }>(),
  { placement: "right-start", disabled: false },
);
const hints = useRackHints();
const owner = Symbol("rack-hint");
const anchor = ref<HTMLElement>();
const visible = computed(() => hints.active.value === owner && !props.disabled);
const width = computed(() => {
  if (!visible.value) return 280;
  return props.fitToAnchor
    ? Math.min(260, anchor.value?.clientWidth || 260)
    : 280;
});
function show(delay: number) {
  if (!props.disabled) hints.show(owner, delay);
}
function focus(event: FocusEvent) {
  if ((event.target as HTMLElement)?.matches(":focus-visible")) show(0);
}
function hide() {
  hints.hide(owner);
}
watch(
  () => props.disabled,
  (value) => {
    if (value) hide();
  },
);
onBeforeUnmount(hide);
</script>

<template>
  <el-tooltip
    :visible="visible"
    effect="light"
    popper-class="rack-hint-popper"
    :popper-style="{ width: `${width}px` }"
    :placement="placement"
    :fallback-placements="
      placement === 'bottom-start'
        ? ['top-start', 'bottom-end', 'top-end']
        : ['left-start', 'top-start', 'bottom-start']
    "
    :popper-options="{
      modifiers: [{ name: 'preventOverflow', options: { padding: 12 } }],
    }"
    :offset="8"
    :enterable="false"
    :persistent="false"
    transition="rack-hint"
  >
    <template #content>
      <div class="rack-hint-card">
        <strong>{{ heading }}</strong>
        <span
          v-if="subtitle && subtitle !== heading"
          class="rack-hint-card__subtitle"
          >{{ subtitle }}</span
        >
        <dl v-if="fields?.length">
          <div v-for="field in fields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value }}</dd>
          </div>
        </dl>
      </div>
    </template>
    <span
      ref="anchor"
      class="rack-hint-anchor"
      v-bind="$attrs"
      @mouseenter="show(300)"
      @mouseleave="hide"
      @focusin="focus"
      @focusout="hide"
      @pointerdown="hide"
      @click.capture="hide"
      @keydown.esc.stop="hide"
      ><slot
    /></span>
  </el-tooltip>
</template>
