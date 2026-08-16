from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0010_roles_room_rack_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="asset",
            name="asset_data_center",
            field=models.ForeignKey(
                blank=True,
                help_text="未上架资产的所属数据中心；已上架资产以机柜归属为准",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="unmounted_assets",
                to="assets.datacenter",
            ),
        ),
        migrations.CreateModel(
            name="InventoryTask",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=160)),
                ("start_at", models.DateTimeField()),
                ("end_at", models.DateTimeField()),
                ("status", models.CharField(choices=[("in_progress", "进行中"), ("completed", "已完成")], default="in_progress", max_length=20)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
                ("data_center", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="inventory_tasks", to="assets.datacenter")),
                ("inspector", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="inventory_tasks", to=settings.AUTH_USER_MODEL)),
                ("server_room", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="inventory_tasks", to="assets.serverroom")),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.CreateModel(
            name="InventoryItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("system_snapshot", models.JSONField(default=dict)),
                ("status", models.CharField(choices=[("pending", "未盘点"), ("normal", "正常"), ("location_mismatch", "位置不符"), ("not_found", "未找到"), ("info_mismatch", "设备信息不符"), ("other", "其他异常")], default="pending", max_length=30)),
                ("checked_at", models.DateTimeField(blank=True, null=True)),
                ("actual_start_u", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("actual_end_u", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
                ("actual_rack", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="inventory_items", to="assets.rack")),
                ("asset", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="inventory_items", to="assets.asset")),
                ("checked_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="checked_inventory_items", to=settings.AUTH_USER_MODEL)),
                ("task", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="items", to="assets.inventorytask")),
            ],
            options={"ordering": ["asset__asset_no", "id"]},
        ),
        migrations.AddConstraint(
            model_name="inventoryitem",
            constraint=models.UniqueConstraint(fields=("task", "asset"), name="uniq_inventory_item_task_asset"),
        ),
    ]
