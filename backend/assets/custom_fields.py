"""Shared validation and normalization for asset custom field values."""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation


VALIDATION_CONFIG_KEYS = {
    "text": {"min_length", "max_length"},
    "textarea": {"min_length", "max_length"},
    "number": {"min", "max", "precision"},
    "date": {"min_date", "max_date"},
    "multiselect": {"min_items", "max_items"},
    "select": set(),
    "boolean": set(),
}

# AssetCustomValue.number_value remains stored in DecimalField(max_digits=20,
# decimal_places=6) for compatibility with existing data. New logical values
# are limited to two decimal places before they reach the database.
CUSTOM_VALUE_NUMBER_MAX_DIGITS = 20
CUSTOM_VALUE_NUMBER_STORAGE_DECIMAL_PLACES = 6
CUSTOM_VALUE_NUMBER_DECIMAL_PLACES = 2
CUSTOM_VALUE_NUMBER_MAX_INTEGER_DIGITS = (
    CUSTOM_VALUE_NUMBER_MAX_DIGITS - CUSTOM_VALUE_NUMBER_STORAGE_DECIMAL_PLACES
)


def _validation_integer(value, label, *, maximum=None):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label}必须是非负整数")
    if maximum is not None and value > maximum:
        raise ValueError(f"{label}不能大于 {maximum}")
    return value


def _validation_decimal(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label}必须是数字")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{label}必须是数字") from exc
    if not parsed.is_finite():
        raise ValueError(f"{label}必须是有限数字")
    return str(parsed)


def normalize_validation_date(value, label):
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期")
    return value


def normalize_validation_config(field_type, value):
    """Validate and normalize the configured rules for one field type."""
    if not isinstance(value, dict):
        raise ValueError("校验配置必须是 JSON 对象")
    allowed = VALIDATION_CONFIG_KEYS.get(field_type, set())
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ValueError(f"不支持的校验配置项：{'、'.join(unknown)}")

    normalized = {}
    for key, raw in value.items():
        if key in {"min_length", "max_length", "min_items", "max_items"}:
            normalized[key] = _validation_integer(raw, key)
        elif key == "precision":
            normalized[key] = _validation_integer(raw, key, maximum=CUSTOM_VALUE_NUMBER_DECIMAL_PLACES)
        elif key in {"min", "max"}:
            normalized[key] = _validation_decimal(raw, key)
        elif key in {"min_date", "max_date"}:
            normalized[key] = normalize_validation_date(raw, key)

    if {"min_length", "max_length"}.issubset(normalized) and normalized["min_length"] > normalized["max_length"]:
        raise ValueError("min_length 不能大于 max_length")
    if {"min_items", "max_items"}.issubset(normalized) and normalized["min_items"] > normalized["max_items"]:
        raise ValueError("min_items 不能大于 max_items")
    if {"min", "max"}.issubset(normalized) and Decimal(normalized["min"]) > Decimal(normalized["max"]):
        raise ValueError("min 不能大于 max")
    if {"min_date", "max_date"}.issubset(normalized):
        min_date = date.fromisoformat(normalized["min_date"])
        max_date = date.fromisoformat(normalized["max_date"])
        if min_date > max_date:
            raise ValueError("min_date 不能晚于 max_date")
    return normalized


def custom_field_value_is_empty(value, field_type):
    if field_type in {"text", "textarea", "date", "select"}:
        return value is None or (isinstance(value, str) and value.strip() == "")
    if field_type == "number":
        return value is None or (isinstance(value, str) and value.strip() == "")
    if field_type == "boolean":
        return value is None
    if field_type == "multiselect":
        return value is None or value == []
    return value is None


def _parse_decimal(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label}必须是数字")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{label}必须是数字") from exc
    if not parsed.is_finite():
        raise ValueError(f"{label}必须是有限数字")
    return parsed


def _parse_date(value, label):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期")
    return parsed


def _decimal_places(value):
    """Return significant decimal places, ignoring insignificant trailing zeros."""
    sign, digits, exponent = value.as_tuple()
    if exponent >= 0 or not digits:
        return 0
    trailing_zeroes = 0
    for digit in reversed(digits):
        if digit != 0:
            break
        trailing_zeroes += 1
    return max(0, -exponent - trailing_zeroes)


def _decimal_integer_digits(value):
    """Return the number of digits to the left of the decimal point."""
    if value == 0:
        return 1
    return max(1, value.adjusted() + 1)


def _normalized_decimal(value):
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def validate_custom_field_value(
    field,
    value,
    *,
    allowed_inactive_options=None,
    allowed_option_values=None,
    validate_empty=False,
):
    """Validate one logical custom field value and return a JSON-safe value.

    Required/optional presence is intentionally handled by the asset value
    application service, because it needs to distinguish a partial update from
    a submitted empty value. This function validates every non-empty value and
    returns ``None`` for an empty value.
    """
    field_type = field.field_type
    config = normalize_validation_config(field_type, field.validation_config or {})
    label = getattr(field, "name", "自定义字段")

    if custom_field_value_is_empty(value, field_type) and not validate_empty:
        return None

    if field_type in {"text", "textarea"}:
        if not isinstance(value, str):
            raise ValueError(f"{label}必须是文本")
        length = len(value)
        if "min_length" in config and length < config["min_length"]:
            raise ValueError(f"{label}长度不能少于 {config['min_length']} 个字符")
        if "max_length" in config and length > config["max_length"]:
            raise ValueError(f"{label}长度不能超过 {config['max_length']} 个字符")
        return value

    if field_type == "number":
        number = _parse_decimal(value, label)
        if _decimal_integer_digits(number) > CUSTOM_VALUE_NUMBER_MAX_INTEGER_DIGITS:
            raise ValueError(
                f"{label}整数部分不能超过 {CUSTOM_VALUE_NUMBER_MAX_INTEGER_DIGITS} 位"
            )
        if "min" in config and number < Decimal(config["min"]):
            raise ValueError(f"{label}不能小于 {config['min']}")
        if "max" in config and number > Decimal(config["max"]):
            raise ValueError(f"{label}不能大于 {config['max']}")
        precision = config.get("precision", CUSTOM_VALUE_NUMBER_DECIMAL_PLACES)
        if _decimal_places(number) > precision:
            raise ValueError(f"{label}最多支持 {precision} 位小数")
        return _normalized_decimal(number)

    if field_type == "date":
        parsed_date = _parse_date(value, label)
        if "min_date" in config and parsed_date < date.fromisoformat(config["min_date"]):
            raise ValueError(f"{label}不能早于 {config['min_date']}")
        if "max_date" in config and parsed_date > date.fromisoformat(config["max_date"]):
            raise ValueError(f"{label}不能晚于 {config['max_date']}")
        return parsed_date.isoformat()

    if field_type == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"{label}必须是 true 或 false")
        return value

    if field_type in {"select", "multiselect"}:
        if field_type == "select":
            if not isinstance(value, str):
                raise ValueError(f"{label}必须是选项值")
            submitted_values = [value]
        else:
            if not isinstance(value, list):
                raise ValueError(f"{label}必须是选项数组")
            submitted_values = value
        options = (
            set(allowed_option_values)
            if allowed_option_values is not None
            else {option.value for option in field.options.all() if option.is_active}
        )
        if allowed_inactive_options:
            inactive_options = {
                option.value
                for option in field.options.all()
                if not option.is_active
            }
            options.update(inactive_options.intersection(set(allowed_inactive_options)))
        if any(not isinstance(item, str) or item not in options for item in submitted_values):
            raise ValueError(f"{label}包含无效或已停用选项")
        if field_type == "multiselect":
            if "min_items" in config and len(value) < config["min_items"]:
                raise ValueError(f"{label}至少选择 {config['min_items']} 项")
            if "max_items" in config and len(value) > config["max_items"]:
                raise ValueError(f"{label}最多选择 {config['max_items']} 项")
            return list(value)
        return value

    raise ValueError(f"不支持的自定义字段类型：{field_type}")


def custom_field_storage_payload(field, value):
    """Convert a validated logical value to AssetCustomValue columns."""
    payload = {
        "text_value": "",
        "number_value": None,
        "date_value": None,
        "boolean_value": None,
        "json_value": None,
    }
    if field.field_type in {"text", "textarea", "select"}:
        payload["text_value"] = value
    elif field.field_type == "number":
        payload["number_value"] = Decimal(str(value))
    elif field.field_type == "date":
        payload["date_value"] = date.fromisoformat(str(value))
    elif field.field_type == "boolean":
        payload["boolean_value"] = value
    elif field.field_type == "multiselect":
        payload["json_value"] = value
    else:
        raise ValueError(f"不支持的自定义字段类型：{field.field_type}")
    return payload
