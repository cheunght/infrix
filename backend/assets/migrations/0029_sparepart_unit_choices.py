from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0028_sparestocktransaction_quantity_delta"),
    ]

    operations = [
        migrations.AlterField(
            model_name="sparepart",
            name="unit",
            field=models.CharField(
                choices=[
                    ("piece", "个"),
                    ("block", "块"),
                    ("stick", "条"),
                    ("root", "根"),
                    ("set", "套"),
                    ("pair", "对"),
                    ("box", "盒"),
                ],
                default="piece",
                max_length=20,
            ),
        ),
    ]
