<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import PagedTable from "./PagedTable.vue";
import PageContent from "./page/PageContent.vue";
import type { SettingsContext } from "../page-context";
import { isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import { formatSystemDate } from "../system-settings";
import { normalizeApiError } from "../error-handling";

const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();

type NotificationDelivery = {
  id: number;
  delivery_type: string;
  window_date: string;
  status: string;
  attempts: number;
  attempted_at: string | null;
  sent_at: string | null;
  recipient_count: number;
  error_code: string;
};

const rows = ref<NotificationDelivery[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const statusFilter = ref("");
const busy = ref(false);
const error = ref("");
let generation = 0;
let requestController: AbortController | null = null;

onBeforeUnmount(() => {
  generation += 1;
  requestController?.abort();
});

async function load(allowPageClamp = true) {
  const current = ++generation;
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  busy.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize.value) });
    if (statusFilter.value) params.set("status", statusFilter.value);
    const result = await props.context.request<PageResult<NotificationDelivery> | NotificationDelivery[]>(
      `/notification-deliveries/?${params.toString()}`,
      { signal: controller.signal },
    );
    if (current !== generation) return;
    const nextTotal = pageTotal(result);
    const maxPage = Math.max(1, Math.ceil(nextTotal / pageSize.value));
    if (page.value > maxPage) {
      page.value = maxPage;
      if (allowPageClamp) await load(false);
      return;
    }
    rows.value = pageItems(result);
    total.value = nextTotal;
  } catch (cause) {
    if (current === generation && !isAbortError(cause)) {
      error.value = normalizeApiError(cause).message;
      rows.value = [];
      total.value = 0;
    }
  } finally {
    if (current === generation) {
      busy.value = false;
      requestController = null;
    }
  }
}

function state(value: string | undefined) {
  return t(`operations.${value || "unavailable"}`);
}

function deliveryFailure(value: string | undefined) {
  if (!value) return "—";
  const key = `operations.error_${value}`;
  const translated = String(t(key));
  return translated === key ? value : translated;
}

function windowDate(value: string) {
  return formatSystemDate(value) || value;
}

function changePage(value: number) {
  page.value = value;
  load();
}

function changePageSize(value: number) {
  pageSize.value = value;
  page.value = 1;
  load();
}

function changeStatus(value: string | undefined) {
  statusFilter.value = value || "";
  page.value = 1;
  load();
}

onMounted(load);
</script>

<template>
  <PageContent surface>
    <div class="settings-maintenance">
      <div class="settings-maintenance__intro">
        <h2>{{ t("settings.mailDeliveryTab") }}</h2>
        <p>{{ t("settings.mailDeliveryDescription") }}</p>
      </div>
      <div class="settings-system__actions">
        <el-select
          :model-value="statusFilter"
          clearable
          :disabled="busy"
          :placeholder="t('operations.allDeliveryStatuses')"
          @update:model-value="changeStatus"
        >
          <el-option v-for="value in ['pending', 'sending', 'sent', 'failed', 'unknown']" :key="value" :label="state(value)" :value="value" />
        </el-select>
        <el-button :disabled="busy" @click="load">{{ t("common.refresh") }}</el-button>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-table v-loading="busy" :data="rows" :empty-text="t('common.noData')">
        <el-table-column :label="t('operations.deliveryType')">
          <template #default="{ row }">{{ row.delivery_type === "daily_digest" ? t("operations.dailyDigest") : row.delivery_type }}</template>
        </el-table-column>
        <el-table-column prop="window_date" :label="t('operations.deliveryDate')">
          <template #default="{ row }">{{ windowDate(row.window_date) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.status')"><template #default="{ row }">{{ state(row.status) }}</template></el-table-column>
        <el-table-column prop="attempts" :label="t('operations.attempts')" width="100" />
        <el-table-column prop="recipient_count" :label="t('operations.recipientCount')" width="100" />
        <el-table-column :label="t('operations.failureReason')"><template #default="{ row }">{{ deliveryFailure(row.error_code) }}</template></el-table-column>
        <el-table-column :label="t('operations.attemptedAt')" min-width="180"><template #default="{ row }">{{ props.context.formatDateTime(row.attempted_at) }}</template></el-table-column>
        <el-table-column :label="t('operations.sentAt')" min-width="180"><template #default="{ row }">{{ props.context.formatDateTime(row.sent_at) }}</template></el-table-column>
      </el-table>
      <PagedTable
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        @update:current-page="changePage"
        @update:page-size="changePageSize"
      />
    </div>
  </PageContent>
</template>
