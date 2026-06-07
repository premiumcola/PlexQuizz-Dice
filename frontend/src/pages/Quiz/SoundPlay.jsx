import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Loader2, Music4, Play, Pause } from 'lucide-react';
import { navigate } from '../../router';
import { getThemeQuestion, getThemeEligible, getSeriesEligible } from '../../api';
import { loadRound, saveResults } from './store';
import { initAudio, preloadSounds, setSoundEnabled } from './audio';
import SoundQuestion from './SoundQuestion';
import SeriesQuestion from './SeriesQuestion';

// L4 + T2 — client-sequenced player for "Nur Sound", "Serien-Themes" and "Mixed". Sound + series
// questions use the standalone /api/themes/* and /api/series/* endpoints (no server session); for
// "Mixed" the normal questions come pre-generated in the stored round and are scored client-side
// from correct_option_id, so the polished server-session QuizPlay stays untouched. dvh single
// screen, no page scroll.

const REVEAL_MS = 1800;
const MIN_POOL = 8;
const HINT_PENALTY = 20;

// Shared, mode-independent score: 100 per correct answer, minus a small per-question hint penalty
// (-20 per hint used), floored at 0 per question. Same 0..size*100 scale as the normal mode's
// QuizResult (max = size*100), so every mode is comparable on the shared leaderboard.
function scoreResults(results) {
  return results.reduce(
    (sum, r) => sum + (r.correct ? Math.max(0, 100 - HINT_PENALTY * (r.hints || 0)) : 0),
    0,
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mixed plan: round-robin over the available content types, honouring per-type caps
// (normal ≤ normalCount, series ≤ seriesCount, sound effectively unlimited).
function buildMixedPlan(size, normalCount, includeSound, includeSeries, seriesCount) {
  const caps = {
    sound: includeSound ? Infinity : 0,
    normal: normalCount,
    series: includeSeries ? seriesCount : 0,
  };
  const order = ['sound', 'normal', 'series'];
  const used = { sound: 0, normal: 0, series: 0 };
  const plan = [];
  let oi = 0;
  let guard = 0;
  while (plan.length < size && guard < size * 6) {
    const t = order[oi % order.length];
    oi += 1; guard += 1;
    if (used[t] < caps[t]) { plan.push(t); used[t] += 1; }
  }
  return plan.length ? plan : Array.from({ length: Math.min(size, normalCount) }, () => 'normal');
}

// Compact normal-question card for Mixed rounds (single-select). Reveal-on-correct only.
function NormalCard({ q, onResolved }) {
  const [chosen, setChosen] = useState(null);
  const [locked, setLocked] = useState(false);
  const advanceRef = useRef(null);
  useEffect(() => () => clearTimeout(advanceRef.current), []);

  const pick = (id) => {
    if (locked) return;
    setLocked(true);
    setChosen(id);
    const correct = id === q.correct_option_id;
    const info = {
      correct,
      hints: 0,
      title: q.movie_title || null,
      year: q.movie_year ?? null,
      cover_url: q.movie_key ? `/api/library/thumb/${q.movie_key}` : null,
      plex_url: null,
    };
    advanceRef.current = setTimeout(() => onResolved(correct, info), REVEAL_MS);
  };

  const stem = q.stem || {};
  const imageOptions = (q.options || []).some((o) => o.kind === 'image');

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-3">
        {stem.caption && <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{stem.caption}</div>}
        {stem.kind === 'image' ? (
          <img src={stem.content} alt="" className="max-h-[28vh] w-auto mx-auto rounded-2xl object-contain" />
        ) : (
          <div className="text-zinc-100 text-lg font-semibold leading-snug">{stem.content}</div>
        )}
      </div>
      <div className={`flex-1 min-h-0 grid gap-2 ${imageOptions ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'} content-start overflow-y-auto`}>
        {(q.options || []).map((o) => {
          const isCorrect = locked && o.id === q.correct_option_id;
          const isWrongChosen = locked && o.id === chosen && o.id !== q.correct_option_id;
          let cls = 'bg-zinc-800/60 text-zinc-100 ring-1 ring-zinc-700';
          if (isCorrect) cls = 'bg-emerald-500/20 text-zinc-100 ring-2 ring-emerald-400';
          else if (isWrongChosen) cls = 'bg-rose-500/20 text-zinc-100 ring-2 ring-rose-500';
          return (
            <button
              key={o.id}
              type="button"
              disabled={locked}
              onClick={() => pick(o.id)}
              className={`relative rounded-2xl overflow-hidden min-h-[48px] active:scale-[0.98] transition-transform ${cls} ${o.kind === 'image' ? 'aspect-[2/3]' : 'p-3 flex items-center justify-center text-center'}`}
            >
              {o.kind === 'image' ? (
                <>
                  {o.content && <img src={o.content} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                  {o.label && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 to-transparent px-2 py-1 text-xs text-white truncate">{o.label}</span>}
                </>
              ) : (
                <span className="font-medium">{o.content}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SoundPlay({ roundId }) {
  const round = useRef(loadRound(roundId)).current;
  const mode = round?.mode || 'sound';
  const difficulty = round?.difficulty || 'medium';
  const soundOn = round?.sound_enabled !== false;
  const normalQs = useRef(
    (round?.questions || []).filter((q) => !q.multi_select && q.mode !== 'connect'),
  ).current;
  const targetSize = round ? (round.size || 10) : 10;

  const [plan, setPlan] = useState(null);
  const [building, setBuilding] = useState(true);
  const [buildError, setBuildError] = useState('');
  const seriesPoolRef = useRef([]);
  const seriesIdxRef = useRef(0);
  const normalIdxRef = useRef(0);

  const [step, setStep] = useState(0);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [correct, setCorrect] = useState(0);
  const [paused, setPaused] = useState(false);

  // Per-question results, collected client-side for the shared result + Auflösung (no server session).
  const resultsRef = useRef([]);
  const currentRef = useRef(null);
  const finishedRef = useRef(false);

  useEffect(() => { currentRef.current = current; }, [current]);

  useEffect(() => { preloadSounds(); setSoundEnabled(soundOn); initAudio(); }, [soundOn]);

  // Build the plan + load content sources once.
  useEffect(() => {
    if (!round) { setBuilding(false); return undefined; }
    let alive = true;
    (async () => {
      try {
        if (mode === 'sound') {
          if (alive) setPlan(Array.from({ length: targetSize }, () => 'sound'));
        } else if (mode === 'series') {
          const el = await getSeriesEligible();
          seriesPoolRef.current = shuffle(el.shows || []);
          const n = Math.min(targetSize, seriesPoolRef.current.length);
          if (alive) setPlan(Array.from({ length: n }, () => 'series'));
        } else {
          const [themes, series] = await Promise.all([
            getThemeEligible().catch(() => ({ count: 0 })),
            getSeriesEligible().catch(() => ({ count: 0, shows: [] })),
          ]);
          seriesPoolRef.current = shuffle(series.shows || []);
          const includeSound = (themes.count || 0) >= MIN_POOL;
          const includeSeries = (series.count || 0) >= MIN_POOL;
          if (alive) {
            setPlan(buildMixedPlan(targetSize, normalQs.length, includeSound, includeSeries, seriesPoolRef.current.length));
          }
        }
      } catch (e) {
        if (alive) setBuildError(e.message || 'Runde konnte nicht aufgebaut werden');
      } finally {
        if (alive) setBuilding(false);
      }
    })();
    return () => { alive = false; };
  }, [round, mode, targetSize, normalQs.length]);

  // Load the question for the current step.
  useEffect(() => {
    if (!plan || step >= plan.length) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    const type = plan[step];
    (async () => {
      try {
        if (type === 'normal') {
          const q = normalQs[normalIdxRef.current % normalQs.length];
          normalIdxRef.current += 1;
          if (alive) setCurrent({ type, payload: q });
        } else if (type === 'series') {
          const show = seriesPoolRef.current[seriesIdxRef.current % seriesPoolRef.current.length];
          seriesIdxRef.current += 1;
          if (alive) setCurrent({ type, payload: show });
        } else {
          const q = await getThemeQuestion(difficulty);
          if (alive) setCurrent({ type, payload: q });
        }
      } catch (e) {
        if (alive) setError(e.message || 'Frage konnte nicht geladen werden');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [step, plan, normalQs, difficulty]);

  const onResolved = useCallback((wasCorrect, info) => {
    resultsRef.current.push({
      mode: currentRef.current?.type || 'sound',
      correct: !!wasCorrect,
      hints: info?.hints || 0,
      title: info?.title || null,
      year: info?.year ?? null,
      cover_url: info?.cover_url || null,
      plex_url: info?.plex_url || null,
    });
    if (wasCorrect) setCorrect((c) => c + 1);
    setStep((s) => s + 1);
  }, []);

  // End the round (all done OR "Beenden & Auflösung"): assemble the shared result + per-question
  // Auflösung and hand off to the SAME result overview the normal mode uses. The leaderboard entry
  // is submitted from QuizResult.save (mirrors the normal mode), so quitting and finishing match.
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const played = resultsRef.current;
    const correctCount = played.filter((r) => r.correct).length;
    const answers = played.map((r) => ({ mode: r.mode, correct: r.correct }));
    const solutions = played.map((r) => ({
      title: r.title || 'Nicht erkannt',
      year: r.year,
      cover_url: r.cover_url,
      plex_url: r.plex_url,
      correct: r.correct,
    }));
    saveResults(roundId, {
      score: scoreResults(played),
      size: played.length,
      correct: correctCount,
      sessionless: true,
      mode,
      answers,
      solutions,
    });
    navigate(`/quiz/result/${roundId}`);
  }, [roundId, mode]);

  // Natural end: every planned question resolved → straight to the shared result overview.
  useEffect(() => {
    if (plan && plan.length > 0 && step >= plan.length) finish();
  }, [plan, step, finish]);

  if (!round) {
    return (
      <div className="h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-zinc-400">Runde nicht gefunden.</p>
        <button type="button" onClick={() => navigate('/quiz')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">Zurück zum Quiz</button>
      </div>
    );
  }

  if (building || !plan) {
    return (
      <div className="h-[100dvh] bg-zinc-950 text-zinc-100 flex items-center justify-center">
        {buildError ? (
          <div className="text-center px-6">
            <p className="text-rose-300 mb-3">{buildError}</p>
            <button type="button" onClick={() => navigate('/quiz')} className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200">Zurück</button>
          </div>
        ) : <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />}
      </div>
    );
  }

  if (plan.length === 0) {
    return (
      <div className="h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-zinc-400">Keine Fragen für diese Runde verfügbar.</p>
        <button type="button" onClick={() => navigate('/quiz/setup')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">Zurück zur Auswahl</button>
      </div>
    );
  }

  if (step >= plan.length) {
    // finish() routes to the shared result overview from an effect; brief loader while it navigates.
    return (
      <div className="h-[100dvh] bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="shrink-0 flex items-center gap-3 px-4 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2">
        <div className="flex items-center gap-2">
          <Music4 className="w-5 h-5 text-amber-400" />
          <span className="text-lg font-bold tabular-nums">{step + 1} / {plan.length}</span>
        </div>
        <div className="flex-1 text-right text-sm text-zinc-400 tabular-nums">
          <span className="text-emerald-400 font-semibold">{correct}</span> richtig
        </div>
        <button type="button" onClick={() => setPaused(true)} aria-label="Pause" className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center active:scale-95 transition-transform">
          <Pause className="w-5 h-5 text-zinc-400" />
        </button>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {loading || !current ? (
          <div className="h-full flex items-center justify-center text-zinc-500">
            {error ? (
              <div className="text-center">
                <p className="text-rose-300 mb-3">{error}</p>
                <button type="button" onClick={() => navigate('/quiz')} className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200">Zurück</button>
              </div>
            ) : <Loader2 className="w-6 h-6 animate-spin" />}
          </div>
        ) : current.type === 'sound' ? (
          <SoundQuestion key={current.payload.question_id} question={current.payload} soundOn={soundOn} paused={paused} onResolved={onResolved} />
        ) : current.type === 'series' ? (
          <SeriesQuestion key={current.payload.ratingKey} show={current.payload} soundOn={soundOn} paused={paused} onResolved={onResolved} />
        ) : (
          <NormalCard key={current.payload.id} q={current.payload} onResolved={onResolved} />
        )}
      </div>

      {/* Quit = pause + confirm (mirrors QuizPlay): resume, or end the round and see the Auflösung. */}
      {paused && (
        <div className="absolute inset-0 z-50 bg-zinc-950/85 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-6 text-center">
            <p className="font-display-tight text-2xl mb-1">Pausiert</p>
            <p className="text-sm text-zinc-400 mb-5">Frage pausiert · Ton gestoppt.</p>
            <div className="space-y-2">
              <button type="button" onClick={() => setPaused(false)} className="w-full min-h-[44px] py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2">
                <Play className="w-4 h-4 fill-zinc-950" /> Weiter
              </button>
              <button type="button" onClick={finish} className="w-full min-h-[44px] py-3 rounded-xl bg-rose-500/90 text-white font-medium flex items-center justify-center gap-2">
                <LogOut className="w-4 h-4" /> Beenden &amp; Auflösung
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
