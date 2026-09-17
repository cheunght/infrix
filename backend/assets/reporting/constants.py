"""Stable metadata shared by the read-only dashboard reporting services."""

from ..enum_contracts import ASSET_STATUS_LABELS


STATUS_METADATA = (
    ("in_use", ASSET_STATUS_LABELS["in_use"], "#16A34A"),
    ("in_stock", ASSET_STATUS_LABELS["in_stock"], "#2563EB"),
    ("repair", ASSET_STATUS_LABELS["repair"], "#D97706"),
    ("idle", ASSET_STATUS_LABELS["idle"], "#8B5CF6"),
    ("retired", ASSET_STATUS_LABELS["retired"], "#98A2B3"),
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

# The synchronous rack workbook writes a five-column cell grid for every U
# position and keeps the complete workbook in the request. Keep the guard
# aligned with those two dimensions instead of treating it as a row export.
RACK_LAYOUT_EXPORT_MAX_RACKS = 100
RACK_LAYOUT_EXPORT_MAX_U_POSITIONS = 10_000
