#!/usr/bin/env python3
"""Destructive acceptance exercise for an EMPTY, explicitly named fixture DB only.

Run with backend/.venv/bin/python, an isolated MariaDB environment and
--database infrix_phase1. Never points at the development SQLite database.
"""
import argparse
import gzip
import json
import os
from pathlib import Path
import subprocess
import socket
import sys
import tarfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from io import BytesIO
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    args = parser.parse_args()
    import django
    from django.conf import settings
    database = settings.DATABASES["default"]
    if settings.IS_PRODUCTION or database["ENGINE"] != "django.db.backends.mysql" or database["NAME"] != args.database or not (args.database == "infrix_phase1" or args.database.startswith("infrix_phase1_")):
        raise SystemExit("Refusing: requires development mode and matching isolated infrix_phase1 fixture database")
    django.setup()
    from django.contrib.auth.models import User
    from django.core.files.uploadedfile import SimpleUploadedFile
    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient
    from assets.models import Asset, Attachment, DeviceType, DataCenter, ServerRoom, SparePart, SparePartCategory, SpareStock, UserSecurityProfile
    from assets.system_maintenance import list_backups
    if Asset.objects.exists() or User.objects.exists():
        raise SystemExit("Refusing: fixture database must have no users or assets")
    # The backup service deliberately requires its production-only flag.
    # Enable that flag only inside guarded fixture CLI subprocesses, keeping
    # development transport and the no-production-database guard intact.
    cli_code = """import sys
from django.conf import settings
assert not settings.IS_PRODUCTION and settings.DATABASES['default']['NAME'].startswith('infrix_phase1')
settings.IS_PRODUCTION = True
from django.core.management import execute_from_command_line
execute_from_command_line(['manage.py'] + sys.argv[1:])
"""
    settings.ALLOWED_HOSTS = ["testserver", "localhost"]
    admin = User.objects.create_superuser("acceptance-admin", "audit@example.test", "Fixture-Password-834!")
    UserSecurityProfile.objects.filter(user=admin).update(must_change_password=False)
    device_type = DeviceType.objects.create(name="Acceptance type")
    asset = Asset.objects.create(asset_no="ACCEPTANCE-ASSET", name="original name", standalone_device_type=device_type)
    center = DataCenter.objects.create(name="Acceptance A")
    other = DataCenter.objects.create(name="Acceptance B")
    category = SparePartCategory.objects.create(name="Acceptance", code="ACCEPTANCE")
    part = SparePart.objects.create(name="Acceptance part", code="ACCEPTANCE", category=category)

    def client():
        value = APIClient()
        value.force_login(User.objects.get(pk=admin.pk))
        return value

    web = client()
    response = web.post("/api/v1/spare-transactions/", {"part": part.pk, "operation_type": "inbound", "quantity": 5, "target_data_center": center.pk}, format="json")
    assert response.status_code == 201, response.data

    def cli(arguments, *, check=True):
        result = subprocess.run([sys.executable, "-c", cli_code, *arguments], cwd=ROOT / "backend", text=True, capture_output=True, timeout=90)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def start_backup():
        return subprocess.Popen([sys.executable, "-c", cli_code, "create_backup"], cwd=ROOT / "backend", text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def wait_marker():
        deadline = time.monotonic() + 10
        while not (settings.INFRIX_MAINTENANCE_DIR / "state.json").exists():
            if time.monotonic() >= deadline:
                raise AssertionError("CLI did not enter maintenance")
            time.sleep(0.02)

    def blocked():
        # No force_login here: session creation is itself a DB mutation.
        for method, url in [("get", "/api/v1/assets/"), ("get", "/admin/"), ("post", "/api/v1/tags/")]:
            response = getattr(APIClient(), method)(url)
            assert response.status_code == 503, (url, response.status_code)
            assert response["Retry-After"] == "30"

    # Exercise an upload admitted before maintenance; actual storage pauses.
    entered, resume = threading.Event(), threading.Event()
    storage = Attachment._meta.get_field("file").storage
    save_file = storage.save
    def paused_save(*a, **kw):
        entered.set()
        assert resume.wait(10)
        return save_file(*a, **kw)
    def upload():
        close_old_connections()
        try:
            return client().post("/api/v1/attachments/", {"asset": asset.pk, "file": SimpleUploadedFile("proof.txt", b"proof of restore", content_type="text/plain")}, format="multipart")
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=1) as pool, patch.object(storage, "save", side_effect=paused_save):
        upload_result = pool.submit(upload)
        assert entered.wait(10)
        backup_process = start_backup()
        try:
            wait_marker()
            blocked()
        finally:
            resume.set()
        response = upload_result.result(timeout=10)
        assert response.status_code == 201, response.data
        output, error = backup_process.communicate(timeout=30)
        assert backup_process.returncode == 0, error
    print("PASS: admitted upload drains, later API/Admin/writes return 503")
    attachment = Attachment.objects.get()
    first_backup = output.strip().splitlines()[-1].split(": ", 1)[1]
    with tarfile.open(settings.INFRIX_BACKUP_DIR / first_backup) as archive:
        assert archive.extractfile("media/" + attachment.file.name).read() == b"proof of restore"
    print("PASS: SQL/media snapshot includes completed upload")

    # Exercise a delete paused inside its commit-time physical file callback.
    response = web.post("/api/v1/attachments/", {"asset": asset.pk, "file": SimpleUploadedFile("delete.txt", b"delete me", content_type="text/plain")}, format="multipart")
    assert response.status_code == 201, response.data
    deleted_id = response.data["id"]
    deleted_name = Attachment.objects.get(pk=deleted_id).file.name
    entered.clear(); resume.clear()
    delete_file = storage.delete
    def paused_delete(*a, **kw):
        entered.set()
        assert resume.wait(10)
        return delete_file(*a, **kw)
    def delete():
        close_old_connections()
        try:
            return client().delete(f"/api/v1/attachments/{deleted_id}/")
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=1) as pool, patch.object(storage, "delete", side_effect=paused_delete):
        deletion = pool.submit(delete)
        assert entered.wait(10)
        backup_process = start_backup()
        try:
            wait_marker()
            blocked()
            assert backup_process.poll() is None
        finally:
            resume.set()
        assert deletion.result(timeout=10).status_code == 204
        output, error = backup_process.communicate(timeout=30)
        assert backup_process.returncode == 0, error
    snapshot = output.strip().splitlines()[-1].split(": ", 1)[1]
    with tarfile.open(settings.INFRIX_BACKUP_DIR / snapshot) as archive:
        assert "media/" + deleted_name not in archive.getnames()
    print("PASS: backup waits for commit-time file deletion callback")

    response = web.patch(f"/api/v1/assets/{asset.pk}/", {"name": "changed after snapshot"}, format="json")
    assert response.status_code == 200, response.data
    Path(attachment.file.path).write_bytes(b"changed after snapshot")
    response = web.post("/api/v1/spare-transactions/", {"part": part.pk, "operation_type": "inbound", "quantity": 3, "target_data_center": center.pk}, format="json")
    assert response.status_code == 201
    cli(["restore_backup", snapshot, "--confirm-restore", "RESTORE INFRIX"])
    close_old_connections()
    asset.refresh_from_db()
    assert asset.name == "original name"
    assert Path(attachment.file.path).read_bytes() == b"proof of restore"
    assert SpareStock.objects.get(part=part).quantity == 5
    assert web.get("/api/v1/assets/").status_code == 403
    web = APIClient()
    assert web.post("/api/v1/auth/login/", {"username": admin.username, "password": "Fixture-Password-834!"}, format="json").status_code == 200
    assert web.post("/api/v1/spare-transactions/", {"part": part.pk, "operation_type": "outbound", "quantity": 1, "source_data_center": center.pk}, format="json").status_code == 201
    print("PASS: real SQL restore, attachment bytes, session invalidation, relogin and stock operation")

    # Fail the import adapter after media has been replaced, then recover with
    # the real MariaDB import. No injected failure reaches a non-fixture DB.
    failure_code = """from django.conf import settings
assert not settings.IS_PRODUCTION and settings.DATABASES['default']['NAME'].startswith('infrix_phase1')
settings.IS_PRODUCTION = True
import django; django.setup()
from unittest.mock import patch
from django.core.management import call_command, CommandError
from assets.backups import BackupServiceError
import sys
with patch('assets.backups._restore_database', side_effect=BackupServiceError('Injected fixture import failure', code='database_restore_failed')):
 try: call_command('restore_backup', sys.argv[1], confirm_restore='RESTORE INFRIX')
 except CommandError: sys.exit(7)
"""
    result = subprocess.run([sys.executable, "-c", failure_code, snapshot], cwd=ROOT / "backend", text=True, capture_output=True, timeout=60)
    assert result.returncode == 7, result.stderr
    blocked()
    state = json.loads((settings.INFRIX_MAINTENANCE_DIR / "state.json").read_text())
    assert state["dirty"]
    cli(["restore_backup", state["safety_backup"], "--confirm-restore", "RESTORE INFRIX", "--recover"])
    close_old_connections()
    assert not (settings.INFRIX_MAINTENANCE_DIR / "state.json").exists()
    assert SpareStock.objects.get(part=part).quantity == 4
    print("PASS: failed import stays closed; real safety-backup recovery verifies and reopens")

    # Pause a REAL MariaDB import with a fixture-only SQL delay, kill its CLI
    # parent, and verify that the surviving client prevents concurrent recovery.
    interrupted = settings.INFRIX_BACKUP_DIR / "infrix-backup-20261008-000000-98.tar.gz"
    with tarfile.open(settings.INFRIX_BACKUP_DIR / snapshot) as source, tarfile.open(interrupted, "w:gz") as destination:
        for member in source.getmembers():
            data = source.extractfile(member).read() if member.isreg() else None
            if member.name == "database.sql.gz":
                data = gzip.compress(gzip.decompress(data) + b"\nSELECT SLEEP(8);\n")
                member.size = len(data)
            destination.addfile(member, BytesIO(data) if data is not None else None)
    Path(attachment.file.path).write_bytes(b"before interrupted restore")
    process = subprocess.Popen([sys.executable, "-c", cli_code, "restore_backup", interrupted.name,
        "--confirm-restore", "RESTORE INFRIX"], cwd=ROOT / "backend", text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def import_is_paused():
        connection.close()
        with connection.cursor() as cursor:
            cursor.execute("SHOW FULL PROCESSLIST")
            return any(row[3] == args.database and row[7] == "SELECT SLEEP(8)" for row in cursor.fetchall())

    try:
        deadline = time.monotonic() + 15
        while not import_is_paused():
            assert process.poll() is None, "Import exited before its fixture delay"
            assert time.monotonic() < deadline, "Import did not reach its fixture delay"
            time.sleep(0.05)
        process.kill()
        process.communicate(timeout=5)
        blocked()
        state = json.loads((settings.INFRIX_MAINTENANCE_DIR / "state.json").read_text())
        assert state["dirty"] and state["stage"] == "restoring_database"
        retry = cli(["restore_backup", state["safety_backup"], "--confirm-restore", "RESTORE INFRIX", "--recover"], check=False)
        assert retry.returncode != 0, "Recovery raced the surviving import client"
        deadline = time.monotonic() + 15
        while import_is_paused():
            assert time.monotonic() < deadline
            time.sleep(0.1)
        blocked()
        cli(["restore_backup", state["safety_backup"], "--confirm-restore", "RESTORE INFRIX", "--recover"])
        close_old_connections()
        assert SpareStock.objects.get(part=part).quantity == 4
        assert Path(attachment.file.path).read_bytes() == b"before interrupted restore"
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    print("PASS: killed real restore CLI stays closed; surviving MariaDB client blocks recovery until exit; safety recovery succeeds")

    legacy = settings.INFRIX_BACKUP_DIR / "infrix-backup-20261008-000000-99.tar.gz"
    with tarfile.open(settings.INFRIX_BACKUP_DIR / snapshot) as source, tarfile.open(legacy, "w:gz") as destination:
        for member in source.getmembers():
            data = source.extractfile(member).read() if member.isreg() else None
            if member.name == "manifest.json":
                manifest = json.loads(data)
                manifest["backup_format_version"] = 1
                manifest.pop("media_references")
                data = json.dumps(manifest).encode()
                member.size = len(data)
            destination.addfile(member, BytesIO(data) if data is not None else None)
    assert next(row for row in list_backups() if row["filename"] == legacy.name)["media_reference_validation"] == "legacy_unverified"
    cli(["restore_backup", legacy.name, "--confirm-restore", "RESTORE INFRIX"])
    close_old_connections()
    assert Path(attachment.file.path).read_bytes() == b"proof of restore"
    print("PASS: legacy format is labeled, restored and verified")

    # Real InnoDB row locks: either move wins and inbound rejects the old
    # center, or inbound wins and movement reports 409. Never both succeed.
    for iteration in range(8):
        room = ServerRoom.objects.create(name=f"Concurrent room {iteration}", data_center=center)
        ready = threading.Barrier(2)
        def race(move):
            close_old_connections()
            try:
                session = client()
                ready.wait(timeout=10)
                if move:
                    return session.patch(f"/api/v1/server-rooms/{room.pk}/", {"data_center": other.pk}, format="json").status_code
                return session.post("/api/v1/spare-transactions/", {"part": part.pk, "operation_type": "inbound", "quantity": 1, "target_data_center": center.pk, "target_server_room": room.pk}, format="json").status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            move = pool.submit(race, True)
            stock = pool.submit(race, False)
            statuses = (move.result(timeout=20), stock.result(timeout=20))
        assert statuses in {(200, 400), (409, 201)}, statuses
        room.refresh_from_db()
        assert not SpareStock.objects.filter(server_room=room).exclude(data_center_id=room.data_center_id).exists()
    print("PASS: 8 concurrent room-reparent/inbound races preserve location consistency")

    # Run real HTTP requests against three Gunicorn worker processes, sharing
    # the same environment/lock directory with a real create_backup CLI.
    from assets.maintenance_gate import business_access
    with socket.socket() as address:
        address.bind(("127.0.0.1", 0))
        port = address.getsockname()[1]
    access_log = settings.INFRIX_MAINTENANCE_DIR / "acceptance-http.log"
    workers = subprocess.Popen([
        sys.executable, "-m", "gunicorn", "config.wsgi:application",
        "--bind", f"127.0.0.1:{port}", "--workers", "3",
        "--access-logfile", str(access_log), "--access-logformat", "%(p)s %(s)s",
    ], cwd=ROOT / "backend", stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    backup_process = None

    def http_status():
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/v1/assets/", timeout=5) as response:
                return response.status
        except HTTPError as error:
            return error.code

    try:
        deadline = time.monotonic() + 15
        while True:
            try:
                assert http_status() == 403
                break
            except URLError:
                if workers.poll() is not None or time.monotonic() >= deadline:
                    raise AssertionError("Fixture Gunicorn failed to start")
                time.sleep(0.05)
        with business_access():
            backup_process = start_backup()
            wait_marker()
            with ThreadPoolExecutor(max_workers=12) as requests:
                assert all(status == 503 for status in requests.map(lambda _: http_status(), range(120)))
            served_by = {line.split()[0] for line in access_log.read_text().splitlines() if line.endswith(" 503")}
            assert len(served_by) == 3, served_by
        output, error = backup_process.communicate(timeout=30)
        assert backup_process.returncode == 0, error
        assert http_status() == 403
    finally:
        if backup_process is not None and backup_process.poll() is None:
            backup_process.kill()
            backup_process.communicate(timeout=5)
        workers.terminate()
        try:
            workers.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            workers.kill()
            workers.communicate(timeout=5)
    print("PASS: 120 real HTTP requests across 3 Gunicorn workers return 503 during CLI backup; access reopens")
    print("ALL PHASE 1 MARIADB ACCEPTANCE CHECKS PASSED")


if __name__ == "__main__":
    main()
