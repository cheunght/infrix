from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0029_sparepart_unit_choices"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="asset",
            name="asset_type",
        ),
        migrations.RemoveField(
            model_name="rack",
            name="vendor",
        ),
    ]
