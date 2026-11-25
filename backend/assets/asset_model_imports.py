from django.db import IntegrityError, transaction
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from rest_framework.exceptions import ValidationError

from .imports import ImportFileError, ImportValidationError, iter_import_worksheet_rows
from .models import AssetModel, CustomFieldSet, DeviceType, Manufacturer
from .operation_limits import MAX_ASSET_MODEL_IMPORT_BYTES, MAX_ASSET_MODEL_IMPORT_ROWS
from .serializers import AssetModelSerializer


ASSET_MODEL_IMPORT_COLUMNS = (
    ("name", "型号名称", True, "同一厂商内唯一。"),
    ("model_number", "型号编号", False, "填写时在同一厂商内唯一。"),
    ("manufacturer", "厂商", True, "必须提前维护且处于启用状态。"),
    ("device_type", "设备类型", True, "必须提前维护且处于启用状态。"),
    ("fieldset", "字段集", False, "留空时继承设备类型的默认字段集。"),
    ("default_warranty_months", "默认保修月数", False, "非负整数。"),
    ("expected_life_months", "预计寿命月数", False, "非负整数。"),
    ("notes", "备注", False, "型号说明。"),
    ("is_active", "状态", False, "可填 true/false、启用/停用，默认启用。"),
)


def build_asset_model_import_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "资产型号导入"
    sheet.append([item[0] for item in ASSET_MODEL_IMPORT_COLUMNS])
    sheet.freeze_panes = "A2"
    for cell in sheet[1]:
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = PatternFill("solid", fgColor="1F4E78")
        cell.alignment = Alignment(horizontal="center")
    guide = workbook.create_sheet("填写说明")
    guide.append(["字段", "显示名称", "必填", "填写说明"])
    for key, label, required, description in ASSET_MODEL_IMPORT_COLUMNS:
        guide.append([key, label, "是" if required else "否", description])
    guide.column_dimensions["A"].width = 28
    guide.column_dimensions["B"].width = 24
    guide.column_dimensions["C"].width = 10
    guide.column_dimensions["D"].width = 72
    return workbook


def _cell_text(value):
    return "" if value is None else str(value).strip()


def _named(queryset, value, label):
    value = _cell_text(value)
    if not value:
        raise ValidationError({label: f"{label}不能为空"})
    matches = list(queryset.filter(name__iexact=value)[:2])
    if not matches:
        raise ValidationError({label: f"未找到{label}“{value}”"})
    if not matches[0].is_active:
        raise ValidationError({label: f"停用的{label}不能用于资产型号"})
    return matches[0]


def _optional_months(value, field):
    text = _cell_text(value)
    if not text:
        return None
    if not text.isdigit():
        raise ValidationError({field: "必须是非负整数"})
    try:
        return int(text)
    except ValueError as exc:
        raise ValidationError({field: "必须是有效的非负整数"}) from exc


def _active(value):
    text = _cell_text(value).lower()
    if not text:
        return True
    if text in {"true", "1", "yes", "启用"}:
        return True
    if text in {"false", "0", "no", "停用"}:
        return False
    raise ValidationError({"is_active": "状态只能填写 true/false 或启用/停用"})


def _payload(row):
    manufacturer = _named(Manufacturer.objects, row.get("manufacturer"), "厂商")
    device_type = _named(DeviceType.objects, row.get("device_type"), "设备类型")
    fieldset_text = _cell_text(row.get("fieldset"))
    fieldset = _named(CustomFieldSet.objects, fieldset_text, "字段集") if fieldset_text else None
    return {
        "name": _cell_text(row.get("name")),
        "model_number": _cell_text(row.get("model_number")),
        "manufacturer": manufacturer.pk,
        "device_type": device_type.pk,
        "fieldset": fieldset.pk if fieldset else None,
        "default_warranty_months": _optional_months(row.get("default_warranty_months"), "default_warranty_months"),
        "expected_life_months": _optional_months(row.get("expected_life_months"), "expected_life_months"),
        "notes": _cell_text(row.get("notes")),
        "is_active": _active(row.get("is_active")),
    }


def _validate_file_size(upload):
    if upload is None:
        raise ValidationError({"file": "请选择导入文件"})
    if not upload.name.lower().endswith(".xlsx"):
        raise ValidationError({"file": "资产型号导入仅支持 .xlsx 文件"})
    size = int(getattr(upload, "size", 0) or 0)
    if size > MAX_ASSET_MODEL_IMPORT_BYTES:
        max_megabytes = MAX_ASSET_MODEL_IMPORT_BYTES // (1024 * 1024)
        raise ValidationError({
            "file": f"资产型号导入文件不能超过 {max_megabytes} MB",
        })


def _rows(upload):
    _validate_file_size(upload)
    upload.seek(0)
    try:
        workbook = load_workbook(upload, read_only=True, data_only=False, keep_links=False)
    except Exception as exc:
        raise ValidationError({"file": "Excel 文件无法解析，请确认文件为有效的 .xlsx 工作簿"}) from exc
    try:
        worksheets = workbook.worksheets
        if not worksheets:
            raise ValidationError({"file": "Excel 文件没有可读取的工作表"})
        default_sheet = workbook.active if workbook.active in worksheets else worksheets[0]
        sheet = next((item for item in worksheets if item.title == "资产型号导入"), default_sheet)
        rows = iter_import_worksheet_rows(sheet)
        headers = [_cell_text(cell.value).lstrip("\ufeff").strip() for cell in next(rows, ())]
        while headers and not headers[-1]:
            headers.pop()
        expected = {column[0] for column in ASSET_MODEL_IMPORT_COLUMNS}
        if not headers or not expected.issubset(set(headers)):
            raise ValidationError({"file": "模板字段不完整，请重新下载最新模板"})
        if any(not header for header in headers) or len(headers) != len(set(headers)):
            raise ValidationError({"file": "模板包含空白或重复字段名，请保留每个字段一列"})
        parsed = []
        for line, cells in enumerate(rows, start=2):
            if not any(_cell_text(cell.value) for cell in cells):
                continue
            if any(cell.data_type == "f" for cell in cells):
                raise ValidationError({"file": f"第 {line} 行包含公式，请将公式结果复制为值后再导入"})
            if any(_cell_text(cell.value) for cell in cells[len(headers):]):
                raise ValidationError({"file": f"第 {line} 行包含未命名的多余数据列"})
            if len(parsed) >= MAX_ASSET_MODEL_IMPORT_ROWS:
                raise ValidationError({
                    "file": (
                        f"资产型号导入数据行数超过 {MAX_ASSET_MODEL_IMPORT_ROWS} 行，"
                        "请拆分文件后重试"
                    ),
                })
            parsed.append((line, dict(zip(headers, (cell.value for cell in cells)))))
        if not parsed:
            raise ValidationError({"file": "导入文件中没有资产型号数据"})
        return parsed
    except ImportFileError as exc:
        raise ValidationError({"file": str(exc)}) from exc
    finally:
        workbook.close()


def preview_asset_model_import(upload):
    rows = _rows(upload)
    result = []
    seen = set()
    seen_numbers = set()
    for line, row in rows:
        item = {
            "line": line, "name": _cell_text(row.get("name")), "valid": False, "errors": [],
            "values": {key: _cell_text(row.get(key)) for key, *_ in ASSET_MODEL_IMPORT_COLUMNS},
        }
        try:
            payload = _payload(row)
            key = (payload["manufacturer"], payload["name"].casefold())
            if key in seen:
                raise ValidationError({"name": "文件内存在重复的厂商与型号名称"})
            seen.add(key)
            model_number = payload["model_number"].casefold()
            number_key = (payload["manufacturer"], model_number)
            if model_number and number_key in seen_numbers:
                raise ValidationError({"model_number": "文件内存在重复的厂商与型号编号"})
            if model_number:
                seen_numbers.add(number_key)
            serializer = AssetModelSerializer(data=payload)
            serializer.is_valid(raise_exception=True)
            item["payload"] = payload
            item["values"].update({key: value for key, value in payload.items()
                                   if key not in {"manufacturer", "device_type", "fieldset"}})
            item["valid"] = True
        except ValidationError as exc:
            item["errors"] = exc.detail
        result.append(item)
    return {
        "total": len(result),
        "valid": sum(1 for item in result if item["valid"]),
        "invalid": sum(1 for item in result if not item["valid"]),
        "rows": result,
    }


@transaction.atomic
def commit_asset_model_import(upload):
    preview = preview_asset_model_import(upload)
    if preview["invalid"]:
        # DRF ValidationError stringifies nested booleans and counts.
        raise ImportValidationError(preview)
    created = []
    try:
        for item in preview["rows"]:
            serializer = AssetModelSerializer(data=item["payload"])
            serializer.is_valid(raise_exception=True)
            created.append(serializer.save())
    except IntegrityError as exc:
        raise ValidationError({"detail": "导入期间型号目录已发生变化，请重新预览后再试"}) from exc
    return created
