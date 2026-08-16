from django.db import migrations, models


def sync_rack_status(apps, schema_editor):
    Rack = apps.get_model("assets", "Rack")
    Rack.objects.filter(status="in_use", is_active=False).update(status="disabled")


class Migration(migrations.Migration):
    dependencies = [("assets", "0013_custom_fields_tags")]

    operations = [
        migrations.AddField(
            model_name="serverroom",
            name="owner_name",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="serverroom",
            name="contact_phone",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="serverroom",
            name="notes",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="rack",
            name="name",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="rack",
            name="rack_type",
            field=models.CharField(blank=True, default="标准机柜", max_length=80),
        ),
        migrations.AddField(
            model_name="rack",
            name="owner_name",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="rack",
            name="notes",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="rack",
            name="status",
            field=models.CharField(
                choices=[("in_use", "使用中"), ("reserved", "预留"), ("disabled", "停用")],
                default="in_use",
                max_length=20,
            ),
        ),
        migrations.RunPython(sync_rack_status, migrations.RunPython.noop),
    ]
