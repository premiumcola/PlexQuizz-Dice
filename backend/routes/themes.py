"""Film-music theme enrichment API: build the theme cache, list quiz-eligible movies."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

import theme_enrichment

bp = Blueprint("themes", __name__, url_prefix="/api/themes")


@bp.post("/enrich")
def enrich():
    """Enrich up to ``limit`` not-yet-cached movies (default: all). Returns the summary."""
    body = request.get_json(silent=True) or {}
    raw = body.get("limit")
    limit = int(raw) if isinstance(raw, (int, float)) and not isinstance(raw, bool) else None
    summary = theme_enrichment.run_enrichment(limit)
    return jsonify(summary)


@bp.get("/eligible")
def eligible():
    """Ids (and count) of cached movies that have a streamable preview."""
    ids = theme_enrichment.list_eligible()
    return jsonify({"count": len(ids), "ids": ids})
