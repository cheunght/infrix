"""Shared validation and normalization for asset custom field values."""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import re
from ipaddress import IPv4Address, IPv6Address, ip_address

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator, validate_email


CUSTOM_FIELD_FORMATS = {
    "any",
    "alpha",
    "alpha_dash",
    "numeric",
    "alpha_numeric",
    "email",
    "date",
    "url",
    "ip",
    "ipv4",
    "ipv6",
    "mac",
    "regex",
}

VALIDATION_CONFIG_KEYS = {
    "text": {"format", "pattern", "min_length", "max_length"},
    "textarea": {"format", "pattern", "min_length", "max_length"},
    "number": set(),
    "date": set(),
    "multiselect": {"min_items", "max_items"},
    "select": set(),
    "boolean": set(),
}

# These keys were used by the previous range-based UI. Ignore them while
# normalizing old JSON values so existing fields remain readable; any later
# save strips them from the stored configuration.
LEGACY_VALIDATION_CONFIG_KEYS = {"min", "max", "min_date", "max_date", "precision"}
CUSTOM_FIELD_REGEX_MAX_LENGTH = 500
MAC_PATTERN = re.compile(
    r"(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|"
    r"(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}"
)
URL_VALIDATOR = URLValidator()

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


def normalize_validation_config(field_type, value):
    """Validate and normalize the configured rules for one field type."""
    if not isinstance(value, dict):
        raise ValueError("校验配置必须是 JSON 对象")
    allowed = VALIDATION_CONFIG_KEYS.get(field_type, set())
    current = {
        key: raw
        for key, raw in value.items()
        if key not in LEGACY_VALIDATION_CONFIG_KEYS
    }
    unknown = sorted(set(current) - allowed)
    if unknown:
        raise ValueError(f"不支持的校验配置项：{'、'.join(unknown)}")

    normalized = {}
    format_name = "any"
    if "format" in current:
        format_name = current["format"] or "any"
        if not isinstance(format_name, str) or format_name not in CUSTOM_FIELD_FORMATS:
            raise ValueError("不支持的输入格式")
        if format_name != "any":
            normalized["format"] = format_name

    if "pattern" in current:
        pattern = current["pattern"]
        if format_name != "regex":
            raise ValueError("只有自定义正则格式可以配置正则表达式")
        if not isinstance(pattern, str) or not pattern.strip():
            raise ValueError("自定义正则不能为空")
        if len(pattern) > CUSTOM_FIELD_REGEX_MAX_LENGTH:
            raise ValueError(f"自定义正则不能超过 {CUSTOM_FIELD_REGEX_MAX_LENGTH} 个字符")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError("自定义正则格式不正确") from exc
        normalized["pattern"] = pattern
    elif format_name == "regex":
        raise ValueError("选择自定义正则后必须填写正则表达式")

    for key, raw in current.items():
        if key in {"format", "pattern"}:
            continue
        if key in {"min_length", "max_length", "min_items", "max_items"}:
            normalized[key] = _validation_integer(raw, key)

    if {"min_length", "max_length"}.issubset(normalized) and normalized["min_length"] > normalized["max_length"]:
        raise ValueError("min_length 不能大于 max_length")
    if {"min_items", "max_items"}.issubset(normalized) and normalized["min_items"] > normalized["max_items"]:
        raise ValueError("min_items 不能大于 max_items")
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


def _validate_text_format(value, format_name, pattern, label):
    if format_name in {None, "", "any"}:
        return
    matches = True
    if format_name == "alpha":
        matches = re.fullmatch(r"[A-Za-z]+", value) is not None
    elif format_name == "alpha_dash":
        matches = re.fullmatch(r"[A-Za-z0-9_-]+", value) is not None
    elif format_name == "numeric":
        try:
            _parse_decimal(value, label)
        except ValueError:
            matches = False
    elif format_name == "alpha_numeric":
        matches = re.fullmatch(r"[A-Za-z0-9]+", value) is not None
    elif format_name == "email":
        try:
            validate_email(value)
        except DjangoValidationError:
            matches = False
    elif format_name == "date":
        try:
            _parse_date(value, label)
        except ValueError:
            matches = False
    elif format_name == "url":
        try:
            URL_VALIDATOR(value)
        except DjangoValidationError:
            matches = False
    elif format_name in {"ip", "ipv4", "ipv6"}:
        try:
            address = ip_address(value)
            matches = (
                format_name == "ip"
                or format_name == "ipv4" and isinstance(address, IPv4Address)
                or format_name == "ipv6" and isinstance(address, IPv6Address)
            )
        except ValueError:
            matches = False
    elif format_name == "mac":
        matches = MAC_PATTERN.fullmatch(value) is not None
    elif format_name == "regex":
        try:
            matches = re.fullmatch(pattern or "", value) is not None
        except re.error:
            matches = False
    else:
        raise ValueError(f"不支持的输入格式：{format_name}")
    if not matches:
        raise ValueError(f"{label}格式不符合要求")


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
        _validate_text_format(value, config.get("format"), config.get("pattern"), label)
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
        precision = CUSTOM_VALUE_NUMBER_DECIMAL_PLACES
        if _decimal_places(number) > precision:
            raise ValueError(f"{label}最多支持 {precision} 位小数")
        return _normalized_decimal(number)

    if field_type == "date":
        parsed_date = _parse_date(value, label)
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
