"""Film-music theme enrichment API: run background batches, report status, list eligible."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

import theme_enrichment
import theme_quiz

bp = Blueprint("themes", __name__, url_prefix="/api/themes")


@bp.post("/enrich")
def enrich():
    """Start a background batch of ``count`` random uncached movies (default 200)."""
    body = request.get_json(silent=True) or {}
    raw = body.get("count", 200)
    count = int(raw) if isinstance(raw, (int, float)) and not isinstance(raw, bool) else 200
    result = theme_enrichment.start_enrichment_batch(count)
    return jsonify(result)


@bp.get("/status")
def status():
    """Live progress of the running/last batch, merged with library + cache totals."""
    return jsonify(theme_enrichment.get_status())


@bp.get("/eligible")
def eligible():
    """Ids (and count) of cached movies that have a streamable preview."""
    ids = theme_enrichment.list_eligible()
    return jsonify({"count": len(ids), "ids": ids})


@bp.get("/question")
def question():
    """A sound question: {question_id, preview_url, difficulty}. Leaks NO answer text."""
    difficulty = (request.args.get("difficulty") or "medium").strip().lower()
    payload = theme_quiz.new_question(difficulty)
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
