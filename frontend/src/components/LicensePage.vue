<script setup lang="ts">
import { computed } from "vue";
import { Download } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import type { LicenseContext } from "../types/page-context";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{ context: LicenseContext }>();
const context = props.context;
const {
  licenseListLoading,
  licenseListError,
  exportingLicenses,
  licenseKeyword,
  searchLicenses,
  licenseStatus,
  licenseManufacturer,
  licenseManufacturerFilterOptions,
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
</script>

<template>
  <PageContainer class="itam-page">
      <template #toolbar>
        <PageToolbar>
        <template #search>
          <SearchField
            v-model="licenseKeyword"
            placeholder="搜索软件名称、厂商或许可类型"
            aria-label="搜索许可证"
            :loading="licenseListLoading"
            @search="searchLicenses"
          />
        </template>
        <template #primary-filter>
          <el-select
            v-model="licenseStatus"
            placeholder="全部状态"
            clearable
            @change="searchLicenses"
          >
            <el-option label="正常" value="normal" />
            <el-option label="即将到期" value="expiring" />
            <el-option label="已过期" value="expired" />
          </el-select>
        </template>
        <template #secondary-filter>
          <el-select
            v-model="licenseManufacturer"
            placeholder="全部厂商"
            clearable
            filterable
            @change="searchLicenses"
          >
            <el-option v-for="manufacturer in licenseManufacturerFilterOptions" :key="manufacturer.id" :label="manufacturer.name" :value="String(manufacturer.id)" />
          </el-select>
        </template>
        <template #extra-filter>
          <el-button class="toolbar-secondary-action" :disabled="licenseListLoading" @click="resetLicenseFilters">重置</el-button>
        </template>
        <template #actions>
          <el-button v-if="can('licenses.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingLicenses" :disabled="exportingLicenses" @click="exportLicenses">
            导出数据
          </el-button>
          <el-button v-if="can('licenses.manage')" class="page-primary-action" type="primary" @click="openLicenseModal()">
            新增许可
          </el-button>
        </template>
        </PageToolbar>
      </template>

      <PageContent surface class="license-list-card">
        <div v-if="licenseListError" class="license-list-error" role="alert">
          <div class="license-list-error__copy">
            <strong>许可证数据加载失败</strong>
            <span>{{ licenseListError }}</span>
          </div>
          <el-button link type="primary" @click="retryLicenseList">重新加载</el-button>
        </div>
        <PagedTable
          v-model:current-page="licensePage"
          v-model:page-size="licensePageSize"
          :total="licenseCount"
          :loading="licenseListLoading"
          @update:current-page="changeLicensePage"
          @update:page-size="changeLicensePageSize"
        >
          <el-table
            class="license-table"
            :data="licenses"
            table-layout="fixed"
            empty-text="暂无许可证记录"
          >
          <el-table-column
            prop="name"
            label="软件名称"
            min-width="180"
            show-overflow-tooltip
          />
          <el-table-column
            label="厂商"
            min-width="120"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ row.manufacturer?.name || "—" }}</template>
          </el-table-column>
          <el-table-column
            prop="license_type"
            label="许可类型"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column label="授权使用" min-width="190">
            <template #default="{ row }">
              <div class="license-capacity-cell">
                <div class="license-capacity-values">
                  <strong>{{ row.used_count }} / {{ row.authorized_count }}</strong>
                  <span>剩余 {{ row.remaining_count }}</span>
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
          <el-table-column label="到期日期" width="135">
            <template #default="{ row }">{{ row.expiry_date || "长期有效" }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <StatusTag
                :status="row.status"
                :label="row.status_label"
              />
            </template>
          </el-table-column>
          <el-table-column
            v-if="can('licenses.manage')"
            label="操作"
            fixed="right"
            width="120"
          >
            <template #default="{ row }">
              <div class="ep-table-actions">
                <el-button link type="primary" @click="openLicenseModal(row)">编辑</el-button>
                <el-button
                  link
                  type="danger"
                  :loading="deletingLicenseId === row.id"
                  :disabled="deletingLicenseId !== null && deletingLicenseId !== row.id"
                  @click="deleteLicense(row)"
                >删除</el-button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <div v-if="licenseListError" class="license-table-empty-placeholder" aria-hidden="true" />
            <div v-else-if="licenseHasFilters" class="license-table-empty">
              <span>没有符合当前筛选条件的许可证</span>
              <el-button link type="primary" @click="resetLicenseFilters">清除筛选</el-button>
            </div>
            <div v-else class="license-table-empty">暂无许可证记录</div>
          </template>
          </el-table>
        </PagedTable>
      </PageContent>
  </PageContainer>
</template>
