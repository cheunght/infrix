from django.db import migrations


def add_missing_email_columns(apps, schema_editor):
    """Repair databases created before these fields were folded into 0001.

    The current baseline migration already contains both fields so a fresh
    database gets them from 0001. Older databases may have 0001 recorded as
    applied while their physical tables still lack the columns. Add only the
    missing columns so this migration is safe in both cases.
    """

    connection = schema_editor.connection
    field_specs = (
        ("Person", "email"),
        ("SystemSetting", "email_digest_people"),
    )
    with connection.cursor() as cursor:
        for model_name, field_name in field_specs:
            model = apps.get_model("assets", model_name)
            table = model._meta.db_table
            columns = {
                column.name
                for column in connection.introspection.get_table_description(cursor, table)
            }
            if field_name not in columns:
                schema_editor.add_field(model, model._meta.get_field(field_name))


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(
            add_missing_email_columns,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
