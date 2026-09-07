<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, Download, Edit } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import type { LicenseContext } from "../page-context";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import { statusTone } from "../status";
import { businessOptionLabel, LICENSE_STATUS_OPTIONS } from "../business-enums";
import ResourceState from "./ResourceState.vue";
import TableIconButton from "./TableIconButton.vue";
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
          <div class="page-toolbar__filter-group">
            <el-select
              v-model="licenseStatus"
              :placeholder="t('license.allStatuses')"
              clearable
              @change="searchLicenses"
            >
              <el-option v-for="option in LICENSE_STATUS_OPTIONS" :key="option.value" :label="businessOptionLabel(LICENSE_STATUS_OPTIONS, option.value)" :value="option.value" />
            </el-select>
          </div>
        </template>
        <template #actions>
          <el-button v-if="can('licenses.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingLicenses" :disabled="exportingLicenses" @click="exportLicenses">
            {{ t('asset.exportData') }}
          </el-button>
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
            width="132"
          >
            <template #default="{ row }">
              <div class="ep-table-actions">
                <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" @click="openLicenseModal(row)" />
                <TableIconButton
                  :icon="Delete"
                  :label="t('common.delete')"
                  type="danger"
                  :loading="deletingLicenseId === row.id"
                  :disabled="deletingLicenseId !== null && deletingLicenseId !== row.id"
                  @click="deleteLicense(row)"
                />
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
</template>
