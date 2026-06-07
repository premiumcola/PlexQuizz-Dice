"""TV-series theme quiz API: coverage scan, eligible pool, and token-hidden media proxies.

Endpoints (Blueprint url_prefix /api/series):
  GET  /api/series/eligible       - shows WITH a theme (the quiz pool)
  GET  /api/series/coverage       - stats + the list of shows WITHOUT a theme
  GET  /api/series/theme/<rk>     - streams the theme audio (token hidden)
  GET  /api/series/thumb/<rk>     - proxies the show poster (token hidden)
  POST /api/series/score          - live match meter for a typed guess {score, accepted}
  POST /api/series/answer         - final answer {correct} + reveal ONLY when correct
  POST /api/series/rescan         - trigger a background rescan

The Plex token stays server-side: it is attached as a query param to upstream Plex
requests and never appears in any response body, header, or log line (redacted to '****').
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests
from flask import Blueprint, Response, jsonify, request, stream_with_context

import series_cache
import series_quiz
import series_scan
from services import plex_client, settings_store

logger = logging.getLogger(__name__)
bp = Blueprint("series", __name__, url_prefix="/api/series")

_PROXY_TIMEOUT = 20
_STALE_HOURS = 24

_scan_lock = threading.Lock()
_scanning = False


def _redact(text: str, token: str) -> str:
    return text.replace(token, "****") if token else text


def _plex_base_token():
    """Return (base_url, token, plex_settings). Prefer the manual LAN URL when set."""
    plex = settings_store.get("plex")
    base = (plex.get("plex_server_url") or plex.get("url") or "").rstrip("/")
    return base, plex.get("token") or "", plex


def _run_scan() -> None:
    global _scanning
    token = ""
    try:
        _, token, plex = _plex_base_token()
        if not token:
            logger.warning("Series scan skipped: Plex not configured")
            return
        server = plex_client.connect_from_settings(plex, timeout=30)
        entries = series_scan.scan_series(server, series_scan.tv_section_ids(server))
        series_cache.write_cache(entries)
        total = len(entries)
        themed = sum(1 for e in entries if e.get("has_theme"))
        pct = round(themed / total * 100, 1) if total else 0.0
        logger.info("series scan done: %d/%d themed (%.1f%%)", themed, total, pct)
    except Exception as exc:  # noqa: BLE001 — surface a redacted reason, never the token
        logger.warning("Series scan failed: %s", _redact(str(exc), token))
    finally:
        with _scan_lock:
            _scanning = False


def start_scan() -> bool:
    """Start a background scan unless one is already running. Returns True if started."""
    global _scanning
    with _scan_lock:
        if _scanning:
            return False
        _scanning = True
    logger.info("series scan starting")
    threading.Thread(target=_run_scan, daemon=True).start()
    return True


def _is_stale(updated_at: str) -> bool:
    if not updated_at:
        return True
    try:
        ts = datetime.fromisoformat(updated_at)
    except ValueError:
        return True
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
    return age_h > _STALE_HOURS


def _maybe_autoscan(cache: dict) -> None:
    """Kick a background scan if the cache is empty or older than 24h (never blocks)."""
    if not cache.get("shows") or _is_stale(cache.get("updated_at", "")):
        start_scan()


def bootstrap_if_empty() -> None:
    """On boot: if the series cache file is absent, run one scan in the background."""
    if series_cache.cache_exists():
        return
    logger.info("series_cache absent on boot — starting initial scan")
    start_scan()


@bp.get("/eligible")
def eligible():
    """Shows WITH a theme (the quiz pool). Triggers a background scan if empty/stale."""
    cache = series_cache.load_cache()
    _maybe_autoscan(cache)
    shows = [
        {
            "ratingKey": s.get("ratingKey"),
            "title": s.get("title"),
            "year": s.get("year"),
            "guid": s.get("guid"),
            "thumb_url": f"/api/series/thumb/{s.get('ratingKey')}" if s.get("thumb") else None,
        }
        for s in cache.get("shows", [])
        if s.get("has_theme") and s.get("ratingKey") is not None
    ]
    return jsonify({"count": len(shows), "shows": shows})


@bp.get("/coverage")
def coverage():
    """Coverage stats + the alphabetical list of shows WITHOUT a theme. Reads cache only."""
    cache = series_cache.load_cache()
    shows = cache.get("shows", [])
    total = len(shows)
    with_theme = sum(1 for s in shows if s.get("has_theme"))
    pct = round(with_theme / total * 100, 1) if total else 0.0
    missing = sorted(
        (
            {"title": s.get("title"), "year": s.get("year"),
             "ratingKey": s.get("ratingKey"), "guid": s.get("guid")}
            for s in shows if not s.get("has_theme")
        ),
        key=lambda s: (s["title"] or "").lower(),
    )
    return jsonify({"total": total, "with_theme": with_theme, "percent": pct, "missing": missing})


@bp.get("/thumb/<int:rating_key>")
def thumb(rating_key: int):
    """Proxy a show's poster so the Plex token never reaches the browser."""
    cache = series_cache.load_cache()
    show = next((s for s in cache.get("shows", []) if s.get("ratingKey") == rating_key), None)
    path = show.get("thumb") if show else None
    base, token, _ = _plex_base_token()
    if not path or not base or not token:
        return jsonify({"error": "not found"}), 404
    target = urljoin(base + "/", path.lstrip("/"))
    try:
        upstream = requests.get(target, params={"X-Plex-Token": token},
                                timeout=_PROXY_TIMEOUT, verify=False)
    except requests.RequestException as exc:
        logger.warning("Series thumb proxy failed for %s: %s", rating_key, _redact(str(exc), token))
        return jsonify({"error": "upstream error"}), 502
    if upstream.status_code != 200:
        return jsonify({"error": "upstream status"}), upstream.status_code
    return Response(upstream.content,
                    content_type=upstream.headers.get("Content-Type", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=86400"})


@bp.get("/theme/<int:rating_key>")
def theme(rating_key: int):
    """Stream a show's ~30s theme audio from Plex, token attached server-side, chunked."""
    cache = series_cache.load_cache()
    show = next((s for s in cache.get("shows", []) if s.get("ratingKey") == rating_key), None)
    theme_path = show.get("theme_path") if show else None
    base, token, _ = _plex_base_token()
    if not theme_path or not base or not token:
        return jsonify({"error": "Theme nicht gefunden"}), 404
    target = urljoin(base + "/", theme_path.lstrip("/"))
    try:
        upstream = requests.get(target, params={"X-Plex-Token": token},
                                stream=True, timeout=_PROXY_TIMEOUT, verify=False)
    except requests.RequestException as exc:
        logger.warning("Series theme proxy failed for %s: %s", rating_key, _redact(str(exc), token))
        return jsonify({"error": "Theme nicht gefunden"}), 404
    if upstream.status_code != 200:
        upstream.close()
        return jsonify({"error": "Theme nicht gefunden"}), 404

    headers = {"Cache-Control": "public, max-age=86400"}
    content_length = upstream.headers.get("Content-Length")
    if content_length:
        headers["Content-Length"] = content_length

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return Response(stream_with_context(generate()),
                    content_type=upstream.headers.get("Content-Type", "audio/mpeg"),
                    headers=headers)


@bp.post("/score")
def score():
    """Live match meter for a typed series guess: {score 0-100, accepted}. No answer text."""
    body = request.get_json(silent=True) or {}
    try:
        rk = int(body.get("ratingKey"))
    except (TypeError, ValueError):
        return jsonify({"error": "ratingKey fehlt"}), 400
    result = series_quiz.score(rk, str(body.get("guess") or ""))
    if result is None:
        return jsonify({"error": "Serie nicht gefunden"}), 404
    return jsonify(result)


@bp.post("/answer")
def answer():
    """Final answer: {correct} plus 'reveal' ONLY when correct (HARD RULE, server-side)."""
    body = request.get_json(silent=True) or {}
    try:
        rk = int(body.get("ratingKey"))
    except (TypeError, ValueError):
        return jsonify({"error": "ratingKey fehlt"}), 400
    result = series_quiz.answer(rk, str(body.get("guess") or ""))
    if result is None:
        return jsonify({"error": "Serie nicht gefunden"}), 404
    return jsonify(result)


@bp.post("/rescan")
def rescan():
    """Trigger a background rescan, returning immediately with the previous totals."""
    cache = series_cache.load_cache()
    started = start_scan()
    return jsonify({
        "started": started,
        "previous_total": cache.get("total", 0),
        "previous_with_theme": cache.get("with_theme", 0),
    })
