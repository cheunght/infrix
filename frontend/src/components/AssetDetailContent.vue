<script setup lang="ts">
import type { AssetDetail } from "../types";

defineProps<{ asset: AssetDetail | null; loading: boolean; error: string }>();

function roleLabel(role: string) {
  return (
    (
      { business: "业务 IP", management: "管理 IP", oob: "带外 IP" } as Record<
        string,
        string
      >
    )[role] || role
  );
}

function statusLabel(status: string) {
  return (
    (
      {
        in_stock: "在库",
        in_use: "在用",
        idle: "闲置",
        repair: "维修中",
        retired: "已报废",
      } as Record<string, string>
    )[status] || status
  );
}

function statusTagType(status: string) {
  return (
    ({
      in_stock: "info",
      in_use: "success",
      idle: "warning",
      repair: "danger",
      retired: "info",
    } as Record<string, "success" | "warning" | "danger" | "info">)[status] ||
    "info"
  );
}
</script>

<template>
  <div v-if="loading" class="drawer-state">正在加载资产详情…</div>
  <div v-else-if="error" class="drawer-state drawer-error">{{ error }}</div>
  <div v-else-if="asset" class="drawer-content">
    <div class="asset-detail-summary">
      <div>
        <span>资产编号</span>
        <strong>{{ asset.asset_no }}</strong>
      </div>
      <div>
        <span>当前状态</span>
        <el-tag :type="statusTagType(asset.status)" effect="light">
          {{ statusLabel(asset.status) }}
        </el-tag>
      </div>
    </div>
    <section class="detail-section">
      <h3>基础信息</h3>
      <dl>
        <dt>资产名称</dt>
        <dd>{{ asset.name }}</dd>
        <dt>设备类型</dt>
        <dd>{{ asset.device_type_name || asset.asset_type || "—" }}</dd>
        <dt>品牌</dt>
        <dd>{{ asset.brand_name || "—" }}</dd>
        <dt>型号</dt>
        <dd>{{ asset.model_name || asset.brand_model || "—" }}</dd>
        <dt>序列号</dt>
        <dd>{{ asset.serial_number || "—" }}</dd>
        <dt>用途</dt>
        <dd>{{ asset.purpose || "—" }}</dd>
        <dt>使用人</dt>
        <dd>{{ asset.owner_name || "—" }}</dd>
      </dl>
    </section>
    <section class="detail-section">
      <h3>机柜位置</h3>
      <dl>
        <dt>上架状态</dt>
        <dd>{{ asset.rack_allocation ? "已上架" : "未上架" }}</dd>
        <dt>数据中心</dt>
        <dd>{{ asset.rack_allocation?.data_center || asset.asset_data_center_name || "—" }}</dd>
        <dt>机房</dt>
        <dd>{{ asset.rack_allocation?.server_room || "—" }}</dd>
        <dt>机柜编号</dt>
        <dd>{{ asset.rack_allocation?.rack_code || "—" }}</dd>
        <dt>U 位</dt>
        <dd>
          {{
            asset.rack_allocation
              ? `${asset.rack_allocation.start_u}–${asset.rack_allocation.end_u} U`
              : "—"
          }}
        </dd>
      </dl>
    </section>
    <section class="detail-section">
      <h3>网络地址</h3>
      <dl>
        <template v-for="role in ['business', 'management', 'oob']" :key="role">
          <dt>{{ roleLabel(role) }}</dt>
          <dd>
            {{
              asset.network_addresses.find((item) => item.role === role)
                ?.address || "—"
            }}
          </dd>
        </template>
      </dl>
    </section>
    <section class="detail-section">
      <h3>采购与维保</h3>
      <dl>
        <dt>采购日期</dt>
        <dd>{{ asset.procurement_records[0]?.purchase_date || "—" }}</dd>
        <dt>供应商</dt>
        <dd>{{ asset.procurement_records[0]?.supplier || "—" }}</dd>
        <dt>采购单号</dt>
        <dd>{{ asset.procurement_records[0]?.order_no || "—" }}</dd>
        <dt>维保厂商</dt>
        <dd>{{ asset.maintenance_contracts[0]?.provider || "—" }}</dd>
        <dt>维保合同号</dt>
        <dd>{{ asset.maintenance_contracts[0]?.contract_no || "—" }}</dd>
        <dt>维保开始日</dt>
        <dd>{{ asset.maintenance_contracts[0]?.start_date || "—" }}</dd>
        <dt>维保到期日</dt>
        <dd>{{ asset.maintenance_contracts[0]?.expiry_date || "—" }}</dd>
      </dl>
    </section>
    <section class="detail-section">
      <h3>标签</h3>
      <div v-if="asset.tags?.length" class="asset-detail-tags"><el-tag v-for="tag in asset.tags" :key="tag.id" size="small" :type="tag.is_active ? '' : 'info'">{{ tag.name }}</el-tag></div>
      <span v-else>—</span>
    </section>
    <section class="detail-section" v-if="asset.custom_fields?.length">
      <h3>自定义字段</h3>
      <dl>
        <template v-for="field in asset.custom_fields" :key="field.id">
          <dt>{{ field.name }}<small v-if="!field.is_active">（已停用）</small></dt>
          <dd>{{ Array.isArray(field.value) ? field.value.join('、') : (field.value === true ? '是' : field.value === false ? '否' : field.value ?? '—') }}</dd>
        </template>
      </dl>
    </section>
    <section class="detail-section">
      <h3>备注</h3>
      <p class="detail-notes">{{ asset.notes || "—" }}</p>
    </section>
    <section class="detail-section">
      <h3>盘点记录</h3>
      <el-empty v-if="!asset.inventory_records?.length" description="暂无盘点记录" :image-size="60" />
      <div v-else class="asset-inventory-history">
        <div v-for="record in asset.inventory_records" :key="record.id" class="asset-inventory-history-item">
          <div class="asset-inventory-history-head">
            <strong>{{ record.task_name }}</strong>
            <el-tag :type="record.status === 'normal' ? 'success' : record.status === 'pending' ? 'info' : 'warning'" size="small">{{ record.status_label }}</el-tag>
          </div>
          <small>{{ record.checked_at ? new Date(record.checked_at).toLocaleString('zh-CN') : '未盘点' }} · {{ record.checked_by_name || '—' }}</small>
          <p v-if="record.notes">{{ record.notes }}</p>
          <small v-if="record.actual_rack_code">实际位置：{{ [record.actual_data_center, record.actual_server_room, record.actual_rack_code].filter(Boolean).join(' / ') }} · U{{ record.actual_start_u }}–U{{ record.actual_end_u }}</small>
        </div>
      </div>
    </section>
  </div>
</template>
