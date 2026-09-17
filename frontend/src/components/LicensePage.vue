<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, Download, Edit, Filter } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import type { LicenseContext } from "../page-context";
import type { LicenseStatus } from "../types";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import { statusTone } from "../status";
import { businessOptionLabel, LICENSE_STATUS_OPTIONS } from "../business-enums";
import ResourceState from "./ResourceState.vue";
import TableIconButton from "./TableIconButton.vue";
import ToolbarIconButton from "./page/ToolbarIconButton.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";
import { formatSystemDate } from "../system-settings";

const props = defineProps<{ context: LicenseContext }>();
const { t } = useI18n();
const context = props.context;
const {
  licenseListLoading,
  licenseListError,
  exportingLicenses,
  licenseKeyword,
  searchLicenses,
  licenseStatus,
  licenseManufacturer,
  resetLicenseFilters,
  retryLicenseList,
  exportLicenses,
  can,
  openLicenseModal,
  deleteLicense,
  deletingLicenseId,
  licenses,
  licensePage,
  licensePageSize,
  licenseCount,
  changeLicensePage,
  changeLicensePageSize,
} = context;

const licenseHasFilters = computed(
  () => Boolean(licenseKeyword.value.trim() || licenseStatus.value || licenseManufacturer.value),
);

const showLicenseFilters = ref(false);
const licenseFilterDraft = reactive<{ status: LicenseStatus | ""; manufacturer: string }>({
  status: "",
  manufacturer: "",
});
const activeLicenseFilterCount = computed(() =>
  Number(Boolean(licenseStatus.value)) + Number(Boolean(licenseManufacturer.value)),
);

function mapManufacturer(item: Record<string, unknown>): SearchableSelectOption {
  return {
    value: String(item.id ?? ""),
    label: String(item.name ?? ""),
    secondary: item.is_active === false ? t("status.inactive") : String(item.code ?? ""),
    disabled: item.is_active === false,
    data: item,
  };
}

const selectedManufacturerOption = computed<SearchableSelectOption | null>(() => {
  const manufacturer = context.licenseManufacturerFilterOptions.value.find(
    (item) => String(item.id) === licenseFilterDraft.manufacturer,
  );
  return manufacturer ? mapManufacturer(manufacturer as unknown as Record<string, unknown>) : null;
});

function openLicenseFilters() {
  licenseFilterDraft.status = licenseStatus.value as LicenseStatus | "";
  licenseFilterDraft.manufacturer = licenseManufacturer.value;
  showLicenseFilters.value = true;
}

function clearLicenseFilters() {
  licenseFilterDraft.status = "";
  licenseFilterDraft.manufacturer = "";
}

function applyLicenseFilters() {
  licenseStatus.value = licenseFilterDraft.status;
  licenseManufacturer.value = licenseFilterDraft.manufacturer;
  searchLicenses();
  showLicenseFilters.value = false;
}

function formatLicenseExpiry(value: string | null | undefined): string {
  if (!value) return t("license.longTermValid");
  return formatSystemDate(value) || t("common.notAvailable");
}
</script>

<template>
  <PageContainer class="infrix-page">
      <template #toolbar>
        <PageToolbar>
        <template #search>
          <SearchField
            v-model="licenseKeyword"
            :placeholder="t('license.searchPlaceholder')"
            :aria-label="t('license.title')"
            :loading="licenseListLoading"
            @search="searchLicenses"
          />
        </template>
        <template #filters>
          <ToolbarIconButton
            :icon="Filter"
            :label="t('asset.moreFilters')"
            :badge="activeLicenseFilterCount"
            @click="openLicenseFilters"
          />
        </template>
        <template #actions>
          <ToolbarIconButton
            v-if="can('licenses.export')"
            :icon="Download"
            :label="t('asset.exportData')"
            :loading="exportingLicenses"
            :disabled="exportingLicenses"
            @click="exportLicenses"
          />
        </template>
        <template #primary>
          <el-button v-if="can('licenses.manage')" class="page-primary-action" type="primary" @click="openLicenseModal()">
            {{ t('license.addLicense') }}
          </el-button>
        </template>
        </PageToolbar>
      </template>

      <PageContent surface class="license-list-card">
        <ResourceState :error="licenseListError" @retry="retryLicenseList">
          <template #error="{ error }">
            <el-alert :title="t('license.licenseLoadFailed')" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" @click="retryLicenseList">{{ t('common.retry') }}</el-button>
          </template>
          <PagedTable
            v-model:current-page="licensePage"
            v-model:page-size="licensePageSize"
            :total="licenseCount"
            @update:current-page="changeLicensePage"
            @update:page-size="changeLicensePageSize"
          >
          <el-table
            class="license-table"
            :data="licenses"
            v-loading="licenseListLoading"
            table-layout="fixed"
            :empty-text="t('license.noLicenses')"
          >
          <el-table-column
            prop="name"
            :label="t('license.softwareName')"
            min-width="180"
          />
          <el-table-column
            :label="t('license.vendor')"
            min-width="120"
          >
            <template #default="{ row }">{{ row.manufacturer?.name || "—" }}</template>
          </el-table-column>
          <el-table-column
            prop="license_type"
            :label="t('license.licenseType')"
            min-width="120"
          />
          <el-table-column :label="t('license.authorizedUse')" min-width="190">
            <template #default="{ row }">
              <div class="license-capacity-cell">
                <div class="license-capacity-values">
                  <strong>{{ row.used_count }} / {{ row.authorized_count }}</strong>
                  <span>{{ t('license.remaining', { count: row.remaining_count }) }}</span>
                </div>
                <div class="license-capacity-progress">
                  <el-progress
                    :percentage="Math.min(Math.max(row.utilization, 0), 100)"
                    :show-text="false"
                  />
                  <span>{{ Number(row.utilization || 0).toFixed(1) }}%</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="t('license.expiryDate')" width="135">
            <template #default="{ row }">{{ formatLicenseExpiry(row.expiry_date) }}</template>
          </el-table-column>
          <el-table-column :label="t('common.status')" width="110">
            <template #default="{ row }">
              <StatusTag
                :tone="statusTone(row.status)"
                :label="businessOptionLabel(LICENSE_STATUS_OPTIONS, row.status)"
              />
            </template>
          </el-table-column>
          <el-table-column
            v-if="can('licenses.manage')"
            :label="t('common.operation')"
            fixed="right"
            width="84"
          >
            <template #default="{ row }">
              <div class="ep-table-actions">
                <el-button-group>
                <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" @click="openLicenseModal(row)" />
                  <TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" :loading="deletingLicenseId === row.id" :disabled="deletingLicenseId !== null && deletingLicenseId !== row.id" @click="deleteLicense(row)" />
                </el-button-group>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :image-size="56" :description="licenseHasFilters ? t('license.noMatchingLicenses') : t('license.noLicenses')">
              <el-button v-if="licenseHasFilters" link type="primary" @click="resetLicenseFilters">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
          </template>
          </el-table>
          </PagedTable>
        </ResourceState>
      </PageContent>
  </PageContainer>

  <el-drawer v-model="showLicenseFilters" :title="t('asset.moreFilters')" size="360px" append-to-body>
    <el-form label-position="top">
      <el-form-item :label="t('license.allStatuses')">
        <el-select v-model="licenseFilterDraft.status" clearable :placeholder="t('license.allStatuses')">
          <el-option v-for="option in LICENSE_STATUS_OPTIONS" :key="option.value" :label="businessOptionLabel(LICENSE_STATUS_OPTIONS, option.value)" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('license.vendor')">
        <SearchableSelect
          v-model="licenseFilterDraft.manufacturer"
          :request="context.request"
          endpoint="/manufacturers/"
          :map-option="mapManufacturer"
          :selected-option="selectedManufacturerOption"
          :base-query="{ is_active: 'all' }"
          :placeholder="t('license.vendor')"
          :aria-label="t('license.vendor')"
          clearable
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="page-filter-drawer__footer">
        <el-button @click="clearLicenseFilters">{{ t('common.clearFilters') }}</el-button>
        <el-button @click="showLicenseFilters = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="applyLicenseFilters">{{ t('asset.applyFilters') }}</el-button>
      </div>
    </template>
  </el-drawer>
</template>
