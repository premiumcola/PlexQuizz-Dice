import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Loader2, Trophy, Music4 } from 'lucide-react';
import { navigate } from '../../router';
import { getThemeQuestion } from '../../api';
import { loadRound, clearRound } from './store';
import { initAudio, preloadSounds, setSoundEnabled } from './audio';
import SoundQuestion from './SoundQuestion';

// L4 — client-sequenced player for the "Nur Sound" and "Mixed" modes. Sound questions use the
// standalone /api/themes/* endpoints (no server round/session); for "Mixed" the normal questions
// come pre-generated in the stored round and are scored client-side from correct_option_id, so
// the polished server-session QuizPlay stays untouched. dvh-locked single screen, no page scroll.

const REVEAL_MS = 1800;

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
    advanceRef.current = setTimeout(() => onResolved(correct), REVEAL_MS);
  };

  const stem = q.stem || {};
  const stemImage = stem.kind === 'image';
  const imageOptions = (q.options || []).some((o) => o.kind === 'image');

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-3">
        {stem.caption && <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{stem.caption}</div>}
        {stemImage ? (
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
                  {o.label && (
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 to-transparent px-2 py-1 text-xs text-white truncate">{o.label}</span>
                  )}
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

// Build the play plan: 'sound' only, or alternating 'sound'/'normal' for mixed.
function buildPlan(mode, size, normalCount) {
  if (mode !== 'mixed' || normalCount === 0) {
    return Array.from({ length: size }, () => 'sound');
  }
  const plan = [];
  let normalLeft = normalCount;
  for (let i = 0; i < size; i += 1) {
    // Alternate, but fall back to sound once normal questions run out.
    if (i % 2 === 1 && normalLeft > 0) { plan.push('normal'); normalLeft -= 1; }
    else plan.push('sound');
  }
  return plan;
}

export default function SoundPlay({ roundId }) {
  const round = useRef(loadRound(roundId)).current;
  const mode = round?.mode || 'sound';
  const difficulty = round?.difficulty || 'medium';
  const soundOn = round?.sound_enabled !== false;

  // Single-select normal questions available for mixed interleaving.
  const normalQs = useRef(
    (round?.questions || []).filter((q) => !q.multi_select && q.mode !== 'connect'),
  ).current;
  const size = round ? (round.size || 10) : 10;
  const plan = useRef(buildPlan(mode, size, normalQs.length)).current;

  const [step, setStep] = useState(0);
  const [current, setCurrent] = useState(null); // {type, payload}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [correct, setCorrect] = useState(0);
  const normalIdxRef = useRef(0);

  useEffect(() => { preloadSounds(); setSoundEnabled(soundOn); initAudio(); }, [soundOn]);

  // Load the question for the current step.
  useEffect(() => {
    if (!round || step >= plan.length) return;
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
  }, [step, round, plan, normalQs, difficulty]);

  const onResolved = useCallback((wasCorrect) => {
    if (wasCorrect) setCorrect((c) => c + 1);
    setStep((s) => s + 1);
  }, []);

  const exit = () => { clearRound(roundId); navigate('/quiz'); };

  if (!round) {
    return (
      <div className="h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-zinc-400">Runde nicht gefunden.</p>
        <button type="button" onClick={() => navigate('/quiz')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">Zurück zum Quiz</button>
      </div>
    );
  }

  // End screen
  if (step >= plan.length) {
    const total = plan.length;
    return (
      <div className="h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-5 px-6 text-center">
        <Trophy className="w-14 h-14 text-amber-400" />
        <div>
          <div className="text-4xl font-bold tabular-nums">{correct} / {total}</div>
          <div className="text-zinc-400 mt-1">richtig erkannt</div>
        </div>
        <div className="flex gap-3 mt-2">
          <button type="button" onClick={() => navigate('/quiz/setup')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">Nochmal</button>
          <button type="button" onClick={exit} className="px-5 py-3 rounded-xl bg-zinc-800 text-zinc-200 font-semibold">Zum Quiz</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* HUD */}
      <div className="shrink-0 flex items-center gap-3 px-4 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2">
        <div className="flex items-center gap-2">
          <Music4 className="w-5 h-5 text-amber-400" />
          <span className="text-lg font-bold tabular-nums">{step + 1} / {plan.length}</span>
        </div>
        <div className="flex-1 text-right text-sm text-zinc-400 tabular-nums">
          <span className="text-emerald-400 font-semibold">{correct}</span> richtig
        </div>
        <button type="button" onClick={exit} aria-label="Beenden" className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center active:scale-95 transition-transform">
          <LogOut className="w-5 h-5 text-zinc-400" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {loading || !current ? (
          <div className="h-full flex items-center justify-center text-zinc-500">
            {error ? (
              <div className="text-center">
                <p className="text-rose-300 mb-3">{error}</p>
                <button type="button" onClick={() => navigate('/quiz')} className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200">Zurück</button>
              </div>
            ) : (
              <Loader2 className="w-6 h-6 animate-spin" />
            )}
          </div>
        ) : current.type === 'sound' ? (
          <SoundQuestion key={current.payload.question_id} question={current.payload} soundOn={soundOn} onResolved={onResolved} />
        ) : (
          <NormalCard key={current.payload.id} q={current.payload} onResolved={onResolved} />
        )}
      </div>
    </div>
  );
}
