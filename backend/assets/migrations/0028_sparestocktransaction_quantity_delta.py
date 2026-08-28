from django.db import migrations, models


def backfill_quantity_delta(apps, schema_editor):
    transaction_model = apps.get_model("assets", "SpareStockTransaction")
    for movement in transaction_model.objects.all().only("pk", "before_quantity", "after_quantity"):
        movement.quantity_delta = movement.after_quantity - movement.before_quantity
        movement.save(update_fields=["quantity_delta"])


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0027_sparepart_inventory_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="sparestocktransaction",
            name="quantity_delta",
            field=models.IntegerField(default=0),
            preserve_default=False,
        ),
        migrations.RunPython(backfill_quantity_delta, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="sparestocktransaction",
            name="quantity_delta",
            field=models.IntegerField(),
        ),
        migrations.AlterField(
            model_name="sparestocktransaction",
            name="operation_type",
            field=models.CharField(
                choices=[
                    ("initial", "初始库存"),
                    ("inbound", "入库"),
                    ("outbound", "出库"),
                    ("transfer", "调拨"),
                    ("adjustment", "调整"),
                    ("scrap", "报废"),
                ],
                max_length=20,
            ),
        ),
    ]
