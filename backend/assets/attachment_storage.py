"""Small, recoverable helpers for attachment storage cleanup."""

import logging


logger = logging.getLogger(__name__)


def cleanup_attachment_file(storage, name, *, protected_name=""):
    """Best-effort cleanup that never masks the original application error."""

    if not storage or not name or name == protected_name:
        return
    try:
        storage.delete(name)
    except Exception:
        logger.warning("Failed to clean up attachment storage key %s", name, exc_info=True)
