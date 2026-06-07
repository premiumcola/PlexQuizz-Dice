"""Shared movie pre-filter for quiz round building — mirrors the dice ("Würfel") filter.

The dice page narrows the library client-side by genre, year, runtime, FSK, rating and seen/unseen;
the quiz reuses the SAME criteria so a round can be restricted before it starts. Every criteria key
is optional — an absent key leaves that dimension unrestricted (a no-op), exactly like an inactive
dice filter stage. Missing movie values pass (matches the dice ``!m.y || …`` predicates).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _genres_match(movie: Dict[str, Any], groups: List[List[str]]) -> bool:
    """OR of AND-groups: match when ANY group's every genre is on the movie."""
    active = [g for g in groups if g]
    if not active:
        return True
    movie_genres = set(movie.get("genres") or [])
    return any(all(g in movie_genres for g in grp) for grp in active)


def _in_range(value: Optional[float], lo: Optional[float], hi: Optional[float]) -> bool:
    """Inclusive range check; a missing (None) value passes (mirrors the dice predicates)."""
    if value is None:
        return True
    if lo is not None and value < lo:
        return False
    if hi is not None and value > hi:
        return False
    return True


def matches(movie: Dict[str, Any], criteria: Dict[str, Any]) -> bool:
    """True if a library movie dict satisfies the (partial) filter criteria."""
    if not criteria:
        return True
    if "genres" in criteria and not _genres_match(movie, criteria.get("genres") or []):
        return False
    if not _in_range(movie.get("year"), criteria.get("year_min"), criteria.get("year_max")):
        return False
    if not _in_range(movie.get("duration_min"), criteria.get("runtime_min"), criteria.get("runtime_max")):
        return False
    if not _in_range(movie.get("fsk"), criteria.get("fsk_min"), criteria.get("fsk_max")):
        return False
    if not _in_range(movie.get("rating"), criteria.get("rating_min"), criteria.get("rating_max")):
        return False
    watched = criteria.get("watched")
    if watched in ("seen", "unseen"):
        seen = (movie.get("view_count") or 0) > 0
        if watched == "seen" and not seen:
            return False
        if watched == "unseen" and seen:
            return False
    return True


def apply_filters(
    movies: List[Dict[str, Any]], criteria: Optional[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Return only the movies matching the criteria (the full list when no criteria are given)."""
    if not criteria:
        return list(movies)
    return [m for m in movies if matches(m, criteria)]


def year_ok(year: Optional[int], criteria: Optional[Dict[str, Any]]) -> bool:
    """Year-only check for pools without rich metadata (e.g. TV series)."""
    if not criteria:
        return True
    return _in_range(year, criteria.get("year_min"), criteria.get("year_max"))
