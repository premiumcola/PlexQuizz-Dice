"""Persistence health diagnostics — lets the Settings page warn on data-loss risk."""
from __future__ import annotations

import datetime
import os

from flask import Blueprint

from atomic_io import file_size
from services import DATA_DIR, settings_store

bp = Blueprint("health", __name__, url_prefix="/api/health")

# Captured ONCE at module import, i.e. when this container/process starts. A Watchtower redeploy
# (or any manual restart) recreates the process and re-imports this module, so the value reflects
# the current "online since" — surfaced read-only in the About tab.
_STARTED_AT = datetime.datetime.now(datetime.timezone.utc).isoformat()


@bp.get("/build")
def build() -> dict[str, str]:
    """Report when this container/process started (ISO-8601 UTC); resets on every redeploy."""
    return {"started_at": _STARTED_AT}


@bp.get("/persistence")
def persistence():
    """Report whether /data is writable and how much state currently lives on disk."""
    abs_dir = os.path.abspath(DATA_DIR)
    writable = os.path.isdir(abs_dir) and os.access(abs_dir, os.W_OK)
    return {
        "data_dir": abs_dir,
        "writable": writable,
        "settings_bytes": file_size(os.path.join(DATA_DIR, "settings.json")),
        "library_cache_bytes": file_size(os.path.join(DATA_DIR, "library_cache.json")),
        "last_settings_write_utc": settings_store.last_write_utc(),
    }
