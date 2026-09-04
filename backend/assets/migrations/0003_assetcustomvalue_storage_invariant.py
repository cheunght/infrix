from django.db import migrations, models
from django.db.models import Q


def _asset_custom_value_storage_condition():
    """Allow zero or one active typed storage family per value row."""
    return (
        (Q(text_value="") | Q(number_value__isnull=True))
        & (Q(text_value="") | Q(date_value__isnull=True))
        & (Q(text_value="") | Q(boolean_value__isnull=True))
        & (Q(text_value="") | Q(json_value__isnull=True))
        & (Q(number_value__isnull=True) | Q(date_value__isnull=True))
        & (Q(number_value__isnull=True) | Q(boolean_value__isnull=True))
        & (Q(number_value__isnull=True) | Q(json_value__isnull=True))
        & (Q(date_value__isnull=True) | Q(boolean_value__isnull=True))
        & (Q(date_value__isnull=True) | Q(json_value__isnull=True))
        & (Q(boolean_value__isnull=True) | Q(json_value__isnull=True))
    )


def fail_if_asset_custom_value_storage_is_ambiguous(apps, schema_editor):
    AssetCustomValue = apps.get_model("assets", "AssetCustomValue")
    invalid = AssetCustomValue.objects.filter(~_asset_custom_value_storage_condition())
    count = invalid.count()
    if count:
        ids = list(invalid.order_by("id").values_list("id", flat=True)[:10])
        raise RuntimeError(
            "Cannot add the AssetCustomValue typed-storage exclusivity constraint because "
            f"{count} rows use more than one storage column; affected IDs (up to 10): {ids}. "
            "Clean these rows before retrying the migration; no custom-field values were changed."
        )


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0002_remove_sparestock_uniq_spare_stock_location_and_more"),
    ]

    operations = [
        migrations.RunPython(
            fail_if_asset_custom_value_storage_is_ambiguous,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name="assetcustomvalue",
            constraint=models.CheckConstraint(
                condition=_asset_custom_value_storage_condition(),
                name="asset_custom_value_one_storage",
            ),
        ),
    ]
