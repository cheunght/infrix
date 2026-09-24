import csv
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITestCase

from assets.models import (
    Asset,
    AssetDisposal,
    AuditLog,
    DataCenter,
    DeviceType,
    FaultEvent,
    Rack,
    RackUnitAllocation,
    RepairRecord,
    ServerRoom,
    SystemSetting,
    Person,
)
from assets.services import dispose_asset
from assets.runtime_clock import system_localdate


class AssetDisposalApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(
            username="disposal-admin",
            first_name="Disposal",
            last_name="Operator",
            email="disposal@example.com",
            password="test-password-123",
        )
        self.client.force_authenticate(user=self.user)
        self.device_type = DeviceType.objects.create(name="Disposal device")

    def make_asset(self, asset_no="DSP-001", *, status="in_stock"):
        return Asset.objects.create(
            asset_no=asset_no,
            name=f"Asset {asset_no}",
            status=status,
            standalone_device_type=self.device_type,
        )

    def dispose_url(self, asset):
        return f"/api/v1/assets/{asset.pk}/dispose/"

    def disposal_payload(self, **overrides):
        payload = {
            "disposed_on": system_localdate().isoformat(),
            "reason": "达到使用年限",
            "method": "回收",
            "notes": "已完成资产交接",
        }
        payload.update(overrides)
        return payload

    def test_dispose_success_returns_detail_persists_snapshot_and_projects_timeline(self):
        asset = self.make_asset()

        response = self.client.post(self.dispose_url(asset), self.disposal_payload(), format="json")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["status"], "retired")
        self.assertEqual(body["disposal"]["reason"], "达到使用年限")
        self.assertEqual(body["disposal"]["method"], "回收")
        self.assertEqual(body["disposal"]["operator_name"], "Disposal Operator")
        self.assertEqual(body["disposal_status"], "recorded")

        disposal = AssetDisposal.objects.get(asset=asset)
        self.assertEqual(disposal.operator_id, self.user.pk)
        self.assertEqual(disposal.operator_name, "Disposal Operator")
        audit = AuditLog.objects.get(resource_type="asset", action="dispose", resource_id=str(asset.pk))
        self.assertEqual(audit.payload["extra"]["source"], "asset_disposal")
        self.assertEqual(audit.payload["extra"]["disposal"]["method"], "回收")

        timeline = self.client.get(f"/api/v1/assets/{asset.pk}/timeline/")
        self.assertEqual(timeline.status_code, 200)
        event = next(row for row in timeline.json()["results"] if row["action"] == "dispose")
        self.assertEqual(event["event_type"], "lifecycle")
        self.assertEqual(event["metadata"]["disposal"]["reason"], "达到使用年限")

    def test_disposal_date_must_not_be_in_the_future(self):
        asset = self.make_asset()

        response = self.client.post(
            self.dispose_url(asset),
            self.disposal_payload(disposed_on=(system_localdate() + timedelta(days=1)).isoformat()),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("disposed_on", response.json())
        self.assertEqual(AssetDisposal.objects.count(), 0)
        self.assertEqual(Asset.objects.get(pk=asset.pk).status, "in_stock")

    def test_disposal_request_rejects_status_and_other_ordinary_write_fields(self):
        asset = self.make_asset()

        response = self.client.post(
            self.dispose_url(asset),
            self.disposal_payload(status="retired", name="must not be accepted"),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.json())
        self.assertEqual(Asset.objects.get(pk=asset.pk).status, "in_stock")
        self.assertFalse(AssetDisposal.objects.filter(asset=asset).exists())

    def test_retirement_preconditions_are_rejected_without_partial_state(self):
        assigned = self.make_asset("DSP-ASSIGNED")
        assigned.assigned_person = Person.objects.create(name="Assigned", employee_no="DSP-P-001")
        assigned.save(update_fields=["assigned_person", "updated_at"])

        data_center = DataCenter.objects.create(name="Disposal DC")
        room = ServerRoom.objects.create(data_center=data_center, name="Disposal room")
        rack = Rack.objects.create(room=room, code="DSP-RACK-01", total_u=42)
        mounted = self.make_asset("DSP-MOUNTED")
        RackUnitAllocation.objects.create(asset=mounted, rack=rack, start_u=1, end_u=2)

        open_fault = self.make_asset("DSP-FAULT")
        FaultEvent.objects.create(
            asset=open_fault,
            occurred_at=timezone.now(),
            reason="仍未关闭",
            is_closed=False,
        )

        unfinished_repair = self.make_asset("DSP-REPAIR")
        closed_fault = FaultEvent.objects.create(
            asset=unfinished_repair,
            occurred_at=timezone.now(),
            reason="维修记录",
            is_closed=True,
        )
        RepairRecord.objects.create(fault=closed_fault, finished_at=None)

        for asset, expected in (
            (assigned, "当前使用人"),
            (mounted, "机柜 U 位"),
            (open_fault, "未关闭故障"),
            (unfinished_repair, "未完成维修"),
        ):
            with self.subTest(asset=asset.asset_no):
                response = self.client.post(self.dispose_url(asset), self.disposal_payload(), format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn(expected, response.content.decode("utf-8"))
                self.assertEqual(Asset.objects.get(pk=asset.pk).status, "in_stock")
                self.assertFalse(AssetDisposal.objects.filter(asset=asset).exists())

    def test_duplicate_disposal_is_rejected(self):
        asset = self.make_asset()
        first = self.client.post(self.dispose_url(asset), self.disposal_payload(), format="json")
        second = self.client.post(self.dispose_url(asset), self.disposal_payload(reason="再次提交"), format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()["code"], "asset_already_disposed")
        self.assertEqual(AssetDisposal.objects.filter(asset=asset).count(), 1)

    def test_audit_failure_rolls_back_status_and_disposal(self):
        asset = self.make_asset()

        with patch("assets.audit.write_audit_log", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(RuntimeError):
                dispose_asset(
                    asset_id=asset.pk,
                    disposed_on=system_localdate(),
                    reason="达到使用年限",
                    method="回收",
                    notes="",
                    actor=self.user,
                    request=None,
                )

        asset.refresh_from_db()
        self.assertEqual(asset.status, "in_stock")
        self.assertFalse(AssetDisposal.objects.filter(asset=asset).exists())

    def test_normal_asset_api_cannot_create_new_retired_status_but_legacy_retired_can_be_read_and_edited(self):
        created = self.client.post(
            "/api/v1/assets/",
            {
                "asset_no": "DSP-API-001",
                "name": "Normal asset",
                "device_type": self.device_type.pk,
                "status": "retired",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 400)

        asset = self.make_asset("DSP-LEGACY", status="retired")
        detail = self.client.get(f"/api/v1/assets/{asset.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertIsNone(detail.json()["disposal"])
        self.assertEqual(detail.json()["disposal_status"], "legacy")

        updated = self.client.patch(
            f"/api/v1/assets/{asset.pk}/",
            {"name": "Legacy asset renamed"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["status"], "retired")

        transition = self.client.patch(
            f"/api/v1/assets/{asset.pk}/",
            {"status": "in_stock"},
            format="json",
        )
        self.assertEqual(transition.status_code, 400)
        self.assertEqual(Asset.objects.get(pk=asset.pk).status, "retired")

    def test_legacy_default_status_is_inactive_for_new_assets_and_cannot_be_saved(self):
        SystemSetting.objects.create(default_asset_status="retired")

        response = self.client.post(
            "/api/v1/assets/",
            {
                "asset_no": "DSP-DEFAULT-001",
                "name": "Default status asset",
                "device_type": self.device_type.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "in_stock")

        settings_response = self.client.patch(
            "/api/v1/system/settings/",
            {"general": {"default_asset_status": "retired"}},
            format="json",
        )
        self.assertEqual(settings_response.status_code, 400)
        self.assertIn("default_asset_status", settings_response.json().get("general", {}))

    def test_normal_asset_import_rejects_retired_status(self):
        content = StringIO()
        writer = csv.writer(content)
        writer.writerow(["asset_no", "name", "device_type", "status"])
        writer.writerow(["DSP-IMPORT-001", "Imported retired", self.device_type.name, "retired"])
        upload = SimpleUploadedFile("assets.csv", content.getvalue().encode("utf-8"), content_type="text/csv")

        response = self.client.post("/api/v1/assets/import/preview/", {"file": upload}, format="multipart")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["valid"], 0)
        self.assertIn("报废", response.json()["rows"][0]["errors"][0]["message"])
        self.assertFalse(Asset.objects.filter(asset_no="DSP-IMPORT-001").exists())

    def test_disposal_cascades_when_asset_is_deleted(self):
        asset = self.make_asset()
        disposed = self.client.post(self.dispose_url(asset), self.disposal_payload(), format="json")
        self.assertEqual(disposed.status_code, 200)

        response = self.client.delete(f"/api/v1/assets/{asset.pk}/")

        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(Asset.objects.filter(pk=asset.pk).exists())
        self.assertFalse(AssetDisposal.objects.filter(asset_id=asset.pk).exists())

    def test_disposal_requires_asset_manage_permission(self):
        asset = self.make_asset()
        reader = User.objects.create_user(username="disposal-reader", password="test-password-123")
        self.client.force_authenticate(user=reader)

        response = self.client.post(self.dispose_url(asset), self.disposal_payload(), format="json")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Asset.objects.get(pk=asset.pk).status, "in_stock")
        self.assertFalse(AssetDisposal.objects.filter(asset=asset).exists())
