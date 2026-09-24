import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from django.core.files.uploadedfile import SimpleUploadedFile

from assets.models import (
    Asset,
    AuditLog,
    DataCenter,
    DeviceType,
    FaultEvent,
    Rack,
    RepairRecord,
    ServerRoom,
    Person,
    SparePart,
    SparePartCategory,
    SpareStock,
)
from assets.timeline import asset_timeline_queryset


class AssetTimelineApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(
            username="timeline-admin",
            first_name="Timeline",
            last_name="Operator",
            email="timeline@example.com",
            password="test-password-123",
        )
        self.client.force_authenticate(user=self.user)
        self.device_type = DeviceType.objects.create(name="Timeline device")
        self.asset = Asset.objects.create(
            asset_no="TL-001",
            name="Timeline asset",
            standalone_device_type=self.device_type,
        )
        self.other_asset = Asset.objects.create(
            asset_no="TL-002",
            name="Other asset",
            standalone_device_type=self.device_type,
        )

    def timeline_url(self, asset=None):
        return f"/api/v1/assets/{(asset or self.asset).pk}/timeline/"

    def test_mysql_legacy_relation_subqueries_use_explicit_resource_id_collation(self):
        with patch.object(connection, "vendor", "mysql"):
            sql = str(asset_timeline_queryset(self.asset.pk).query)

        self.assertEqual(sql.count("utf8mb4_unicode_ci"), 2)

    def create_log(
        self,
        *,
        asset=None,
        action="update",
        resource_type="asset",
        payload=None,
        actor="default",
        created_at=None,
    ):
        log = AuditLog.objects.create(
            actor=self.user if actor == "default" else actor,
            action=action,
            resource_type=resource_type,
            resource_id=str((asset or self.asset).pk),
            payload=payload or {},
        )
        if created_at is not None:
            AuditLog.objects.filter(pk=log.pk).update(created_at=created_at)
        return log

    def test_timeline_is_asset_scoped_newest_first_and_paginates(self):
        base = timezone.now()
        first = self.create_log(
            action="create",
            payload={"after": {"asset_no": self.asset.asset_no, "name": self.asset.name}},
            created_at=base - timedelta(minutes=2),
        )
        same_timestamp_older_id = self.create_log(
            action="update",
            payload={"before": {"name": "before"}, "after": {"name": "middle"}},
            created_at=base,
        )
        newest = self.create_log(
            action="update",
            payload={"before": {"name": "middle"}, "after": {"name": "newest"}},
            created_at=base,
        )
        self.create_log(
            asset=self.other_asset,
            action="update",
            payload={"before": {"name": "other"}, "after": {"name": "other 2"}},
            created_at=base + timedelta(minutes=1),
        )

        response = self.client.get(self.timeline_url(), {"page": 1, "page_size": 2})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["count"], 3)
        self.assertEqual([row["id"] for row in body["results"]], [newest.pk, same_timestamp_older_id.pk])
        self.assertNotIn(first.pk, [row["id"] for row in body["results"]])
        page_two = self.client.get(self.timeline_url(), {"page": 2, "page_size": 2})
        self.assertEqual([row["id"] for row in page_two.json()["results"]], [first.pk])

    def test_actor_system_fallback_known_unknown_and_changes_are_stable(self):
        known = self.create_log(
            action="assign",
            payload={
                "before": {"assigned_person": None},
                "after": {"assigned_person": {"display_name": "Alice"}, "status": "in_use"},
                "extra": {"source": "asset_assignment", "reason": "onboarding"},
            },
        )
        system = self.create_log(actor=None, action="update", payload={"after": {"name": "system"}})
        unknown = self.create_log(action="new_future_action", payload={"after": {"name": "future"}})
        inventory = self.create_log(
            resource_type="inventory_item",
            action="resolve",
            payload={
                "after": {"status_label": "Location mismatch"},
                "extra": {"asset_id": self.asset.pk},
            },
        )

        response = self.client.get(self.timeline_url())

        self.assertEqual(response.status_code, 200)
        rows = {row["id"]: row for row in response.json()["results"]}
        self.assertEqual(rows[known.pk]["event_type"], "assignment")
        self.assertEqual(rows[known.pk]["actor"]["display_name"], "Timeline Operator")
        self.assertSetEqual(
            {change["field"] for change in rows[known.pk]["changes"]},
            {"assigned_person", "status"},
        )
        self.assertIsNone(rows[system.pk]["actor"])
        self.assertEqual(rows[unknown.pk]["event_type"], "other")
        self.assertEqual(rows[unknown.pk]["action"], "new_future_action")
        self.assertEqual(rows[inventory.pk]["event_type"], "inventory")

    def test_sensitive_values_are_not_exposed_in_timeline_projection(self):
        self.create_log(
            payload={
                "before": {"notes": "safe"},
                "after": {"notes": "safe", "password": "password-value"},
                "extra": {"reason": "normal", "token": "token-value", "secret": "secret-value"},
            },
        )

        response = self.client.get(self.timeline_url())

        self.assertEqual(response.status_code, 200)
        rendered = json.dumps(response.json(), ensure_ascii=False)
        self.assertNotIn("password-value", rendered)
        self.assertNotIn("token-value", rendered)
        self.assertNotIn("secret-value", rendered)

    def test_permission_and_missing_asset_are_enforced_by_asset_endpoint(self):
        regular_user = User.objects.create_user(username="timeline-reader", password="password-123")
        self.client.force_authenticate(user=regular_user)
        self.assertEqual(self.client.get(self.timeline_url()).status_code, 403)

        self.client.force_authenticate(user=self.user)
        self.assertEqual(self.client.get(self.timeline_url(Asset(pk=999999))).status_code, 404)

    def test_real_asset_create_update_assignment_placement_maintenance_and_attachment_paths_are_timeline_events(self):
        created = self.client.post(
            "/api/v1/assets/",
            {"asset_no": "TL-API-001", "name": "API asset", "device_type": self.device_type.pk},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        asset_id = created.json()["id"]

        updated = self.client.patch(
            f"/api/v1/assets/{asset_id}/",
            {"name": "API asset renamed"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)

        person = Person.objects.create(name="Timeline user", employee_no="TL-P-001")
        assigned = self.client.post(
            f"/api/v1/assets/{asset_id}/assign/",
            {"target_person": person.pk, "reason": "timeline test"},
            format="json",
        )
        self.assertEqual(assigned.status_code, 200)

        data_center = DataCenter.objects.create(name="Timeline DC")
        room = ServerRoom.objects.create(data_center=data_center, name="Timeline room")
        rack = Rack.objects.create(room=room, code="TL-RACK-01", total_u=42)
        placed = self.client.patch(
            f"/api/v1/assets/{asset_id}/",
            {
                "configuration": {
                    "data_center": data_center.pk,
                    "server_room_id": room.pk,
                    "rack_id": rack.pk,
                    "rack_start_u": 1,
                    "rack_end_u": 2,
                }
            },
            format="json",
        )
        self.assertEqual(placed.status_code, 200, placed.content)

        fault = self.client.post(
            "/api/v1/fault-events/",
            {
                "asset": asset_id,
                "occurred_at": "2026-09-23T10:00:00+08:00",
                "reason": "Timeline test fault",
                "description": "Timeline maintenance event",
            },
            format="json",
        )
        self.assertEqual(fault.status_code, 201, fault.content)

        attachment_id = None
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=Path(media_root)):
                attachment = self.client.post(
                    "/api/v1/attachments/",
                    {
                        "asset": asset_id,
                        "category": "other",
                        "file": SimpleUploadedFile("timeline.txt", b"timeline", content_type="text/plain"),
                    },
                    format="multipart",
                )
                self.assertEqual(attachment.status_code, 201, attachment.content)
                attachment_id = attachment.json()["id"]
                deleted = self.client.delete(f"/api/v1/attachments/{attachment_id}/")
                self.assertEqual(deleted.status_code, 204, deleted.content)

        response = self.client.get(self.timeline_url(Asset(pk=asset_id)))
        self.assertEqual(response.status_code, 200)
        rows = response.json()["results"]
        event_types = {row["event_type"] for row in rows}
        self.assertTrue({"created", "updated", "assignment", "placement", "maintenance", "attachment"}.issubset(event_types))
        self.assertIn("delete", {row["action"] for row in rows if row["event_type"] == "attachment"})

    def test_real_maintenance_part_usage_events_are_asset_scoped_and_distinct(self):
        fault_response = self.client.post(
            "/api/v1/fault-events/",
            {
                "asset": self.asset.pk,
                "occurred_at": "2026-09-23T10:00:00+08:00",
                "reason": "Part usage timeline fault",
            },
            format="json",
        )
        self.assertEqual(fault_response.status_code, 201, fault_response.content)
        fault_id = fault_response.json()["id"]

        vendor_usage = self.client.post(
            f"/api/v1/fault-events/{fault_id}/part-usages/",
            {
                "source": "vendor_provided",
                "part_name": "Vendor fan",
                "quantity": 1,
            },
            format="json",
        )
        self.assertEqual(vendor_usage.status_code, 201, vendor_usage.content)

        category = SparePartCategory.objects.create(name="Timeline parts", code="timeline-parts")
        part = SparePart.objects.create(
            code="TL-PART-001",
            name="Timeline power module",
            category=category,
            unit="piece",
        )
        data_center = DataCenter.objects.create(name="Timeline stock DC")
        stock = SpareStock.objects.create(part=part, data_center=data_center, quantity=5)
        internal_usage = self.client.post(
            f"/api/v1/fault-events/{fault_id}/part-usages/",
            {
                "source": "internal_stock",
                "spare_part_id": part.pk,
                "spare_stock_id": stock.pk,
                "quantity": 2,
            },
            format="json",
        )
        self.assertEqual(internal_usage.status_code, 201, internal_usage.content)

        usage_log = AuditLog.objects.get(
            resource_type="repair_part_usage",
            resource_id=str(internal_usage.json()["id"]),
        )
        stock_log = AuditLog.objects.get(
            resource_type="spare_stock_transaction",
            payload__extra__repair_part_usage_id=internal_usage.json()["id"],
        )
        self.assertEqual(usage_log.payload["extra"]["asset_id"], self.asset.pk)
        self.assertEqual(stock_log.payload["extra"]["asset_id"], self.asset.pk)

        asset_rows = {
            row["id"]: row
            for row in self.client.get(self.timeline_url()).json()["results"]
        }
        other_asset_rows = {
            row["id"]: row
            for row in self.client.get(self.timeline_url(self.other_asset)).json()["results"]
        }
        self.assertEqual(asset_rows[usage_log.pk]["event_type"], "maintenance")
        self.assertEqual(asset_rows[stock_log.pk]["event_type"], "maintenance")
        self.assertNotEqual(asset_rows[usage_log.pk]["summary"], asset_rows[stock_log.pk]["summary"])
        self.assertNotIn(usage_log.pk, other_asset_rows)
        self.assertNotIn(stock_log.pk, other_asset_rows)

    def test_fault_delete_remains_in_asset_timeline(self):
        response = self.client.post(
            "/api/v1/fault-events/",
            {
                "asset": self.asset.pk,
                "occurred_at": "2026-09-23T10:00:00+08:00",
                "reason": "Delete timeline fault",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        fault_id = response.json()["id"]

        deleted = self.client.delete(f"/api/v1/fault-events/{fault_id}/")

        self.assertEqual(deleted.status_code, 204, deleted.content)
        self.assertFalse(FaultEvent.objects.filter(pk=fault_id).exists())
        log = AuditLog.objects.get(resource_type="fault_event", resource_id=str(fault_id), action="delete")
        self.assertEqual(log.payload["extra"]["asset_id"], self.asset.pk)
        rows = self.client.get(self.timeline_url()).json()["results"]
        delete_rows = [row for row in rows if row["id"] == log.pk]
        self.assertEqual(len(delete_rows), 1)
        self.assertEqual(delete_rows[0]["event_type"], "maintenance")

    def test_repair_delete_remains_in_asset_timeline(self):
        fault_response = self.client.post(
            "/api/v1/fault-events/",
            {
                "asset": self.other_asset.pk,
                "occurred_at": "2026-09-23T10:00:00+08:00",
                "reason": "Delete timeline repair fault",
            },
            format="json",
        )
        self.assertEqual(fault_response.status_code, 201, fault_response.content)
        fault_id = fault_response.json()["id"]
        repair_response = self.client.post(
            "/api/v1/repair-records/",
            {"fault": fault_id, "provider": "Timeline provider"},
            format="json",
        )
        self.assertEqual(repair_response.status_code, 201, repair_response.content)
        repair_id = repair_response.json()["id"]

        deleted = self.client.delete(f"/api/v1/repair-records/{repair_id}/")

        self.assertEqual(deleted.status_code, 204, deleted.content)
        self.assertFalse(RepairRecord.objects.filter(pk=repair_id).exists())
        log = AuditLog.objects.get(resource_type="repair_record", resource_id=str(repair_id), action="delete")
        self.assertEqual(log.payload["extra"]["asset_id"], self.other_asset.pk)
        rows = self.client.get(self.timeline_url(self.other_asset)).json()["results"]
        delete_rows = [row for row in rows if row["id"] == log.pk]
        self.assertEqual(len(delete_rows), 1)
        self.assertEqual(delete_rows[0]["event_type"], "maintenance")
        self.assertNotIn(log.pk, {row["id"] for row in self.client.get(self.timeline_url()).json()["results"]})

    def test_timeline_keeps_historical_rack_name_after_rack_rename(self):
        data_center = DataCenter.objects.create(name="Historical DC")
        room = ServerRoom.objects.create(data_center=data_center, name="Historical room")
        rack = Rack.objects.create(room=room, code="OLD-RACK", total_u=42)
        placed = self.client.patch(
            f"/api/v1/assets/{self.asset.pk}/",
            {
                "configuration": {
                    "data_center": data_center.pk,
                    "server_room_id": room.pk,
                    "rack_id": rack.pk,
                    "rack_start_u": 1,
                    "rack_end_u": 2,
                }
            },
            format="json",
        )
        self.assertEqual(placed.status_code, 200, placed.content)

        renamed = self.client.patch(
            f"/api/v1/racks/{rack.pk}/",
            {"code": "NEW-RACK"},
            format="json",
        )
        self.assertEqual(renamed.status_code, 200, renamed.content)

        rows = self.client.get(self.timeline_url()).json()["results"]
        placement_changes = [
            change
            for row in rows
            if row["event_type"] == "placement"
            for change in row["changes"]
            if change["field"] == "rack_allocation"
        ]
        self.assertTrue(placement_changes)
        self.assertTrue(any("OLD-RACK" in str(change["after"]) for change in placement_changes))
        self.assertTrue(all("NEW-RACK" not in str(change["after"]) for change in placement_changes))

    def test_timeline_uses_enum_codes_for_related_changes(self):
        attachment = self.create_log(
            resource_type="attachment",
            action="upload",
            payload={
                "after": {"category": "photo", "category_label": "照片"},
                "extra": {"asset_id": self.asset.pk, "repair_id": None},
            },
        )
        inventory = self.create_log(
            resource_type="inventory_item",
            action="resolve",
            payload={
                "after": {
                    "status": "location_mismatch",
                    "status_label": "位置不符",
                    "resolution_status": "resolved",
                    "resolution_status_label": "已处理",
                    "resolution_action": "update_asset",
                    "resolution_action_label": "更新资产台账",
                },
                "extra": {"asset_id": self.asset.pk},
            },
        )

        rows = {
            row["id"]: row
            for row in self.client.get(self.timeline_url()).json()["results"]
        }
        self.assertIn(
            {"field": "attachment_category", "label": None, "before": None, "after": "photo"},
            rows[attachment.pk]["changes"],
        )
        self.assertIn(
            {"field": "inventory_status", "label": None, "before": None, "after": "location_mismatch"},
            rows[inventory.pk]["changes"],
        )
        self.assertIn(
            {"field": "inventory_resolution_action", "label": None, "before": None, "after": "update_asset"},
            rows[inventory.pk]["changes"],
        )
