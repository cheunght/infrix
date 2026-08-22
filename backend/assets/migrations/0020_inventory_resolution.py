from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def initialize_inventory_resolution(apps, schema_editor):
    InventoryItem = apps.get_model("assets", "InventoryItem")
    InventoryItem.objects.all().update(
        resolution_status="not_required",
        resolution_action=None,
        resolution_note="",
        resolved_by=None,
        resolved_at=None,
    )
    InventoryItem.objects.filter(
        status__in=["location_mismatch", "not_found", "info_mismatch", "other"]
    ).update(resolution_status="pending")


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0019_customfield_filterable"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="inventoryitem",
            name="resolution_status",
            field=models.CharField(
                choices=[
                    ("not_required", "无需处理"),
                    ("pending", "待处理"),
                    ("resolved", "已处理"),
                ],
                default="not_required",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="inventoryitem",
            name="resolution_action",
            field=models.CharField(
                blank=True,
                choices=[
                    ("update_asset", "更新资产台账"),
                    ("keep_asset", "保持资产台账"),
                    ("confirm_missing", "确认设备缺失"),
                    ("ignore", "忽略/误报"),
                ],
                max_length=30,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="inventoryitem",
            name="resolution_note",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="inventoryitem",
            name="resolved_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="resolved_inventory_items",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="inventoryitem",
            name="resolved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(initialize_inventory_resolution, migrations.RunPython.noop),
    ]
