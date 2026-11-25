from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("assets", "0003_rack_unit_reservation")]

    operations = [
        migrations.AddField(
            model_name="auditlog",
            name="timeline_asset_id",
            field=models.PositiveBigIntegerField(null=True, editable=False),
        ),
        migrations.AddIndex(
            model_name="auditlog",
            index=models.Index(fields=["timeline_asset_id", "-created_at", "-id"], name="assets_audit_timeline_idx"),
        ),
    ]
