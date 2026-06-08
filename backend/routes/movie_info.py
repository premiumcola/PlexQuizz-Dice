"""Keyless movie-info endpoint: metadata facts + Wikipedia synopsis, cached 24h."""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict

from flask import Blueprint, jsonify, request

import movie_info
from atomic_io import atomic_write_json, read_json
from services import DATA_DIR, library_cache

bp = Blueprint("movie_info", __name__, url_prefix="/api/movie")

_CACHE_PATH = os.path.join(DATA_DIR, "movie_info_cache.json")
_TTL_SECONDS = 24 * 3600
_lock = threading.Lock()


def _load() -> Dict[str, Any]:
    return read_json(_CACHE_PATH, {})


def _save(cache: Dict[str, Any]) -> None:
    atomic_write_json(_CACHE_PATH, cache, ensure_ascii=False)


def clear_cache() -> int:
    """Empty the movie-info (AI-plot) cache; returns how many entries were removed."""
    with _lock:
        count = len(_load())
        _save({})
    return count


@bp.post("/info")
def info():
    body = request.get_json(silent=True) or {}
    key = str(body.get("key") or "")
    movie = library_cache.find(key)
    if not movie:
        return jsonify({"error": "movie not found"}), 404
    force = bool(body.get("force"))

    if not force:
        with _lock:
            entry = _load().get(key)
        if entry and (time.time() - entry.get("ts", 0)) < _TTL_SECONDS:
            return jsonify(entry["data"])

    data = movie_info.gather(movie)
    with _lock:
        cache = _load()
        cache[key] = {"ts": time.time(), "data": data}
        _save(cache)
    return jsonify(data)
