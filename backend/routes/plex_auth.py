"""Plex OAuth PIN login flow (matches the Seerr/Jellyseerr UX)."""
from __future__ import annotations

import logging
import time
from typing import Any, Dict

import requests
from flask import Blueprint, jsonify

from services import settings_store

logger = logging.getLogger(__name__)
bp = Blueprint("plex_auth", __name__, url_prefix="/api/plex/auth")

_PLEX_TV = "https://plex.tv/api/v2"
_TIMEOUT = 15
_RETRIES = 2
_BACKOFF = 0.4
# One shared session so the boot-time IPv4 preference and connection reuse apply
# to every plex.tv call (pin create, pin check, user fetch).
_session = requests.Session()


def _request(method: str, url: str, **kwargs: Any) -> requests.Response:
    """Issue a plex.tv request with a small bounded retry on transient
    connection/timeout errors, then let the caller map a final failure to the
    existing German error responses."""
    last_exc: requests.RequestException = requests.exceptions.ConnectionError("no attempt made")
    for attempt in range(_RETRIES + 1):
        try:
            return _session.request(method, url, timeout=_TIMEOUT, **kwargs)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            last_exc = exc
            if attempt < _RETRIES:
                logger.warning("plex.tv %s %s failed (attempt %d/%d): %s",
                               method, url, attempt + 1, _RETRIES + 1, exc)
                time.sleep(_BACKOFF * (attempt + 1))
    raise last_exc


def _headers() -> Dict[str, str]:
    """Common headers required on every plex.tv API call."""
    return {
        "X-Plex-Product": "PlexDice",
        "X-Plex-Version": "1.0",
        "X-Plex-Client-Identifier": settings_store.ensure_client_id(),
        "X-Plex-Device": "PlexDice",
        "X-Plex-Device-Name": "PlexDice",
        "X-Plex-Platform": "Web",
        "Accept": "application/json",
    }


@bp.post("/pin")
def create_pin():
    """Request a fresh login PIN from plex.tv."""
    try:
        resp = _request("POST", f"{_PLEX_TV}/pins", params={"strong": "true"}, headers=_headers())
        resp.raise_for_status()
        data = resp.json()
        return jsonify({"id": data["id"], "code": data["code"]})
    except requests.exceptions.Timeout as exc:
        logger.warning("Plex pin creation timed out: %s", exc)
        return jsonify({"error": "Zeitüberschreitung beim Plex-Login"}), 504
    except requests.exceptions.ConnectionError as exc:
        logger.warning("Plex pin creation could not reach plex.tv: %s", exc)
        return jsonify({"error": "plex.tv nicht erreichbar — DNS-Problem?"}), 502
    except requests.exceptions.HTTPError as exc:
        logger.warning("Plex pin creation rejected by plex.tv: %s", exc)
        return jsonify({"error": "plex.tv hat die Anfrage abgelehnt"}), 502
    except requests.RequestException as exc:
        logger.warning("Plex pin creation failed: %s", exc)
        return jsonify({"error": str(exc)}), 502


@bp.get("/pin/<pin_id>")
def check_pin(pin_id: str):
    """Poll a PIN; once claimed, persist the token + user and report success."""
    try:
        resp = _request("GET", f"{_PLEX_TV}/pins/{pin_id}", headers=_headers())
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        logger.warning("Plex pin check failed: %s", exc)
        return jsonify({"error": str(exc)}), 502

    token = data.get("authToken")
    if not token:
        return jsonify({"ok": False, "pending": True})

    user = _fetch_user(token)
    settings_store.set_plex(token=token, user=user)
    logger.info("Plex login succeeded for %s", (user or {}).get("username") or "unknown")
    return jsonify({"ok": True, "user": user})


@bp.post("/logout")
def logout():
    """Forget the stored Plex token and user."""
    settings_store.set_plex(token="", user=None)
    return jsonify({"ok": True})


@bp.post("/client-id")
def ensure_client_id():
    """Return the stable client identifier, generating one if settings lost it.

    The frontend calls this before building the auth URL: an empty clientID makes
    plex.tv silently reject the login, so we guarantee a value server-side first.
    """
    return jsonify({"client_id": settings_store.ensure_client_id()})


def _fetch_user(token: str) -> Dict[str, Any]:
    """Fetch the signed-in account's username, email and avatar."""
    headers = {**_headers(), "X-Plex-Token": token}
    try:
        resp = _request("GET", f"{_PLEX_TV}/user", headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return {
            "username": data.get("username") or data.get("title") or "",
            "email": data.get("email") or "",
            "thumb": data.get("thumb") or "",
        }
    except requests.RequestException as exc:
        logger.warning("Plex user fetch failed: %s", exc)
        return {"username": "", "email": "", "thumb": ""}
