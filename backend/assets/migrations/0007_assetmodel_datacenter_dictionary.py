from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("assets", "0006_brand_devicetype_asset_links")]

    operations = [
        migrations.AddField(
            model_name="datacenter",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="asset",
            name="model",
            field=models.CharField(blank=True, max_length=160),
        ),
    ]
