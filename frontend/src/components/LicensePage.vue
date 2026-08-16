<script setup lang="ts">
import { Clock, Key, Warning } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import StatisticCard from "./StatisticCard.vue";

const props = defineProps<{ context: Record<string, any> }>();
const {
  loading,
  licenseSummary,
  licenseKeyword,
  searchLicenses,
  licenseStatus,
  can,
  openLicenseModal,
  deleteLicense,
  licenses,
  licenseProgressStyle,
  licensePage,
  licensePageSize,
  licenseCount,
  changeLicensePage,
  changeLicensePageSize,
} = props.context;
</script>

<template>
  <div class="itam-page license-page">
        <section class="license-page">
          <section class="license-summary-grid">
            <StatisticCard
              label="许可证总数"
              :value="licenseSummary.total"
              unit="项"
              tone="blue"
              :icon="Key"
            />
            <StatisticCard
              label="90天内到期"
              :value="licenseSummary.within_90_days"
              unit="项"
              tone="orange"
              :icon="Clock"
            />
            <StatisticCard
              label="超授权风险"
              :value="licenseSummary.over_license_risk"
              unit="项"
              tone="gray"
              :icon="Warning"
            />
          </section>
          <el-card shadow="never">
            <div class="ep-toolbar">
              <SearchField
                v-model="licenseKeyword"
                placeholder="搜索软件名称、厂商或许可类型"
                aria-label="搜索许可证"
                @search="searchLicenses"
              />
              <el-select
                v-model="licenseStatus"
                placeholder="全部状态"
                clearable
                @change="searchLicenses"
                ><el-option label="正常" value="normal" /><el-option
                  label="即将到期"
                  value="expiring" /><el-option
                  label="已过期"
                  value="expired" /><el-option
                  label="超授权"
                  value="over_limit"
              /></el-select>
              
              <span class="ep-toolbar-spacer"></span
              ><div class="ep-toolbar-actions"><el-button v-if="can('licenses.manage')" type="primary" @click="openLicenseModal()"
                >新增许可证</el-button
              ></div>
            </div>
            <PagedTable
              v-model:current-page="licensePage"
              v-model:page-size="licensePageSize"
              :total="licenseCount"
              :loading="loading"
              @update:current-page="changeLicensePage"
              @update:page-size="changeLicensePageSize"
            >
            <el-table :data="licenses" empty-text="暂无许可证记录">
              <el-table-column
                prop="name"
                label="软件名称"
                min-width="180"
              /><el-table-column
                prop="vendor"
                label="厂商"
                min-width="120"
              /><el-table-column
                prop="license_type"
                label="许可类型"
                min-width="120"
              /><el-table-column
                prop="authorized_count"
                label="授权数"
                width="90"
              /><el-table-column prop="used_count" label="已用" width="80" />
              <el-table-column label="使用率" min-width="170"
                ><template #default="{ row }"
                  ><el-progress
                    :percentage="Math.min(row.utilization, 100)"
                    :status="
                      row.status === 'over_limit' ? 'exception' : undefined
                    " /></template
              ></el-table-column>
              <el-table-column label="到期日期" width="120"
                ><template #default="{ row }">{{
                  row.expiry_date || "长期有效"
                }}</template></el-table-column
              >
              <el-table-column label="状态" width="110"
                ><template #default="{ row }"
                  ><el-tag
                    :type="
                      row.status === 'normal'
                        ? 'success'
                        : row.status === 'expiring'
                          ? 'warning'
                          : 'danger'
                    "
                    >{{ row.status_label }}</el-tag
                  ></template
                ></el-table-column
              >
              <el-table-column v-if="can('licenses.manage')" label="操作" fixed="right" width="140"
                ><template #default="{ row }"
                  ><div class="ep-table-actions"><el-button link type="primary" @click="openLicenseModal(row)"
                    >编辑</el-button
                  ><el-button link type="danger" @click="deleteLicense(row)"
                    >删除</el-button></div
                  ></template
                ></el-table-column
              >
            </el-table>
            </PagedTable>
          </el-card>
        </section>
  </div>
</template>
