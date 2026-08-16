from django.db import migrations, models
import django.db.models.deletion


def link_existing_device_types(apps, schema_editor):
    Asset = apps.get_model("assets", "Asset")
    DeviceType = apps.get_model("assets", "DeviceType")

    names = Asset.objects.exclude(asset_type="").values_list("asset_type", flat=True).distinct()
    for raw_name in names:
        name = (raw_name or "").strip()
        if not name:
            continue
        device_type = DeviceType.objects.filter(name__iexact=name).first()
        if device_type is None:
            device_type = DeviceType.objects.create(name=name, is_active=True)
        Asset.objects.filter(device_type__isnull=True, asset_type__iexact=name).update(device_type_id=device_type.pk)


class Migration(migrations.Migration):
    dependencies = [("assets", "0005_softwarelicense")]

    operations = [
        migrations.CreateModel(
            name="Brand",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=120, unique=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
        ),
        migrations.CreateModel(
            name="DeviceType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=80, unique=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
        ),
        migrations.AddField(
            model_name="asset",
            name="brand",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assets", to="assets.brand"),
        ),
        migrations.AddField(
            model_name="asset",
            name="device_type",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assets", to="assets.devicetype"),
        ),
        migrations.RunPython(link_existing_device_types, migrations.RunPython.noop),
    ]
