from django.db import migrations


def column_names(schema_editor, table_name):
    with schema_editor.connection.cursor() as cursor:
        return {
            column.name
            for column in schema_editor.connection.introspection.get_table_description(cursor, table_name)
        }


def repair_columns(apps, schema_editor):
    Asset = apps.get_model("assets", "Asset")
    DataCenter = apps.get_model("assets", "DataCenter")

    asset_columns = column_names(schema_editor, Asset._meta.db_table)
    if "model" not in asset_columns:
        schema_editor.add_field(Asset, Asset._meta.get_field("model"))

    data_center_columns = column_names(schema_editor, DataCenter._meta.db_table)
    if "is_active" not in data_center_columns:
        schema_editor.add_field(DataCenter, DataCenter._meta.get_field("is_active"))


class Migration(migrations.Migration):
    # MySQL implicitly commits ALTER TABLE statements and cannot roll them
    # back from Django's migration transaction.
    atomic = False
    dependencies = [("assets", "0008_asset_model_text_compat")]

    operations = [
        migrations.RunPython(repair_columns, migrations.RunPython.noop),
    ]
