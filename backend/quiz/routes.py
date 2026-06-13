"""Flask blueprint /api/quiz/* — round lifecycle, history, per-movie stats."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify, request, send_file

from quiz import photos
from quiz.filters import apply_filters
from quiz.generator import QuizGenerator
from quiz.history import History
from quiz.leaderboard import Leaderboard
from quiz.modes import MODES
from quiz.session import SessionStore
from services import DATA_DIR, library_cache, settings_store

_CONFIG_KEYS = {
    "default_difficulty", "default_size", "countdown_seconds", "sound_enabled",
    "enabled_modes", "show_correct_on_wrong", "autoreveal_delay_ms",
}

logger = logging.getLogger(__name__)
bp = Blueprint("quiz", __name__, url_prefix="/api/quiz")

sessions = SessionStore()
history = History(
    os.path.join(DATA_DIR, "quiz_history.json"),
    os.path.join(DATA_DIR, "quiz_movie_stats.json"),
    os.path.join(DATA_DIR, "quiz_recent.json"),
)
# Shared, server-side leaderboard + reusable player-name roster (all instance users share both).
leaderboard = Leaderboard(
    os.path.join(DATA_DIR, "leaderboard.json"),
    os.path.join(DATA_DIR, "players.json"),
)

# Remove photo files no round references anymore (runs once on boot).
try:
    photos.cleanup_orphans(history.all_photo_ids())
except Exception:  # noqa: BLE001
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _readable(option: dict | None) -> str | None:
    """Human-readable answer text from an option (title/name)."""
    if not option:
        return None
    return option.get("content") if option.get("kind") == "text" else option.get("label")


def _option_view(opt: dict) -> dict:
    """Compact, display-only view of an option/item for the review reveal: its stable id, readable
    text and (for image options) a thumbnail url."""
    return {
        "id": opt.get("id"),
        "text": _readable(opt),
        "thumb": opt.get("content") if opt.get("kind") == "image" else None,
    }


def _reveal_fields(q: dict, first_chosen) -> dict:
    """Display-only data letting the review reveal the FULL correct answer for multi-select and
    connect rounds (single-select rounds already carry chosen_text / correct_text). Purely additive —
    it never affects scoring or grading."""
    if not q.get("multi_select"):
        return {}
    chosen_ids = first_chosen if isinstance(first_chosen, list) else []
    fields: dict = {
        "multi_select": True,
        "correct_option_ids": q.get("correct_option_ids") or [],
        "chosen_option_ids": chosen_ids,
    }
    if q.get("mode") == "connect":
        # Reveal the correct left↔right pairs and the items needed to render them.
        fields["pairs"] = q.get("pairs") or []
        fields["items"] = {it["id"]: _option_view(it) for it in q.get("items", [])}
    else:
        fields["options"] = [_option_view(o) for o in q.get("options", [])]
    return fields


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# The only per-question fields a client-assembled (sessionless) round may persist — a strict allow-list
# so a posted round can never write a Plex deep-link / token or arbitrary blob into the history store.
_SESSIONLESS_Q_FIELDS = ("id", "mode", "correct", "movie_key", "movie_title", "movie_year", "correct_text", "chosen_text")


def _sanitize_question(q: Any) -> dict:
    """Keep only the allow-listed, display-only fields from a posted sessionless question."""
    if not isinstance(q, dict):
        return {}
    out = {k: q.get(k) for k in _SESSIONLESS_Q_FIELDS if q.get(k) is not None}
    out["correct"] = bool(q.get("correct"))
    return out


@bp.post("/round/new")
def new_round():
    body = request.get_json(silent=True) or {}
    cfg = settings_store.get("quiz")
    size = max(1, min(int(body.get("size") or cfg.get("default_size") or 50), 200))
    difficulty = body.get("difficulty") or cfg.get("default_difficulty") or "medium"
    enabled_modes = body.get("enabled_modes") or body.get("modes") or (cfg.get("enabled_modes") or None)
    name = (body.get("name") or "").strip() or None
    # Shared dice-style pre-filter: restrict the candidate movies (stems AND distractors) before the
    # generator builds the round, so a filtered round contains only matching films.
    criteria = body.get("filters") if isinstance(body.get("filters"), dict) else None

    status = library_cache.status()
    movies = apply_filters(library_cache.movies(), criteria)
    generator = QuizGenerator(movies, status)
    # Connect ("Verbinden") rounds are a configurable minority of the run; excluding "connect" from
    # enabled_modes turns them off. Default ~20%.
    connect_share = 0.0 if (enabled_modes and "connect" not in enabled_modes) else float(cfg.get("connect_share", 0.2))
    questions, meta = generator.build_round(
        size,
        difficulty=difficulty,
        enabled_modes=enabled_modes,
        avoid=history.recent_signatures(),
        connect_share=connect_share,
    )
    if not questions:
        return jsonify({"error": "Nicht genug Daten für ein Quiz"}), 400

    session = sessions.create(questions, name, meta["modes"], meta["difficulty"])
    history.push_signatures([f"{q['mode']}:{q['movie_key']}" for q in questions])
    return jsonify(
        {
            "round_id": session.round_id,
            "questions": questions,
            "created_at": session.created_at,
            "size": len(questions),
            "difficulty": meta["difficulty"],
            "modes": meta["modes"],
            "insufficient_cast": meta["insufficient_cast"],
            "countdown_seconds": cfg.get("countdown_seconds", 15),
            "sound_enabled": cfg.get("sound_enabled", True),
            "autoreveal_delay_ms": cfg.get("autoreveal_delay_ms", 1200),
            "show_correct_on_wrong": cfg.get("show_correct_on_wrong", True),
        }
    )


@bp.post("/round/<round_id>/answer")
def answer(round_id: str):
    session = sessions.get(round_id)
    if not session:
        return jsonify({"error": "round not found"}), 404
    body = request.get_json(silent=True) or {}
    result = session.record(
        body.get("question_id"),
        body.get("chosen_option_id"),
        body.get("time_ms"),
        chosen_ids=body.get("chosen_option_ids"),
    )
    if result is None:
        return jsonify({"error": "question not found"}), 404
    return jsonify(result)


@bp.get("/round/<round_id>/state")
def round_state(round_id: str):
    """Mastery progress: counts, per-question status, the next question, and stats.
    Doubles as the timeline source and the result-screen stats feed."""
    session = sessions.get(round_id)
    if not session:
        return jsonify({"error": "round not found"}), 404
    return jsonify(session.state_payload())


@bp.post("/round/<round_id>/complete")
def complete(round_id: str):
    session = sessions.get(round_id)
    if not session:
        return jsonify({"error": "round not found"}), 404
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or session.name or "Runde").strip()
    questions_out = []
    for q in session.questions:
        ans = session.answers.get(q["id"], {})
        st = session.status.get(q["id"], {})
        options = {o["id"]: o for o in q.get("options", [])}
        # Mastery: the meaningful "did you know it" signal is the first attempt, so
        # the review shows the first guess and whether it was right first time.
        first_chosen = st.get("first_chosen")
        first_chosen_id = first_chosen if isinstance(first_chosen, str) else None
        questions_out.append(
            {
                "id": q["id"],
                "mode": q["mode"],
                "difficulty": q.get("difficulty"),
                "movie_key": q["movie_key"],
                "movie_title": q.get("movie_title"),
                "movie_year": q.get("movie_year"),
                "correct": bool(st.get("first_try_correct", False)),
                "first_try_correct": bool(st.get("first_try_correct", False)),
                "attempts": int(st.get("attempts", 0)),
                "forced_resolve": bool(st.get("forced_resolve", False)),
                "chosen_option_id": first_chosen_id,
                "chosen_text": _readable(options.get(first_chosen_id)),
                "correct_text": _readable(options.get(q.get("correct_option_id"))),
                "time_ms": ans.get("time_ms"),
                **_reveal_fields(q, first_chosen),
            }
        )
    record = {
        "id": session.round_id,
        "name": name,
        "player_names": body.get("player_names") or [],
        "photo_id": body.get("photo_id"),
        "created_at": session.created_at,
        "finished_at": _now(),
        "size": len(session.questions),
        "score": session.score,
        "difficulty": session.difficulty,
        "modes": session.modes,
        "questions": questions_out,
        "mastery": session.stats_payload(),
    }
    history.add_round(record)
    # Keep the in-memory session alive (it is ephemeral, dropped on restart): the result screen
    # auto-persists on mount and the optional "Speichern" re-completes to attach a photo / names —
    # add_round is idempotent by id, so re-completing updates the round without duplicating it. The
    # session also still backs /state and /solutions for the Auflösung after finishing.
    return jsonify(record)


@bp.delete("/round/<round_id>")
def abandon(round_id: str):
    # Mark ended (don't drop) so the end-of-round Auflösung can still resolve every answer.
    session = sessions.get(round_id)
    if session is not None:
        session.ended = True
    return jsonify({"ok": True})


@bp.get("/history")
def history_list():
    return jsonify({"rounds": history.list_rounds()})


@bp.post("/history")
def history_add():
    """Persist a fully client-assembled (sessionless) round — Sound / Serien / Mixed carry no server
    session — into the SAME history store the normal rounds use, so it appears in the "Runden" list.
    Idempotent by id (re-posting the same id never duplicates). Additive: this does not touch scoring,
    the shared leaderboard, or any settings/cache file."""
    body = request.get_json(silent=True) or {}
    round_id = str(body.get("id") or "").strip()
    if not round_id:
        return jsonify({"error": "id required"}), 400
    record = {
        "id": round_id,
        "name": (str(body.get("name") or "").strip() or "Runde"),
        "player_names": body.get("player_names") or [],
        "photo_id": body.get("photo_id"),
        "created_at": body.get("created_at") or _now(),
        "finished_at": body.get("finished_at") or _now(),
        "size": _as_int(body.get("size")),
        "score": _as_int(body.get("score")),
        "correct": _as_int(body.get("correct")),
        "difficulty": body.get("difficulty"),
        "modes": body.get("modes") or [],
        "sessionless": True,
        "questions": [sq for q in (body.get("questions") or []) if (sq := _sanitize_question(q))],
    }
    history.add_round(record)
    return jsonify(record)


@bp.get("/history/top")
def history_top():
    return jsonify({"movies": history.top_movies(10)})


@bp.get("/leaderboard")
def leaderboard_top():
    return jsonify({"entries": leaderboard.top(50)})


@bp.post("/leaderboard")
def leaderboard_submit():
    body = request.get_json(silent=True) or {}
    entry = leaderboard.submit(
        body.get("name"), body.get("score"), body.get("correct"), body.get("wrong"), body.get("size"),
    )
    return jsonify(entry)


@bp.get("/players")
def players_list():
    return jsonify({"players": leaderboard.players()})


@bp.post("/players")
def players_add():
    body = request.get_json(silent=True) or {}
    return jsonify({"players": leaderboard.add_player(body.get("name"))})


@bp.get("/history/<round_id>")
def history_get(round_id: str):
    record = history.get_round(round_id)
    if not record:
        return jsonify({"error": "not found"}), 404
    keys = {q.get("movie_key") for q in record.get("questions", [])}
    stats = {k: history.movie_stats(k).get("attempts", []) for k in keys if k}
    return jsonify({**record, "movie_stats": stats})


@bp.delete("/history/<round_id>")
def history_delete(round_id: str):
    record = history.delete_round(round_id)
    if not record:
        return jsonify({"error": "not found"}), 404
    photos.delete(record.get("photo_id"))
    return jsonify({"ok": True})


@bp.get("/movie/<movie_key>/stats")
def movie_stats(movie_key: str):
    return jsonify(history.movie_stats(movie_key))


def _config_payload() -> dict:
    cfg = settings_store.get("quiz")
    all_ids = list(MODES.keys())
    return {
        **cfg,
        "enabled_modes": cfg.get("enabled_modes") or all_ids,
        "modes": [
            {"id": m.id, "label": m.label, "description": m.description, "tier": m.tier}
            for m in MODES.values()
        ],
    }


@bp.get("/config")
def get_config():
    return jsonify(_config_payload())


@bp.post("/config")
def post_config():
    body = request.get_json(silent=True) or {}
    patch = {k: v for k, v in body.items() if k in _CONFIG_KEYS}
    if patch:
        settings_store.update({"quiz": patch})
    return jsonify(_config_payload())


@bp.post("/photo")
def upload_photo():
    file = request.files.get("photo") or request.files.get("file")
    if not file:
        return jsonify({"error": "no file"}), 400
    try:
        photo_id = photos.save(file)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Photo upload failed: %s", exc)
        return jsonify({"error": "invalid image"}), 400
    return jsonify({"photo_id": photo_id, "url": f"/api/quiz/photo/{photo_id}"})


@bp.get("/photo/<photo_id>")
def get_photo(photo_id: str):
    width = request.args.get("w", type=int)
    width = width if width and 0 < width <= 1200 else None
    path = photos.get_path(photo_id, width)
    if not path:
        return jsonify({"error": "not found"}), 404
    response = send_file(path, mimetype="image/jpeg")
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response
