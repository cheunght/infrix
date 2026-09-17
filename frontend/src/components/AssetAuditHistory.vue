<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { auditChangeSummary, auditLogActionLabel, auditObjectLabel } from "../audit-formatters";
import { formatSystemDateTime } from "../system-settings";
import type { AssetAuditHistoryContext } from "../page-context";
import DetailSection from "./DetailSection.vue";
import ResourceState from "./ResourceState.vue";

const props = withDefaults(
  defineProps<{
    context: AssetAuditHistoryContext;
    collapsible?: boolean;
  }>(),
  {
    collapsible: false,
  },
);
const { t } = useI18n();
const context = props.context;
const items = computed(() => context.assetAuditItems.value);
const loading = computed(() => context.assetAuditLoading.value);
const error = computed(() => context.assetAuditError.value);
const empty = computed(() => !loading.value && !error.value && items.value.length === 0);

function formatDateTime(value: string): string {
  return formatSystemDateTime(value) || value;
}

function actorName(value: string | null): string {
  return value || t("common.notAvailable");
}

function retry() {
  void context.retryAssetAudit();
}
</script>

<template>
  <DetailSection
    class="asset-audit-history"
    :title="t('asset.auditHistory')"
    :summary="t('units.item', items.length)"
    :collapsible="collapsible"
  >
    <ResourceState
      :loading="loading"
      :error="error"
      :empty="empty"
      :empty-text="t('asset.noAuditHistory')"
      @retry="retry"
    >
      <div class="asset-audit-history__list">
        <article v-for="item in items" :key="item.id" class="asset-audit-history__record">
          <div class="asset-audit-history__heading">
            <strong>{{ auditLogActionLabel(item) }}</strong>
            <span>{{ auditObjectLabel(item) }}</span>
          </div>
          <p class="asset-audit-history__summary">{{ auditChangeSummary(item) }}</p>
          <div class="asset-audit-history__meta">
            <span>{{ t("settings.actor") }} · {{ actorName(item.actor_display_name || item.actor_username) }}</span>
            <time :datetime="item.created_at">{{ formatDateTime(item.created_at) }}</time>
          </div>
        </article>
      </div>
    </ResourceState>
  </DetailSection>
</template>

<style scoped>
.asset-audit-history__record {
  padding: 14px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  overflow-wrap: anywhere;
}

.asset-audit-history__record:first-child {
  padding-top: 0;
}

.asset-audit-history__record:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.asset-audit-history__heading,
.asset-audit-history__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  align-items: baseline;
}

.asset-audit-history__heading strong {
  font-weight: 600;
}

.asset-audit-history__heading span,
.asset-audit-history__meta {
  color: var(--el-text-color-secondary);
}

.asset-audit-history__summary {
  margin: 7px 0;
  color: var(--el-text-color-regular);
}

.asset-audit-history__meta {
  font-size: 12px;
}
</style>
