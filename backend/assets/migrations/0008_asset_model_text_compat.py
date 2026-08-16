from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("assets", "0007_assetmodel_datacenter_dictionary")]

    operations = [
        migrations.AlterField(
            model_name="asset",
            name="model",
            field=models.CharField(blank=True, max_length=160),
        ),
    ]
