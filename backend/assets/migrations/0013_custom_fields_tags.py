# Generated manually for dynamic asset fields and tags.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("assets", "0012_sparepart_sparestocktransaction_sparestock")]

    operations = [
        migrations.CreateModel(
            name="CustomField",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("key", models.CharField(max_length=80, unique=True)),
                ("name", models.CharField(max_length=120)),
                ("field_type", models.CharField(choices=[("text", "单行文本"), ("textarea", "多行文本"), ("number", "数字"), ("date", "日期"), ("select", "下拉单选"), ("multiselect", "多选"), ("boolean", "是/否")], max_length=20)),
                ("required", models.BooleanField(default=False)),
                ("default_value", models.CharField(blank=True, max_length=255)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("device_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="custom_fields", to="assets.devicetype")),
            ],
            options={"ordering": ["device_type__name", "sort_order", "id"]},
        ),
        migrations.CreateModel(
            name="Tag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=80, unique=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.CreateModel(
            name="CustomFieldOption",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("value", models.CharField(max_length=120)),
                ("label", models.CharField(max_length=120)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("field", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="options", to="assets.customfield")),
            ],
            options={"ordering": ["sort_order", "id"], "constraints": [models.UniqueConstraint(fields=("field", "value"), name="uniq_custom_field_option_value")]},
        ),
        migrations.CreateModel(
            name="AssetCustomValue",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("text_value", models.TextField(blank=True)),
                ("number_value", models.DecimalField(blank=True, decimal_places=6, max_digits=20, null=True)),
                ("date_value", models.DateField(blank=True, null=True)),
                ("boolean_value", models.BooleanField(blank=True, null=True)),
                ("json_value", models.JSONField(blank=True, null=True)),
                ("asset", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="custom_values", to="assets.asset")),
                ("field", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="asset_values", to="assets.customfield")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("asset", "field"), name="uniq_asset_custom_value")]},
        ),
        migrations.CreateModel(
            name="AssetTag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("asset", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="asset_tags", to="assets.asset")),
                ("tag", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="asset_tags", to="assets.tag")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("asset", "tag"), name="uniq_asset_tag")]},
        ),
    ]
