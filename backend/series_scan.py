"""Enumerate TV shows across the Plex TV libraries and record theme-music coverage.

Backend only. Every show — themed or not — is returned so the cache can serve both the
quiz pool (has_theme) and the coverage report (the missing list). Plex caches each show's
~30s theme locally and streams it over the LAN; no Anthropic / iTunes calls here.

The Plex token is read elsewhere (the caller passes a connected server) and is NEVER
returned or logged in clear text by this module.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _show_entry(show: Any) -> Dict[str, Any]:
    """Map a plexapi Show to a flat, JSON-safe dict (themed or not)."""
    theme_path = getattr(show, "theme", None) or None
    rating_key = getattr(show, "ratingKey", None)
    return {
        "title": getattr(show, "title", "") or "",
        "year": getattr(show, "year", None),
        "ratingKey": int(rating_key) if rating_key is not None else None,
        "guid": getattr(show, "guid", None),
        "thumb": getattr(show, "thumb", None),
        "art": getattr(show, "art", None),  # wide backdrop for the blurred fanart hint
        "theme_path": theme_path,
        "has_theme": bool(theme_path),
    }


def tv_section_ids(plex_server: Any) -> List[int]:
    """Return the section ids of every 'show'-type library on the server."""
    ids: List[int] = []
    for section in plex_server.library.sections():
        if getattr(section, "type", None) == "show":
            try:
                ids.append(int(getattr(section, "key")))
            except (TypeError, ValueError):
                continue
    return ids


def scan_series(plex_server: Any, selected_section_ids: List[int]) -> List[Dict[str, Any]]:
    """Return one dict per show across the given TV section ids.

    Only 'show'-type sections are scanned. Each entry carries ``has_theme`` + ``theme_path``
    so the cache feeds both the eligible quiz pool and the coverage (missing) report.
    """
    wanted = {int(s) for s in selected_section_ids} if selected_section_ids else None
    entries: List[Dict[str, Any]] = []
    for section in plex_server.library.sections():
        if getattr(section, "type", None) != "show":
            continue
        try:
            sid = int(getattr(section, "key", -1))
        except (TypeError, ValueError):
            sid = -1
        if wanted is not None and sid not in wanted:
            continue
        try:
            shows = section.all()
        except Exception as exc:  # noqa: BLE001 — one bad section must not abort the scan
            logger.warning("Series scan: section %s listing failed: %s", sid, exc)
            continue
        themed = 0
        for show in shows:
            if getattr(show, "type", "show") != "show":
                continue
            entry = _show_entry(show)
            if entry["ratingKey"] is None:
                continue
            themed += 1 if entry["has_theme"] else 0
            entries.append(entry)
        logger.info("Series scan: section %s -> %d shows (%d themed)", sid, len(shows), themed)
    return entries
