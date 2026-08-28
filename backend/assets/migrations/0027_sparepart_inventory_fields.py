from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0025_sparepartcategory_sparepart_category"),
    ]

    operations = [
        migrations.AddField(
            model_name="sparepart",
            name="code",
            field=models.CharField(max_length=80, unique=True),
        ),
        migrations.AddField(
            model_name="sparepart",
            name="safety_stock",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="sparepart",
            name="storage_location",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.RemoveField(
            model_name="sparepart",
            name="is_active",
        ),
    ]
