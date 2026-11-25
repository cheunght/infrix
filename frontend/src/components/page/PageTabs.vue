<script lang="ts">
export function pageTabPanelAttrs(id: string, tab: string) {
  return { id, role: "tabpanel", "aria-labelledby": `${id}-tab-${tab}`, tabindex: 0 };
}
</script>

<script setup lang="ts">
import { ref } from "vue";

export interface PageTabItem {
  label: string;
  value: string;
  disabled?: boolean;
  status?: "error" | "warning";
  statusLabel?: string;
}

defineProps<{
  modelValue: string;
  items: PageTabItem[];
  panelId: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const focusedTab = ref<string>();

function resetTabFocus(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) focusedTab.value = undefined;
}

function moveTabFocus(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const index = tabs.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const offset = event.key === 'ArrowRight' ? 1 : -1;
  const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + offset + tabs.length) % tabs.length];
  next?.focus();
}
</script>

<template>
  <div class="page-tabs-row">
    <div class="page-tabs" role="tablist" @keydown="moveTabFocus" @focusout="resetTabFocus">
      <button
        v-for="item in items"
        :key="item.value"
        :id="`${panelId}-tab-${item.value}`"
        type="button"
        role="tab"
        :aria-selected="modelValue === item.value"
        :aria-controls="panelId"
        :tabindex="(focusedTab ?? modelValue) === item.value ? 0 : -1"
        :disabled="item.disabled"
        @focus="focusedTab = item.value"
        @click="emit('update:modelValue', item.value)"
      >
          <span class="page-tabs__label">
            <span>{{ item.label }}</span>
            <el-badge
              v-if="item.status"
              is-dot
              :type="item.status"
              :title="item.statusLabel"
              :aria-label="item.statusLabel"
            />
          </span>
      </button>
    </div>
    <div v-if="$slots.actions" class="page-tabs-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
