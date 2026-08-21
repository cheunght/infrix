from django.db import migrations, models


def reject_existing_negative_balances(apps, schema_editor):
    SpareStock = apps.get_model("assets", "SpareStock")
    if SpareStock.objects.filter(quantity__lt=0).exists():
        raise RuntimeError(
            "无法添加备件库存非负约束：数据库中存在负库存，请先核查并修复这些余额"
        )


class Migration(migrations.Migration):
    dependencies = [("assets", "0016_merge_asset_category_into_device_type")]

    operations = [
        migrations.RunPython(reject_existing_negative_balances, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="sparestock",
            constraint=models.CheckConstraint(
                condition=models.Q(quantity__gte=0),
                name="spare_stock_quantity_nonnegative",
            ),
        ),
    ]
