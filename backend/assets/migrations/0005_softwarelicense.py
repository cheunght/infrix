from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0004_current_asset_configuration"),
    ]

    operations = [
        migrations.CreateModel(
            name="SoftwareLicense",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=160)),
                ("vendor", models.CharField(blank=True, max_length=120)),
                ("license_type", models.CharField(blank=True, max_length=80)),
                ("authorized_count", models.PositiveIntegerField(default=0)),
                ("used_count", models.PositiveIntegerField(default=0)),
                ("expiry_date", models.DateField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
            ],
            options={
                "ordering": ["expiry_date", "name", "id"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(used_count__lte=models.F("authorized_count")),
                        name="license_used_lte_authorized",
                    ),
                ],
            },
        ),
    ]
