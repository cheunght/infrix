"""Read-only reporting services used by dashboard and facility endpoints."""

from .capacity import build_dashboard_capacity, build_rack_capacity_rows, rack_effective_used_u
from .dashboard import build_dashboard_payload
from .alerts import build_alerts_payload
from .scope import DashboardScopeError, resolve_dashboard_scope

__all__ = [
    "DashboardScopeError",
    "build_alerts_payload",
    "build_dashboard_capacity",
    "build_dashboard_payload",
    "build_rack_capacity_rows",
    "rack_effective_used_u",
    "resolve_dashboard_scope",
]
