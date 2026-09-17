<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

type DescriptionListItem = {
  key: string;
  label: string;
  raw?: unknown;
  value?: unknown;
  empty?: boolean;
  wide?: boolean;
  className?: string;
  title?: string;
};
type DescriptionListSize = "large" | "default" | "small";
type DescriptionListLayout = "horizontal" | "stacked" | "compact";

const props = withDefaults(
  defineProps<{
    items: DescriptionListItem[];
    columns?: 1 | 2;
    border?: boolean;
    emptyValue?: string;
    size?: DescriptionListSize;
    layout?: DescriptionListLayout;
  }>(),
  {
    border: false,
    columns: 2,
    layout: "horizontal",
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
  if (typeof value === "boolean")
    return value ? t("common.yes") : t("common.no");
  return String(value);
}
</script>

<template>
  <dl
    v-if="layout === 'compact'"
    class="description-list description-list--compact"
    :class="{ 'description-list--single': descriptionColumns === 1 }"
  >
    <div
      v-for="item in items"
      :key="item.key"
      :class="{ 'description-list__pair--wide': item.wide }"
    >
      <dt>{{ item.label }}</dt>
      <dd :title="item.title || displayValue(item.value)">
        <slot :name="`value-${item.key}`" :item="item">
          <span
            :class="{
              'description-list__empty': item.empty || !hasContent(item.value),
            }"
            >{{ displayValue(item.value) }}</span
          >
        </slot>
      </dd>
    </div>
  </dl>
  <el-descriptions
    v-else
    class="description-list"
    :class="`description-list--${layout}`"
    :border="border"
    :column="descriptionColumns"
    :direction="layout === 'stacked' ? 'vertical' : 'horizontal'"
    :size="size"
  >
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
          <span
            :class="{
              'description-list__empty': item.empty || !hasContent(item.value),
            }"
          >
            {{ displayValue(item.value) }}
          </span>
        </slot>
      </span>
    </el-descriptions-item>
  </el-descriptions>
</template>

<style scoped>
.description-list--compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 28px;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}
.description-list--compact > div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  min-width: 0;
}
.description-list--compact dt {
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.description-list--compact dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 400;
}
.description-list__pair--wide {
  grid-column: 1 / -1;
}
.description-list--single {
  grid-template-columns: minmax(0, 1fr);
}
.description-list__value {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.description-list__empty {
  color: var(--el-text-color-secondary);
}
</style>
