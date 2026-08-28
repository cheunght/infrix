from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0024_remove_softwarelicense_vendor_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="SparePartCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=120, unique=True)),
                ("code", models.CharField(max_length=80, unique=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.AddField(
            model_name="sparepart",
            name="category",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="spare_parts",
                to="assets.sparepartcategory",
            ),
        ),
        migrations.RemoveField(
            model_name="sparepart",
            name="part_type",
        ),
        migrations.AlterModelOptions(
            name="sparepart",
            options={"ordering": ["name", "category__name", "id"]},
        ),
    ]
