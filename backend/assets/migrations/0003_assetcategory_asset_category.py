from django.db import migrations, models
import django.db.models.deletion


def assign_existing_categories(apps, schema_editor):
    Asset = apps.get_model("assets", "Asset")
    AssetCategory = apps.get_model("assets", "AssetCategory")
    for asset in Asset.objects.exclude(asset_type="").iterator():
        category, _ = AssetCategory.objects.get_or_create(name=asset.asset_type, defaults={"color": "#1677EF"})
        if asset.category_id is None:
            Asset.objects.filter(pk=asset.pk).update(category_id=category.pk)


class Migration(migrations.Migration):
    dependencies = [("assets", "0002_assetrelation_asset_relation_not_self")]

    operations = [
        migrations.CreateModel(
            name="AssetCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=80, unique=True)),
                ("color", models.CharField(default="#1677EF", max_length=7)),
            ],
            options={"abstract": False},
        ),
        migrations.AddField(
            model_name="asset",
            name="category",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assets", to="assets.assetcategory"),
        ),
        migrations.RunPython(assign_existing_categories, migrations.RunPython.noop),
    ]
