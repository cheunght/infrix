<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

type DescriptionListItem = {
  key: string;
  label: string;
  value?: unknown;
  wide?: boolean;
  className?: string;
  title?: string;
};

const props = withDefaults(
  defineProps<{
    items: DescriptionListItem[];
    columns?: 1 | 2;
    emptyValue?: string;
  }>(),
  {
    columns: 2,
  },
);
const { t } = useI18n();

const compact = ref(false);
const descriptionColumns = computed(() => (compact.value ? 1 : props.columns));
let mediaQuery: MediaQueryList | null = null;

function handleMediaChange(event: MediaQueryListEvent) {
  compact.value = event.matches;
}

onMounted(() => {
  if (typeof window === "undefined") return;
  mediaQuery = window.matchMedia("(max-width: 767px)");
  compact.value = mediaQuery.matches;
  mediaQuery.addEventListener?.("change", handleMediaChange);
  mediaQuery.addListener?.(handleMediaChange);
});

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener?.("change", handleMediaChange);
  mediaQuery?.removeListener?.(handleMediaChange);
  mediaQuery = null;
});

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

function displayValue(value: unknown): string {
  if (!hasContent(value)) return props.emptyValue || t("common.notAvailable");
  if (Array.isArray(value)) return value.map(displayValue).join("、");
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  return String(value);
}
</script>

<template>
  <el-descriptions class="description-list" :column="descriptionColumns" direction="horizontal">
    <el-descriptions-item
      v-for="item in items"
      :key="item.key"
      :label="item.label"
      :span="item.wide ? descriptionColumns : 1"
      :class-name="item.className || undefined"
    >
      <span
        class="description-list__value"
        :class="{ 'description-list__value--wide': item.wide }"
        :title="item.title || displayValue(item.value)"
      >
        <slot :name="`value-${item.key}`" :item="item">
          <span :class="{ 'description-list__empty': !hasContent(item.value) }">
            {{ displayValue(item.value) }}
          </span>
        </slot>
      </span>
    </el-descriptions-item>
  </el-descriptions>
</template>

<style scoped>
.description-list__value {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.description-list__empty {
  color: var(--el-text-color-secondary);
}
</style>
