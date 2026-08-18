from django.db import migrations, models
import django.db.models.deletion


DEFAULT_COLOR = "#1677EF"


def merge_categories(apps, schema_editor):
    Asset = apps.get_model("assets", "Asset")
    AssetCategory = apps.get_model("assets", "AssetCategory")
    DeviceType = apps.get_model("assets", "DeviceType")

    def get_or_create_type(name, color=DEFAULT_COLOR, is_active=True):
        normalized = (name or "").strip()
        if not normalized:
            return None
        device_type = DeviceType.objects.filter(name__iexact=normalized).first()
        if device_type is None:
            device_type = DeviceType.objects.create(
                name=normalized,
                color=color or DEFAULT_COLOR,
                is_active=is_active,
            )
        return device_type

    category_types = {}
    for category in AssetCategory.objects.all().iterator():
        device_type = get_or_create_type(category.name, category.color, True)
        if device_type is None:
            continue
        # The former category color is the source of truth for an existing
        # same-name device type during this one-time merge.
        DeviceType.objects.filter(pk=device_type.pk).update(
            color=category.color or DEFAULT_COLOR,
            is_active=True,
        )
        category_types[category.pk] = device_type.pk

    # First repair assets that only have the legacy category relation.
    for asset in Asset.objects.select_related("category", "device_type").all().iterator():
        device_type_id = asset.device_type_id
        if not device_type_id and asset.category_id:
            device_type_id = category_types.get(asset.category_id)
            if device_type_id is None and asset.category:
                device_type = get_or_create_type(asset.category.name)
                device_type_id = device_type.pk if device_type else None
        if not device_type_id and asset.asset_type:
            device_type = get_or_create_type(asset.asset_type)
            device_type_id = device_type.pk if device_type else None
        if device_type_id:
            device_type_name = DeviceType.objects.filter(pk=device_type_id).values_list("name", flat=True).first()
            Asset.objects.filter(pk=asset.pk).update(
                device_type_id=device_type_id,
                asset_type=device_type_name or asset.asset_type,
            )


class Migration(migrations.Migration):
    dependencies = [("assets", "0015_auth_security")]

    operations = [
        migrations.AddField(
            model_name="devicetype",
            name="color",
            field=models.CharField(default="#1677EF", max_length=7),
        ),
        migrations.RunPython(merge_categories, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="asset",
            name="category",
        ),
        migrations.DeleteModel(
            name="AssetCategory",
        ),
    ]
