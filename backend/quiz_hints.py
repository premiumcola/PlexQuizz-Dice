"""Progressive letter hints for the typed quizzes (V1.1).

``reveal_letters(answer, level)`` returns a cumulative, evenly-spread subset of the answer's
LETTER positions — spaces / punctuation are always shown and never count as hint letters. The
reveal is monotonic (every letter shown at level L stays shown at L+1) and capped so the whole
title is never given away. Pure: no I/O, no print.
"""
from __future__ import annotations

from collections import deque
from typing import Any, Dict, List


def _spread_order(n: int) -> List[int]:
    """A permutation of range(n) whose every prefix is evenly spread (breadth-first bisection).

    Picking the first ``c`` items yields a low-discrepancy subset for any ``c``, and the order is
    cumulative (the prefix for ``c`` is contained in the prefix for ``c+1``).
    """
    if n <= 0:
        return []
    order: List[int] = []
    seen: set = set()
    queue = deque([(0, n)])
    while queue:
        lo, hi = queue.popleft()
        if lo >= hi:
            continue
        mid = (lo + hi) // 2
        if mid not in seen:
            seen.add(mid)
            order.append(mid)
        queue.append((lo, mid))
        queue.append((mid + 1, hi))
    return order


def _hint_count(level: int, letters: int) -> int:
    """How many letters to reveal at ``level`` — monotonic, >=1, and never all of them."""
    if letters >= 3:
        cap = letters - 2
    elif letters == 2:
        cap = 1
    else:
        cap = 0  # 0- or 1-letter answers: never reveal the only letter
    if cap < 1:
        return 0
    return min(max(1, round(level * letters / 8)), cap)


def reveal_letters(answer: str, level: int) -> Dict[str, Any]:
    """Return ``{"length": N, "revealed": [{"index", "char"}, ...]}`` for a hint ``level``.

    ``revealed`` always includes every space/punctuation position plus a progressive subset of
    the letter positions; its length is strictly less than ``N`` (the full title is never given).
    """
    answer = answer or ""
    n = len(answer)
    letter_idx = [i for i, ch in enumerate(answer) if ch.isalnum()]
    count = _hint_count(max(1, int(level)), len(letter_idx))
    chosen = {letter_idx[r] for r in _spread_order(len(letter_idx))[:count]}
    revealed = [
        {"index": i, "char": ch}
        for i, ch in enumerate(answer)
        if not ch.isalnum() or i in chosen
    ]
    return {"length": n, "revealed": revealed}
