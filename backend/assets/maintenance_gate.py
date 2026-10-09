"""Single-host admission barrier independent of the restored database.

The durable marker rejects arrivals before exclusive access drains admitted
requests. Dirty restores stay closed after process death until verified recovery.
Lock files are never replaced or deleted.
"""
import contextlib
import fcntl
import json
import os
import time
from contextvars import ContextVar
from pathlib import Path
from uuid import uuid4

from django.conf import settings

_controller_descriptor = ContextVar("maintenance_controller_descriptor", default=None)


def maintenance_subprocess_options():
    descriptor = _controller_descriptor.get()
    # MariaDB clients retain the controller lock until they exit, including
    # when the CLI parent is killed. Recovery cannot race an orphaned import.
    return {"pass_fds": (descriptor,)} if descriptor is not None else {}


class MaintenanceUnavailable(Exception):
    pass


def _root():
    raw = Path(settings.INFRIX_MAINTENANCE_DIR).expanduser()
    if not raw.is_absolute() or raw.is_symlink():
        raise MaintenanceUnavailable("维护目录配置无效")
    root = raw.resolve()
    for configured in (settings.MEDIA_ROOT, settings.INFRIX_BACKUP_DIR, settings.STATIC_ROOT,
                       Path(settings.BASE_DIR).parent / "frontend" / "dist"):
        other = Path(configured).resolve()
        if root == other or root.is_relative_to(other) or other.is_relative_to(root):
            raise MaintenanceUnavailable("维护目录必须独立于媒体、备份和静态目录")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    return root


def _open_lock(root, name):
    return os.open(root / name, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)


def _sync_directory(root):
    descriptor = os.open(root, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _read_state(root):
    path = root / "state.json"
    try:
        if path.is_symlink():
            raise MaintenanceUnavailable("维护状态不可读取")
        state = json.loads(path.read_text())
        if not isinstance(state, dict) or state.get("operation") not in {"backup", "restore"} or not isinstance(state.get("dirty"), bool):
            raise ValueError("invalid state")
        return state
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise MaintenanceUnavailable("维护状态不可读取") from exc


def _write_state(root, state):
    temporary = root / f".state-{uuid4().hex}"
    try:
        with temporary.open("x") as handle:
            os.chmod(temporary, 0o600)
            json.dump(state, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, root / "state.json")
        _sync_directory(root)
    finally:
        temporary.unlink(missing_ok=True)


def _clear_state(root):
    (root / "state.json").unlink(missing_ok=True)
    _sync_directory(root)


def _reject_active(root):
    state = _read_state(root)
    if state is None:
        return
    if not state["dirty"]:
        controller = _open_lock(root, "controller.lock")
        try:
            try:
                fcntl.flock(controller, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise MaintenanceUnavailable("系统正在维护") from None
            state = _read_state(root)
            if state is None:
                return
            if state is not None and not state["dirty"]:
                _clear_state(root)
                return
        finally:
            os.close(controller)
    raise MaintenanceUnavailable("系统正在维护，恢复失败时需完成服务器恢复验收")


@contextlib.contextmanager
def authorization_access(user_id, *, exclusive=False):
    """Coordinate grant revocation with in-flight requests on this host."""
    descriptor = _open_lock(_root(), f"scope-{int(user_id)}.lock")
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield
    finally:
        os.close(descriptor)


@contextlib.contextmanager
def business_access():
    root = _root()
    _reject_active(root)
    descriptor = _open_lock(root, "access.lock")
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            raise MaintenanceUnavailable("系统正在维护") from None
        _reject_active(root)
        yield
    finally:
        os.close(descriptor)


class MaintenanceOperation:
    def __init__(self, root, operation, previous):
        self.root = root
        self.recovering = bool(previous and previous["dirty"])
        self.state = {"operation": operation, "dirty": self.recovering, "stage": "draining", "started_at": time.time()}
        if previous and previous.get("safety_backup"):
            self.state["safety_backup"] = previous["safety_backup"]

    def stage(self, stage, **metadata):
        self.state.update(metadata, stage=stage)
        _write_state(self.root, self.state)

    def mark_dirty(self, stage):
        self.state["dirty"] = True
        self.stage(stage)

    def complete(self):
        self.state["dirty"] = False


@contextlib.contextmanager
def maintenance_window(operation, *, recover=False):
    if operation not in {"backup", "restore"}:
        raise ValueError("unsupported maintenance operation")
    root = _root()
    controller = _open_lock(root, "controller.lock")
    access = None
    window = None
    token = None
    try:
        try:
            fcntl.flock(controller, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise MaintenanceUnavailable("另一维护操作正在执行") from None
        previous = _read_state(root)
        if previous and previous["dirty"] and not (recover and operation == "restore"):
            raise MaintenanceUnavailable("上次恢复未通过验收，请使用 restore_backup --recover")
        window = MaintenanceOperation(root, operation, previous)
        window.stage("draining")
        access = _open_lock(root, "access.lock")
        deadline = time.monotonic() + settings.INFRIX_MAINTENANCE_DRAIN_SECONDS
        while True:
            try:
                fcntl.flock(access, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise MaintenanceUnavailable("在途请求未结束，维护未开始") from None
                time.sleep(0.05)
        token = _controller_descriptor.set(controller)
        yield window
    finally:
        if token is not None:
            _controller_descriptor.reset(token)
        if window is not None and not window.state["dirty"]:
            _clear_state(root)
        if access is not None:
            os.close(access)
        os.close(controller)
