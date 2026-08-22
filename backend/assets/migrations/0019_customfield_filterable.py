from django.db import migrations, models


def enable_filtering_for_existing_fields(apps, schema_editor):
    CustomField = apps.get_model("assets", "CustomField")
    CustomField.objects.all().update(filterable=True)


class Migration(migrations.Migration):
    dependencies = [("assets", "0018_customfield_detail_visible_customfield_form_visible_and_more")]

    operations = [
        migrations.AddField(
            model_name="customfield",
            name="filterable",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(enable_filtering_for_existing_fields, migrations.RunPython.noop),
    ]
