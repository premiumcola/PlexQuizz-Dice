"""Atomic JSON writes so a crashed or partial write can never truncate live data."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def atomic_write_json(path: str, data: Any, **dump_kwargs: Any) -> bool:
    """Write ``data`` as JSON to ``path`` atomically.

    Serializes to ``<path>.tmp``, flushes and fsyncs it, then ``os.replace``s it
    over ``path`` — an atomic rename on POSIX, so a reader sees either the old
    file or the complete new one, never a half-written one. On any failure the
    existing file is left untouched and the function returns ``False`` so a bad
    write never destroys good data.
    """
    directory = os.path.dirname(path) or "."
    tmp_path = f"{path}.tmp"
    try:
        os.makedirs(directory, exist_ok=True)
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, **dump_kwargs)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, path)
        return True
    except OSError as exc:
        logger.error("Atomic write to %s failed, keeping existing file: %s", path, exc)
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return False


def read_json(path: str, default: Any = None) -> Any:
    """Read JSON from ``path`` (utf-8), returning ``default`` if it is missing or corrupt.

    Mirrors :func:`atomic_write_json` on the read side: a missing file or invalid
    JSON yields the caller's default instead of raising, so callers don't have to
    repeat the same try/except around every cache load.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def file_size(path: str) -> int:
    """Bytes on disk at ``path``, or 0 if it is missing/unreadable."""
    try:
        return os.path.getsize(path)
    except OSError:
        return 0
