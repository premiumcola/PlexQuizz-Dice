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
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Resolved relative to this module so it works regardless of the process CWD.
_SEED_PATH = Path(__file__).parent / "data" / "theme_seed.json"
_USABLE_CONFIDENCE = {"high", "medium", "low"}

# Cached once after the first load() (also primed at import time, see bottom).
_seed: Optional[Dict[str, dict]] = None


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
    """Load the theme seed once and cache it module-level.

    Returns an empty dict (never raises) when the file is missing or malformed, so a
    missing seed simply degrades to the Haiku-only path.
    """
    global _seed
    if _seed is not None:
        return _seed
    try:
        with _SEED_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        logger.error("theme_seed: file not found at %s; running Haiku-only", _SEED_PATH)
        _seed = {}
        return _seed
    except json.JSONDecodeError as exc:
        logger.error("theme_seed: could not parse %s: %s; running Haiku-only", _SEED_PATH, exc)
        _seed = {}
        return _seed
    _seed = data if isinstance(data, dict) else {}
    _log_breakdown(_seed)
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


# Prime the cache (and emit the load log) once at import time.
load_seed()
