"""Atomic, additive cache for the TV-series theme scan (/data/series_cache.json).

Joins the protected data files: writes are atomic (atomic_write_json → .tmp + os.replace)
and additive — a show briefly missing from a scan (e.g. a transient section error) is kept,
never dropped. No other file is touched.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List

from atomic_io import atomic_write_json

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
_CACHE_PATH = os.path.join(DATA_DIR, "series_cache.json")


def cache_exists() -> bool:
    """True if the series cache file is present on disk."""
    return os.path.exists(_CACHE_PATH)


def load_cache() -> Dict[str, Any]:
    """Return the cache dict, or {} when missing / unparseable."""
    try:
        with open(_CACHE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_cache(entries: List[Dict[str, Any]]) -> None:
    """Additively merge ``entries`` (keyed by ratingKey) into the cache, atomically.

    Existing shows absent from this scan are preserved; a re-scanned show is replaced with
    its newest data. Shows are stored title-sorted; ``total`` / ``with_theme`` recomputed.
    """
    by_key: Dict[str, Dict[str, Any]] = {}
    for show in load_cache().get("shows", []):
        if isinstance(show, dict) and show.get("ratingKey") is not None:
            by_key[str(show["ratingKey"])] = show
    for entry in entries:
        if entry.get("ratingKey") is not None:
            by_key[str(entry["ratingKey"])] = entry

    shows = sorted(by_key.values(), key=lambda s: (s.get("title") or "").lower())
    with_theme = sum(1 for s in shows if s.get("has_theme"))
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(shows),
        "with_theme": with_theme,
        "shows": shows,
    }
    atomic_write_json(_CACHE_PATH, payload, ensure_ascii=False)
    logger.info("series_cache written: %d shows, %d themed", len(shows), with_theme)
