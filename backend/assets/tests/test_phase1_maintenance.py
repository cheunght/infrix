import tempfile
import json
import os
import subprocess
import sys
import time
import tarfile
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from assets.models import UserSecurityProfile
from assets.models import Asset, Attachment, DeviceType


class MaintenanceApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_superuser("maintenance-admin", "admin@example.test", "Isolated-Password-823!")
        UserSecurityProfile.objects.filter(user=self.user).update(must_change_password=False)
        self.client.force_login(self.user)

    def test_web_backup_and_restore_are_cli_only(self):
        with patch("assets.views.create_backup", return_value={"filename": "test"}) as create, patch("assets.views.restore_backup", return_value={"ok": True}) as restore:
            for url in ("/api/v1/system/backups/", "/api/v1/system/backups/infrix-backup-20261008-010203.tar.gz/restore/"):
                response = self.client.post(url, {"confirmation": "RESTORE INFRIX"}, format="json")
                self.assertEqual(response.status_code, 405)
                self.assertEqual(response.json()["code"], "maintenance_cli_required")
            create.assert_not_called()
            restore.assert_not_called()

    def test_dynamic_requests_are_blocked_before_authentication(self):
        from assets.maintenance_gate import maintenance_window
        with tempfile.TemporaryDirectory() as root, override_settings(INFRIX_MAINTENANCE_DIR=root):
            with maintenance_window("backup"):
                for url in ("/api/v1/assets/", "/admin/", "/api/v1/auth/login/", "/api/schema/"):
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()["code"], "maintenance_in_progress")
                    self.assertEqual(response["Retry-After"], "30")
            self.assertEqual(self.client.get("/api/v1/assets/").status_code, 200)

    def test_backup_command_rejects_missing_database_referenced_media(self):
        from django.core.management import call_command, CommandError
        asset = Asset.objects.create(asset_no="BACKUP-TEST", name="Test asset", standalone_device_type=DeviceType.objects.create(name="Test type"))
        Attachment.objects.create(asset=asset, file="attachments/missing.txt", original_filename="missing.txt")
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            with override_settings(INFRIX_BACKUP_DIR=root / "backups", MEDIA_ROOT=root / "media", INFRIX_MAINTENANCE_DIR=root / "state"), \
                 patch("assets.backups._require_mariadb"), \
                 patch("assets.backups._database_settings", return_value={"name": "infrix"}), \
                 patch("assets.backups._database_storage_engines", return_value=["InnoDB"]), \
                 patch("assets.backups._run_dump", side_effect=lambda workdir, path: path.write_text("SELECT 1;\n")):
                with self.assertRaises(CommandError):
                    call_command("create_backup")
                self.assertFalse(list((root / "backups").glob("*.tar.gz")))
                self.assertEqual(self.client.get("/api/v1/assets/").status_code, 200)

    def test_backup_manifest_verifies_content_and_marks_legacy_archives(self):
        from assets.system_maintenance import create_backup, list_backups
        from assets.backups import validate_backup, BackupServiceError
        asset = Asset.objects.create(asset_no="BACKUP-CONTENT", name="Test", standalone_device_type=DeviceType.objects.create(name="Content type"))
        Attachment.objects.create(asset=asset, file="attachments/content.txt", original_filename="content.txt")
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            file = root / "media/attachments/content.txt"
            file.parent.mkdir(parents=True)
            file.write_bytes(b"original content")
            with override_settings(INFRIX_BACKUP_DIR=root / "backups", MEDIA_ROOT=root / "media", INFRIX_MAINTENANCE_DIR=root / "state"), \
                 patch("assets.backups._require_mariadb"), \
                 patch("assets.backups._database_settings", return_value={"name": "infrix"}), \
                 patch("assets.backups._database_storage_engines", return_value=["InnoDB"]), \
                 patch("assets.backups._run_dump", side_effect=lambda workdir, path: path.write_text("SELECT 1;\n")):
                result = create_backup()
                self.assertEqual(result["media_reference_validation"], "verified")
                backup = root / "backups" / result["filename"]
                validated = validate_backup(backup.name)
                self.assertEqual(validated.manifest["media_references"][0]["path"], "attachments/content.txt")
                with tarfile.open(backup) as archive:
                    entries = [(member, archive.extractfile(member).read() if member.isreg() else None) for member in archive.getmembers()]
                with tarfile.open(backup, "w:gz") as archive:
                    for member, data in entries:
                        if member.name == "media/attachments/content.txt":
                            data = b"tampered content"
                            member.size = len(data)
                        archive.addfile(member, BytesIO(data) if data is not None else None)
                with self.assertRaises(BackupServiceError):
                    validate_backup(backup.name)
                with tarfile.open(backup, "w:gz") as archive:
                    for member, data in entries:
                        if member.name == "manifest.json":
                            manifest = json.loads(data)
                            manifest["backup_format_version"] = 1
                            manifest.pop("media_references")
                            data = json.dumps(manifest).encode()
                        if data is not None:
                            member.size = len(data)
                        archive.addfile(member, BytesIO(data) if data is not None else None)
                self.assertTrue(list_backups()[0]["valid"])
                self.assertEqual(list_backups()[0]["media_reference_validation"], "legacy_unverified")


class MaintenanceWindowTests(SimpleTestCase):
    def child(self, root, code):
        environment = os.environ.copy()
        environment.update(DJANGO_SETTINGS_MODULE="config.settings", DJANGO_ENV="development", DB_ENGINE="sqlite", INFRIX_MAINTENANCE_DIR=root)
        process = subprocess.Popen([sys.executable, "-u", "-c", code], env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        return process

    def test_orphaned_import_client_retains_controller_lock(self):
        from assets.maintenance_gate import maintenance_window, MaintenanceUnavailable
        with tempfile.TemporaryDirectory() as root, override_settings(INFRIX_MAINTENANCE_DIR=root):
            process = self.child(root, "import subprocess,sys\nfrom assets.maintenance_gate import maintenance_window, maintenance_subprocess_options\nwith maintenance_window('restore') as operation:\n operation.mark_dirty('importing')\n subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(2)'], **maintenance_subprocess_options())\n print('client-started', flush=True)\n input()\n")
            self.assertEqual(process.stdout.readline().strip(), "client-started")
            process.kill()
            process.wait(timeout=5)
            with self.assertRaises(MaintenanceUnavailable):
                with maintenance_window("restore", recover=True):
                    self.fail("must not recover while the orphaned client is alive")
            process.communicate(timeout=5)
            with maintenance_window("restore", recover=True) as operation:
                operation.complete()

    def test_cli_drains_another_process_and_rejects_arrivals(self):
        from assets.maintenance_gate import business_access, MaintenanceUnavailable
        with tempfile.TemporaryDirectory() as root, override_settings(INFRIX_MAINTENANCE_DIR=root):
            reader = self.child(root, "from assets.maintenance_gate import business_access\nwith business_access():\n print('admitted', flush=True)\n input()\n")
            self.assertEqual(reader.stdout.readline().strip(), "admitted")
            writer = self.child(root, "from assets.maintenance_gate import maintenance_window\nwith maintenance_window('backup'):\n print('exclusive', flush=True)\n input()\n")
            deadline = time.monotonic() + 5
            while not (Path(root) / "state.json").exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue((Path(root) / "state.json").exists())
            with self.assertRaises(MaintenanceUnavailable):
                with business_access():
                    pass
            self.assertEqual(json.loads((Path(root) / "state.json").read_text())["stage"], "draining")
            reader.communicate("\n", timeout=5)
            self.assertEqual(reader.returncode, 0)
            self.assertEqual(writer.stdout.readline().strip(), "exclusive")
            writer.communicate("\n", timeout=5)
            self.assertEqual(writer.returncode, 0)
            with business_access():
                pass

    def test_killed_restore_keeps_business_closed(self):
        from assets.maintenance_gate import business_access, MaintenanceUnavailable
        with tempfile.TemporaryDirectory() as root, override_settings(INFRIX_MAINTENANCE_DIR=root):
            process = self.child(root, "from assets.maintenance_gate import maintenance_window\nwith maintenance_window('restore') as operation:\n operation.mark_dirty('restoring_database')\n print('dirty', flush=True)\n input()\n")
            self.assertEqual(process.stdout.readline().strip(), "dirty")
            process.kill()
            process.communicate(timeout=5)
            with self.assertRaises(MaintenanceUnavailable):
                with business_access():
                    pass

    def test_dirty_restore_failure_stays_closed_until_verified_recovery(self):
        from assets.maintenance_gate import business_access, maintenance_window, MaintenanceUnavailable
        with tempfile.TemporaryDirectory() as root, override_settings(INFRIX_MAINTENANCE_DIR=root):
            with self.assertRaises(RuntimeError):
                with maintenance_window("restore") as operation:
                    operation.mark_dirty("restoring_database")
                    raise RuntimeError("database import failed")
            with self.assertRaises(MaintenanceUnavailable):
                with business_access():
                    self.fail("failed restore must stay closed")
            with maintenance_window("restore", recover=True) as operation:
                operation.mark_dirty("recovering")
                operation.complete()
            with business_access():
                pass
