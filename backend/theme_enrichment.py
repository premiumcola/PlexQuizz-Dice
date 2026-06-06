"""Main-theme enrichment for the film-music quiz.

For every movie we ask Claude Haiku to name its single most iconic main-title score
cue (composer + track title), then locate a free, streamable 30-second preview on the
public iTunes Search API. Matches are cached in ``data/theme_cache.json``.

Only Apple's ``previewUrl`` is stored and streamed at runtime — no audio is ever
downloaded or persisted.

This module is intentionally self-contained: it reads ``data/library_cache.json``
directly and never imports ``services``. Importing ``services`` would re-run the app's
boot-time side effects (some of which rewrite ``library_cache.json``), so keeping this
module decoupled lets a standalone enrichment run — e.g. the validation script — touch
*only* ``theme_cache.json`` and leave every protected data file byte-identical.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

import net_setup
from atomic_io import atomic_write_json

logger = logging.getLogger(__name__)

# Mirrors services.DATA_DIR without importing it (see module docstring).
DATA_DIR = os.environ.get("DATA_DIR", "/data")
_LIBRARY_PATH = os.path.join(DATA_DIR, "library_cache.json")
_THEME_PATH = os.path.join(DATA_DIR, "theme_cache.json")

_MODEL = "claude-haiku-4-5-20251001"
_TEMPERATURE = 0.7
_MAX_TOKENS = 200

# Public iTunes Search API — no key, no auth. Apple asks for <= ~20 req/min, so we
# space calls at least _ITUNES_MIN_INTERVAL apart (~18.75/min worst case).
_ITUNES_ENDPOINT = "https://itunes.apple.com/search"
_ITUNES_MIN_INTERVAL = 3.2
_HTTP_TIMEOUT = 15

# Outbound hosts that must resolve even when the container's :53 DNS is blocked.
_NET_HOSTS = ("api.anthropic.com", "itunes.apple.com")

_write_lock = threading.Lock()
_itunes_lock = threading.Lock()
_last_itunes_call = 0.0
_dns_ready = False
_anthropic_client: Any = None

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)

_THEME_PROMPT = (
    "You are a film-music expert. Identify the single most iconic main theme / "
    "main-title score cue of the film below — the piece a film-music quiz would play.\n"
    "Respond with STRICT JSON ONLY. No prose, no markdown fences. Exactly this shape:\n"
    '{{"composer": "<composer full name>", "theme_title": "<canonical cue/track title>", '
    '"confidence": "high|medium|low"}}\n'
    "Use the track title as released on official soundtrack albums. If you are unsure who "
    'composed it, or the film has no distinctive recurring theme, set confidence to "low".\n\n'
    "Film: {title}{year}"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dns() -> None:
    """Seed DoH /etc/hosts entries for the enrichment hosts once per process."""
    global _dns_ready
    if _dns_ready:
        return
    try:
        net_setup.ensure_dns(_NET_HOSTS)
    except Exception as exc:  # noqa: BLE001 — DNS hardening is best-effort
        logger.warning("Theme DNS seeding skipped: %s", exc)
    _dns_ready = True


def _get_client() -> Any:
    """Lazily build the Anthropic client (import deferred so the module loads w/o the SDK)."""
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic  # local import: keeps this module importable without the SDK

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _ensure_dns()
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


def _parse_theme_json(text: str) -> Optional[Dict[str, str]]:
    """Parse Haiku's reply into a theme dict, tolerating fences and stray prose."""
    if not text:
        return None
    cleaned = _FENCE_RE.sub("", text.strip()).strip()
    if not cleaned.startswith("{"):
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            return None
        cleaned = cleaned[start : end + 1]
    try:
        data = json.loads(cleaned)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    confidence = str(data.get("confidence") or "low").strip().lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"
    return {
        "composer": str(data.get("composer") or "").strip(),
        "theme_title": str(data.get("theme_title") or "").strip(),
        "confidence": confidence,
    }


def get_theme_suggestion(title: str, year: int | None) -> dict:
    """Ask Haiku for a film's canonical main-theme composer + track title.

    Returns ``{"composer", "theme_title", "confidence"}``. A successful call that finds
    no nameable theme returns empty strings (a genuine "no theme" verdict). A transport
    or credential failure PROPAGATES so callers can skip the film and retry it later,
    rather than caching a permanent miss.
    """
    empty = {"composer": "", "theme_title": "", "confidence": "low"}
    if not title:
        return empty
    year_part = f" ({year})" if year else ""
    prompt = _THEME_PROMPT.format(title=title, year=year_part)
    resp = _get_client().messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        temperature=_TEMPERATURE,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(
        getattr(block, "text", "")
        for block in resp.content
        if getattr(block, "type", None) == "text"
    )
    return _parse_theme_json(text) or empty


def _surname(composer: str) -> str:
    parts = composer.replace(".", " ").split()
    return parts[-1].lower() if parts else ""


def _throttle_itunes() -> None:
    """Block until at least _ITUNES_MIN_INTERVAL has elapsed since the last iTunes call."""
    global _last_itunes_call
    with _itunes_lock:
        wait = _ITUNES_MIN_INTERVAL - (time.monotonic() - _last_itunes_call)
        if wait > 0:
            time.sleep(wait)
        _last_itunes_call = time.monotonic()


def search_itunes_preview(composer: str, theme_title: str, country: str = "DE") -> dict | None:
    """Find the best free, playable 30s preview for a film theme on the iTunes Search API.

    Returns the chosen track's fields (incl. ``preview_url`` and a 0..1 ``match_score``),
    or ``None`` when nothing has a usable preview that plausibly matches the composer/theme.
    """
    if not theme_title and not composer:
        return None
    _ensure_dns()
    term = f"{composer} {theme_title}".strip()
    _throttle_itunes()
    try:
        resp = requests.get(
            _ITUNES_ENDPOINT,
            params={
                "term": term,
                "media": "music",
                "entity": "song",
                "limit": 5,
                "country": country,
            },
            timeout=_HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
    except (requests.RequestException, ValueError) as exc:
        logger.warning("iTunes search failed for %r: %s", term, exc)
        return None

    surname = _surname(composer)
    keywords = [w for w in re.split(r"\W+", theme_title.lower()) if len(w) > 2]
    best: Optional[dict] = None
    best_score = 0.0
    for item in results:
        if not item.get("previewUrl"):
            continue
        artist = (item.get("artistName") or "").lower()
        track = (item.get("trackName") or "").lower()
        score = 0.0
        if surname and surname in artist:
            score += 0.6
        if keywords:
            score += 0.4 * (sum(1 for k in keywords if k in track) / len(keywords))
        if score <= 0.0:  # matches neither composer nor theme keywords → not usable
            continue
        if score > best_score:
            best, best_score = item, score
    if best is None:
        return None
    return {
        "track_name": best.get("trackName"),
        "artist_name": best.get("artistName"),
        "collection_name": best.get("collectionName"),
        "preview_url": best.get("previewUrl"),
        "artwork_url": best.get("artworkUrl100"),
        "itunes_track_id": best.get("trackId"),
        "track_view_url": best.get("trackViewUrl"),
        "match_score": round(best_score, 3),
    }


def _blank_entry(title: str, year: Optional[int]) -> dict:
    """An ineligible cache entry — marks a movie processed so batches converge."""
    return {
        "title": title,
        "year": year,
        "composer": "",
        "theme_title": "",
        "confidence": "low",
        "track_name": None,
        "artist_name": None,
        "collection_name": None,
        "preview_url": None,
        "artwork_url": None,
        "itunes_track_id": None,
        "track_view_url": None,
        "match_score": 0.0,
        "eligible": False,
        "enriched_at": _now_iso(),
    }


def enrich_movie(movie: dict) -> dict | None:
    """Identify a movie's main theme and attach a streamable iTunes preview.

    Returns a ``theme_cache`` entry (``eligible=True`` only when a ``preview_url`` was
    found, else ``eligible=False`` for skip-tracking). Returns ``None`` — meaning "leave
    uncached, retry later" — when the movie has no usable title or the theme lookup
    failed (e.g. the model was unreachable), so a transient outage never poisons the
    cache with permanent misses.
    """
    title = str(movie.get("title") or "").strip()
    if not title:
        return None
    raw_year = movie.get("year")
    year = int(raw_year) if isinstance(raw_year, (int, float)) and raw_year else None
    try:
        suggestion = get_theme_suggestion(title, year)
    except Exception as exc:  # noqa: BLE001 — model/credential outage: skip, retry later
        logger.warning("Theme suggestion unavailable for %r: %s", title, exc)
        return None
    entry = _blank_entry(title, year)
    entry["composer"] = suggestion["composer"]
    entry["theme_title"] = suggestion["theme_title"]
    entry["confidence"] = suggestion["confidence"]
    if suggestion["composer"] or suggestion["theme_title"]:
        preview = search_itunes_preview(suggestion["composer"], suggestion["theme_title"])
        if preview:
            entry.update(preview)
            entry["eligible"] = bool(preview.get("preview_url"))
    return entry


# ---- Cache + library helpers (direct file access; no services singletons) ----

def _stable_id(movie: dict) -> Optional[str]:
    """The same stable movie id used everywhere else (LibraryCache keys on ``key``)."""
    key = movie.get("key")
    return str(key) if key not in (None, "") else None


def _load_movies() -> List[Dict[str, Any]]:
    try:
        with open(_LIBRARY_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not read library cache at %s: %s", _LIBRARY_PATH, exc)
        return []
    movies = data.get("movies", []) if isinstance(data, dict) else []
    return [m for m in movies if isinstance(m, dict)]


def load_theme_cache() -> Dict[str, Any]:
    try:
        with open(_THEME_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _store_entry(movie_id: str, entry: dict) -> int:
    """Additively merge one entry into theme_cache.json; return the new total count.

    Reloads under the lock and uses setdefault semantics so concurrent writers (or the
    live app) never lose entries, and an already-present id is never overwritten.
    """
    with _write_lock:
        cache = load_theme_cache()
        cache.setdefault(movie_id, entry)
        atomic_write_json(_THEME_PATH, cache, ensure_ascii=False)
        return len(cache)


def list_eligible() -> List[str]:
    """Ids of cached movies that have a streamable preview (eligible for the quiz)."""
    cache = load_theme_cache()
    return [mid for mid, e in cache.items() if isinstance(e, dict) and e.get("preview_url")]


def _partition_uncached(
    movies: List[Dict[str, Any]], cache: Dict[str, Any]
) -> Tuple[List[Dict[str, Any]], int]:
    """Split movies into (not-yet-cached list, already-cached count) by stable id."""
    uncached: List[Dict[str, Any]] = []
    already = 0
    for movie in movies:
        movie_id = _stable_id(movie)
        if not movie_id:
            continue
        if movie_id in cache:
            already += 1
        else:
            uncached.append(movie)
    return uncached, already


def run_enrichment(limit: int | None = None) -> dict:
    """Enrich up to ``limit`` not-yet-cached movies, additively into theme_cache.json.

    Sequential, synchronous pass. Movies already in the cache are skipped; movies whose
    theme lookup fails are left uncached (retried by a later run). Returns a summary
    dict and writes ONLY theme_cache.json (never the protected data files).
    """
    movies = _load_movies()
    cache = load_theme_cache()
    uncached, already_cached = _partition_uncached(movies, cache)
    batch = uncached if limit is None else uncached[: max(0, limit)]
    logger.info("Theme enrichment: %d movies, enriching %d (already cached %d)",
                len(movies), len(batch), already_cached)

    processed = 0
    matched = 0
    total = len(cache)
    for movie in batch:
        movie_id = _stable_id(movie)
        entry = None
        try:
            entry = enrich_movie(movie)
        except Exception as exc:  # noqa: BLE001 — one bad film must not abort the batch
            logger.warning("Enrichment failed for id=%s: %s", movie_id, exc)
        processed += 1
        if entry is None:
            continue  # transient failure: leave uncached so a later run retries it
        total = _store_entry(movie_id, entry)
        if entry.get("eligible"):
            matched += 1

    return {
        "processed": processed,
        "matched": matched,
        "skipped_no_match": processed - matched,
        "already_cached": already_cached,
        "total_in_cache": total,
    }
