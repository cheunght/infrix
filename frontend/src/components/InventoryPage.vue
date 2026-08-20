<script setup lang="ts">
import { onMounted } from "vue";
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
import type { InventoryContext } from "../types/page-context";
import { useInventory } from "../composables/useInventory";

const props = defineProps<{ context: InventoryContext }>();
const context = props.context;
const can = context.can;
const openAssetDetail = context.openAssetDetail;

const {
  loading, taskError, tasks, taskCount, taskPage, taskPageSize, taskSearch, taskStatus,
  taskDataCenter, taskRoom, activeTask, items, itemCount, itemPage, itemPageSize,
  itemSearch, itemStatus, inspectors, racks, showTaskDialog, showItemDialog, editingItem,
  taskForm, itemForm, activeDataCenters, activeRooms, taskFilterRooms, activeRacks,
  taskStatusOptions, itemStatusOptions, taskStatusLabel, formatDateTime, locationText,
  statusTagType, taskScope, loadInitialData, loadTasks, loadItems, openTask, closeTask,
  openNewTask, changeTaskDataCenter, saveTask, completeTask, reopenTask, exportTask,
  openItem, changeItemStatus, saveItem, changeTaskPage, changeTaskPageSize,
  changeItemPage, changeItemPageSize, resetTaskFilters, resetItemFilters,
} = useInventory(context);
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
            <el-button v-if="can('inventory.manage')" type="primary" :icon="Plus" @click="openNewTask">
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
        <el-alert v-if="taskError" :title="taskError" type="error" show-icon :closable="false" class="inventory-alert" />
        <el-table v-loading="loading" :data="tasks" empty-text="暂无盘点任务" @row-click="openTask">
        <el-table-column prop="name" label="盘点名称" min-width="220" />
        <el-table-column label="盘点范围" min-width="220"><template #default="{ row }">{{ taskScope(row) }}</template></el-table-column>
        <el-table-column prop="inspector_name" label="盘点人" width="120" />
        <el-table-column label="时间范围" min-width="300"><template #default="{ row }">{{ formatDateTime(row.start_at) }} - {{ formatDateTime(row.end_at) }}</template></el-table-column>
        <el-table-column label="完成率" width="150"><template #default="{ row }"><el-progress :percentage="row.summary.completion_rate" :stroke-width="8" /></template></el-table-column>
        <el-table-column label="异常" width="90"><template #default="{ row }">{{ row.summary.total - row.summary.pending - row.summary.normal }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag :status="row.status" :label="taskStatusLabel(row.status)" /></template></el-table-column>
        <el-table-column label="操作" fixed="right" width="150"><template #default="{ row }"><el-button link type="primary" @click.stop="openTask(row)">查看</el-button><el-button v-if="can('inventory.export')" link :icon="Download" @click.stop="exportTask(row)">导出</el-button></template></el-table-column>
        </el-table>
        <PagedTable v-model:current-page="taskPage" v-model:page-size="taskPageSize" :total="taskCount" :page-sizes="[20, 50, 100]" :loading="loading" @update:current-page="changeTaskPage" @update:page-size="changeTaskPageSize" />
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
              @click="completeTask"
            >
              完成盘点
            </el-button>
            <el-button
              v-if="can('inventory.manage') && activeTask.status === 'completed'"
              type="primary"
              @click="reopenTask"
            >
              重新打开
            </el-button>
          </template>
        </PageHeader>
      </template>
      <PageContent>
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
            <el-button :icon="Refresh" @click="resetItemFilters">重置</el-button>
          </PageToolbar>
          <el-alert v-if="taskError" :title="taskError" type="error" show-icon :closable="false" class="inventory-alert" />
          <PagedTable v-model:current-page="itemPage" v-model:page-size="itemPageSize" :total="itemCount" :page-sizes="[20, 50, 100]" :loading="loading" @update:current-page="changeItemPage" @update:page-size="changeItemPageSize">
            <el-table v-loading="loading" :data="items" empty-text="暂无盘点设备">
          <el-table-column label="资产编号" min-width="150"><template #default="{ row }"><el-button link type="primary" @click.stop="openAssetDetail(row.asset)">{{ row.asset_no }}</el-button></template></el-table-column>
          <el-table-column prop="asset_name" label="设备名称" min-width="180" />
          <el-table-column prop="serial_number" label="序列号" min-width="150"><template #default="{ row }">{{ row.serial_number || "—" }}</template></el-table-column>
          <el-table-column label="系统位置" min-width="250"><template #default="{ row }">{{ locationText(row) }}</template></el-table-column>
          <el-table-column label="盘点结果" width="130"><template #default="{ row }"><StatusTag :status="row.status" :type="statusTagType(row.status)" :label="row.status_label" /></template></el-table-column>
          <el-table-column label="实际位置" min-width="250"><template #default="{ row }">{{ row.status === 'pending' ? '—' : locationText(row, true) }}</template></el-table-column>
          <el-table-column label="盘点时间" width="170"><template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template></el-table-column>
          <el-table-column label="操作" fixed="right" width="120"><template #default="{ row }"><el-button v-if="can('inventory.manage') && activeTask.status === 'in_progress'" link type="primary" @click="openItem(row)">{{ row.status === 'pending' ? '确认盘点' : '修改结果' }}</el-button><span v-else>—</span></template></el-table-column>
            </el-table>
          </PagedTable>
        </PageSection>
      </PageContent>
    </PageContainer>

    <el-dialog v-model="showTaskDialog" title="新建盘点任务" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="盘点名称" required><el-input v-model="taskForm.name" placeholder="例如：2026年沈阳数据中心年度盘点" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="数据中心" required><el-select v-model="taskForm.data_center" @change="changeTaskDataCenter"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item label="机房（不选表示整个数据中心）"><el-select v-model="taskForm.server_room" clearable placeholder="整个数据中心"><el-option v-for="room in activeRooms" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
          <el-form-item label="盘点人"><el-select v-model="taskForm.inspector" clearable placeholder="默认当前用户"><el-option v-for="person in inspectors" :key="person.id" :label="person.display_name" :value="String(person.id)" /></el-select></el-form-item>
          <el-form-item label="开始时间" required><el-date-picker v-model="taskForm.start_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item label="结束时间" required><el-date-picker v-model="taskForm.end_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="taskForm.notes" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showTaskDialog = false">取消</el-button><el-button type="primary" @click="saveTask">创建并生成清单</el-button></template>
    </el-dialog>

    <el-dialog v-model="showItemDialog" title="确认盘点" width="560px" destroy-on-close>
      <el-alert v-if="editingItem" :title="`${editingItem.asset_no} · ${editingItem.asset_name}`" type="info" :closable="false" />
      <el-form label-position="top" class="inventory-item-form">
        <el-form-item label="盘点结果" required><el-select v-model="itemForm.status" @change="changeItemStatus"><el-option v-for="item in itemStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <div v-if="itemForm.status !== 'not_found'" class="form-grid">
          <el-form-item label="实际机柜"><el-select v-model="itemForm.actual_rack" clearable placeholder="未上架"><el-option v-for="rack in activeRacks" :key="rack.id" :label="`${rack.data_center_name} / ${rack.server_room_name} / ${rack.code}`" :value="String(rack.id)" /></el-select></el-form-item>
          <el-form-item label="实际起始 U"><el-input-number v-model="itemForm.actual_start_u" :min="1" controls-position="right" /></el-form-item>
          <el-form-item label="实际结束 U"><el-input-number v-model="itemForm.actual_end_u" :min="1" controls-position="right" /></el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="itemForm.notes" type="textarea" :rows="3" placeholder="设备信息不符时请记录具体差异" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showItemDialog = false">取消</el-button><el-button type="primary" @click="saveItem">保存盘点结果</el-button></template>
    </el-dialog>
  </div>
</template>
