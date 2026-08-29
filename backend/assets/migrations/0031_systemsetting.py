from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0030_remove_asset_asset_type_remove_rack_vendor"),
    ]

    operations = [
        migrations.CreateModel(
            name="SystemSetting",
            fields=[
                (
                    "id",
                    models.PositiveSmallIntegerField(
                        default=1,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "default_page_size",
                    models.PositiveSmallIntegerField(
                        choices=[(20, "20"), (50, "50"), (100, "100")],
                        default=50,
                    ),
                ),
                (
                    "default_asset_status",
                    models.CharField(
                        choices=[
                            ("in_stock", "在库"),
                            ("in_use", "在用"),
                            ("idle", "闲置"),
                            ("retired", "已报废"),
                        ],
                        default="in_stock",
                        max_length=20,
                    ),
                ),
            ],
        ),
    ]
