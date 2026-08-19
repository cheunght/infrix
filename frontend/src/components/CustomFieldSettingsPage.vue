<script setup lang="ts">
import { proxyRefs } from "vue";
import type { CustomFieldContext } from "../types/page-context";
const props = defineProps<{ context: CustomFieldContext }>();
const c = proxyRefs(props.context);
</script>

<template>
  <el-card shadow="never" class="settings-card">
    <template #header>
      <div class="ep-toolbar settings-toolbar">
        <strong>自定义字段</strong>
        <el-select class="itam-filter-select" v-model="c.customFieldDeviceType" placeholder="全部设备类型" clearable @change="c.loadCustomFields()">
          <el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
        </el-select>
        <el-select class="itam-filter-select" v-model="c.customFieldActive" placeholder="状态" @change="c.loadCustomFields()">
          <el-option label="全部状态" value="all" /><el-option label="启用" value="true" /><el-option label="停用" value="false" />
        </el-select>
        <span class="ep-toolbar-spacer"></span>
        <el-button type="primary" :disabled="!c.can('custom_fields.manage')" @click="c.openCustomFieldModal()">新增字段</el-button>
      </div>
    </template>
    <el-table :data="c.customFields" empty-text="暂无自定义字段">
      <el-table-column prop="name" label="字段名称" min-width="150" />
      <el-table-column prop="key" label="编码" min-width="150" />
      <el-table-column prop="device_type_name" label="设备类型" min-width="120" />
      <el-table-column prop="field_type_label" label="类型" width="110" />
      <el-table-column label="必填" width="70"><template #default="{ row }"><el-tag size="small" :type="row.required ? 'warning' : 'info'">{{ row.required ? '是' : '否' }}</el-tag></template></el-table-column>
      <el-table-column label="选项" min-width="180"><template #default="{ row }"><template v-if="['select','multiselect'].includes(row.field_type)"><el-tag v-for="option in (row.options || [])" :key="option.id" size="small" class="field-option-tag">{{ option.label }}</el-tag><el-button link type="primary" :disabled="!c.can('custom_fields.manage')" @click="c.openCustomFieldOptionModal(row)">管理选项</el-button></template><span v-else>—</span></template></el-table-column>
      <el-table-column prop="assets_count" label="引用资产" width="100" />
      <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag size="small" :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '启用' : '停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="220" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><el-button link type="primary" :disabled="!c.can('custom_fields.manage')" @click="c.openCustomFieldModal(row)">编辑</el-button><el-button link :disabled="!c.can('custom_fields.manage')" @click="c.toggleCustomField(row)">{{ row.is_active ? '停用' : '启用' }}</el-button><el-button link type="danger" :disabled="!c.can('custom_fields.manage') || (row.assets_count || 0) > 0" @click="c.deleteCustomField(row)">删除</el-button></div></template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="c.showCustomFieldModal" :title="c.editingCustomField ? '编辑自定义字段' : '新增自定义字段'" width="620px" destroy-on-close>
    <el-form label-position="top"><div class="form-grid"><el-form-item label="设备类型" required><el-select v-model="c.customFieldForm.device_type" :disabled="!!c.editingCustomField"><el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" /></el-select></el-form-item><el-form-item label="字段编码" required><el-input v-model="c.customFieldForm.key" :disabled="!!c.editingCustomField" placeholder="例如 operating_system" /></el-form-item><el-form-item label="字段名称" required><el-input v-model="c.customFieldForm.name" /></el-form-item><el-form-item label="字段类型" required><el-select v-model="c.customFieldForm.field_type" :disabled="!!c.editingCustomField"><el-option label="单行文本" value="text" /><el-option label="多行文本" value="textarea" /><el-option label="数字" value="number" /><el-option label="日期" value="date" /><el-option label="下拉单选" value="select" /><el-option label="多选" value="multiselect" /><el-option label="是/否" value="boolean" /></el-select></el-form-item><el-form-item label="默认值提示"><el-input v-model="c.customFieldForm.default_value" /></el-form-item><el-form-item label="显示顺序"><el-input-number v-model="c.customFieldForm.sort_order" :min="0" /></el-form-item></div><el-checkbox v-model="c.customFieldForm.required">必填字段</el-checkbox><el-checkbox v-model="c.customFieldForm.is_active">启用</el-checkbox></el-form>
    <template #footer><el-button @click="c.showCustomFieldModal = false">取消</el-button><el-button type="primary" @click="c.saveCustomField">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="c.showCustomFieldOptionModal" :title="`管理字段选项${c.editingCustomField ? `：${c.editingCustomField.name}` : ''}`" width="680px" destroy-on-close>
    <el-table :data="c.editingCustomField?.options || []" size="small" empty-text="暂无选项"><el-table-column prop="value" label="稳定值" /><el-table-column prop="label" label="显示名称" /><el-table-column prop="sort_order" label="顺序" width="70" /><el-table-column label="状态" width="80"><template #default="{ row }"><el-tag size="small" :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '启用' : '停用' }}</el-tag></template></el-table-column><el-table-column label="操作" width="160"><template #default="{ row }"><el-button link type="primary" @click="c.openCustomFieldOptionModal(c.editingCustomField, row)">编辑</el-button><el-button link type="danger" @click="c.deleteCustomFieldOption(row)">删除</el-button></template></el-table-column></el-table>
    <el-divider />
    <el-form label-position="top" class="form-grid"><el-form-item label="稳定值" required><el-input v-model="c.customFieldOptionForm.value" /></el-form-item><el-form-item label="显示名称" required><el-input v-model="c.customFieldOptionForm.label" /></el-form-item><el-form-item label="顺序"><el-input-number v-model="c.customFieldOptionForm.sort_order" :min="0" /></el-form-item><el-checkbox v-model="c.customFieldOptionForm.is_active">启用</el-checkbox></el-form>
    <template #footer><el-button @click="c.showCustomFieldOptionModal = false">关闭</el-button><el-button type="primary" @click="c.saveCustomFieldOption">保存选项</el-button></template>
  </el-dialog>
</template>
