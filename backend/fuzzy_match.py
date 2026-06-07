"""Server-side fuzzy title matching for the audio quiz answer check (L4.1).

``normalize`` canonicalises a title; ``similarity`` returns a 0..1 score combining a
Levenshtein character ratio with a token-set overlap (the max of the two) so that both
typos AND word-order / partial titles match. Shared by the film-theme and series
quizzes — import it, never re-implement.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from typing import Set

logger = logging.getLogger(__name__)

# Leading articles dropped during normalisation (de / en / fr / es / it).
_ARTICLES = {"der", "die", "das", "the", "a", "an", "le", "la", "el", "il", "ein", "eine"}

# Accept thresholds by difficulty. Raised (CC) so only a clearly-correct guess auto-wins — the live
# meter no longer accepts a vague guess before the player has even seen the answer.
_THRESHOLDS = {"easy": 0.85, "medium": 0.90, "hard": 0.94}
DEFAULT_THRESHOLD = 0.90

_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b\s*$")
_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)


def threshold_for(difficulty: str) -> float:
    """Accept threshold for a difficulty label (unknown -> the default 0.80)."""
    return _THRESHOLDS.get((difficulty or "").strip().lower(), DEFAULT_THRESHOLD)


def normalize(title: str) -> str:
    """Lowercase; strip accents + punctuation; drop a trailing year and a leading article."""
    if not title:
        return ""
    text = unicodedata.normalize("NFD", title)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")  # strip accents
    text = _PUNCT_RE.sub(" ", text.lower())
    text = _YEAR_RE.sub("", text.strip())  # trailing 4-digit year
    tokens = [t for t in text.split() if t]
    while tokens and tokens[0] in _ARTICLES:
        tokens.pop(0)
    return " ".join(tokens)


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


def _char_ratio(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return 1.0 - _levenshtein(a, b) / max(len(a), len(b))


def _token_set_ratio(a: str, b: str) -> float:
    ta: Set[str] = set(a.split())
    tb: Set[str] = set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def similarity(guess: str, target: str) -> float:
    """0..1 similarity: max of a Levenshtein char-ratio and a token-set overlap ratio."""
    g = normalize(guess)
    t = normalize(target)
    if not g or not t:
        return 0.0
    return max(_char_ratio(g, t), _token_set_ratio(g, t))
