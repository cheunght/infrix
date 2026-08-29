"""Typed runtime settings owned by the application.

The model is the source of truth for setting types, defaults and legal values.
This module only provides the singleton lifecycle and the read-only metadata
used by the settings form.
"""

from .models import SystemSetting


SETTING_METADATA = {
    "default_page_size": {
        "label": "默认每页条数",
        "type": "integer",
        "help_text": "作为未指定分页大小的列表默认值；用户已选择的页面大小不受影响。",
    },
    "default_asset_status": {
        "label": "新资产默认状态",
        "type": "enum",
        "help_text": "仅影响以后新建或导入且未填写状态的资产，不修改历史资产。",
    },
}


def get_system_settings():
    """Return the singleton, creating fresh-install defaults when needed."""

    return SystemSetting.objects.get_or_create(pk=SystemSetting.SINGLETON_ID)[0]


def system_settings_snapshot(setting):
    return {
        "default_page_size": setting.default_page_size,
        "default_asset_status": setting.default_asset_status,
    }


def reset_system_settings():
    """Restore the exact model defaults used by a fresh installation."""

    setting = get_system_settings()
    defaults = {
        field.name: field.default
        for field in setting._meta.fields
        if field.name in SETTING_METADATA
    }
    changed_fields = [
        field_name
        for field_name, default in defaults.items()
        if getattr(setting, field_name) != default
    ]
    if changed_fields:
        for field_name, default in defaults.items():
            setattr(setting, field_name, default)
        setting.save(update_fields=[*changed_fields, "updated_at"])
    return setting


def system_setting_definitions():
    """Build form metadata from the model fields, not a second value registry."""

    definitions = []
    for key, metadata in SETTING_METADATA.items():
        field = SystemSetting._meta.get_field(key)
        choices = [
            {"value": value, "label": label}
            for value, label in (field.choices or [])
        ]
        default = field.default() if callable(field.default) else field.default
        definitions.append(
            {
                "key": key,
                "label": metadata["label"],
                "type": metadata["type"],
                "default": default,
                "options": choices,
                "help_text": metadata["help_text"],
            }
        )
    return definitions
