"""Pre-baked title -> theme seed that short-circuits L1 theme enrichment.

A bundled ``data/theme_seed.json`` maps film titles to their composer + main theme,
covering the vast majority of the library. Consulting it BEFORE the Anthropic Haiku
call means Haiku only runs for the handful of titles the seed marks ``unknown`` (or
does not contain), saving thousands of model calls on the first full scan.

The seed is read-only at runtime and is never committed to the repository.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Resolve the seed from the FIRST candidate that exists, trying both filenames at each
# location: the private /data mount first (same dir as theme_cache.json — keeps the user's
# film list out of git AND out of the image), then module-relative as a fallback.
DATA_DIR = os.environ.get("DATA_DIR", "/data")
_MODULE_DATA = Path(__file__).parent / "data"
_SEED_CANDIDATES: List[Path] = [
    Path(DATA_DIR) / "theme_seed.json",
    Path(DATA_DIR) / "movie_theme_seed.json",
    _MODULE_DATA / "theme_seed.json",
    _MODULE_DATA / "movie_theme_seed.json",
]
_USABLE_CONFIDENCE = {"high", "medium", "low"}

# Cached once after the first load() (also primed at import time, see bottom).
_seed: Optional[Dict[str, dict]] = None
_seed_source: Optional[str] = None  # the candidate path the seed actually loaded from


def _log_breakdown(seed: Dict[str, dict]) -> None:
    """Emit a single INFO line with the seed size + per-confidence breakdown."""
    counts = {"high": 0, "medium": 0, "low": 0, "unknown": 0}
    for entry in seed.values():
        if not isinstance(entry, dict):
            continue
        conf = str(entry.get("confidence") or "unknown").strip().lower()
        counts[conf] = counts.get(conf, 0) + 1
    logger.info(
        "theme_seed loaded: seed size=%d (high=%d, medium=%d, low=%d, unknown=%d)",
        len(seed), counts["high"], counts["medium"], counts["low"], counts["unknown"],
    )


def load_seed() -> Dict[str, dict]:
    """Load the theme seed from the first existing candidate path; cache it module-level.

    Returns an empty dict (never raises) when no candidate exists or all are malformed, so a
    missing seed simply degrades to the Haiku-only path.
    """
    global _seed, _seed_source
    if _seed is not None:
        return _seed
    for path in _SEED_CANDIDATES:
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("theme_seed: could not read %s: %s", path, exc)
            continue
        _seed = data if isinstance(data, dict) else {}
        _seed_source = str(path)
        logger.info("theme_seed source: %s", path)
        _log_breakdown(_seed)
        return _seed
    logger.error(
        "theme_seed: no seed file found (tried %s); running Haiku-only",
        ", ".join(str(p) for p in _SEED_CANDIDATES),
    )
    _seed = {}
    return _seed


def lookup(title: str, original_title: Optional[str]) -> Optional[dict]:
    """Return the seed entry for a film, or None when absent / confidence 'unknown'.

    Tries an exact match on ``title`` first, then ``original_title`` (both stripped).
    Only entries whose confidence is high/medium/low are returned; 'unknown' (composer
    and theme are null) yields None so the caller falls through to Haiku.
    """
    seed = load_seed()
    if not seed:
        return None
    for candidate in (title, original_title):
        if not candidate:
            continue
        entry = seed.get(candidate.strip())
        if isinstance(entry, dict) and str(entry.get("confidence") or "").strip().lower() in _USABLE_CONFIDENCE:
            return entry
    return None


def seed_size() -> int:
    """Number of entries in the loaded seed (0 if none loaded)."""
    return len(load_seed())


def seed_path() -> Optional[str]:
    """The candidate path the seed loaded from, or None if no seed was found."""
    load_seed()
    return _seed_source


def is_loaded() -> bool:
    """True when a non-empty seed is loaded."""
    return bool(load_seed())


# Prime the cache (and emit the load log) once at import time.
load_seed()
