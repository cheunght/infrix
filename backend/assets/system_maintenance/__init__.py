"""Public system-maintenance interface.

The HTTP views and management commands use this module as their seam.  The
existing backup and reset implementations remain internal adapters while the
public functions centralize confirmation, safe errors, and operation results.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import BinaryIO, TypedDict

from ..backups import (
    BACKUP_CONFIRMATION,
    BackupServiceError,
    backup_preflight as _backup_preflight,
    backup_path_for_download as _backup_path_for_download,
    create_backup as _create_backup,
    delete_backup as _delete_backup,
    list_backups as _list_backups,
    restore_backup as _restore_backup,
)
from ..operations import read_status as _read_status
from ..system_reset import SYSTEM_RESET_CONFIRMATION, reset_system as _reset_system


MaintenanceError = BackupServiceError


class MaintenanceStatus(TypedDict, total=False):
    application: dict[str, object]
    database: dict[str, object]
    smtp: dict[str, object]
    ldap: dict[str, object]
    configuration_status: str


class BackupSummary(TypedDict, total=False):
    id: str
    filename: str
    backup_type: str
    created_at: str
    size: int
    database_engine: str
    valid: bool
    validation_error: str


class RestoreResult(TypedDict, total=False):
    ok: bool
    filename: str
    safety_backup: str
    database_status: str
    media_status: str
    sessions_invalidated: int
    audit_recorded: bool
    warnings: list[str]


class DeleteResult(TypedDict):
    deleted: bool
    filename: str


@dataclass(frozen=True)
class BackupDownload:
    """A validated backup stream for the HTTP download adapter."""

    stream: BinaryIO
    filename: str


def read_status() -> MaintenanceStatus:
    return _read_status()


def check_backup_support() -> dict[str, object]:
    return _backup_preflight()


def list_backups() -> list[BackupSummary]:
    return _list_backups()


def create_backup(*, actor=None, request=None) -> BackupSummary:
    return _create_backup(actor=actor, request=request)


def restore_backup(
    backup_id: str,
    confirmation: str,
    *,
    actor=None,
    request=None,
) -> RestoreResult:
    return _restore_backup(
        backup_id,
        confirmation=confirmation,
        actor=actor,
        request=request,
    )


def delete_backup(
    backup_id: str,
    confirmation: str,
    *,
    actor=None,
    request=None,
) -> DeleteResult:
    expected = f"DELETE {backup_id}"
    if confirmation != expected:
        raise MaintenanceError(
            "请输入准确的删除确认文本。",
            code="delete_confirmation_required",
            status_code=400,
        )
    return _delete_backup(backup_id, actor=actor, request=request)


def reset_system(*, confirmation: str, actor, request=None) -> dict[str, object]:
    if confirmation != SYSTEM_RESET_CONFIRMATION:
        raise MaintenanceError(
            f"请输入 {SYSTEM_RESET_CONFIRMATION} 以确认恢复系统初始状态。",
            code="reset_confirmation_required",
            status_code=400,
        )
    return _reset_system(actor=actor, request=request)


def open_backup_download(backup_id: str) -> BackupDownload:
    try:
        path = _backup_path_for_download(backup_id)
        stream = path.open("rb")
    except MaintenanceError:
        raise
    except OSError as exc:
        raise MaintenanceError(
            "无法读取备份文件。",
            code="backup_not_found",
            status_code=404,
        ) from exc
    return BackupDownload(stream=stream, filename=path.name)


__all__ = [
    "BACKUP_CONFIRMATION",
    "BackupSummary",
    "BackupDownload",
    "DeleteResult",
    "MaintenanceError",
    "MaintenanceStatus",
    "RestoreResult",
    "SYSTEM_RESET_CONFIRMATION",
    "check_backup_support",
    "create_backup",
    "delete_backup",
    "list_backups",
    "open_backup_download",
    "read_status",
    "reset_system",
    "restore_backup",
]
