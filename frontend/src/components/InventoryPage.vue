<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  CircleCheck,
  Clock,
  DataAnalysis,
  Download,
  Plus,
  Refresh,
  Warning,
} from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import StatisticCard from "./StatisticCard.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageHeader from "./page/PageHeader.vue";
import PageToolbar from "./page/PageToolbar.vue";
import PageSection from "./page/PageSection.vue";
import StatusTag from "./StatusTag.vue";
import type { FormInstance, FormRules } from "element-plus";
import type { InventoryContext } from "../types/page-context";
import { useInventory } from "../composables/useInventory";

const props = defineProps<{ context: InventoryContext }>();
const context = props.context;
const can = context.can;
const openAssetDetail = context.openAssetDetail;
const taskFormRef = ref<FormInstance>();
const itemFormRef = ref<FormInstance>();
const taskRules: FormRules = {
  name: [{ required: true, message: "请输入盘点名称", trigger: "blur" }],
  data_center: [{ required: true, message: "请选择数据中心", trigger: "change" }],
  start_at: [{ required: true, message: "请选择开始时间", trigger: "change" }],
  end_at: [{ required: true, message: "请选择结束时间", trigger: "change" }],
};
const itemRules: FormRules = {
  status: [{ required: true, message: "请选择盘点结果", trigger: "change" }],
};

const {
  taskListLoading, taskListError, itemListLoading, itemListError, taskDetailLoading, taskDetailError,
  auxLoading, taskAuxError, itemAuxError, taskCreating, taskCompleting, taskReopening, itemSaving,
  tasks, taskCount, taskPage, taskPageSize, taskSearch, taskStatus,
  taskDataCenter, taskRoom, activeTask, items, itemCount, itemPage, itemPageSize,
  itemSearch, itemStatus, inspectors, racks, showTaskDialog, showItemDialog, editingItem,
  scopePreview, scopePreviewLoading, scopePreviewError,
  taskForm, itemForm, activeDataCenters, activeRooms, taskFilterRooms, activeRacks,
  taskHasFilters, itemHasFilters,
  taskStatusOptions, itemStatusOptions, itemResultOptions, taskStatusLabel, formatDateTime, locationText,
  statusTagType, taskScope, loadInitialData, loadTasks, loadItems, retryActiveTask, openTask, closeTask,
  openNewTask, changeTaskDataCenter, saveTask, completeTask, reopenTask, exportTask,
  changeTaskServerRoom, retryScopePreview, closeTaskDialog,
  openItem, changeItemStatus, saveItem, saveItemAndNext, filterPendingItems, changeTaskPage, changeTaskPageSize,
  changeItemPage, changeItemPageSize, resetTaskFilters, resetItemFilters,
  retryTaskAuxData, retryRackAuxData,
} = useInventory(context);

const itemCanSave = computed(
  () => Boolean(
    activeTask.value?.status === "in_progress" &&
      can("inventory.manage") &&
      itemForm.value.status &&
      !itemSaving.value,
  ),
);

const scopePreviewWarnings = computed(() => {
  const preview = scopePreview.value;
  if (!preview) return [];
  const warnings = [...(preview.warnings || [])];
  if (preview.retired > 0) {
    warnings.push(`当前范围包含 ${preview.retired} 台已报废资产`);
  }
  return Array.from(new Set(warnings));
});

async function submitTask() {
  const valid = await taskFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveTask();
}

async function submitItem() {
  const valid = await itemFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveItem();
}

async function submitItemAndNext() {
  const valid = await itemFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveItemAndNext();
}
onMounted(async () => {
  await loadInitialData();
});
</script>

<template>
  <div class="itam-page">
    <PageContainer v-if="!activeTask">
      <template #header>
        <PageHeader description="创建盘点任务并跟踪现场核对进度">
          <template #actions>
            <el-button v-if="can('inventory.manage')" type="primary" :icon="Plus" :loading="taskCreating" @click="openNewTask">
              新建盘点任务
            </el-button>
          </template>
        </PageHeader>
      </template>
      <template #toolbar>
        <PageToolbar>
          <SearchField class="itam-filter-search" v-model="taskSearch" placeholder="搜索盘点任务、数据中心或盘点人" aria-label="搜索盘点任务" @search="() => { taskPage = 1; loadTasks(); }" />
          <el-select class="itam-filter-select" v-model="taskStatus" placeholder="全部状态" clearable @change="() => { taskPage = 1; loadTasks(); }">
            <el-option v-for="item in taskStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-select class="itam-filter-select" v-model="taskDataCenter" placeholder="全部数据中心" clearable @change="() => { taskRoom = ''; taskPage = 1; loadTasks(); }">
            <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
          </el-select>
          <el-select class="itam-filter-select" v-model="taskRoom" placeholder="全部机房" clearable @change="() => { taskPage = 1; loadTasks(); }">
            <el-option v-for="room in taskFilterRooms" :key="room.id" :label="room.name" :value="String(room.id)" />
          </el-select>
          <el-button :icon="Refresh" @click="resetTaskFilters">重置</el-button>
        </PageToolbar>
      </template>
      <PageContent surface>
        <el-alert v-if="taskListError" :title="taskListError" type="error" show-icon :closable="false" class="inventory-alert" />
        <div v-if="taskListError" class="inventory-retry-row">
          <el-button link type="primary" @click="() => loadTasks()">重新加载</el-button>
        </div>
        <el-table v-loading="taskListLoading" :data="tasks" table-layout="fixed" @row-click="openTask">
        <template #empty>
          <div v-if="!taskListError" class="inventory-list-empty">
            <span>{{ taskHasFilters ? "没有符合当前筛选条件的盘点任务" : "暂无盘点任务" }}</span>
            <el-button v-if="taskHasFilters" link type="primary" @click="resetTaskFilters">清除筛选</el-button>
          </div>
        </template>
        <el-table-column prop="name" label="盘点名称" min-width="220" show-overflow-tooltip />
        <el-table-column label="盘点范围" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ taskScope(row) }}</template></el-table-column>
        <el-table-column prop="inspector_name" label="盘点人" width="120" show-overflow-tooltip />
        <el-table-column label="时间范围" min-width="300" show-overflow-tooltip><template #default="{ row }">{{ formatDateTime(row.start_at) }} - {{ formatDateTime(row.end_at) }}</template></el-table-column>
        <el-table-column label="完成率" width="150"><template #default="{ row }"><el-progress :percentage="row.summary.completion_rate" :stroke-width="8" /></template></el-table-column>
        <el-table-column label="异常" width="90"><template #default="{ row }">{{ row.summary.total - row.summary.pending - row.summary.normal }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag :status="row.status" :label="taskStatusLabel(row.status)" /></template></el-table-column>
        <el-table-column label="操作" fixed="right" width="150"><template #default="{ row }"><el-button link type="primary" @click.stop="openTask(row)">查看</el-button><el-button v-if="can('inventory.export')" link :icon="Download" @click.stop="exportTask(row)">导出</el-button></template></el-table-column>
        </el-table>
        <PagedTable v-model:current-page="taskPage" v-model:page-size="taskPageSize" :total="taskCount" :page-sizes="[20, 50, 100]" :loading="taskListLoading" @update:current-page="changeTaskPage" @update:page-size="changeTaskPageSize" />
      </PageContent>
    </PageContainer>

    <PageContainer v-else>
      <template #header>
        <PageHeader
          :title="activeTask.name"
          :description="taskScope(activeTask) + ' · 盘点人：' + activeTask.inspector_name"
        >
          <template #leading>
            <el-button link @click="closeTask">返回任务列表</el-button>
          </template>
          <template #actions>
            <el-button v-if="can('inventory.export')" :icon="Download" @click="exportTask()">
              导出结果
            </el-button>
            <el-button
              v-if="can('inventory.manage') && activeTask.status === 'in_progress'"
              type="primary"
              :loading="taskCompleting"
              :disabled="taskCompleting || activeTask.summary.pending > 0"
              :title="activeTask.summary.pending > 0 ? `仍有 ${activeTask.summary.pending} 项未盘点` : undefined"
              @click="completeTask"
            >
              完成盘点
            </el-button>
            <el-button
              v-if="can('inventory.manage') && activeTask.status === 'completed'"
              type="primary"
              :loading="taskReopening"
              :disabled="taskReopening"
              @click="reopenTask"
            >
              重新打开
            </el-button>
          </template>
        </PageHeader>
      </template>
      <PageContent v-loading="taskDetailLoading">
        <el-alert v-if="taskDetailError" :title="taskDetailError" type="error" show-icon :closable="false" class="inventory-alert" />
        <div v-if="taskDetailError" class="inventory-retry-row">
          <el-button link type="primary" @click="retryActiveTask">重新加载任务</el-button>
        </div>
        <PageSection title="盘点进度">
          <section class="inventory-summary-grid">
            <StatisticCard label="总设备" :value="activeTask.summary.total" tone="blue" :icon="DataAnalysis" />
            <StatisticCard label="已盘点" :value="activeTask.summary.checked" tone="green" :icon="CircleCheck" />
            <StatisticCard label="未盘点" :value="activeTask.summary.pending" tone="gray" :icon="Clock" />
            <StatisticCard label="正常" :value="activeTask.summary.normal" tone="green" :icon="CircleCheck" />
            <StatisticCard label="异常" :value="activeTask.summary.total - activeTask.summary.pending - activeTask.summary.normal" tone="red" :icon="Warning" />
            <StatisticCard label="完成率" :value="`${activeTask.summary.completion_rate}%`" tone="purple" :icon="DataAnalysis" />
          </section>
        </PageSection>
        <PageSection title="盘点设备">
          <PageToolbar>
            <SearchField class="itam-filter-search" v-model="itemSearch" placeholder="搜索资产编号、SN、IP或名称" aria-label="搜索盘点设备" @search="() => { itemPage = 1; loadItems(); }" />
            <el-select class="itam-filter-select" v-model="itemStatus" placeholder="全部盘点结果" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
            <el-button :type="itemStatus === 'pending' ? 'primary' : 'default'" :plain="itemStatus !== 'pending'" @click="filterPendingItems">仅看未盘点</el-button>
            <el-button :icon="Refresh" @click="resetItemFilters">重置</el-button>
          </PageToolbar>
          <el-alert v-if="itemListError" :title="itemListError" type="error" show-icon :closable="false" class="inventory-alert" />
          <div v-if="itemListError" class="inventory-retry-row">
            <el-button link type="primary" @click="() => loadItems()">重新加载设备</el-button>
          </div>
          <PagedTable v-model:current-page="itemPage" v-model:page-size="itemPageSize" :total="itemCount" :page-sizes="[20, 50, 100]" :loading="itemListLoading" @update:current-page="changeItemPage" @update:page-size="changeItemPageSize">
            <el-table v-loading="itemListLoading" :data="items" table-layout="fixed">
            <template #empty>
              <div v-if="!itemListError" class="inventory-list-empty">
                <span>{{ itemHasFilters ? "没有符合当前筛选条件的盘点设备" : "当前任务没有盘点设备" }}</span>
                <el-button v-if="itemHasFilters" link type="primary" @click="resetItemFilters">清除筛选</el-button>
              </div>
            </template>
          <el-table-column label="资产编号" min-width="150"><template #default="{ row }"><el-button link type="primary" @click.stop="openAssetDetail(row.asset)">{{ row.asset_no }}</el-button></template></el-table-column>
          <el-table-column prop="asset_name" label="设备名称" min-width="180" show-overflow-tooltip />
          <el-table-column prop="serial_number" label="序列号" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.serial_number || "—" }}</template></el-table-column>
          <el-table-column label="系统位置" min-width="250" show-overflow-tooltip><template #default="{ row }">{{ locationText(row) }}</template></el-table-column>
          <el-table-column label="盘点结果" width="130"><template #default="{ row }"><StatusTag :status="row.status" :type="statusTagType(row.status)" :label="row.status_label" /></template></el-table-column>
          <el-table-column label="实际位置" min-width="250" show-overflow-tooltip><template #default="{ row }">{{ row.status === 'pending' ? '—' : locationText(row, true) }}</template></el-table-column>
          <el-table-column label="盘点时间" width="170"><template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template></el-table-column>
          <el-table-column label="操作" fixed="right" width="120"><template #default="{ row }"><el-button v-if="can('inventory.manage') && activeTask.status === 'in_progress'" link type="primary" @click="openItem(row)">{{ row.status === 'pending' ? '确认盘点' : '修改结果' }}</el-button><span v-else>—</span></template></el-table-column>
            </el-table>
          </PagedTable>
        </PageSection>
      </PageContent>
    </PageContainer>

    <el-dialog v-model="showTaskDialog" title="新建盘点任务" width="620px" destroy-on-close @close="closeTaskDialog">
      <el-alert v-if="taskAuxError" :title="taskAuxError" type="error" show-icon :closable="false" class="inventory-alert">
        <template #default>
          <el-button link type="primary" @click="retryTaskAuxData">重新加载辅助数据</el-button>
        </template>
      </el-alert>
      <el-form ref="taskFormRef" :model="taskForm" :rules="taskRules" :validate-on-rule-change="false" label-position="top">
        <el-form-item label="盘点名称" prop="name"><el-input v-model="taskForm.name" placeholder="例如：2026年沈阳数据中心年度盘点" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="数据中心" prop="data_center"><el-select v-model="taskForm.data_center" :loading="auxLoading" @change="changeTaskDataCenter"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item label="机房（不选表示整个数据中心）"><el-select v-model="taskForm.server_room" clearable :disabled="Boolean(taskAuxError)" placeholder="整个数据中心" @change="changeTaskServerRoom"><el-option v-for="room in activeRooms" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
        </div>
        <section class="inventory-scope-preview" aria-live="polite">
          <div class="inventory-scope-preview__header">
            <strong>盘点范围</strong>
            <el-button v-if="scopePreviewError" link type="primary" @click="retryScopePreview">重新加载</el-button>
          </div>
          <template v-if="scopePreviewLoading">
            <div class="inventory-scope-preview__state">正在计算盘点范围...</div>
          </template>
          <template v-else-if="scopePreviewError">
            <div class="inventory-scope-preview__state inventory-scope-preview__state--error">盘点范围加载失败</div>
          </template>
          <template v-else-if="scopePreview">
            <div class="inventory-scope-preview__scope">{{ scopePreview.scope_label }}</div>
            <div class="inventory-scope-preview__total"><strong>{{ scopePreview.total }}</strong><span>台资产</span></div>
            <div class="inventory-scope-preview__stats">
              <span>已上架<strong>{{ scopePreview.racked }}</strong></span>
              <span>未上架<strong>{{ scopePreview.unracked }}</strong></span>
              <span>已报废<strong>{{ scopePreview.retired }}</strong></span>
            </div>
            <div v-if="scopePreview.total === 0" class="inventory-scope-preview__state inventory-scope-preview__state--warning">当前范围内没有可盘点资产</div>
            <ul v-if="scopePreviewWarnings.length" class="inventory-scope-preview__warnings">
              <li v-for="warning in scopePreviewWarnings" :key="warning">{{ warning }}</li>
            </ul>
            <p class="inventory-scope-preview__help">
              {{ scopePreview.includes_unracked ? "选择整个数据中心时，会包含属于该数据中心的未上架资产。" : "选择具体机房时，仅包含该机房内已上架资产。" }}
            </p>
            <p class="inventory-scope-preview__help">停用机房和停用机柜不纳入盘点范围。</p>
            <p class="inventory-scope-preview__help">任务创建后会固定当前资产清单，后续资产变化不会自动加入本次盘点。</p>
          </template>
          <div v-else class="inventory-scope-preview__state">请选择数据中心以计算盘点范围</div>
        </section>
        <div class="form-grid">
          <el-form-item label="盘点人"><el-select v-model="taskForm.inspector" clearable :loading="auxLoading" :disabled="Boolean(taskAuxError)" placeholder="默认当前用户"><el-option v-for="person in inspectors" :key="person.id" :label="person.display_name" :value="String(person.id)" /></el-select></el-form-item>
          <el-form-item label="开始时间" prop="start_at"><el-date-picker v-model="taskForm.start_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item label="结束时间" prop="end_at"><el-date-picker v-model="taskForm.end_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="taskForm.notes" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="closeTaskDialog">取消</el-button><el-button type="primary" :loading="taskCreating" :disabled="taskCreating || scopePreviewLoading || Boolean(scopePreviewError) || !scopePreview || scopePreview.total <= 0" @click="submitTask">创建并生成清单</el-button></template>
    </el-dialog>

    <el-dialog v-model="showItemDialog" title="确认盘点" width="560px" destroy-on-close>
      <el-alert v-if="itemAuxError" :title="itemAuxError" type="error" show-icon :closable="false" class="inventory-alert">
        <template #default>
          <el-button link type="primary" @click="retryRackAuxData">重新加载机柜</el-button>
        </template>
      </el-alert>
      <el-alert v-if="editingItem" :title="`${editingItem.asset_no} · ${editingItem.asset_name}`" type="info" :closable="false" />
      <el-form :key="editingItem?.id ?? 'inventory-item-form'" ref="itemFormRef" :model="itemForm" :rules="itemRules" :validate-on-rule-change="false" label-position="top" class="inventory-item-form">
        <el-form-item label="盘点结果" prop="status"><el-select v-model="itemForm.status" placeholder="请选择盘点结果" @change="changeItemStatus"><el-option v-for="item in itemResultOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <div v-if="itemForm.status && itemForm.status !== 'not_found'" class="form-grid">
          <el-form-item label="实际机柜"><el-select v-model="itemForm.actual_rack" clearable :disabled="Boolean(itemAuxError)" placeholder="未上架"><el-option v-for="rack in activeRacks" :key="rack.id" :label="`${rack.data_center_name} / ${rack.server_room_name} / ${rack.code}`" :value="String(rack.id)" /></el-select></el-form-item>
          <el-form-item label="实际起始 U"><el-input-number v-model="itemForm.actual_start_u" :min="1" controls-position="right" /></el-form-item>
          <el-form-item label="实际结束 U"><el-input-number v-model="itemForm.actual_end_u" :min="1" controls-position="right" /></el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="itemForm.notes" type="textarea" :rows="3" placeholder="设备信息不符时请记录具体差异" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showItemDialog = false">取消</el-button><el-button :disabled="!itemCanSave" @click="submitItem">保存</el-button><el-button type="primary" :loading="itemSaving" :disabled="!itemCanSave" @click="submitItemAndNext">保存并下一项</el-button></template>
    </el-dialog>
  </div>
</template>
