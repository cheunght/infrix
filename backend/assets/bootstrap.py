"""Initial application data shared by fresh install and system reset."""

from .organization_access import ensure_preset_groups, role_codes
from .system_settings import ensure_system_settings


def initialize_system_data():
    """Create or repair the immutable application bootstrap records.

    Django's migration framework owns schema and content-type/permission
    records.  The application owns the named role groups and the singleton
    typed settings row at this layer; capability definitions remain code-based
    in the organization access module.
    """
    groups = ensure_preset_groups()
    ensure_system_settings()
    missing = sorted(set(role_codes()) - set(groups))
    if missing:
        raise RuntimeError(
            f"预设角色初始化失败：{', '.join(missing)}"
        )
    return groups
