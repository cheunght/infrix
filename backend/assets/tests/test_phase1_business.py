from io import BytesIO
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APITestCase

from assets.models import (
    Asset, DeviceType, DataCenter, ServerRoom, Rack, RackUnitAllocation,
    SparePartCategory, SparePart, SpareStock, InventoryTask, UserSecurityProfile,
    SystemSetting,
)
from assets.notification_delivery import send_digest


class BusinessRepairTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_superuser("business-audit", "audit@example.test", "Test-Password-831!")
        UserSecurityProfile.objects.filter(user=self.user).update(must_change_password=False)
        self.client.force_login(self.user)
        self.type = DeviceType.objects.create(name="Test server")
        self.center = DataCenter.objects.create(name="Center A")
        self.other = DataCenter.objects.create(name="Center B")
        self.room = ServerRoom.objects.create(name="Room A", data_center=self.center)
        self.category = SparePartCategory.objects.create(name="Test category", code="TEST")
        self.part = SparePart.objects.create(name="Test part", code="TEST-PART", category=self.category, safety_stock=15)

    def test_empty_faults_are_safe_in_alert_api_and_digest(self):
        SystemSetting.objects.update_or_create(pk=1, defaults={
            "notify_open_faults": True, "email_digest_enabled": True,
            "email_digest_recipients": ["recipient@example.test"], "application_url": "https://example.test",
        })
        for i, (reason, description) in enumerate([("", ""), ("\n  ", "\n描述\n下一行"), ("X" * 200, ""), ("\n", "\n")]):
            asset = Asset.objects.create(asset_no=f"FAULT-{i}", name="Test asset", standalone_device_type=self.type)
            response = self.client.post("/api/v1/fault-events/", {
                "asset": asset.pk, "occurred_at": timezone.now().isoformat(),
                "reason": reason, "description": description,
            }, format="json")
            self.assertEqual(response.status_code, 201, response.data)
        response = self.client.get("/api/v1/reports/alerts/")
        self.assertEqual(response.status_code, 200)
        references = [item["reference"] for item in response.json()["alerts"] if item["kind"] == "fault"]
        self.assertEqual(references, ["未填写故障说明", "描述", "X" * 160, "未填写故障说明"])
        with patch("assets.notification_delivery.send_smtp_message") as smtp:
            result = send_digest()
            self.assertEqual(result["sent"], 1)
            self.assertIn("未填写故障说明", smtp.call_args.args[2])

    def test_filtered_stock_and_export_keep_global_totals(self):
        SpareStock.objects.create(part=self.part, data_center=self.center, quantity=5)
        SpareStock.objects.create(part=self.part, data_center=self.center, server_room=self.room, quantity=5)
        SpareStock.objects.create(part=self.part, data_center=self.other, quantity=2)
        for params in ({}, {"data_center": self.center.pk}, {"server_room": self.room.pk},
                       {"data_center": self.center.pk, "server_room": self.room.pk}):
            response = self.client.get("/api/v1/spare-parts/", params)
            self.assertEqual(response.status_code, 200)
            row = response.json()["results"][0]
            self.assertEqual(row["total_quantity"], 12)
            self.assertEqual(row["location_count"], 3)
            self.assertTrue(row["is_low_stock"])
            export = self.client.get("/api/v1/reports/spare-parts/export/", params)
            book = load_workbook(BytesIO(export.content))
            self.assertEqual(book.active.cell(2, 8).value, 12)
        response = self.client.get("/api/v1/spare-parts/", {"data_center": self.other.pk, "server_room": self.room.pk})
        self.assertEqual(response.json()["count"], 0)

    def test_room_reparent_rejects_any_stock_balance_atomically(self):
        rack = Rack.objects.create(room=self.room, code="TEST-RACK")
        asset = Asset.objects.create(asset_no="PLACED", name="Placed asset", standalone_device_type=self.type, asset_data_center=self.center)
        RackUnitAllocation.objects.create(asset=asset, rack=rack, start_u=1, end_u=1)
        stock = SpareStock.objects.create(part=self.part, data_center=self.center, server_room=self.room, quantity=10)
        for quantity in (10, 0):
            stock.quantity = quantity
            stock.save()
            response = self.client.patch(f"/api/v1/server-rooms/{self.room.pk}/", {"data_center": self.other.pk}, format="json")
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["code"], "room_reparent_blocked")
            self.room.refresh_from_db()
            asset.refresh_from_db()
            self.assertEqual(self.room.data_center_id, self.center.pk)
            self.assertEqual(asset.asset_data_center_id, self.center.pk)
            stock.refresh_from_db()
            self.assertEqual(stock.data_center_id, self.center.pk)

    def test_room_reparent_rejects_active_inventory_but_allows_unrelated_edits(self):
        InventoryTask.objects.create(name="Active inventory", scope="server_room", data_center=self.center,
            server_room=self.room, inspector=self.user, start_at=timezone.now(), end_at=timezone.now() + timedelta(days=1))
        response = self.client.patch(f"/api/v1/server-rooms/{self.room.pk}/", {"data_center": self.other.pk}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "room_reparent_blocked")
        response = self.client.patch(f"/api/v1/server-rooms/{self.room.pk}/", {"data_center": self.center.pk, "notes": "updated"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_unconstrained_room_reparent_synchronizes_assets(self):
        rack = Rack.objects.create(room=self.room, code="FREE-RACK")
        asset = Asset.objects.create(asset_no="FREE-ASSET", name="Free asset", standalone_device_type=self.type, asset_data_center=self.center)
        RackUnitAllocation.objects.create(asset=asset, rack=rack, start_u=1, end_u=1)
        response = self.client.patch(f"/api/v1/server-rooms/{self.room.pk}/", {"data_center": self.other.pk}, format="json")
        self.assertEqual(response.status_code, 200)
        asset.refresh_from_db()
        self.assertEqual(asset.asset_data_center_id, self.other.pk)
