from django.db import migrations, models


def keep_current_records(apps, schema_editor):
    AssetNetworkAddress = apps.get_model("assets", "AssetNetworkAddress")
    ProcurementRecord = apps.get_model("assets", "ProcurementRecord")
    MaintenanceContract = apps.get_model("assets", "MaintenanceContract")

    seen = set()
    for item in AssetNetworkAddress.objects.order_by("asset_id", "role", "-updated_at", "-id").iterator():
        key = (item.asset_id, item.role)
        if key in seen:
            item.delete()
        else:
            seen.add(key)

    seen.clear()
    for item in ProcurementRecord.objects.order_by("asset_id", "-purchase_date", "-id").iterator():
        if item.asset_id in seen:
            item.delete()
        else:
            seen.add(item.asset_id)

    seen.clear()
    for item in MaintenanceContract.objects.order_by("asset_id", "-updated_at", "-id").iterator():
        if item.asset_id in seen:
            item.delete()
        else:
            seen.add(item.asset_id)


class Migration(migrations.Migration):
    dependencies = [("assets", "0003_assetcategory_asset_category")]

    operations = [
        migrations.RunPython(keep_current_records, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="assetnetworkaddress",
            constraint=models.UniqueConstraint(fields=("asset", "role"), name="uniq_asset_network_role"),
        ),
        migrations.AddConstraint(
            model_name="procurementrecord",
            constraint=models.UniqueConstraint(fields=("asset",), name="uniq_current_procurement_per_asset"),
        ),
        migrations.AddConstraint(
            model_name="maintenancecontract",
            constraint=models.UniqueConstraint(fields=("asset",), name="uniq_current_maintenance_per_asset"),
        ),
        migrations.AlterModelOptions(name="procurementrecord", options={"ordering": ["-purchase_date", "-id"]}),
        migrations.AlterModelOptions(name="maintenancecontract", options={"ordering": ["-updated_at", "-id"]}),
    ]
