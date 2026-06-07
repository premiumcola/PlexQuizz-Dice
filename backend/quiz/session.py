"""In-memory active quiz sessions (ephemeral — lost on restart, acceptable for v1).

Mastery rounds: a question stays in play until answered correctly at least once.
Wrong answers go back into a retry pool, drawn in random order. A question that is
missed five times in a row is force-resolved (and flagged) so a round can't get stuck.
"""
from __future__ import annotations

import random
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_FORCED_RESOLVE_AFTER = 5  # consecutive wrong attempts → auto-resolve & skip


def score_for(correct: bool, time_ms: Optional[int]) -> int:
    """100 / 80 / 60 points for a correct answer within 5 / 10 / 15s; else 0."""
    if not correct:
        return 0
    ms = 15000 if time_ms is None else time_ms
    if ms <= 5000:
        return 100
    if ms <= 10000:
        return 80
    if ms <= 15000:
        return 60
    return 0


class Session:
    def __init__(
        self,
        round_id: str,
        questions: List[Dict[str, Any]],
        name: Optional[str],
        modes: List[str],
        difficulty: str = "medium",
    ) -> None:
        self.round_id = round_id
        self.questions = questions
        self.name = name
        self.modes = modes
        self.difficulty = difficulty
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.answers: Dict[str, Dict[str, Any]] = {}
        self.score = 0
        self._by_id = {q["id"]: q for q in questions}

        order = [q["id"] for q in questions]
        self.order = order
        self.status: Dict[str, Dict[str, Any]] = {
            qid: {
                "attempts": 0,
                "first_try_correct": False,
                "resolved": False,
                "forced_resolve": False,
                "consecutive_wrong": 0,
                "last_seen_index": 0 if i == 0 else -1,
                "first_chosen": None,
            }
            for i, qid in enumerate(order)
        }
        # order[0] is shown immediately on round start; the rest queue as first visits.
        self._first_visits: List[str] = order[1:]
        self.retry_pool: List[str] = []
        self.current_qid: Optional[str] = order[0] if order else None
        self.current_visit: str = "first"
        self._visit_count: int = 1 if order else 0
        self.started_at_utc: Optional[str] = None
        self.completed_at_utc: Optional[str] = None
        self.ended = False  # set on abandon — keeps the session alive for the Auflösung

    # ---- Mastery flow ----

    def _all_resolved(self) -> bool:
        return bool(self.order) and all(s["resolved"] for s in self.status.values())

    def is_over(self) -> bool:
        """True once the round is finished (all resolved) or explicitly ended/abandoned."""
        return self.ended or self._all_resolved()

    def _advance(self) -> Optional[Dict[str, str]]:
        """Serve the next question: remaining first visits in order, then the retry
        pool in random order (avoiding an immediate repeat of the same question)."""
        nxt: Optional[str] = None
        visit = "first"
        if self._first_visits:
            nxt = self._first_visits.pop(0)
        elif self.retry_pool:
            i = random.randrange(len(self.retry_pool))
            if self.retry_pool[i] == self.current_qid and len(self.retry_pool) > 1:
                i = (i + 1) % len(self.retry_pool)
            nxt = self.retry_pool.pop(i)
            visit = "retry"
        self.current_qid = nxt
        self.current_visit = visit
        if nxt is None:
            return None
        self._visit_count += 1
        self.status[nxt]["last_seen_index"] = self._visit_count - 1
        return {"question_id": nxt, "visit": visit}

    def record(
        self,
        question_id: str,
        chosen_option_id: Optional[str],
        time_ms: Optional[int],
        chosen_ids: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        question = self._by_id.get(question_id)
        if not question:
            return None

        if question.get("multi_select"):
            correct_set = set(question.get("correct_option_ids") or [])
            chosen = set(chosen_ids or ([] if chosen_option_id is None else [chosen_option_id]))
            denom = len(correct_set) or 1
            net = len(chosen & correct_set) - len(chosen - correct_set)
            frac = max(0, net) / denom
            base = score_for(True, time_ms)
            points = int(round(base * frac))
            correct = frac >= 1.0
            chosen_value: Any = sorted(chosen)
        else:
            correct = chosen_option_id is not None and chosen_option_id == question["correct_option_id"]
            points = score_for(correct, time_ms)
            chosen_value = chosen_option_id

        now = datetime.now(timezone.utc)
        if self.started_at_utc is None:
            self.started_at_utc = now.isoformat()

        # Latest answer replaces any earlier one for this question (score net-adjusts).
        previous = self.answers.get(question_id)
        if previous:
            self.score -= previous["points"]
        self.answers[question_id] = {
            "chosen_option_id": chosen_value if not question.get("multi_select") else None,
            "chosen_option_ids": chosen_value if question.get("multi_select") else None,
            "time_ms": time_ms,
            "correct": correct,
            "points": points,
        }
        self.score += points

        st = self.status[question_id]
        active = question_id == self.current_qid and not st["resolved"]
        just_forced = False
        if active:
            st["attempts"] += 1
            if st["attempts"] == 1:
                st["first_chosen"] = chosen_value
                if correct:
                    st["first_try_correct"] = True
            if correct:
                st["resolved"] = True
                st["consecutive_wrong"] = 0
            else:
                st["consecutive_wrong"] += 1
                if st["consecutive_wrong"] >= _FORCED_RESOLVE_AFTER:
                    st["resolved"] = True
                    st["forced_resolve"] = True
                    just_forced = True
                else:
                    self.retry_pool.append(question_id)

        done = self._all_resolved()
        if active and not done:
            next_info = self._advance()
        elif done:
            self.current_qid = None
            if self.completed_at_utc is None:
                self.completed_at_utc = now.isoformat()
            next_info = None
        else:  # stale / duplicate submission — re-serve the current question
            next_info = (
                {"question_id": self.current_qid, "visit": self.current_visit}
                if self.current_qid
                else None
            )

        return {
            "correct": correct,
            "correct_option_id": question.get("correct_option_id"),
            "correct_option_ids": question.get("correct_option_ids"),
            "current_score": self.score,
            "done": done,
            "forced_resolve": just_forced,
            "next": next_info,
            "status": self._status_payload(),
            **self._counts(),
        }

    # ---- Payloads for the API / frontend ----

    def _counts(self) -> Dict[str, int]:
        return {
            "total_questions": len(self.order),
            "resolved_count": sum(1 for s in self.status.values() if s["resolved"]),
            "retry_pool_size": len(self.retry_pool),
        }

    def _status_payload(self) -> Dict[str, Dict[str, Any]]:
        pool = set(self.retry_pool)
        out: Dict[str, Dict[str, Any]] = {}
        for i, qid in enumerate(self.order):
            st = self.status[qid]
            out[qid] = {
                "index": i,
                "attempts": st["attempts"],
                "resolved": st["resolved"],
                "first_try_correct": st["first_try_correct"],
                "forced_resolve": st["forced_resolve"],
                "in_retry": qid in pool,
                "active": qid == self.current_qid,
            }
        return out

    def stats_payload(self) -> Dict[str, Any]:
        vals = list(self.status.values())
        first_try = sum(1 for s in vals if s["resolved"] and s["first_try_correct"] and not s["forced_resolve"])
        forced = sum(1 for s in vals if s["forced_resolve"])
        retry = sum(1 for s in vals if s["resolved"] and not s["first_try_correct"] and not s["forced_resolve"])
        retry_attempts = [s["attempts"] for s in vals if s["resolved"] and not s["first_try_correct"] and not s["forced_resolve"]]
        retry_avg = round(sum(retry_attempts) / len(retry_attempts), 1) if retry_attempts else 0
        elapsed: Optional[int] = None
        if self.started_at_utc and self.completed_at_utc:
            delta = datetime.fromisoformat(self.completed_at_utc) - datetime.fromisoformat(self.started_at_utc)
            elapsed = int(delta.total_seconds())
        by_mode: Dict[str, Dict[str, int]] = {}
        for q in self.questions:
            st = self.status[q["id"]]
            entry = by_mode.setdefault(q["mode"], {"first_try": 0, "total": 0})
            entry["total"] += 1
            if st["first_try_correct"]:
                entry["first_try"] += 1
        return {
            "total": len(self.order),
            "first_try": first_try,
            "retry": retry,
            "forced": forced,
            "retry_avg_attempts": retry_avg,
            "elapsed_seconds": elapsed,
            "started_at_utc": self.started_at_utc,
            "completed_at_utc": self.completed_at_utc,
            "score": self.score,
            "by_mode": by_mode,
        }

    def state_payload(self) -> Dict[str, Any]:
        return {
            "done": self._all_resolved(),
            "current": (
                {"question_id": self.current_qid, "visit": self.current_visit}
                if self.current_qid
                else None
            ),
            "status": self._status_payload(),
            "stats": self.stats_payload(),
            **self._counts(),
        }


class SessionStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(
        self,
        questions: List[Dict[str, Any]],
        name: Optional[str],
        modes: List[str],
        difficulty: str = "medium",
    ) -> Session:
        round_id = uuid.uuid4().hex
        session = Session(round_id, questions, name, modes, difficulty)
        with self._lock:
            self._sessions[round_id] = session
        return session

    def get(self, round_id: str) -> Optional[Session]:
        with self._lock:
            return self._sessions.get(round_id)

    def drop(self, round_id: str) -> Optional[Session]:
        with self._lock:
            return self._sessions.pop(round_id, None)
