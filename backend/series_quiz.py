"""Server-side scoring + reveal for the TV-series theme quiz (T2.1).

Stateless by ratingKey: the client picks a series from /api/series/eligible, plays its theme,
and submits a typed guess. Correctness is decided HERE using the shared L4 fuzzy matcher
(imported, never re-implemented). The reveal payload — Plex + IMDB links + poster — is
returned ONLY for a correct guess (HARD RULE); a wrong guess gets {"correct": False} alone.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional
from urllib.parse import quote

import fuzzy_match
import series_cache

logger = logging.getLogger(__name__)

_IMDB_RE = re.compile(r"(tt\d{6,})", re.IGNORECASE)
_PLEX_GUID_RE = re.compile(r"plex://[^/]+/([0-9a-fA-F]+)")


def _find_show(rating_key: int) -> Optional[Dict[str, Any]]:
    for show in series_cache.load_cache().get("shows", []):
        if show.get("ratingKey") == rating_key:
            return show
    return None


def _imdb_url(guid: Optional[str], title: str) -> str:
    """An IMDb link from an imdb id in the guid, else an IMDb title search."""
    if guid:
        m = _IMDB_RE.search(guid)
        if m:
            return f"https://www.imdb.com/title/{m.group(1)}/"
    return "https://www.imdb.com/find?q=" + quote(title or "")


def _plex_url(show: Dict[str, Any]) -> str:
    """A watch.plex.tv Discover details link, keyed by the show's Plex Discover id."""
    guid = show.get("guid") or ""
    m = _PLEX_GUID_RE.search(guid)
    discover_id = m.group(1) if m else show.get("ratingKey")
    return "https://watch.plex.tv/details?key=" + quote(f"/library/metadata/{discover_id}", safe="")


def _reveal(show: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": show.get("title") or "",
        "year": show.get("year"),
        "plex_url": _plex_url(show),
        "imdb_url": _imdb_url(show.get("guid"), show.get("title") or ""),
        "poster_url": f"/api/series/thumb/{show.get('ratingKey')}" if show.get("thumb") else None,
    }


def title_for(rating_key: int) -> Optional[str]:
    """The show's title (for letter hints). None if the show is unknown."""
    show = _find_show(rating_key)
    return show.get("title") if show else None


def score(rating_key: int, guess: str) -> Optional[Dict[str, Any]]:
    """Live meter: {score 0-100, accepted}. None if the show is unknown. No answer text."""
    show = _find_show(rating_key)
    if show is None:
        return None
    sim = fuzzy_match.similarity(guess or "", show.get("title") or "")
    return {"score": round(sim * 100), "accepted": sim >= fuzzy_match.DEFAULT_THRESHOLD}


def answer(rating_key: int, guess: str) -> Optional[Dict[str, Any]]:
    """Final answer: {correct} plus 'reveal' ONLY when correct. None if the show is unknown."""
    show = _find_show(rating_key)
    if show is None:
        return None
    sim = fuzzy_match.similarity(guess or "", show.get("title") or "")
    if sim < fuzzy_match.DEFAULT_THRESHOLD:
        return {"correct": False}
    return {"correct": True, "reveal": _reveal(show)}
