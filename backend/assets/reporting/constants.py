"""Stable metadata shared by the read-only dashboard reporting services."""

STATUS_METADATA = (
    ("in_use", "使用中", "#16A34A"),
    ("in_stock", "在库", "#2563EB"),
    ("repair", "维修中", "#D97706"),
    ("idle", "闲置", "#8B5CF6"),
    ("retired", "已报废", "#98A2B3"),
)

STATUS_METADATA_MAP = {
    status: {"label": label, "color": color}
    for status, label, color in STATUS_METADATA
}

TYPE_PALETTE = (
    "#2563EB",
    "#10B981",
    "#8B5CF6",
    "#F59E0B",
    "#94A3B8",
    "#06B6D4",
)

AUDIT_ACTION_LABELS = {
    "create": "新增",
    "update": "更新",
    "delete": "删除",
    "import": "批量导入",
}

EXPIRY_WINDOWS = {
    "within_30_days": 30,
    "within_60_days": 60,
    "within_90_days": 90,
}

DASHBOARD_LIMITS = {
    "recent_alerts": 6,
    "upcoming_expirations": 8,
    "recent_audit_rows": 40,
    "recent_changes": 8,
}
