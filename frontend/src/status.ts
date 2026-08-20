export const STATUS_LABEL_MAP: Record<string, string> = {
  active: "启用",
  enabled: "启用",
  in_use: "在用",
  in_stock: "在库",
  normal: "正常",
  completed: "已完成",
  expiring: "即将到期",
  pending: "待处理",
  reserved: "预留",
  repair: "维修中",
  idle: "闲置",
  in_progress: "处理中",
  expired: "已过期",
  over_limit: "超授权",
  fault: "故障",
  disabled: "停用",
  inactive: "停用",
  retired: "已报废",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL_MAP[status] || status || "—";
}
