"""Outbound-network hardening so the Plex OAuth login can always reach plex.tv.

Applied once at boot (from services.py). Two independent, self-healing measures:

  * prefer_ipv4 — force IPv4 for all requests/urllib3 traffic. Some Docker
    networks advertise an AAAA route that black-holes; happy-eyeballs then stalls
    on the dead IPv6 address until timeout. plex.tv, app.plex.tv and the
    *.plex.direct server hosts all answer fine over IPv4.

  * ensure_plex_dns — guarantee plex.tv / app.plex.tv resolve. When the system
    resolver cannot (blocked :53, missing forwarder, a Pi-hole that drops the
    query) we resolve over DNS-over-HTTPS on :443 — which needs no prior DNS
    because Cloudflare serves DoH on the 1.1.1.1 IP literal — and pin the answers
    into /etc/hosts so getent, requests and python-plexapi all see them.

Both are no-ops on a healthy host (working DNS + IPv4), so production deployments
are unaffected unless their DNS is actually broken.
"""
from __future__ import annotations

import logging
import socket

import requests
import urllib3.util.connection as urllib3_conn

logger = logging.getLogger(__name__)

# Hosts the OAuth PIN flow touches: the API (plex.tv) and the auth web UI (app.plex.tv).
_PLEX_HOSTS = ("plex.tv", "app.plex.tv")
_HOSTS_FILE = "/etc/hosts"
# Cloudflare DoH on IP literals — the cert carries the IP SAN, so this resolves
# names with no prior DNS lookup of its own.
_DOH_ENDPOINTS = ("https://1.1.1.1/dns-query", "https://1.0.0.1/dns-query")
_DOH_TIMEOUT = 8


def prefer_ipv4() -> None:
    """Pin urllib3's address-family selection to IPv4 for every outbound request."""
    urllib3_conn.allowed_gai_family = lambda: socket.AF_INET
    logger.info("Network: forcing IPv4 (AF_INET) for outbound requests")


def _resolves(host: str) -> bool:
    """True if the system resolver already returns an IPv4 address for host."""
    try:
        socket.getaddrinfo(host, 443, socket.AF_INET)
        return True
    except OSError:
        return False


def _doh_resolve(host: str) -> list[str]:
    """Resolve host's A records via DNS-over-HTTPS; [] if every endpoint fails."""
    for endpoint in _DOH_ENDPOINTS:
        try:
            resp = requests.get(
                endpoint,
                params={"name": host, "type": "A"},
                headers={"accept": "application/dns-json"},
                timeout=_DOH_TIMEOUT,
            )
            resp.raise_for_status()
            ips = [a["data"] for a in resp.json().get("Answer", []) if a.get("type") == 1]
            if ips:
                return ips
        except (requests.RequestException, ValueError, KeyError) as exc:
            logger.warning("DoH via %s failed for %s: %s", endpoint, host, exc)
    return []


def _pin_hosts(entries: dict[str, list[str]]) -> None:
    """Append `ip host` lines to /etc/hosts for the given host -> ips map."""
    lines = ["# plexdice: DoH-resolved plex.tv hosts (system DNS unavailable)\n"]
    for host, ips in entries.items():
        lines.extend("%s %s\n" % (ip, host) for ip in ips)
    with open(_HOSTS_FILE, "a", encoding="utf-8") as fh:
        fh.writelines(lines)


def ensure_plex_dns() -> None:
    """Make plex.tv hosts resolvable, DoH-seeding /etc/hosts when the resolver can't."""
    unresolved = [h for h in _PLEX_HOSTS if not _resolves(h)]
    if not unresolved:
        return
    logger.warning("Network: system DNS cannot resolve %s — falling back to DoH", unresolved)
    seeded: dict[str, list[str]] = {}
    for host in unresolved:
        ips = _doh_resolve(host)
        if ips:
            seeded[host] = ips
    if not seeded:
        logger.error("Network: DoH resolved none of %s — plex.tv stays unreachable", unresolved)
        return
    try:
        _pin_hosts(seeded)
        logger.info("Network: pinned DoH results into %s: %s", _HOSTS_FILE, seeded)
    except OSError as exc:
        logger.error("Network: cannot write %s (%s) — plex.tv may stay unreachable", _HOSTS_FILE, exc)


def bootstrap() -> None:
    """Apply IPv4 preference + the DNS safety net. Safe to call once at boot."""
    prefer_ipv4()
    try:
        ensure_plex_dns()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Network: DNS bootstrap skipped: %s", exc)
