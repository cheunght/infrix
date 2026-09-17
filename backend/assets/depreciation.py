"""Pure straight-line depreciation calculations.

The calculator never writes an asset, procurement record, audit log or cache.
It accepts the existing procurement amount as its original value and returns a
JSON-ready dictionary for the detail API.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from .system_settings import system_localdate


DEPRECIATION_METHOD_STRAIGHT_LINE = "straight_line"
MONEY_QUANTUM = Decimal("0.01")
RATE_QUANTUM = Decimal("0.0001")
PROGRESS_QUANTUM = Decimal("0.0001")


class DepreciationValidationError(ValueError):
    """Validation errors that can be mapped directly to serializer fields."""

    def __init__(self, errors: dict[str, str]):
        self.errors = errors
        super().__init__("折旧配置校验失败")


@dataclass(frozen=True)
class DepreciationResult:
    method: str | None
    start_date: str | None
    years: int | None
    residual_rate: str | None
    original_value: str | None
    residual_value: str | None
    monthly_depreciation: str | None
    accumulated_depreciation: str | None
    net_book_value: str | None
    elapsed_months: int | None
    total_months: int | None
    progress: str | None
    status: str

    def as_dict(self) -> dict[str, object]:
        return {
            "method": self.method,
            "start_date": self.start_date,
            "years": self.years,
            "residual_rate": self.residual_rate,
            "original_value": self.original_value,
            "residual_value": self.residual_value,
            "monthly_depreciation": self.monthly_depreciation,
            "accumulated_depreciation": self.accumulated_depreciation,
            "net_book_value": self.net_book_value,
            "elapsed_months": self.elapsed_months,
            "total_months": self.total_months,
            "progress": self.progress,
            "status": self.status,
        }


def _is_blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _decimal(value, *, field: str) -> Decimal:
    if isinstance(value, float):
        raise ValueError(f"{field} 必须使用 Decimal 或字符串金额")
    try:
        return value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{field} 格式不正确") from exc


def validate_depreciation_configuration(
    *,
    depreciation_start_date,
    depreciation_years,
    residual_rate,
    depreciation_method,
    amount,
) -> None:
    """Validate a complete-or-empty depreciation configuration.

    ``amount`` is the prospective procurement amount, which may come from the
    same AssetWriteSerializer request rather than the database.
    """

    values = {
        "depreciation_start_date": depreciation_start_date,
        "depreciation_years": depreciation_years,
        "residual_rate": residual_rate,
        "depreciation_method": depreciation_method,
    }
    if not any(not _is_blank(value) for value in values.values()):
        return

    errors: dict[str, str] = {
        field: "折旧配置不完整"
        for field, value in values.items()
        if _is_blank(value)
    }

    if not _is_blank(depreciation_years):
        try:
            if int(depreciation_years) <= 0:
                errors["depreciation_years"] = "折旧年限必须大于 0"
        except (TypeError, ValueError):
            errors["depreciation_years"] = "折旧年限必须是正整数"

    if not _is_blank(residual_rate):
        try:
            rate = _decimal(residual_rate, field="残值率")
            if rate < 0 or rate > 1:
                errors["residual_rate"] = "残值率必须在 0 和 1 之间"
        except ValueError as exc:
            errors["residual_rate"] = str(exc)

    if not _is_blank(depreciation_method) and depreciation_method != DEPRECIATION_METHOD_STRAIGHT_LINE:
        errors["depreciation_method"] = "折旧方法只支持 straight_line"

    if _is_blank(amount):
        errors["configuration"] = "配置折旧时必须存在大于 0 的采购金额"
    else:
        try:
            if _decimal(amount, field="采购金额") <= 0:
                errors["configuration"] = "配置折旧时采购金额必须大于 0"
        except ValueError as exc:
            errors["configuration"] = str(exc)

    if errors:
        raise DepreciationValidationError(errors)


def _money_text(value: Decimal) -> str:
    return format(value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP), "f")


def _rate_text(value: Decimal) -> str:
    return format(value.quantize(RATE_QUANTUM, rounding=ROUND_HALF_UP), "f")


def _progress_text(value: Decimal) -> str:
    return format(value.quantize(PROGRESS_QUANTUM, rounding=ROUND_HALF_UP), "f")


def _unconfigured() -> dict[str, object]:
    return DepreciationResult(
        method=None,
        start_date=None,
        years=None,
        residual_rate=None,
        original_value=None,
        residual_value=None,
        monthly_depreciation=None,
        accumulated_depreciation=None,
        net_book_value=None,
        elapsed_months=None,
        total_months=None,
        progress=None,
        status="unconfigured",
    ).as_dict()


def calculate_depreciation(
    *,
    amount,
    depreciation_start_date,
    depreciation_years,
    residual_rate,
    depreciation_method,
    as_of_date: date | None = None,
) -> dict[str, object]:
    """Calculate one asset's depreciation without mutating any state."""

    if (
        _is_blank(amount)
        or _is_blank(depreciation_start_date)
        or _is_blank(depreciation_years)
        or _is_blank(residual_rate)
        or _is_blank(depreciation_method)
    ):
        return _unconfigured()

    try:
        original_value = _decimal(amount, field="采购金额")
        years = int(depreciation_years)
        rate = _decimal(residual_rate, field="残值率")
    except (TypeError, ValueError):
        return _unconfigured()

    if (
        original_value <= 0
        or years <= 0
        or rate < 0
        or rate > 1
        or depreciation_method != DEPRECIATION_METHOD_STRAIGHT_LINE
    ):
        return _unconfigured()

    if not isinstance(depreciation_start_date, date):
        return _unconfigured()
    as_of = as_of_date or system_localdate()
    if not isinstance(as_of, date):
        return _unconfigured()

    residual_value = original_value * rate
    depreciable_amount = original_value - residual_value
    total_months = years * 12
    monthly_depreciation = depreciable_amount / Decimal(total_months)

    if as_of < depreciation_start_date:
        elapsed_months = 0
        status = "not_started"
    else:
        elapsed_months = (
            (as_of.year - depreciation_start_date.year) * 12
            + as_of.month
            - depreciation_start_date.month
        )
        if as_of.day < depreciation_start_date.day:
            elapsed_months -= 1
        elapsed_months = max(elapsed_months, 0)
        status = "fully_depreciated" if elapsed_months >= total_months else "depreciating"

    if elapsed_months >= total_months:
        accumulated_depreciation = depreciable_amount
        progress = Decimal("1")
    elif elapsed_months <= 0:
        accumulated_depreciation = Decimal("0")
        progress = Decimal("0")
    else:
        accumulated_depreciation = min(
            monthly_depreciation * Decimal(elapsed_months),
            depreciable_amount,
        )
        progress = Decimal(elapsed_months) / Decimal(total_months)

    net_book_value = max(original_value - accumulated_depreciation, residual_value)
    return DepreciationResult(
        method=depreciation_method,
        start_date=depreciation_start_date.isoformat(),
        years=years,
        residual_rate=_rate_text(rate),
        original_value=_money_text(original_value),
        residual_value=_money_text(residual_value),
        monthly_depreciation=_money_text(monthly_depreciation),
        accumulated_depreciation=_money_text(accumulated_depreciation),
        net_book_value=_money_text(net_book_value),
        elapsed_months=elapsed_months,
        total_months=total_months,
        progress=_progress_text(progress),
        status=status,
    ).as_dict()


def _asset_procurement_amount(asset):
    cache = getattr(asset, "_prefetched_objects_cache", {})
    if "procurement_records" in cache:
        records = cache["procurement_records"]
        return records[0].amount if records else None
    record = asset.procurement_records.order_by("-purchase_date", "-id").first()
    return record.amount if record else None


def calculate_asset_depreciation(asset, as_of_date: date | None = None) -> dict[str, object]:
    """Calculate from an Asset and its current procurement record.

    Detail and audit querysets prefetch ``procurement_records`` so this adapter
    does not issue an extra query in the normal API path.
    """

    return calculate_depreciation(
        amount=_asset_procurement_amount(asset),
        depreciation_start_date=asset.depreciation_start_date,
        depreciation_years=asset.depreciation_years,
        residual_rate=asset.residual_rate,
        depreciation_method=asset.depreciation_method,
        as_of_date=as_of_date,
    )
