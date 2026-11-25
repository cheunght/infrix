from django.db import migrations

from assets.audit_identity import (
    LEGACY_ASSET_RELATIONS, RELATED_ASSET_EVENTS, audit_resource_pk, recorded_asset_id,
)


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    logs = apps.get_model("assets", "AuditLog").objects.using(alias)
    relevant = logs.filter(resource_type__in={"asset", *RELATED_ASSET_EVENTS}, timeline_asset_id__isnull=True)
    last_id = 0
    while batch := list(relevant.filter(pk__gt=last_id).order_by("pk").only(
        "id", "resource_type", "resource_id", "payload", "timeline_asset_id",
    )[:500]):
        last_id = batch[-1].pk
        for row in batch:
            row.timeline_asset_id = recorded_asset_id(row.resource_type, row.resource_id, row.payload)
        for resource_type, (model, path) in LEGACY_ASSET_RELATIONS.items():
            pending = {
                row.pk: audit_resource_pk(row.resource_id)
                for row in batch if row.timeline_asset_id is None and row.resource_type == resource_type
            }
            resource_ids = set(pending.values()) - {None}
            if not resource_ids:
                continue
            asset_by_resource = dict(apps.get_model("assets", model).objects.using(alias)
                                     .filter(pk__in=resource_ids).values_list("pk", path))
            for row in batch:
                if row.pk in pending:
                    row.timeline_asset_id = asset_by_resource.get(pending[row.pk])
        logs.bulk_update([row for row in batch if row.timeline_asset_id is not None], ["timeline_asset_id"])


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("assets", "0004_audit_timeline_asset")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
