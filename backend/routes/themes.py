"""Film-music theme enrichment API: run background batches, report status, list eligible."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

import theme_enrichment

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
