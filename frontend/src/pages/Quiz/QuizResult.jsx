import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Trophy, TrendingUp, AlertTriangle, Clock, Check, RotateCcw, SkipForward, Camera, Medal, ListChecks } from 'lucide-react';
import { navigate } from '../../router';
import { quizComplete, quizAbandon, quizHistory, quizRound, quizUploadPhoto, quizSubmitScore } from '../../api';
import { loadResults, loadRound, clearRound } from './store';
import { MODE_LABEL, fmt, scoreRank } from './util';

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 36 }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        dur: 1 + Math.random() * 0.6,
        color: Math.random() > 0.5 ? '#f5a623' : '#34d399',
        size: 6 + Math.random() * 6,
      })),
    [],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`@keyframes pfConfetti {0%{transform:translateY(-10vh) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}`}</style>
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${b.left}%`,
            top: 0,
            width: b.size,
            height: b.size * 0.6,
            background: b.color,
            borderRadius: 2,
            animation: `pfConfetti ${b.dur}s ease-in ${b.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

const mmss = (secs) => {
  const s = Math.max(0, Math.round(secs || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const pct = (n, total) => (total ? `${Math.round((n / total) * 100)}%` : '0%');

function Stat({ icon, label, value, sub }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-zinc-500">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-zinc-100">{value}</div>
      {sub && <div className="text-xs text-zinc-400 tabular-nums">{sub}</div>}
    </div>
  );
}

export default function QuizResult({ roundId }) {
  const results = useMemo(() => loadResults(roundId), [roundId]);
  const round = useMemo(() => loadRound(roundId), [roundId]);
  const setup = round?.setup || {};
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Optional photo for this entry — additive, never blocks the save. Seeds from the setup if one
  // was chosen up front; otherwise the user can add one here before saving.
  const [photoId, setPhotoId] = useState(setup.photoId || null);
  const [photoUrl, setPhotoUrl] = useState(setup.photoId ? `/api/quiz/photo/${setup.photoId}?w=200` : null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    quizHistory().then((d) => setHistory(d.rounds || [])).catch(() => {});
  }, []);

  if (!results) {
    return (
      <div className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-zinc-400">Kein Rundenergebnis gefunden.</p>
        <button type="button" onClick={() => navigate('/quiz')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">Zum Quiz</button>
      </div>
    );
  }

  const answers = results.answers || [];
  const stats = results.stats || null;
  const size = stats?.total ?? results.size ?? answers.length;
  const correct = stats?.first_try ?? answers.filter((a) => a.correct).length;
  const maxScore = size * 100;
  const accuracy = maxScore ? results.score / maxScore : 0;
  // Client-sequenced sound/series/mixed rounds carry no server session: render purely from the
  // client-collected results and skip the quizComplete/history path; only the leaderboard is shared.
  const sessionless = !!results.sessionless;

  // Placement among saved rounds. This round may not be persisted yet, so rank against the OTHERS
  // (by id) and add it in — gives a stable "Platz X von Y" both before and after saving.
  const rivalRounds = history.filter((r) => r.id !== roundId);
  const rank = scoreRank(results.score, rivalRounds.map((r) => r.score));
  const rankTotal = rivalRounds.length + 1;

  // Per-mode breakdown: first-try correctness from the server when available,
  // otherwise derived from the client's answer log.
  const byMode = {};
  if (stats?.by_mode) {
    Object.entries(stats.by_mode).forEach(([mode, v]) => {
      byMode[mode] = { correct: v.first_try, total: v.total };
    });
  } else {
    answers.forEach((a) => {
      const m = (byMode[a.mode] = byMode[a.mode] || { correct: 0, total: 0 });
      m.total += 1;
      if (a.correct) m.correct += 1;
    });
  }

  // Callout chips
  const chips = [];
  const otherScores = history.filter((r) => r.id !== roundId).map((r) => r.score || 0);
  if (otherScores.length === 0 || results.score >= Math.max(...otherScores)) {
    chips.push({ icon: <Trophy className="w-4 h-4" />, text: 'Beste Runde bisher!', tone: 'amber' });
  }
  const prev = [...history]
    .filter((r) => r.id !== roundId)
    .sort((a, b) => (b.finished_at || '').localeCompare(a.finished_at || ''))[0];
  if (prev && prev.size) {
    const prevAcc = (prev.score || 0) / (prev.size * 100);
    const delta = Math.round((accuracy - prevAcc) * 100);
    if (delta > 0) chips.push({ icon: <TrendingUp className="w-4 h-4" />, text: `Lernkurve: +${delta}% ggü. letztem Mal`, tone: 'emerald' });
  }
  const worst = Object.entries(byMode)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)[0];
  if (worst && worst[1].correct / worst[1].total < 0.6) {
    chips.push({ icon: <AlertTriangle className="w-4 h-4" />, text: `Stolperfalle: ${MODE_LABEL[worst[0]] || worst[0]}`, tone: 'rose' });
  }

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      const res = await quizUploadPhoto(file);
      setPhotoId(res.photo_id);
      setPhotoUrl(res.url || `/api/quiz/photo/${res.photo_id}`);
    } catch {
      /* photo is optional — ignore the upload failure, the round still saves without it */
    } finally {
      setPhotoBusy(false);
    }
  };

  // Submit one shared-leaderboard entry per player (the backend adds new names to the roster).
  const submitLeaderboard = () => {
    const names = (setup.playerNames && setup.playerNames.length ? setup.playerNames : [setup.name]).filter(Boolean);
    return Promise.all(names.map((p) => quizSubmitScore({
      name: p, score: results.score, correct, wrong: Math.max(0, size - correct), size,
    }).catch(() => {})));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    if (sessionless) {
      // No server session/history to complete — just publish the shared leaderboard entries, then
      // land on the Bestenliste so the player sees their new entry (the round itself isn't persisted).
      await submitLeaderboard();
      clearRound(roundId);
      navigate('/quiz/history?tab=board');
      return;
    }
    try {
      await quizComplete(roundId, {
        name: setup.name,
        player_names: setup.playerNames || [],
        photo_id: photoId || null,
      });
      await submitLeaderboard();
      clearRound(roundId);
      navigate(`/quiz/history?saved=${roundId}`);
    } catch {
      // The in-memory round session may be gone (e.g. the server restarted between play and save).
      // If the round already reached the persistent history, treat it as saved and show the board;
      // otherwise surface a retry instead of failing silently.
      try {
        await quizRound(roundId);
        clearRound(roundId);
        navigate(`/quiz/history?saved=${roundId}`);
      } catch {
        setSaving(false);
        setSaveError(true);
      }
    }
  };

  const discard = async () => {
    try {
      await quizAbandon(roundId);
    } catch {
      /* ignore */
    }
    clearRound(roundId);
    navigate('/quiz');
  };

  const toneClass = {
    amber: 'bg-amber-400/15 text-amber-200 ring-amber-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
    rose: 'bg-rose-500/15 text-rose-200 ring-rose-500/30',
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      {accuracy >= 0.7 && <Confetti />}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6 sm:py-12">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">Ergebnis</div>
          <div
            className="font-display-tight text-6xl sm:text-7xl tabular-nums leading-none text-amber-400"
            style={{ textShadow: '0 0 40px rgba(245,166,35,0.45)' }}
          >
            {fmt(results.score)}
          </div>
          <div className="mt-3 text-zinc-300 tabular-nums">
            {correct} / {size} beim ersten Versuch
          </div>
          {rankTotal > 1 && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/15 text-amber-300 ring-1 ring-amber-500/30 text-sm font-semibold">
              <Medal className="w-4 h-4" /> Platz {rank} von {rankTotal}
            </div>
          )}
        </div>

        {stats && (
          <div className="mt-8 rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-5">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-zinc-400" />
              <span className="font-display-tight text-4xl sm:text-5xl tabular-nums text-zinc-100">{mmss(stats.elapsed_seconds)}</span>
            </div>
            <div className={`grid ${stats.forced > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-3 text-center`}>
              <Stat icon={<Check className="w-4 h-4 text-emerald-400" />} label="1. Versuch" value={stats.first_try} sub={pct(stats.first_try, stats.total)} />
              <Stat
                icon={<RotateCcw className="w-4 h-4 text-amber-400" />}
                label="Wiederholt"
                value={stats.retry}
                sub={stats.retry > 0 ? `⌀ ${stats.retry_avg_attempts}×` : pct(stats.retry, stats.total)}
              />
              {stats.forced > 0 && (
                <Stat icon={<SkipForward className="w-4 h-4 text-zinc-400" />} label="Übersprungen" value={stats.forced} sub={pct(stats.forced, stats.total)} />
              )}
            </div>
          </div>
        )}

        <div className="mt-8 md:grid md:grid-cols-2 md:gap-6 md:items-start space-y-4 md:space-y-0">
          <div className="rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-5">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-3">Pro Modus</div>
            <div className="space-y-2.5">
              {Object.entries(byMode).map(([mode, v]) => (
                <div key={mode} className="flex items-center gap-3">
                  <div className="w-36 sm:w-44 text-sm text-zinc-300 truncate shrink-0">{MODE_LABEL[mode] || mode}</div>
                  <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-amber-400" style={{ width: `${v.total ? (v.correct / v.total) * 100 : 0}%` }} />
                  </div>
                  <div className="text-sm text-zinc-400 tabular-nums shrink-0">{v.correct}/{v.total}</div>
                </div>
              ))}
            </div>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap md:flex-col gap-2 justify-center md:justify-start">
              {chips.map((c, i) => (
                <span key={i} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ring-1 ${toneClass[c.tone]}`}>
                  {c.icon} {c.text}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Optional photo for this entry — additive, never blocks the save. */}
        <div className="mt-8 flex items-center justify-center gap-3">
          {photoUrl && <img src={photoUrl} alt="" className="w-12 h-12 rounded-xl object-cover ring-1 ring-zinc-700 shrink-0" />}
          <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-200 text-sm font-medium cursor-pointer active:scale-[0.98] transition-transform">
            {photoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {photoId ? 'Foto ändern' : 'Foto hinzufügen'}
            <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
          </label>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 w-full py-4 rounded-2xl text-zinc-950 font-semibold text-lg tracking-wide flex items-center justify-center gap-2 active:scale-[0.985] transition-transform disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #f5a623 0%, #ffaf3a 100%)' }}
        >
          {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Save className="w-6 h-6" />}
          Runde speichern
        </button>
        {saveError && (
          <p className="mt-3 text-center text-sm text-rose-300">Speichern fehlgeschlagen — bitte erneut versuchen.</p>
        )}
        <button type="button" onClick={() => navigate(`/quiz/solutions/${roundId}`)} className="mt-3 w-full min-h-[44px] rounded-2xl bg-zinc-800 text-zinc-100 font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
          <ListChecks className="w-5 h-5 text-amber-400" /> Auflösung anzeigen
        </button>
        <button type="button" onClick={discard} className="mt-3 w-full py-2 text-sm text-zinc-500 active:text-zinc-300">
          Verwerfen
        </button>
      </div>
    </div>
  );
}
