"""End-of-round Auflösung (solutions) for the general quiz — GET /api/quiz/<round_id>/solutions.

Served ONLY once the round is over (all resolved, or explicitly ended/abandoned); a 409 while
still in active play keeps it from being used to peek at answers mid-round (the HARD RULE).
Reuses the quiz blueprint's session/history singletons + the library thumb proxy for covers.
"""
from __future__ import annotations

from typing import Any, Optional

from flask import Blueprint, jsonify

from quiz.routes import history, sessions
from services import library_cache

bp = Blueprint("quiz_solutions", __name__, url_prefix="/api/quiz")


def _solution(mode: Optional[str], movie_key: Any, title: Optional[str],
              year: Any, first_try: bool) -> dict:
    """One Auflösung row: the correct answer + cover/deep-link (cover via the thumb proxy)."""
    movie = library_cache.find(str(movie_key)) if movie_key else None
    return {
        "mode": mode,
        "correct": bool(first_try),
        "title": title or (movie.get("title") if movie else None) or "",
        "year": year if year is not None else (movie.get("year") if movie else None),
        "cover_url": f"/api/library/thumb/{movie_key}" if movie_key else None,
        "plex_url": movie.get("plex_url") if movie else None,
    }


@bp.get("/<round_id>/solutions")
def round_solutions(round_id: str):
    """Every question's correct answer in play order — gated on the round being over."""
    session = sessions.get(round_id)
    if session is not None:
        if not session.is_over():
            return jsonify({"error": "Runde läuft noch"}), 409
        sols = [
            _solution(
                q["mode"], q.get("movie_key"), q.get("movie_title"), q.get("movie_year"),
                session.status.get(q["id"], {}).get("first_try_correct", False),
            )
            for q in session.questions
        ]
        return jsonify({"solutions": sols})
    record = history.get_round(round_id)
    if record:
        sols = [
            _solution(
                q.get("mode"), q.get("movie_key"), q.get("movie_title"), q.get("movie_year"),
                q.get("first_try_correct", q.get("correct", False)),
            )
            for q in record.get("questions", [])
        ]
        return jsonify({"solutions": sols})
    return jsonify({"error": "round not found"}), 404
