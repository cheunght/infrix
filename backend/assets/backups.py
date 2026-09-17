"""Local MariaDB backup and restore service.

Backups are deliberately implemented as a filesystem format instead of a
database model.  A restored database must not depend on a row that was stored
in the database being restored.  The service is intentionally MariaDB-only;
SQLite remains a development/test database and is rejected by this module.
"""

from __future__ import annotations

import contextlib
import datetime as datetime_module
import gzip
import hashlib
import json
import logging
import os
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterator
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone

from .audit import write_audit_log


logger = logging.getLogger(__name__)

BACKUP_FORMAT_VERSION = 1
BACKUP_CONFIRMATION = "RESTORE INFRIX"
BACKUP_FILENAME_RE = re.compile(
    r"^infrix-(?:backup|pre-restore)-[0-9]{8}-[0-9]{6}(?:-[0-9]+)?\.tar\.gz$"
)
DATABASE_DUMP_NAME = "database.sql.gz"
MANIFEST_NAME = "manifest.json"
MEDIA_DIRECTORY_NAME = "media"
MAX_MANIFEST_BYTES = 1024 * 1024
_UNSAFE_DATABASE_SQL_RE = re.compile(
    rb"^\s*(?:/\*![0-9]*\s*)?(?:USE|CREATE\s+(?:DATABASE|SCHEMA)|"
    rb"DROP\s+(?:DATABASE|SCHEMA)|ALTER\s+(?:DATABASE|SCHEMA))\b",
    re.IGNORECASE,
)
_CLIENT_COMMAND_RE = re.compile(rb"^\s*\\(?:!|system|source|\.)(?:\s|$)", re.IGNORECASE)


class BackupServiceError(Exception):
    """A safe, user-facing backup error with no filesystem or secret details."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "backup_error",
        status_code: int = 400,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}


class BackupOperationInProgress(BackupServiceError):
    def __init__(self) -> None:
        super().__init__(
            "另一个备份或恢复操作正在进行，请稍后重试。",
            code="backup_operation_in_progress",
            status_code=409,
        )


@dataclass(frozen=True)
class ValidatedBackup:
    path: Path
    manifest: dict[str, object]
    member_names: tuple[str, ...]
    checksum: str


def _configured_backup_root() -> Path:
    configured = getattr(settings, "INFRIX_BACKUP_DIR", "")
    if not configured:
        configured = "/var/backups/infrix" if getattr(settings, "IS_PRODUCTION", False) else (
            Path(settings.BASE_DIR) / "backups"
        )
    root = Path(configured).expanduser()
    if not root.is_absolute():
        raise BackupServiceError(
            "备份目录必须使用绝对路径。",
            code="backup_directory_invalid",
            status_code=500,
        )
    if root.is_symlink():
        raise BackupServiceError(
            "备份目录不可用。",
            code="backup_directory_invalid",
            status_code=500,
        )
    return root.resolve()


def _configured_media_root() -> Path:
    configured = getattr(settings, "MEDIA_ROOT", "")
    if not configured:
        return (Path(settings.BASE_DIR) / "media").resolve()
    root = Path(configured).expanduser()
    if not root.is_absolute():
        raise BackupServiceError(
            "媒体目录必须使用绝对路径。",
            code="media_directory_invalid",
            status_code=500,
        )
    if root.is_symlink():
        raise BackupServiceError(
            "媒体目录不可用。",
            code="media_directory_invalid",
            status_code=500,
        )
    return root.resolve()


def _is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _validate_directory_relationships(backup_root: Path, media_root: Path) -> None:
    if _is_within(backup_root, media_root) or _is_within(media_root, backup_root):
        raise BackupServiceError(
            "备份目录不能位于媒体目录内，媒体目录也不能位于备份目录内。",
            code="backup_media_directory_conflict",
            status_code=500,
        )
    static_roots = [Path(settings.STATIC_ROOT).expanduser().resolve()]
    frontend_dist = Path(settings.BASE_DIR).parent / "frontend" / "dist"
    static_roots.append(frontend_dist.resolve())
    if any(
        _is_within(backup_root, static_root) or _is_within(static_root, backup_root)
        for static_root in static_roots
    ):
        raise BackupServiceError(
            "备份目录不能与静态文件目录重叠。",
            code="backup_public_directory",
            status_code=500,
        )


def ensure_backup_root(*, create: bool) -> Path:
    """Resolve and optionally create the secure backup directory."""

    root = _configured_backup_root()
    media_root = _configured_media_root()
    _validate_directory_relationships(root, media_root)

    if root.exists():
        if root.is_symlink() or not root.is_dir():
            raise BackupServiceError(
                "备份目录不可用。",
                code="backup_directory_invalid",
                status_code=500,
            )
    elif create:
        try:
            root.mkdir(parents=True, mode=0o700, exist_ok=True)
        except OSError as exc:
            logger.exception("Unable to create backup directory")
            raise BackupServiceError(
                "无法创建备份目录，请检查服务器权限和磁盘状态。",
                code="backup_directory_unwritable",
                status_code=500,
            ) from exc

    if root.exists():
        try:
            if create:
                root.chmod(0o700)
        except OSError as exc:
            logger.exception("Unable to set backup directory permissions")
            raise BackupServiceError(
                "无法设置备份目录权限。",
                code="backup_directory_unwritable",
                status_code=500,
            ) from exc
        if not os.access(root, os.W_OK | os.X_OK):
            raise BackupServiceError(
                "备份目录不可写，请检查服务账号权限。",
                code="backup_directory_unwritable",
                status_code=500,
            )
    return root


@contextlib.contextmanager
def backup_operation_lock() -> Iterator[None]:
    """Serialize backup and restore operations across gunicorn workers."""

    root = ensure_backup_root(create=True)
    lock_path = root / ".operation.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise BackupOperationInProgress() from exc
        except ImportError as exc:  # pragma: no cover - production is Linux
            raise BackupServiceError(
                "当前系统不支持安全的备份操作锁。",
                code="backup_lock_unavailable",
                status_code=500,
            ) from exc
        try:
            yield
        finally:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


def _require_mariadb() -> None:
    if not getattr(settings, "IS_PRODUCTION", False) or connection.vendor != "mysql":
        raise BackupServiceError(
            "备份与恢复仅支持生产环境 MariaDB。",
            code="mariadb_required",
            status_code=400,
        )


def _database_settings() -> dict[str, str]:
    _require_mariadb()
    values = connection.settings_dict
    name = str(values.get("NAME") or "").strip()
    user = str(values.get("USER") or "").strip()
    password = str(values.get("PASSWORD") or "")
    host = str(values.get("HOST") or "127.0.0.1").strip()
    port = str(values.get("PORT") or "3306").strip()
    if not name or not user or not host or not port:
        raise BackupServiceError(
            "数据库连接配置不完整，无法执行备份。",
            code="database_configuration_invalid",
            status_code=500,
        )
    if "\n" in name or "\r" in name or not re.fullmatch(r"[A-Za-z0-9_]+", name):
        raise BackupServiceError(
            "数据库名称配置无效，无法执行备份。",
            code="database_configuration_invalid",
            status_code=500,
        )
    if any("\n" in value or "\r" in value for value in (user, password, host, port)):
        raise BackupServiceError(
            "数据库连接配置包含无效字符，无法执行备份。",
            code="database_configuration_invalid",
            status_code=500,
        )
    if not re.fullmatch(r"[0-9]{1,5}", port) or not 1 <= int(port) <= 65535:
        raise BackupServiceError(
            "数据库端口配置无效，无法执行备份。",
            code="database_configuration_invalid",
            status_code=500,
        )
    return {
        "name": name,
        "user": user,
        "password": password,
        "host": host,
        "port": port,
    }


def _option_file_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


@contextlib.contextmanager
def _database_option_file(workdir: Path, values: dict[str, str]) -> Iterator[Path]:
    descriptor, raw_path = tempfile.mkstemp(
        prefix=".infrix-db-",
        suffix=".cnf",
        dir=str(workdir),
    )
    option_path = Path(raw_path)
    try:
        os.fchmod(descriptor, 0o600)
        content = "\n".join(
            [
                "[client]",
                f'user="{_option_file_value(values["user"])}"',
                f'password="{_option_file_value(values["password"])}"',
                f'host="{_option_file_value(values["host"])}"',
                f'port="{_option_file_value(values["port"])}"',
                "",
            ]
        ).encode("utf-8")
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
        yield option_path
    finally:
        try:
            option_path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            logger.exception("Unable to remove temporary database option file")


def _subprocess_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for key in ("DB_PASSWORD", "MYSQL_PWD", "PGPASSWORD"):
        environment.pop(key, None)
    return environment


def _find_binary(names: tuple[str, ...], *, error_code: str) -> str:
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    raise BackupServiceError(
        "服务器未安装所需的 MariaDB 客户端工具。",
        code=error_code,
        status_code=503,
    )


def _run_dump(workdir: Path, output_path: Path) -> None:
    database = _database_settings()
    binary = _find_binary(("mariadb-dump", "mysqldump"), error_code="dump_client_missing")
    args = [
        binary,
        "--defaults-extra-file=PLACEHOLDER",
        "--protocol=tcp",
        "--single-transaction",
        "--quick",
        "--skip-lock-tables",
        "--triggers",
        "--routines",
        "--events",
        "--hex-blob",
        "--add-drop-table",
        "--default-character-set=utf8mb4",
        database["name"],
    ]
    try:
        with _database_option_file(workdir, database) as option_file:
            args[1] = f"--defaults-extra-file={option_file}"
            with output_path.open("wb") as output:
                result = subprocess.run(
                    args,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=subprocess.PIPE,
                    env=_subprocess_environment(),
                    shell=False,
                    check=False,
                )
    except OSError as exc:
        logger.exception("MariaDB dump process could not be started")
        raise BackupServiceError(
            "无法启动 MariaDB 备份工具。",
            code="database_dump_failed",
            status_code=502,
        ) from exc
    if result.returncode != 0:
        logger.error("MariaDB dump failed with exit code %s", result.returncode)
        raise BackupServiceError(
            "数据库备份失败，请检查 MariaDB 连接和权限。",
            code="database_dump_failed",
            status_code=502,
        )
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise BackupServiceError(
            "数据库备份为空，已停止生成备份文件。",
            code="database_dump_empty",
            status_code=502,
        )


def _gzip_file(source: Path, target: Path) -> None:
    try:
        with source.open("rb") as source_handle, gzip.open(target, "wb", compresslevel=6) as target_handle:
            shutil.copyfileobj(source_handle, target_handle)
        target.chmod(0o600)
    except OSError as exc:
        raise BackupServiceError(
            "无法压缩数据库备份。",
            code="database_archive_failed",
            status_code=500,
        ) from exc


def _copy_tree_without_symlinks(source: Path, target: Path) -> None:
    if source.is_symlink():
        raise BackupServiceError(
            "媒体目录包含不安全的符号链接，备份已停止。",
            code="media_contains_symlink",
            status_code=400,
        )
    if not source.is_dir():
        raise BackupServiceError(
            "媒体目录不是有效目录，备份已停止。",
            code="media_directory_invalid",
            status_code=500,
        )
    target.mkdir(parents=True, mode=0o700, exist_ok=True)
    for entry in os.scandir(source):
        source_entry = Path(entry.path)
        target_entry = target / entry.name
        if entry.is_symlink():
            raise BackupServiceError(
                "媒体目录包含不安全的符号链接，备份已停止。",
                code="media_contains_symlink",
                status_code=400,
            )
        if entry.is_dir(follow_symlinks=False):
            _copy_tree_without_symlinks(source_entry, target_entry)
        elif entry.is_file(follow_symlinks=False):
            shutil.copy2(source_entry, target_entry)
            target_entry.chmod(0o600)
        else:
            raise BackupServiceError(
                "媒体目录包含不支持的特殊文件，备份已停止。",
                code="media_contains_special_file",
                status_code=400,
            )


def _migration_state() -> list[str]:
    try:
        applied = MigrationRecorder(connection).applied_migrations()
    except Exception as exc:
        logger.exception("Unable to read migration state")
        raise BackupServiceError(
            "无法读取当前数据库迁移状态。",
            code="migration_state_unavailable",
            status_code=500,
        ) from exc
    return sorted(f"{app_label}.{name}" for app_label, name in applied)


def _database_storage_engines(database_name: str) -> list[str]:
    """Report non-transactional tables without making the dump depend on ORM data."""

    if connection.vendor != "mysql":
        return []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT DISTINCT ENGINE "
                "FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE' "
                "AND ENGINE IS NOT NULL",
                [database_name],
            )
            return sorted({str(row[0]).strip() for row in cursor.fetchall() if row and row[0]})
    except Exception:
        logger.warning("Unable to inspect MariaDB storage engines")
        return []


def _new_backup_filename(root: Path, kind: str) -> str:
    timestamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
    prefix = "pre-restore" if kind == "pre-restore" else "backup"
    base = f"infrix-{prefix}-{timestamp}"
    candidate = f"{base}.tar.gz"
    suffix = 1
    while (root / candidate).exists():
        candidate = f"{base}-{suffix}.tar.gz"
        suffix += 1
    return candidate


def _git_revision() -> str:
    value = getattr(settings, "INFRIX_GIT_REVISION", "")
    return str(value or "").strip()[:160]


def _create_backup_locked(
    *,
    kind: str,
    request=None,
    actor=None,
    write_audit: bool = True,
) -> dict[str, object]:
    root = ensure_backup_root(create=True)
    database = _database_settings()
    filename = _new_backup_filename(root, kind)
    logger.info("Starting Infrix %s backup", kind)
    started = timezone.now()
    media_root = _configured_media_root()
    media_included = media_root.exists()

    with tempfile.TemporaryDirectory(prefix=".infrix-backup-", dir=str(root)) as temporary_directory:
        workdir = Path(temporary_directory)
        plain_dump = workdir / "database.sql"
        compressed_dump = workdir / DATABASE_DUMP_NAME
        _run_dump(workdir, plain_dump)
        _gzip_file(plain_dump, compressed_dump)
        plain_dump.unlink(missing_ok=True)

        media_directory = workdir / MEDIA_DIRECTORY_NAME
        try:
            media_directory.mkdir(mode=0o700)
        except OSError as exc:
            raise BackupServiceError(
                "无法准备媒体备份目录。",
                code="media_backup_failed",
                status_code=500,
            ) from exc
        if media_included:
            try:
                _copy_tree_without_symlinks(media_root, media_directory)
            except BackupServiceError:
                raise
            except OSError as exc:
                raise BackupServiceError(
                    "媒体文件备份失败，请检查媒体目录和磁盘状态。",
                    code="media_backup_failed",
                    status_code=502,
                ) from exc

        manifest: dict[str, object] = {
            "backup_format_version": BACKUP_FORMAT_VERSION,
            "application_name": "infrix",
            "backup_type": "pre_restore" if kind == "pre-restore" else "manual",
            "application_version": str(getattr(settings, "PRODUCT_VERSION", "")),
            "created_at": timezone.now().isoformat(),
            "database_engine": "mariadb",
            "database_name": database["name"],
            "database_dump_file": DATABASE_DUMP_NAME,
            "media_included": media_included,
            "media_path": "media/",
            "migration_state": _migration_state(),
        }
        revision = _git_revision()
        if revision:
            manifest["git_revision"] = revision
        storage_engines = _database_storage_engines(database["name"])
        if storage_engines:
            manifest["database_storage_engines"] = storage_engines
            if any(engine.casefold() != "innodb" for engine in storage_engines):
                manifest["transaction_consistency_warning"] = (
                    "The database contains non-InnoDB tables; --single-transaction "
                    "does not guarantee a consistent snapshot for those tables."
                )

        manifest_path = workdir / MANIFEST_NAME
        try:
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            manifest_path.chmod(0o600)
        except OSError as exc:
            raise BackupServiceError(
                "无法写入备份清单。",
                code="backup_archive_failed",
                status_code=500,
            ) from exc

        try:
            with tempfile.NamedTemporaryFile(
                prefix=".infrix-archive-",
                suffix=".tmp",
                dir=str(root),
                delete=False,
            ) as temporary_handle:
                temporary_archive = Path(temporary_handle.name)
        except OSError as exc:
            raise BackupServiceError(
                "无法创建备份归档临时文件。",
                code="backup_archive_failed",
                status_code=500,
            ) from exc
        try:
            with tarfile.open(temporary_archive, mode="w:gz") as archive:
                archive.add(manifest_path, arcname=MANIFEST_NAME, recursive=False)
                archive.add(compressed_dump, arcname=DATABASE_DUMP_NAME, recursive=False)
                archive.add(media_directory, arcname=MEDIA_DIRECTORY_NAME, recursive=True)
            temporary_archive.chmod(0o600)
            with temporary_archive.open("rb") as handle:
                os.fsync(handle.fileno())
            final_path = root / filename
            os.replace(temporary_archive, final_path)
        except (OSError, tarfile.TarError) as exc:
            raise BackupServiceError(
                "无法生成备份归档。",
                code="backup_archive_failed",
                status_code=500,
            ) from exc
        finally:
            temporary_archive.unlink(missing_ok=True)

    try:
        validate_backup(filename, check_migrations=False)
    except BackupServiceError as exc:
        try:
            final_path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Unable to remove invalid generated backup", extra={"filename": filename})
        raise BackupServiceError(
            "生成的备份校验失败，未保留该归档。",
            code="backup_archive_failed",
            status_code=502,
        ) from exc
    result = inspect_backup(final_path, require_valid=False)
    elapsed = (timezone.now() - started).total_seconds()
    logger.info(
        "Finished Infrix %s backup filename=%s size=%s elapsed=%.3f",
        kind,
        filename,
        result["size"],
        elapsed,
    )
    if write_audit:
        try:
            write_audit_log(
                request,
                actor=actor,
                action="create",
                resource_type="backup",
                resource_id=filename,
                extra={
                    "backup_kind": kind,
                    "size": result["size"],
                    "sha256": result["checksum"],
                    "media_included": media_included,
                },
            )
        except Exception:
            # A completed backup remains usable even if audit storage is
            # temporarily unavailable.  The failure is retained server-side.
            logger.exception("Unable to record backup creation audit")
    return result


def create_backup(*, request=None, actor=None) -> dict[str, object]:
    _require_mariadb()
    with backup_operation_lock():
        return _create_backup_locked(request=request, actor=actor, kind="backup")


def _safe_archive_member_name(name: str) -> str:
    if not name or "\x00" in name or "\\" in name:
        raise BackupServiceError(
            "备份归档包含不安全的文件路径。",
            code="unsafe_archive_path",
            status_code=400,
        )
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise BackupServiceError(
            "备份归档包含不安全的文件路径。",
            code="unsafe_archive_path",
            status_code=400,
        )
    return path.as_posix().rstrip("/")


def _archive_members(archive: tarfile.TarFile) -> tuple[tarfile.TarInfo, ...]:
    members = archive.getmembers()
    seen: set[str] = set()
    for member in members:
        normalized = _safe_archive_member_name(member.name)
        if not normalized or normalized in seen:
            raise BackupServiceError(
                "备份归档包含重复或无效的文件路径。",
                code="unsafe_archive_path",
                status_code=400,
            )
        seen.add(normalized)
        if member.issym() or member.islnk() or member.isdev() or not (member.isdir() or member.isreg()):
            raise BackupServiceError(
                "备份归档包含不支持的特殊文件或链接。",
                code="unsafe_archive_member",
                status_code=400,
            )
        top_level = normalized.split("/", 1)[0]
        if top_level not in {MANIFEST_NAME, DATABASE_DUMP_NAME, MEDIA_DIRECTORY_NAME}:
            raise BackupServiceError(
                "备份归档包含未知文件。",
                code="unsupported_archive_content",
                status_code=400,
            )
    return tuple(members)


def _read_manifest_from_archive(
    archive: tarfile.TarFile,
    members: tuple[tarfile.TarInfo, ...],
) -> dict[str, object]:
    manifest_member = next((member for member in members if member.name.rstrip("/") == MANIFEST_NAME), None)
    if manifest_member is None or not manifest_member.isreg() or manifest_member.size > MAX_MANIFEST_BYTES:
        raise BackupServiceError(
            "备份缺少有效的 manifest.json。",
            code="manifest_invalid",
            status_code=400,
        )
    extracted = archive.extractfile(manifest_member)
    if extracted is None:
        raise BackupServiceError(
            "无法读取备份 manifest.json。",
            code="manifest_invalid",
            status_code=400,
        )
    try:
        raw = extracted.read(MAX_MANIFEST_BYTES + 1)
        if len(raw) > MAX_MANIFEST_BYTES:
            raise ValueError("manifest too large")
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise BackupServiceError(
            "备份 manifest.json 格式无效。",
            code="manifest_invalid",
            status_code=400,
        ) from exc
    if not isinstance(value, dict):
        raise BackupServiceError(
            "备份 manifest.json 格式无效。",
            code="manifest_invalid",
            status_code=400,
        )
    return value


def _validate_manifest(
    manifest: dict[str, object],
    members: tuple[tarfile.TarInfo, ...],
    *,
    check_migrations: bool,
) -> None:
    if manifest.get("backup_format_version") != BACKUP_FORMAT_VERSION:
        raise BackupServiceError(
            "备份格式版本不受当前版本支持。",
            code="backup_format_unsupported",
            status_code=400,
        )
    if str(manifest.get("application_name", "")).strip().lower() != "infrix":
        raise BackupServiceError(
            "备份不是 Infrix 生成的文件。",
            code="backup_application_mismatch",
            status_code=400,
        )
    if str(manifest.get("database_engine", "")).strip().lower() != "mariadb":
        raise BackupServiceError(
            "备份数据库类型不是当前支持的 MariaDB。",
            code="backup_database_mismatch",
            status_code=400,
        )
    if not str(manifest.get("database_name", "")).strip():
        raise BackupServiceError(
            "备份缺少数据库名称。",
            code="manifest_invalid",
            status_code=400,
        )
    dump_name = str(manifest.get("database_dump_file", ""))
    if dump_name != DATABASE_DUMP_NAME:
        raise BackupServiceError(
            "备份数据库文件名无效。",
            code="manifest_invalid",
            status_code=400,
        )
    dump_member = next((member for member in members if member.name == DATABASE_DUMP_NAME), None)
    if dump_member is None or not dump_member.isreg() or dump_member.size == 0:
        raise BackupServiceError(
            "备份缺少数据库导出文件。",
            code="database_dump_missing",
            status_code=400,
        )
    if manifest.get("media_path") != "media/":
        raise BackupServiceError(
            "备份媒体目录元数据无效。",
            code="manifest_invalid",
            status_code=400,
        )
    media_root = next(
        (member for member in members if member.name.rstrip("/") == MEDIA_DIRECTORY_NAME),
        None,
    )
    if media_root is None or not media_root.isdir():
        raise BackupServiceError(
            "备份缺少媒体目录。",
            code="media_missing",
            status_code=400,
        )
    if not isinstance(manifest.get("media_included"), bool):
        raise BackupServiceError(
            "备份媒体元数据无效。",
            code="manifest_invalid",
            status_code=400,
        )
    migration_state = manifest.get("migration_state")
    if not isinstance(migration_state, list) or not all(isinstance(item, str) for item in migration_state):
        raise BackupServiceError(
            "备份迁移状态无效。",
            code="manifest_invalid",
            status_code=400,
        )
    if check_migrations:
        current_state = _migration_state()
        backup_state = sorted(str(item) for item in migration_state)
        if current_state != backup_state:
            raise BackupServiceError(
                "备份与当前应用的数据库迁移状态不一致，已停止恢复。",
                code="migration_state_incompatible",
                status_code=409,
                details={
                    "backup_migration_count": len(backup_state),
                    "current_migration_count": len(current_state),
                },
            )


def _validate_gzip_member(archive: tarfile.TarFile, member: tarfile.TarInfo) -> None:
    extracted = archive.extractfile(member)
    if extracted is None:
        raise BackupServiceError(
            "无法读取数据库备份文件。",
            code="database_dump_invalid",
            status_code=400,
        )
    decompressed_bytes = 0
    pending_line = b""
    try:
        with gzip.GzipFile(fileobj=extracted, mode="rb") as gzip_handle:
            while True:
                chunk = gzip_handle.read(1024 * 1024)
                if not chunk:
                    break
                decompressed_bytes += len(chunk)
                lines = (pending_line + chunk).split(b"\n")
                pending_line = lines.pop()
                if any(_UNSAFE_DATABASE_SQL_RE.match(line) or _CLIENT_COMMAND_RE.match(line) for line in lines):
                    raise BackupServiceError(
                        "数据库备份包含不安全的数据库切换或客户端命令。",
                        code="database_dump_invalid",
                        status_code=400,
                    )
            if _UNSAFE_DATABASE_SQL_RE.match(pending_line) or _CLIENT_COMMAND_RE.match(pending_line):
                raise BackupServiceError(
                    "数据库备份包含不安全的数据库切换或客户端命令。",
                    code="database_dump_invalid",
                    status_code=400,
                )
    except (OSError, EOFError, zlib.error) as exc:
        raise BackupServiceError(
            "数据库备份文件不是可读取的 gzip 文件。",
            code="database_dump_invalid",
            status_code=400,
        ) from exc
    if decompressed_bytes == 0:
        raise BackupServiceError(
            "数据库备份文件为空。",
            code="database_dump_invalid",
            status_code=400,
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_backup_path(identifier: str) -> Path:
    root = ensure_backup_root(create=False)
    if not isinstance(identifier, str) or not BACKUP_FILENAME_RE.fullmatch(identifier):
        raise BackupServiceError(
            "备份文件标识无效。",
            code="backup_not_found",
            status_code=404,
        )
    raw_candidate = root / identifier
    if raw_candidate.is_symlink():
        raise BackupServiceError(
            "备份文件不存在。",
            code="backup_not_found",
            status_code=404,
        )
    candidate = raw_candidate.resolve()
    if candidate.parent != root or candidate.name != identifier or not candidate.is_file():
        raise BackupServiceError(
            "备份文件不存在。",
            code="backup_not_found",
            status_code=404,
        )
    try:
        mode = candidate.stat().st_mode
    except OSError as exc:
        raise BackupServiceError(
            "无法读取备份文件。",
            code="backup_not_found",
            status_code=404,
        ) from exc
    if not stat.S_ISREG(mode):
        raise BackupServiceError(
            "备份文件无效。",
            code="backup_not_found",
            status_code=404,
        )
    return candidate


def validate_backup(identifier: str, *, check_migrations: bool = True) -> ValidatedBackup:
    path = _resolve_backup_path(identifier)
    try:
        with tarfile.open(path, mode="r:gz") as archive:
            members = _archive_members(archive)
            manifest = _read_manifest_from_archive(archive, members)
            _validate_manifest(manifest, members, check_migrations=check_migrations)
            dump_member = next(member for member in members if member.name == DATABASE_DUMP_NAME)
            _validate_gzip_member(archive, dump_member)
            member_names = tuple(_safe_archive_member_name(member.name) for member in members)
    except BackupServiceError:
        raise
    except (OSError, tarfile.TarError) as exc:
        raise BackupServiceError(
            "备份归档无法读取或已损坏。",
            code="backup_archive_invalid",
            status_code=400,
        ) from exc
    try:
        checksum = _sha256(path)
    except OSError as exc:
        raise BackupServiceError(
            "无法读取备份文件。",
            code="backup_archive_invalid",
            status_code=400,
        ) from exc
    return ValidatedBackup(
        path=path,
        manifest=manifest,
        member_names=member_names,
        checksum=checksum,
    )


def _read_manifest(path: Path) -> dict[str, object]:
    try:
        with tarfile.open(path, mode="r:gz") as archive:
            members = _archive_members(archive)
            return _read_manifest_from_archive(archive, members)
    except BackupServiceError:
        raise
    except (OSError, tarfile.TarError) as exc:
        raise BackupServiceError(
            "备份归档无法读取。",
            code="backup_archive_invalid",
            status_code=400,
        ) from exc


def inspect_backup(path: Path, *, require_valid: bool = False) -> dict[str, object]:
    manifest: dict[str, object] = {}
    valid = True
    validation_error = ""
    try:
        if require_valid:
            validated = validate_backup(path.name, check_migrations=False)
            manifest = validated.manifest
        else:
            manifest = _read_manifest(path)
    except BackupServiceError as exc:
        valid = False
        validation_error = exc.message
        try:
            # Keep the safe, non-secret summary available for an invalid
            # archive whenever its manifest can still be read.
            manifest = _read_manifest(path)
        except BackupServiceError:
            pass
    try:
        stat_result = path.stat()
    except OSError as exc:
        raise BackupServiceError(
            "无法读取备份文件。",
            code="backup_not_found",
            status_code=404,
        ) from exc
    try:
        checksum = _sha256(path)
    except OSError:
        checksum = ""
    return {
        "id": path.name,
        "filename": path.name,
        "backup_type": manifest.get(
            "backup_type",
            "pre_restore" if path.name.startswith("infrix-pre-restore-") else "manual",
        ),
        "created_at": manifest.get("created_at") or datetime_module.datetime.fromtimestamp(
            stat_result.st_mtime,
            tz=datetime_module.timezone.utc,
        ).isoformat(),
        "size": stat_result.st_size,
        "database_engine": manifest.get("database_engine", "mariadb"),
        "database_name": manifest.get("database_name", ""),
        "media_included": manifest.get("media_included", False),
        "format_version": manifest.get("backup_format_version", 0),
        "application_version": manifest.get("application_version", ""),
        "git_revision": manifest.get("git_revision", ""),
        "migration_state": manifest.get("migration_state", []),
        "database_storage_engines": manifest.get("database_storage_engines", []),
        "transaction_consistency_warning": manifest.get("transaction_consistency_warning", ""),
        "checksum": checksum,
        "valid": valid,
        "validation_error": validation_error,
    }


def list_backups() -> list[dict[str, object]]:
    root = ensure_backup_root(create=False)
    if not root.exists():
        return []
    entries: list[dict[str, object]] = []
    for path in root.iterdir():
        if not path.is_file() or path.is_symlink() or not BACKUP_FILENAME_RE.fullmatch(path.name):
            continue
        try:
            entries.append(inspect_backup(path, require_valid=True))
        except (BackupServiceError, OSError):
            logger.warning("Skipping unreadable backup entry", extra={"filename": path.name})
    entries.sort(key=lambda item: str(item.get("created_at", "")), reverse=True)
    return entries


def backup_path_for_download(identifier: str) -> Path:
    return _resolve_backup_path(identifier)


def delete_backup(identifier: str, *, request=None, actor=None) -> dict[str, object]:
    with backup_operation_lock():
        path = _resolve_backup_path(identifier)
        info = inspect_backup(path)
        try:
            path.unlink()
        except OSError as exc:
            raise BackupServiceError(
                "删除备份失败，请检查服务器权限。",
                code="backup_delete_failed",
                status_code=500,
            ) from exc
        try:
            write_audit_log(
                request,
                actor=actor,
                action="delete",
                resource_type="backup",
                resource_id=path.name,
                before=info,
            )
        except Exception:
            logger.exception("Unable to record backup deletion audit")
        return {"deleted": True, "filename": path.name}


def _extract_archive(validated: ValidatedBackup, target: Path) -> None:
    try:
        target.mkdir(mode=0o700, parents=True, exist_ok=True)
        target_resolved = target.resolve()
        with tarfile.open(validated.path, mode="r:gz") as archive:
            members = _archive_members(archive)
            for member in members:
                normalized = _safe_archive_member_name(member.name)
                destination = (target / normalized).resolve()
                if destination != target_resolved and target_resolved not in destination.parents:
                    raise BackupServiceError(
                        "备份归档包含越界路径。",
                        code="unsafe_archive_path",
                        status_code=400,
                    )
                if member.isdir():
                    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
                    destination.chmod(0o700)
                    continue
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise BackupServiceError(
                        "无法解压备份文件。",
                        code="backup_archive_invalid",
                        status_code=400,
                    )
                with source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
                destination.chmod(0o600)
    except BackupServiceError:
        raise
    except (OSError, tarfile.TarError) as exc:
        raise BackupServiceError(
            "无法解压备份文件。",
            code="backup_extract_failed",
            status_code=400,
        ) from exc


def _restore_database(extracted_root: Path) -> None:
    database = _database_settings()
    client = _find_binary(("mariadb", "mysql"), error_code="restore_client_missing")
    compressed_dump = extracted_root / DATABASE_DUMP_NAME
    plain_dump = extracted_root / "database.sql"
    try:
        with gzip.open(compressed_dump, "rb") as source, plain_dump.open("wb") as target:
            shutil.copyfileobj(source, target)
        plain_dump.chmod(0o600)
        if plain_dump.stat().st_size == 0:
            raise BackupServiceError(
                "数据库备份文件为空。",
                code="database_dump_invalid",
                status_code=400,
            )
        args = [
            client,
            "--defaults-extra-file=PLACEHOLDER",
            "--protocol=tcp",
            "--binary-mode",
            "--batch",
            "--database",
            database["name"],
        ]
        with _database_option_file(extracted_root, database) as option_file:
            args[1] = f"--defaults-extra-file={option_file}"
            with plain_dump.open("rb") as stdin_handle:
                result = subprocess.run(
                    args,
                    stdin=stdin_handle,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=_subprocess_environment(),
                    shell=False,
                    check=False,
                )
        if result.returncode != 0:
            logger.error("MariaDB restore failed with exit code %s", result.returncode)
            raise BackupServiceError(
                "数据库恢复失败，当前数据库可能处于部分恢复状态。",
                code="database_restore_failed",
                status_code=502,
            )
    except BackupServiceError:
        raise
    except (OSError, gzip.BadGzipFile, zlib.error) as exc:
        raise BackupServiceError(
            "无法读取数据库备份文件。",
            code="database_restore_failed",
            status_code=502,
        ) from exc
    finally:
        plain_dump.unlink(missing_ok=True)


def _remove_tree(path: Path) -> None:
    if not path.exists():
        return
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()


def _stage_media_tree(source: Path, media_root: Path) -> Path:
    """Copy restored media beside MEDIA_ROOT before touching the database.

    The extracted archive normally lives under the backup directory, which
    may be mounted on a different filesystem from MEDIA_ROOT.  Staging beside
    the destination makes the later directory swap an atomic same-filesystem
    rename and lets us fail before database restore if the copy cannot finish.
    """

    staged: Path | None = None
    try:
        if source.is_symlink() or not source.is_dir():
            raise BackupServiceError(
                "备份媒体目录无效，无法恢复媒体文件。",
                code="media_restore_failed",
                status_code=400,
            )
        media_root.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        staged = media_root.parent / f".{media_root.name}.infrix-staged-{uuid4().hex}"
        _copy_tree_without_symlinks(source, staged)
        staged.chmod(0o750)
        return staged
    except BackupServiceError:
        if staged is not None:
            try:
                _remove_tree(staged)
            except OSError:
                logger.exception("Unable to remove incomplete staged media")
        raise
    except OSError as exc:
        if staged is not None:
            try:
                _remove_tree(staged)
            except OSError:
                logger.exception("Unable to remove incomplete staged media")
        raise BackupServiceError(
            "媒体文件恢复失败，无法准备媒体目录。",
            code="media_restore_failed",
            status_code=502,
        ) from exc


def _replace_media_tree(staged_media: Path, media_root: Path) -> Path | None:
    if media_root.exists() and media_root.is_symlink():
        raise BackupServiceError(
            "当前媒体目录是符号链接，无法安全恢复。",
            code="media_restore_failed",
            status_code=500,
        )
    try:
        media_root.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    except OSError as exc:
        raise BackupServiceError(
            "媒体文件恢复失败，无法准备媒体目录。",
            code="media_restore_failed",
            status_code=502,
        ) from exc
    rollback_path: Path | None = None
    try:
        if media_root.exists():
            rollback_path = media_root.parent / f".{media_root.name}.infrix-rollback-{uuid4().hex}"
            os.replace(media_root, rollback_path)
        os.replace(staged_media, media_root)
    except OSError as exc:
        if rollback_path is not None and rollback_path.exists():
            try:
                os.replace(rollback_path, media_root)
            except OSError:
                logger.exception("Unable to restore original media directory after replacement failure")
        raise BackupServiceError(
            "媒体文件恢复失败，已尝试保留原媒体目录。",
            code="media_restore_failed",
            status_code=502,
        ) from exc
    return rollback_path


def _rollback_media(media_root: Path, rollback_path: Path | None) -> bool:
    if rollback_path is None:
        return True
    try:
        _remove_tree(media_root)
        os.replace(rollback_path, media_root)
        return True
    except OSError:
        logger.exception("Unable to roll back media directory")
        return False


def _finalize_media_rollback(rollback_path: Path | None) -> None:
    if rollback_path is None:
        return
    try:
        _remove_tree(rollback_path)
    except OSError:
        logger.exception("Unable to remove media rollback directory")


def _post_restore() -> tuple[int, list[str]]:
    warnings: list[str] = []
    try:
        connection.close()
        connection.connect()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception as exc:
        logger.exception("Post-restore database validation failed")
        raise BackupServiceError(
            "数据库恢复后连接检查失败。",
            code="post_restore_validation_failed",
            status_code=502,
        ) from exc
    invalidated_sessions = 0
    try:
        invalidated_sessions, _ = Session.objects.all().delete()
    except Exception:
        logger.exception("Unable to invalidate sessions after restore")
        warnings.append("恢复完成，但未能清理现有登录会话。")
    try:
        cache.clear()
    except Exception:
        logger.exception("Unable to clear Django cache after restore")
        warnings.append("恢复完成，但未能清理应用缓存。")
    return invalidated_sessions, warnings


def restore_backup(
    identifier: str,
    *,
    confirmation: str,
    request=None,
    actor=None,
) -> dict[str, object]:
    if confirmation != BACKUP_CONFIRMATION:
        raise BackupServiceError(
            "请输入准确的恢复确认文本：RESTORE INFRIX。",
            code="restore_confirmation_required",
            status_code=400,
        )
    _require_mariadb()
    with backup_operation_lock():
        validated = validate_backup(identifier, check_migrations=True)
        safety_filename = ""
        try:
            safety = _create_backup_locked(
                kind="pre-restore",
                actor=actor,
                request=None,
                write_audit=False,
            )
            safety_filename = str(safety["filename"])
        except BackupServiceError as exc:
            raise BackupServiceError(
                "恢复前安全备份失败，未执行恢复。",
                code="safety_backup_failed",
                status_code=502,
                details={"database_status": "not_started", "media_status": "not_started"},
            ) from exc

        database_status = "not_started"
        media_status = "not_started"
        rollback_path: Path | None = None
        media_root = _configured_media_root()
        staged_media: Path | None = None
        try:
            with tempfile.TemporaryDirectory(prefix=".infrix-restore-", dir=str(ensure_backup_root(create=True))) as temp_directory:
                extracted_root = Path(temp_directory) / "archive"
                _extract_archive(validated, extracted_root)
                if bool(validated.manifest.get("media_included")):
                    # Complete the cross-filesystem copy before importing the
                    # database. A failed media stage therefore cannot leave a
                    # restored database paired with old media.
                    staged_media = _stage_media_tree(
                        extracted_root / MEDIA_DIRECTORY_NAME,
                        media_root,
                    )
                    # Swap only after the complete copy is ready. If the
                    # same-filesystem rename fails, the database is untouched.
                    rollback_path = _replace_media_tree(staged_media, media_root)
                    staged_media = None
                    media_status = "restored"
                # The manifest database name is informational only.  The
                # client is given the current Django database name above, and
                # the dump is created without --databases/USE wrappers so a
                # backup from another environment cannot redirect the import.
                _restore_database(extracted_root)
                database_status = "restored"
                if not bool(validated.manifest.get("media_included")):
                    media_status = "unchanged"
                sessions_invalidated, warnings = _post_restore()
        except BackupServiceError as exc:
            if staged_media is not None:
                try:
                    _remove_tree(staged_media)
                except OSError:
                    logger.exception("Unable to remove staged media after restore failure")
            if rollback_path is not None:
                media_status = "rollback_succeeded" if _rollback_media(media_root, rollback_path) else "rollback_failed"
            raise BackupServiceError(
                "恢复未能完整完成，请根据安全备份文件处理当前状态。",
                code="restore_failed",
                status_code=502,
                details={
                    "stage": exc.code,
                    "safety_backup": safety_filename,
                    "database_status": database_status,
                    "media_status": media_status,
                },
            ) from exc
        finally:
            if staged_media is not None:
                try:
                    _remove_tree(staged_media)
                except OSError:
                    logger.exception("Unable to remove staged media after restore")
            if rollback_path is not None and media_status == "restored":
                _finalize_media_rollback(rollback_path)

        audit_recorded = True
        try:
            user_model = get_user_model()
            audit_actor = user_model.objects.filter(pk=getattr(actor, "pk", None)).first() if actor else None
            write_audit_log(
                None,
                actor=audit_actor,
                action="restore",
                resource_type="backup",
                resource_id=identifier,
                extra={
                    "safety_backup": safety_filename,
                    "database_status": database_status,
                    "media_status": media_status,
                    "sessions_invalidated": sessions_invalidated,
                },
            )
        except Exception:
            audit_recorded = False
            logger.exception("Unable to record backup restore audit")
        return {
            "ok": True,
            "filename": identifier,
            "safety_backup": safety_filename,
            "database_status": database_status,
            "media_status": media_status,
            "sessions_invalidated": sessions_invalidated,
            "audit_recorded": audit_recorded,
            "warnings": warnings,
        }


def backup_preflight() -> dict[str, object]:
    """Read-only checks for production deployment and support diagnostics."""

    root: Path | None = None
    directory_error = ""
    media_overlap = False
    public_overlap = False
    try:
        root = _configured_backup_root()
        media_root = _configured_media_root()
        try:
            _validate_directory_relationships(root, media_root)
        except BackupServiceError as exc:
            directory_error = exc.code
            media_overlap = exc.code == "backup_media_directory_conflict"
            public_overlap = exc.code == "backup_public_directory"
    except BackupServiceError as exc:
        directory_error = exc.code

    dump_client = shutil.which("mariadb-dump") or shutil.which("mysqldump")
    restore_client = shutil.which("mariadb") or shutil.which("mysql")
    database_configured = False
    database_error = ""
    try:
        database = _database_settings()
        database_configured = bool(database["name"] and database["user"] and database["host"])
    except BackupServiceError as exc:
        database_error = exc.code
    root_is_invalid_file = bool(root and root.exists() and not root.is_dir())
    if root_is_invalid_file and not directory_error:
        directory_error = "backup_directory_invalid"
    directory_exists = bool(root and root.exists() and root.is_dir() and not root.is_symlink())
    parent = root if directory_exists and root is not None else (root.parent if root is not None else None)
    writable = bool(parent and parent.exists() and os.access(parent, os.W_OK | os.X_OK))
    if not writable and not directory_error:
        directory_error = "backup_directory_unwritable"
    return {
        "database_engine": "mariadb" if connection.vendor == "mysql" else connection.vendor,
        "database_configured": database_configured,
        "database_error": database_error,
        "dump_client_available": bool(dump_client),
        "restore_client_available": bool(restore_client),
        "backup_directory_exists": directory_exists,
        "backup_directory_writable": writable and not directory_error,
        "backup_directory_safe": not directory_error,
        "backup_directory_error": directory_error,
        "backup_media_overlap": media_overlap,
        "backup_public_overlap": public_overlap,
        "backup_format_version": BACKUP_FORMAT_VERSION,
    }
