from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0022_asset_depreciation"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="Brand",
            new_name="Manufacturer",
        ),
        migrations.RenameField(
            model_name="asset",
            old_name="brand",
            new_name="manufacturer",
        ),
        migrations.RenameField(
            model_name="sparepart",
            old_name="brand",
            new_name="manufacturer",
        ),
        migrations.RenameField(
            model_name="asset",
            old_name="brand_model",
            new_name="manufacturer_model",
        ),
        migrations.AddField(
            model_name="manufacturer",
            name="code",
            field=models.CharField(
                blank=True,
                max_length=80,
                null=True,
                unique=True,
            ),
        ),
    ]
