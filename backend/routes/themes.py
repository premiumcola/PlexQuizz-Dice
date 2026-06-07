"""Film-music theme enrichment API: run background batches, report status, list eligible."""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

import quiz_hints
import theme_enrichment
import theme_quiz
from routes.library import thumb as _library_thumb

bp = Blueprint("themes", __name__, url_prefix="/api/themes")


def _parse_filters() -> Optional[Dict[str, Any]]:
    """Decode the optional ?filters=<json> dice-style pre-filter (None when absent/invalid)."""
    raw = request.args.get("filters")
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) and data else None


@bp.post("/enrich")
def enrich():
    """Start a background batch of ``count`` random uncached movies (default 200; "all" = the lot)."""
    body = request.get_json(silent=True) or {}
    raw = body.get("count", 200)
    if raw == "all" or (isinstance(raw, (int, float)) and not isinstance(raw, bool) and raw <= 0):
        count: object = "all"
    elif isinstance(raw, (int, float)) and not isinstance(raw, bool):
        count = int(raw)
    else:
        count = 200
    result = theme_enrichment.start_enrichment_batch(count)
    return jsonify(result)


@bp.get("/status")
def status():
    """Live progress of the running/last batch, merged with library + cache totals."""
    return jsonify(theme_enrichment.get_status())


@bp.get("/sample")
def sample():
    """A random eligible theme (preview + title/composer) to hear in Settings. 404 if none."""
    result = theme_enrichment.random_sample()
    if result is None:
        return jsonify({"error": "Keine Hörprobe vorhanden"}), 404
    return jsonify(result)


@bp.post("/retry-previews")
def retry_previews():
    """POST /api/themes/retry-previews — keyless: re-run iTunes only for identified
    themes that still lack a preview_url (fills missing previews, never overwrites)."""
    body = request.get_json(silent=True) or {}
    raw = body.get("count", 200)
    count = int(raw) if isinstance(raw, (int, float)) and not isinstance(raw, bool) else 200
    return jsonify(theme_enrichment.start_preview_retry(count))


@bp.get("/eligible")
def eligible():
    """Ids (and count) of cached movies with a streamable preview, optionally pre-filtered."""
    ids = theme_quiz.eligible_ids(_parse_filters())
    return jsonify({"count": len(ids), "ids": ids})


@bp.get("/question")
def question():
    """A sound question: {question_id, preview_url, difficulty}. Leaks NO answer text."""
    difficulty = (request.args.get("difficulty") or "medium").strip().lower()
    payload = theme_quiz.new_question(difficulty, _parse_filters())
    if payload is None:
        return jsonify({"error": "Keine Film-Themes verfügbar"}), 404
    return jsonify(payload)


@bp.post("/score")
def score():
    """Live match meter for a typed guess: {score, accepted}. Never returns answer text."""
    body = request.get_json(silent=True) or {}
    result = theme_quiz.score_guess(str(body.get("question_id") or ""), str(body.get("guess") or ""))
    if result is None:
        return jsonify({"error": "Frage abgelaufen"}), 404
    return jsonify(result)


@bp.post("/answer")
def answer():
    """Final answer: {correct} plus 'reveal' ONLY when correct (HARD RULE, server-side)."""
    body = request.get_json(silent=True) or {}
    result = theme_quiz.answer(str(body.get("question_id") or ""), str(body.get("guess") or ""))
    if result is None:
        return jsonify({"error": "Frage abgelaufen"}), 404
    return jsonify(result)


@bp.get("/cover/<question_id>")
def cover(question_id: str):
    """Token-hidden poster for the blurred-cover hint, keyed by question id (the answer key never
    appears in the URL). The frontend renders it heavily blurred during the hint flow."""
    movie_id = theme_quiz.cover_movie_id(question_id)
    if not movie_id:
        return jsonify({"error": "Frage abgelaufen"}), 404
    return _library_thumb(str(movie_id))


@bp.post("/reveal")
def reveal():
    """POST /api/themes/reveal — the correct title+cover for a question (END-OF-ROUND Auflösung).

    The client calls this only when assembling the post-round overview for a MISSED question;
    the in-play question UI never shows it (the mid-play HARD RULE). 404 if expired."""
    body = request.get_json(silent=True) or {}
    payload = theme_quiz.reveal(str(body.get("question_id") or ""))
    if payload is None:
        return jsonify({"error": "Frage abgelaufen"}), 404
    return jsonify({"reveal": payload})


@bp.post("/hint")
def hint():
    """POST /api/themes/hint — progressive letter hint for the question's primary title.

    Returns {length, revealed:[{index,char}]}; never the full title as one field."""
    body = request.get_json(silent=True) or {}
    target = theme_quiz.primary_target(str(body.get("question_id") or ""))
    if not target:
        return jsonify({"error": "Frage abgelaufen"}), 404
    level = body.get("level", 1)
    level = int(level) if isinstance(level, (int, float)) and not isinstance(level, bool) else 1
    return jsonify(quiz_hints.reveal_letters(target, max(0, level)))
