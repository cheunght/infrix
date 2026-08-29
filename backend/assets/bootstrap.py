"""Initial application data shared by fresh install and system reset."""

from .roles import ROLE_DEFINITIONS, ensure_preset_groups
from .system_settings import get_system_settings


def initialize_system_data():
    """Create or repair the immutable application bootstrap records.

    Django's migration framework owns schema and content-type/permission
    records.  The application owns the named role groups and the singleton
    typed settings row at this layer; capability definitions remain code-based
    in ``roles.py``.
    """
    groups = ensure_preset_groups()
    get_system_settings()
    missing = sorted(set(ROLE_DEFINITIONS) - set(groups))
    if missing:
        raise RuntimeError(
            f"预设角色初始化失败：{', '.join(missing)}"
        )
    return groups
