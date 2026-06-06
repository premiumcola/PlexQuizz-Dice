"""In-memory question store + scoring for the audio Film-Theme quiz (L3 + L4).

A question is created from a random eligible movie (one with a cached iTunes preview),
stored under a short-lived id (30-min TTL), and answered by free text checked with the
shared fuzzy matcher. The HARD RULE is enforced HERE, server-side: the reveal payload is
returned ONLY for a correct answer; a wrong guess never receives any answer-identifying
text. The public question payload likewise leaks no title/composer/theme text.
"""
from __future__ import annotations

import logging
import random
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import fuzzy_match
import theme_enrichment
from services import library_cache

logger = logging.getLogger(__name__)

_TTL_SECONDS = 30 * 60
_THEME_TIER = 2  # medium — drives the 3-bar DifficultyIcon in the UI

_questions: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


def _evict_expired() -> None:
    """Drop questions older than the TTL. Caller must hold _lock."""
    cutoff = _now_ts() - _TTL_SECONDS
    for qid in [qid for qid, q in _questions.items() if q["created_at"] < cutoff]:
        _questions.pop(qid, None)


def _spotify_search_url(track_name: Optional[str], artist_name: Optional[str]) -> str:
    terms = " ".join(t for t in (track_name, artist_name) if t).strip()
    return "https://open.spotify.com/search/" + quote(terms)


def _build_reveal(movie_id: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    """Reveal payload shown ONLY on a correct answer. plex_url reuses the stored deep-link."""
    movie = library_cache.find(movie_id) or {}
    return {
        "title": movie.get("title") or entry.get("title") or "",
        "composer": entry.get("composer") or "",
        "theme_title": entry.get("theme_title") or "",
        "apple_url": entry.get("track_view_url"),
        "spotify_url": _spotify_search_url(entry.get("track_name"), entry.get("artist_name")),
        "plex_url": movie.get("plex_url"),
        # Extra fields let the frontend reuse the existing plexAppUrl() native-link builder.
        "machineIdentifier": movie.get("machineIdentifier"),
        "ratingKey": movie.get("ratingKey") or movie_id,
    }


def _acceptable_titles(movie_id: str, entry: Dict[str, Any]) -> List[str]:
    """Titles a guess may match against (display + original title), de-duplicated."""
    movie = library_cache.find(movie_id) or {}
    seen: set = set()
    out: List[str] = []
    for raw in (movie.get("title"), movie.get("originalTitle"), entry.get("title")):
        title = (raw or "").strip()
        if title and title.lower() not in seen:
            seen.add(title.lower())
            out.append(title)
    return out


def new_question(difficulty: str = "medium") -> Optional[Dict[str, Any]]:
    """Create a question from a random eligible movie; None when none are eligible."""
    cache = theme_enrichment.load_theme_cache()
    eligible = [(mid, e) for mid, e in cache.items()
                if isinstance(e, dict) and e.get("preview_url")]
    if not eligible:
        return None
    movie_id, entry = random.choice(eligible)
    qid = uuid.uuid4().hex
    with _lock:
        _evict_expired()
        _questions[qid] = {
            "correct_movie_id": movie_id,
            "targets": _acceptable_titles(movie_id, entry),
            "reveal": _build_reveal(movie_id, entry),
            "difficulty": (difficulty or "medium").strip().lower(),
            "created_at": _now_ts(),
        }
    return {
        "question_id": qid,
        "preview_url": entry.get("preview_url"),
        "difficulty": _THEME_TIER,
    }


def _best_score(question: Dict[str, Any], guess: str) -> float:
    return max((fuzzy_match.similarity(guess, t) for t in question["targets"]), default=0.0)


def _get(question_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        _evict_expired()
        question = _questions.get(question_id)
        return dict(question) if question is not None else None


def score_guess(question_id: str, guess: str) -> Optional[Dict[str, Any]]:
    """Live match meter: {score 0..1, accepted}. None if the question is unknown/expired.

    Returns NO answer text — safe to call on every keystroke.
    """
    question = _get(question_id)
    if question is None:
        return None
    score = _best_score(question, guess or "")
    accepted = score >= fuzzy_match.threshold_for(question["difficulty"])
    return {"score": round(score, 3), "accepted": accepted}


def answer(question_id: str, guess: str) -> Optional[Dict[str, Any]]:
    """Final answer. Returns {correct} plus 'reveal' ONLY when correct. None if unknown.

    HARD RULE: a wrong guess never gets a reveal object.
    """
    question = _get(question_id)
    if question is None:
        return None
    score = _best_score(question, guess or "")
    if score < fuzzy_match.threshold_for(question["difficulty"]):
        return {"correct": False}
    return {"correct": True, "reveal": question["reveal"]}


def eligible_count() -> int:
    """Number of movies eligible for the theme quiz (have a streamable preview)."""
    return len(theme_enrichment.list_eligible())
