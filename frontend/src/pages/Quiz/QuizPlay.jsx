import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Timer, Check, X, Pause, Play, RotateCcw, LogOut, MousePointerClick, User } from 'lucide-react';
import { navigate } from '../../router';
import { quizAnswer, quizAbandon, quizState } from '../../api';
import { loadRound, saveResults, clearRound } from './store';
import { MODE_PROMPT, MODE_CATEGORY, STEM_IS_PERSON, OPTIONS_ARE_PERSONS, OPTIONS_BLUR_NAME_BANDS, ANSWER_IS_MOVIE, panelOnRight, fmt } from './util';
import Fireworks from '../../components/Fireworks';
import DifficultyIcon from '../../components/DifficultyIcon';
import { usePrefs } from '../../usePrefs';
import { initAudio, playSound, preloadSounds, setSoundEnabled } from './audio';
import RadialCountdown from './RadialCountdown';
import QuizConnect from './QuizConnect';
import { renderRedactedPlot } from './redact';

// Title→poster question prints the answer title on the cover, so every candidate is blurred while
// unanswered. Blur radius (px) — strong enough that printed titles are illegible, while artwork and
// colours stay distinguishable. Easy to tune: raise for more obscurity, lower for less.
const GIVEAWAY_BLUR_PX = 7;

function basePoints(timeMs) {
  if (timeMs <= 5000) return 100;
  if (timeMs <= 10000) return 80;
  if (timeMs <= 15000) return 60;
  return 0;
}

function mmss(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// A short text stem (a "pill" — the "A & B" two-stars line, "Drehbuch: <name>", …)
// needs no tall Stage; shrink it so the cover options claim the lower viewport. Long
// text stems (plot / tagline / redacted plot) stay tall.
function stemIsShortText(q) {
  if (q.stem?.kind !== 'text') return false;
  const text = String(q.stem.content || '').trim();
  if (!text) return false;
  const PILL_MODES = new Set([
    'two_actors_to_shared',
    'writer_to_movie',
    'slogan_to_movie',
  ]);
  if (PILL_MODES.has(q.mode)) return true;
  // Belt-and-braces: any TEXT stem under 60 chars counts as a pill.
  return text.length <= 60;
}

// Auto-fit the answer covers. Measures the option area and picks the column count + cover width that
// makes every cover as large as possible while ALL of them stay fully visible without scrolling (any
// count, any viewport). `aspect` (width/height) is the cover shape — 2/3 for posters, 1 for square
// person photos — so cells match it exactly and object-cover neither stretches nor crops. A
// ResizeObserver re-fits on rotate / resize / question change.
function useFitCovers(count, ref, enabled, aspect = 2 / 3, gap = 12) {
  const [fit, setFit] = useState({ cols: 1, coverW: 0, gap });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !count || !el) return undefined;
    const compute = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      let best = { cols: 1, coverW: 0, gap };
      for (let c = 1; c <= count; c += 1) {
        const r = Math.ceil(count / c);
        const cellW = (W - (c - 1) * gap) / c;
        const cellH = (H - (r - 1) * gap) / r;
        if (cellW > 0 && cellH > 0) {
          const coverW = Math.min(cellW, cellH * aspect);
          if (coverW > best.coverW) best = { cols: c, coverW, gap };
        }
      }
      best.coverW = Math.floor(best.coverW);
      setFit((prev) => (prev.cols === best.cols && Math.abs(prev.coverW - best.coverW) < 1 ? prev : best));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count, ref, enabled, aspect, gap]);
  return fit;
}

// THE single subject-image renderer for every question. Routes strictly by image KIND via `aspect`:
// a still/backdrop (16/9) ALWAYS lands in a landscape container, a poster in 2:3, a person photo in
// 1:1 — a still can never be forced into a 2:3 box (the recurring bug). object-cover → never
// distorted. cover_to_title gets the heavy blur + one sharp window (lifted on a correct answer).
// `className` carries sizing + decoration; extra overlays (e.g. a name) go in children.
function SubjectImage({ content, aspect, mode, revealCorrect = false, className = '', children }) {
  const aspectClass = aspect === '16/9' ? 'aspect-[16/9]' : aspect === '1/1' ? 'aspect-square' : 'aspect-[2/3]';
  const person = STEM_IS_PERSON.has(mode);
  const blurred = mode === 'cover_to_title' && !revealCorrect;
  return (
    <div className={`relative ${aspectClass} rounded-2xl overflow-hidden ${className}`}>
      {content ? (
        <img
          src={content}
          alt=""
          className={`w-full h-full object-cover ${person ? 'object-top' : 'object-center'}`}
          style={blurred ? { filter: 'blur(18px) brightness(0.85) saturate(1.15)', transform: 'scale(1.04)' } : undefined}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center"><User className="w-1/3 h-1/3 text-zinc-600" /></div>
      )}
      {blurred && (
        <img
          src={content}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center"
          style={{ transform: 'scale(1.04)', clipPath: 'circle(16% at 58% 42%)', WebkitClipPath: 'circle(16% at 58% 42%)' }}
        />
      )}
      {children}
    </div>
  );
}

// Dark-Panel option. Unselected = zinc; selected (not locked) = amber outline;
// reveal = emerald (correct) / rose (wrong chosen).
function OptionButton({ option, mode, fill, selected, locked, reveal, revealCorrect, onTap, hint, btnRef, flash, coverWidth }) {
  let cls = 'border-2 border-zinc-700 bg-zinc-800/60 text-zinc-100';
  let anim;
  if (!locked && selected) {
    // Selection: an accent (#f5a623) border drawn INSIDE the cell (border-box → never wider than
    // the cell) plus an accent fill and a soft glow for elevation. NO scale transform — a zoom would
    // push the card past its grid cell and the overflow-hidden option area would clip the poster top
    // and the "Nochmal tippen" hint (the reported bug). Border width stays constant across states so
    // the poster never reflows.
    cls = 'border-[3px] border-[#f5a623] bg-[#f5a623]/25 text-amber-100 shadow-[0_0_12px_rgba(245,166,35,0.45)]';
  }
  if (locked && reveal) {
    const isCorrect = reveal.correctIds.includes(option.id);
    const isChosen = reveal.chosenIds.has(option.id);
    if (isCorrect) {
      cls = 'border-2 border-emerald-400 bg-emerald-500/20 text-zinc-100';
      if (isChosen) anim = 'pfCorrect 0.4s ease';
    } else if (isChosen) {
      cls = 'border-2 border-rose-500 bg-rose-500/20 text-zinc-100';
      anim = 'pfWrong 0.3s ease';
    } else {
      cls = 'border-2 border-zinc-700 bg-zinc-800/60 text-zinc-100 opacity-50';
    }
  }
  const isImage = option.kind === 'image';
  // The film title is the hidden answer only for ANSWER_IS_MOVIE modes → reveal it on the CORRECT
  // cover (never for attribute/person modes, where the title is the visible subject).
  const isCorrectOption = !!(locked && reveal && reveal.correctIds.includes(option.id));
  const titleReveal = isImage && revealCorrect && isCorrectOption && ANSWER_IS_MOVIE.has(mode);
  // Image options sit in a measured 2:3 grid cell (useFitCovers sizes the column to coverWidth): the
  // button fills that column and an aspect-[2/3] box, so object-cover shows the WHOLE poster with no
  // stretch and no crop. (Fallback w-full h-full covers a cell with no measured width.) The
  // title→poster question gives the answer away (the title is printed on the cover), so blur every
  // candidate while unanswered; the blur lifts on reveal. Other image questions (e.g. actor→movie)
  // stay sharp — the posters ARE the answer.
  // Render each option by its image KIND so nothing is distorted: landscape stills 16:9, person
  // portraits 1:1 (square), movie posters 2:3. object-cover fills the matching cell without stretch.
  const optAspectClass = option.aspect === '16/9' ? 'aspect-[16/9]'
    : (option.aspect === '1/1' || OPTIONS_ARE_PERSONS.has(mode)) ? 'aspect-square'
      : 'aspect-[2/3]';
  const imageBox = coverWidth ? `w-full ${optAspectClass}` : 'w-full h-full';
  // The blur hides the title printed on the poster; lift it only on a CORRECT answer (a wrong pick
  // keeps the candidates unspoiled for when they reappear).
  const blurGiveaway = isImage && mode === 'title_year_to_cover' && !revealCorrect;
  // Actor→film posters often print the actor's name along the top/bottom edge → blur those bands.
  const nameBands = isImage && OPTIONS_BLUR_NAME_BANDS.has(mode);
  // Text options: in a text-only grid they stretch to fill the cell (big, centered);
  // otherwise (a rare text fallback among images) they stay compact and left-aligned.
  const textBox = fill
    ? 'h-full p-4 md:p-6 flex flex-col items-center justify-center text-center'
    : 'min-h-[64px] p-3 md:p-4 flex flex-col justify-center text-left';
  return (
    <button
      ref={btnRef}
      type="button"
      disabled={locked}
      onClick={() => onTap(option.id)}
      style={{ animation: anim || 'none' }}
      className={`relative rounded-2xl overflow-hidden ${cls} transition-all duration-[120ms] ease-out active:scale-[0.97] disabled:active:scale-100 ${isImage ? imageBox : textBox} ${flash ? 'animate-quizCardFlash' : ''}`}
    >
      {isImage ? (
        <>
          {option.content ? (
            <img
              src={option.content}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover ${OPTIONS_ARE_PERSONS.has(mode) ? 'object-top' : 'object-center'}`}
              style={{
                filter: blurGiveaway ? `blur(${GIVEAWAY_BLUR_PX}px)` : 'none',
                transform: blurGiveaway ? 'scale(1.06)' : 'none',
                transition: 'filter 0.3s ease, transform 0.3s ease',
              }}
            />
          ) : (
            // Graceful fallback — never a blank card. Person options show a neutral avatar icon
            // (the name label still renders below); the backend already filters photo-less people.
            <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
              {OPTIONS_ARE_PERSONS.has(mode) && <User className="w-1/3 h-1/3 text-zinc-600" />}
            </div>
          )}
          {nameBands && (
            <>
              <div
                className="absolute inset-x-0 top-0 pointer-events-none"
                style={{ height: '13%', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', background: 'linear-gradient(to bottom, rgba(9,9,11,0.5), rgba(9,9,11,0))' }}
              />
              <div
                className="absolute inset-x-0 bottom-0 pointer-events-none"
                style={{ height: '13%', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', background: 'linear-gradient(to top, rgba(9,9,11,0.5), rgba(9,9,11,0))' }}
              />
            </>
          )}
          {/* Person options always show the name (you pick by name) — single line. */}
          {OPTIONS_ARE_PERSONS.has(mode) && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 to-transparent px-2 py-1.5">
              <div className="text-xs sm:text-sm font-medium text-white truncate">{option.label}</div>
            </div>
          )}
          {/* Reveal-on-correct: the answer film's title overlaid on the CORRECT cover, fit to width
              and wrapping to at most 2 lines (a hard, no-text-hint round otherwise). */}
          {titleReveal && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/75 to-transparent px-2 pt-5 pb-1.5">
              <div className="text-xs sm:text-sm font-semibold text-white text-center leading-tight line-clamp-2">{option.label}</div>
            </div>
          )}
          {selected && !locked && hint && (
            <div
              className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 overflow-hidden bg-amber-500/85 px-2 py-1 text-[11px] font-medium text-zinc-950"
              style={{ maxHeight: '22%', animation: 'pfHintIn 0.15s ease' }}
            >
              <MousePointerClick className="w-3 h-3 shrink-0" />
              <span className="truncate">Nochmal tippen zum Bestätigen</span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`font-semibold leading-tight ${fill ? 'text-lg md:text-2xl tabular-nums' : 'text-base sm:text-lg'}`}>{option.content}</div>
          {option.label && <div className="text-xs text-zinc-400 tabular-nums mt-0.5">{option.label}</div>}
          {selected && !locked && hint && (
            <div
              className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-medium uppercase tracking-wide text-amber-300/90"
              style={{ animation: 'pfHintIn 0.15s ease' }}
            >
              <MousePointerClick className="w-3 h-3 shrink-0" />
              Nochmal tippen zum Bestätigen
            </div>
          )}
        </>
      )}
    </button>
  );
}

// Per-question attempt history for the chip strip, reconstructed from the server status (no new
// client state): each entry true = right, false = wrong, in attempt order; [] = not yet answered.
// A resolved question got its LAST attempt right and every earlier attempt wrong; a forced-resolve
// (skipped after 5 tries) or still-unresolved retry question has only wrong attempts so far.
function resultDots(st) {
  if (!st || !st.attempts) return [];
  if (st.forced_resolve) return Array(st.attempts).fill(false);
  if (st.resolved) {
    if (st.first_try_correct) return [true];
    return [...Array(Math.max(0, st.attempts - 1)).fill(false), true];
  }
  return Array(st.attempts).fill(false);
}

// Flat single-row progress strip. One chip per question encodes: the attempt history (dots, red =
// wrong / green = right, in chronological order — a re-asked question shows its full sequence), the
// difficulty (DifficultyIcon above the chip → a difficulty profile across the whole row), and the
// CURRENT question (a wider accent tile with position, category and a prominent difficulty icon).
// Horizontally scrollable with the active tile auto-centred when 20 questions overflow one iPhone row.
function ChipStrip({ questions, statusMap, currentQid }) {
  const total = questions.length;
  const currentIndex = questions.findIndex((qq) => qq.id === currentQid);
  const activeRef = useRef(null);

  // Keep the active tile centred as the quiz advances. block:'nearest' stops it scrolling the page.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [currentQid]);

  return (
    <div
      aria-label="Fragen-Fortschritt"
      className="quiz-chipstrip shrink-0 flex items-end gap-1.5 overflow-x-auto bg-zinc-900 py-2"
      style={{ paddingInline: 'max(0.75rem, env(safe-area-inset-left))' }}
    >
      {questions.map((qq, i) => {
        // Questions carry a 1-3 tier; TODO: default to 2 (mittel) if a future question type omits it.
        const level = Math.max(1, Math.min(3, qq.tier || qq.difficulty || 2));
        if (qq.id === currentQid) {
          return (
            <div
              key={qq.id}
              ref={activeRef}
              aria-current="step"
              aria-label={`Frage ${currentIndex + 1} von ${total} · ${MODE_CATEGORY[qq.mode] || 'Frage'}`}
              className="shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl bg-[#f5a623] px-3 py-1 text-zinc-950"
            >
              <span className="text-[9px] font-bold uppercase tracking-wide leading-none">{MODE_CATEGORY[qq.mode] || 'Frage'}</span>
              <span className="text-sm font-extrabold tabular-nums leading-none">{currentIndex + 1} / {total}</span>
              {/* Dark accent: the tile background IS #f5a623, so filled bars must contrast here. */}
              <DifficultyIcon level={level} accent="#18181b" className="w-9 text-zinc-950" />
            </div>
          );
        }
        const dots = resultDots(statusMap[qq.id]);
        return (
          <div key={qq.id} className="shrink-0 flex flex-col items-center gap-1">
            <DifficultyIcon level={level} className="w-7 text-zinc-500" />
            <div className="flex items-center justify-center gap-0.5 rounded-lg bg-zinc-800 px-1.5 min-h-[20px] min-w-[20px]">
              {dots.length === 0 ? (
                <span className="w-1.5 h-1.5 rounded-full" style={{ border: '1.5px solid #52525b' }} aria-hidden="true" />
              ) : (
                dots.map((ok, di) => (
                  <span
                    key={di}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: ok ? '#22c55e' : '#ef4444' }}
                    aria-hidden="true"
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function QuizPlay({ roundId }) {
  const round = useRef(loadRound(roundId)).current;
  const questions = round?.questions || [];
  const dur = (round?.countdown_seconds || 15) * 1000;
  const soundOn = round?.sound_enabled !== false;
  const autoreveal = round?.autoreveal_delay_ms || 1200;
  const showCorrect = round?.show_correct_on_wrong !== false;

  const total = questions.length;
  const byId = useRef(Object.fromEntries(questions.map((qq) => [qq.id, qq]))).current;

  const [currentQid, setCurrentQid] = useState(questions[0]?.id || null);
  const [visit, setVisit] = useState('first');
  const [visitSeq, setVisitSeq] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [statusMap, setStatusMap] = useState({});
  const [toast, setToast] = useState(null);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [locked, setLocked] = useState(false);
  const [reveal, setReveal] = useState(null);
  // Reveal-on-CORRECT only: on a correct answer, briefly show extras (the film title) and lift any
  // blur; a wrong answer reveals nothing and keeps blurs on (items may reappear unspoiled).
  const [revealCorrect, setRevealCorrect] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [remaining, setRemaining] = useState(dur);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState(false);
  const { reduceMotion } = usePrefs();
  const correctOptionRef = useRef(null);
  const [fireworksOrigin, setFireworksOrigin] = useState(null);
  const [fireworksKey, setFireworksKey] = useState(0);
  const [showCardFlash, setShowCardFlash] = useState(false);
  const [showPageWash, setShowPageWash] = useState(false);
  const [roundTwoIntroShown, setRoundTwoIntroShown] = useState(false);
  const [showRoundTwoIntro, setShowRoundTwoIntro] = useState(false);
  const [roundTwoCountdown, setRoundTwoCountdown] = useState(3);

  const startRef = useRef(Date.now());
  const roundStartRef = useRef(Date.now());
  const pausedRef = useRef(false);
  const pauseRemainRef = useRef(dur);
  const lastSecRef = useRef(null);
  const answersRef = useRef([]);
  const selectedRef = useRef([]);
  const lastTapRef = useRef({ id: null, ts: 0 });
  const advanceRef = useRef(null);
  const toastRef = useRef(null);
  const scoreRef = useRef(0);
  const introActiveRef = useRef(false); // true while the round-2 overlay freezes the timer
  const roundTwoTimerRef = useRef(null);

  const q = byId[currentQid];
  // Connect ("Verbinden") rounds carry pairs/items/columns instead of a stem + options, and render
  // in their own component; guard the stem/option-derived values below so they never touch q.stem
  // / q.options for a connect question.
  const isConnect = !!q && q.mode === 'connect';

  // Answer-cover auto-fit: only for image-option questions (text options fill their cells instead).
  // Person-photo options fit a 1:1 box; movie posters fit 2:3.
  const optionAreaRef = useRef(null);
  const imageOptionCount = q && !isConnect && !q.options.every((o) => o.kind === 'text') ? q.options.length : 0;
  // Cover-fit cell shape matches the option image kind: 16:9 stills, 1:1 person portraits, 2:3 posters.
  const optAspect = imageOptionCount
    ? (q.options[0].aspect || (OPTIONS_ARE_PERSONS.has(q.mode) ? '1/1' : '2/3'))
    : '2/3';
  const optAspectNum = optAspect === '16/9' ? 16 / 9 : optAspect === '1/1' ? 1 : 2 / 3;
  const coverFit = useFitCovers(imageOptionCount, optionAreaRef, imageOptionCount > 0, optAspectNum);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Mastery rounds end only when every question is resolved; pull the final stats
  // from the (still-alive) server session so the result screen can show them.
  const finish = useCallback(async () => {
    let stats = null;
    try {
      const st = await quizState(roundId);
      stats = st?.stats || null;
    } catch {
      /* round gone / offline — fall back to client tallies */
    }
    saveResults(roundId, {
      score: stats?.score ?? scoreRef.current,
      size: total,
      stats,
      answers: answersRef.current,
    });
    navigate(`/quiz/result/${roundId}`);
  }, [roundId, total]);

  // Close the round-2 overlay (countdown done or tapped) and hand the retry
  // question its full clock — the timer stayed frozen while the overlay was up.
  const dismissRoundTwoIntro = useCallback(() => {
    if (roundTwoTimerRef.current) {
      clearInterval(roundTwoTimerRef.current);
      roundTwoTimerRef.current = null;
    }
    introActiveRef.current = false;
    startRef.current = Date.now();
    setRemaining(dur);
    setShowRoundTwoIntro(false);
  }, [dur]);

  // Announce the retry pool with a 3 → 2 → 1 countdown, then reveal the question.
  const startRoundTwoIntro = useCallback(() => {
    setRoundTwoIntroShown(true);
    setShowRoundTwoIntro(true);
    if (soundOn) playSound('drumroll');
    setRoundTwoCountdown(3);
    introActiveRef.current = true; // read inside the question-timer interval to pause it
    if (roundTwoTimerRef.current) clearInterval(roundTwoTimerRef.current);
    let n = 3;
    roundTwoTimerRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) dismissRoundTwoIntro();
      else setRoundTwoCountdown(n);
    }, 900);
  }, [dismissRoundTwoIntro]);

  // Advance to whatever the server serves next (a first visit or a retry), or
  // finish once the round is fully resolved.
  const applyNext = useCallback(
    (resp) => {
      if (!resp) {
        finish();
        return;
      }
      if (resp.status) setStatusMap(resp.status);
      if (typeof resp.resolved_count === 'number') setResolvedCount(resp.resolved_count);
      if (typeof resp.current_score === 'number') {
        setScore(resp.current_score);
        scoreRef.current = resp.current_score;
      }
      if (resp.forced_resolve) showToast('Frage übersprungen nach 5 Versuchen');
      if (resp.done || !resp.next) {
        finish();
        return;
      }
      const nextVisit = resp.next.visit || 'first';
      setCurrentQid(resp.next.question_id);
      setVisit(nextVisit);
      setVisitSeq((n) => n + 1);
      setLocked(false);
      setReveal(null);
      setRevealCorrect(false);
      setSelectedIds([]);
      selectedRef.current = [];
      lastTapRef.current = { id: null, ts: 0 };
      // First retry of the session → announce round 2 (timer paused until dismissed).
      if (nextVisit === 'retry' && !roundTwoIntroShown) startRoundTwoIntro();
    },
    [finish, showToast, roundTwoIntroShown, startRoundTwoIntro],
  );

  const lockIn = useCallback(
    (chosenArr, timedOut = false) => {
      if (locked || !q) return;
      setLocked(true);
      const timeMs = timedOut ? dur : Math.min(dur, Date.now() - startRef.current);
      const chosenSet = new Set(chosenArr);
      let correct;
      let pts;
      let correctIds;
      let payload;
      if (q.multi_select) {
        correctIds = q.correct_option_ids || [];
        const hits = correctIds.filter((id) => chosenSet.has(id)).length;
        const wrong = chosenArr.filter((id) => !correctIds.includes(id)).length;
        const frac = Math.max(0, hits - wrong) / (correctIds.length || 1);
        pts = Math.round(basePoints(timeMs) * frac);
        correct = frac >= 1;
        payload = { question_id: q.id, chosen_option_ids: chosenArr, time_ms: timeMs };
      } else {
        correctIds = [q.correct_option_id];
        const id = chosenArr[0] ?? null;
        correct = id === q.correct_option_id;
        pts = correct ? basePoints(timeMs) : 0;
        payload = { question_id: q.id, chosen_option_id: id, time_ms: timeMs };
      }
      setReveal({ correctIds: correct || showCorrect ? correctIds : [], chosenIds: chosenSet });
      setRevealCorrect(correct); // extras + un-blur only when right; wrong stays unspoiled
      if (correct) setCorrectCount((c) => c + 1);
      else setWrongCount((c) => c + 1);
      answersRef.current.push({ mode: q.mode, correct, points: pts, difficulty: q.difficulty });
      if (soundOn) playSound(correct ? 'correct' : 'loser');
      if (correct && !reduceMotion) {
        // Rockets launch from the correct card's centre and explode upward; the card
        // flickers multi-colour and a brief emerald wash flashes once. ≤ 2 s total.
        const el = correctOptionRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          setFireworksOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
          setFireworksKey((k) => k + 1);
          setShowCardFlash(true);
          setShowPageWash(true);
          setTimeout(() => setShowCardFlash(false), 900);
          setTimeout(() => setShowPageWash(false), 280);
          setTimeout(() => setFireworksOrigin(null), 2000);
        }
      }
      if (timedOut) {
        setFlash(true);
        setTimeout(() => setFlash(false), 200);
      }
      // The server response decides what comes next (retry order is server-side). A correct answer
      // lingers a little (>= 2s) so the brief reveal (title + un-blur) is enjoyable; wrong advances
      // at the normal pace with nothing revealed.
      const answerPromise = quizAnswer(roundId, payload).catch(() => null);
      advanceRef.current = setTimeout(async () => {
        applyNext(await answerPromise);
      }, correct ? Math.max(autoreveal, 2000) : autoreveal);
    },
    [locked, q, roundId, applyNext, dur, soundOn, showCorrect, autoreveal, reduceMotion],
  );

  const onOption = (id) => {
    if (locked || pausedRef.current) return;
    initAudio();
    if (q.multi_select) {
      if (soundOn) playSound('click');
      setSelectedIds((sel) => {
        const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        selectedRef.current = next;
        return next;
      });
      return;
    }
    // Single-select: first tap marks the option, a second tap on the SAME option
    // confirms (this replaces the old Bestätigen button). Ignore a second tap within
    // 120 ms of the first as an accidental fat-finger double-tap.
    const now = Date.now();
    const isMarked = selectedRef.current.length === 1 && selectedRef.current[0] === id;
    if (isMarked) {
      if (now - lastTapRef.current.ts < 120) return;
      lockIn([id]);
      return;
    }
    if (soundOn) playSound('click');
    lastTapRef.current = { id, ts: now };
    selectedRef.current = [id];
    setSelectedIds([id]);
  };

  // Decode all sounds up front (zero first-tick latency) and gate them on this round's
  // Sound setting so playSound honours it even from the timer interval.
  useEffect(() => { preloadSounds(); setSoundEnabled(soundOn); }, [soundOn]);

  useEffect(() => {
    if (locked || !q) return undefined;
    startRef.current = Date.now();
    // Connect rounds are a multi-step matching task — no per-question countdown / timeout.
    if (q.mode === 'connect') return undefined;
    lastSecRef.current = null;
    setRemaining(dur);
    const iv = setInterval(() => {
      if (pausedRef.current || introActiveRef.current) return;
      const rem = dur - (Date.now() - startRef.current);
      if (rem <= 0) {
        setRemaining(0);
        if (soundOn) playSound('alarm');
        lockIn(selectedRef.current, true);
        return;
      }
      setRemaining(rem);
      // One sound per whole second as it counts down: tick at 10→6, bomb at 5→1.
      const sec = Math.ceil(rem / 1000);
      if (sec !== lastSecRef.current) {
        lastSecRef.current = sec;
        if (soundOn) {
          if (sec >= 6 && sec <= 10) playSound('tick');
          else if (sec >= 1 && sec <= 5) playSound('bomb');
        }
      }
    }, 100);
    return () => clearInterval(iv);
  }, [visitSeq, locked, q, lockIn, dur, soundOn]);

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - roundStartRef.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let lock;
    (async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* unsupported */
      }
    })();
    return () => {
      try {
        lock && lock.release();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const doPause = useCallback(() => {
    pauseRemainRef.current = remaining;
    pausedRef.current = true;
    setPaused(true);
  }, [remaining]);

  const resume = () => {
    startRef.current = Date.now() - (dur - pauseRemainRef.current);
    pausedRef.current = false;
    setPaused(false);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') doPause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doPause]);

  useEffect(
    () => () => {
      clearTimeout(advanceRef.current);
      clearTimeout(toastRef.current);
      clearInterval(roundTwoTimerRef.current);
    },
    [],
  );

  if (!round || !q) {
    return (
      <div className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-zinc-400">Runde nicht gefunden (oder Server neu gestartet).</p>
        <button type="button" onClick={() => navigate('/quiz')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">
          Zurück zum Quiz
        </button>
      </div>
    );
  }

  const stem = q.stem || {};
  const stemImage = stem.kind === 'image';
  // Stem aspect comes from the backend (16/9 backdrops, 1/1 faces); default 2/3 posters. SubjectImage
  // maps the aspect → container; stemLandscape only drives the wrapper sizing/decoration here.
  const stemAspect = stem.aspect || (STEM_IS_PERSON.has(q.mode) ? '1/1' : '2/3');
  const stemLandscape = stemAspect === '16/9';
  // A short "pill" text stem shrinks the Stage so the cover options fill the Panel
  // below; it stays panel-below on every breakpoint (never side-by-side).
  const shortStage = stemIsShortText(q);
  // Single-actor question: a COMPACT header (question top-left, portrait + name side by side)
  // instead of a centred portrait with the name below — frees the Panel for the answer covers.
  const compactActor = !isConnect && q.mode === 'actor_to_movie' && stem.kind === 'image';
  // Filmography (multi-select): same compact header, but the person name is OVERLAID on the portrait
  // bottom (no extra height) — frees the Panel so the hint, 6 covers and Bestätigen all fit no-scroll.
  const compactFilmography = !isConnect && q.mode === 'actor_filmography_multi' && stem.kind === 'image';
  const compactHeader = compactActor || compactFilmography;
  // md+ only: tall image options claim the full-height stage on the right so covers
  // never clip; pill stems, multi-select trays and connect rounds sit full-width regardless.
  const wantsRight = panelOnRight(q) && !shortStage && !isConnect && !compactHeader;
  // A text-only option grid stretches to fill the Panel; image grids keep their aspect.
  const textOptions = !isConnect && q.options.every((o) => o.kind === 'text');
  const gridCols = !isConnect && q.options.length > 4 ? 'grid-cols-3' : 'grid-cols-2';
  const vignette = remaining <= 5000 && !locked && !isConnect;

  const leave = async (to) => {
    clearTimeout(advanceRef.current);
    try {
      await quizAbandon(roundId);
    } catch {
      /* ignore */
    }
    clearRound(roundId);
    navigate(to);
  };

  // Stop the round and show the Auflösung (every correct answer, incl. missed). Abandon marks
  // the round ended server-side (it is NOT dropped), so /solutions can resolve it.
  const goSolutions = async () => {
    clearTimeout(advanceRef.current);
    try { await quizAbandon(roundId); } catch { /* ignore */ }
    navigate(`/quiz/solutions/${roundId}`);
  };

  // One option chip. coverWidth is set only on the measured image grid (→ a fixed 2:3 box).
  const renderOption = (o, coverWidth) => (
    <OptionButton
      key={o.id}
      option={o}
      mode={q.mode}
      fill={textOptions}
      selected={selectedIds.includes(o.id)}
      locked={locked}
      reveal={reveal}
      revealCorrect={revealCorrect}
      onTap={onOption}
      hint={!q.multi_select}
      btnRef={o.id === q.correct_option_id ? correctOptionRef : undefined}
      flash={showCardFlash && o.id === q.correct_option_id}
      coverWidth={coverWidth}
    />
  );

  return (
    // Lock the quiz to ONE visible viewport: 100dvh tracks the real visible height (browser window /
    // standalone PWA), unlike the parent's max(innerHeight, screen.height) app-height which overshoots
    // on desktop (physical screen) and iOS — that overshoot is what scrolled the page and cut covers
    // off. overflow-hidden + the dvh cap make the page itself non-scrollable; children use min-h-0 to
    // shrink instead of overflow. dvh (NOT vh) so it never floats on iOS toolbar changes.
    <div className={`h-[100dvh] flex flex-col overflow-hidden relative ${wantsRight ? 'md:flex-row' : ''}`}>
      <style>{`
        @keyframes pfVignette {0%,100%{opacity:0.6}50%{opacity:1}}
        @keyframes pfSlideUp {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pfCorrect {0%,100%{transform:scale(1)}40%{transform:scale(1.05)}}
        @keyframes pfWrong {0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
        @keyframes pfHintIn {from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {vignette && (
        <div className="pointer-events-none absolute inset-0 z-40" style={{
          background: 'radial-gradient(ellipse at center, transparent 45%, rgba(185,28,28,0.25) 100%)',
          animation: 'pfVignette 0.5s ease-in-out infinite',
        }} />
      )}
      {flash && <div className="pointer-events-none absolute inset-0 z-40" style={{ background: 'rgba(185,28,28,0.35)' }} />}

      {fireworksOrigin && (
        <Fireworks key={fireworksKey} variant="bursts" origin={fireworksOrigin} />
      )}
      {showPageWash && (
        <div className="absolute inset-0 z-[55] pointer-events-none bg-emerald-400/15 animate-quizPageWash" />
      )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex justify-center px-4" role="status" aria-live="polite">
          <span className="rounded-full bg-zinc-900/95 text-zinc-100 ring-1 ring-amber-500/40 px-4 py-2 text-sm shadow-lg" style={{ animation: 'pfHintIn 0.2s ease' }}>
            {toast}
          </span>
        </div>
      )}

      {/* Stage + Panel hide behind the round-2 overlay so the retry question
          never flashes before the countdown completes. */}
      {!showRoundTwoIntro && (
      <>
      {/* Stage — light neutral surface (connect rounds use it as a fixed header only) */}
      <div className={`relative flex flex-col w-full bg-zinc-100 text-zinc-900 ${isConnect || compactHeader ? 'shrink-0' : shortStage ? 'shrink-0 h-auto' : `h-[55%] ${wantsRight ? 'md:h-full md:w-[62%]' : ''}`}`}>
        {/* HUD — progress (left), stats (flexible middle, right-aligned), pause (right). No divider
            lines (depth via colour/spacing); stats are right-aligned in a flex-1 box so the score sits
            a gap before the pause and can never overlap it. */}
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-6 py-1.5 pt-[max(0.5rem,env(safe-area-inset-top))] min-h-[56px]">
          {/* progress */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col leading-none">
              <span className="text-xl sm:text-2xl font-bold text-zinc-900 tabular-nums">{resolvedCount}/{total}</span>
              <span className="text-[10px] text-zinc-500">gelöst</span>
            </div>
            {visit === 'retry' && (
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400/20 text-amber-600" role="img" aria-label="Wiederholung" title="Wiederholung">
                <RotateCcw className="w-3.5 h-3.5" />
              </span>
            )}
          </div>

          {/* status — right-aligned, shrinks toward the progress side, never under the pause */}
          <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3 min-w-0 text-sm sm:text-base font-semibold tabular-nums">
            <span className="flex items-center gap-1 font-mono text-zinc-800"><Timer className="w-4 h-4 text-zinc-400 shrink-0" />{mmss(elapsed)}</span>
            <span className="flex items-center gap-1 text-emerald-600"><Check className="w-4 h-4 shrink-0" />{correctCount}</span>
            <span className="flex items-center gap-1 text-rose-600"><X className="w-4 h-4 shrink-0" />{wrongCount}</span>
            <span className="flex items-center gap-0.5 text-amber-600 whitespace-nowrap">✨ {fmt(score)}</span>
          </div>

          {/* Group C · actions */}
          <button type="button" onClick={doPause} aria-label="Pause" className="w-11 h-11 rounded-lg bg-zinc-200 flex items-center justify-center active:scale-95 shrink-0">
            <Pause className="w-5 h-5 text-zinc-700" />
          </button>
        </div>

        <ChipStrip questions={questions} statusMap={statusMap} currentQid={currentQid} />

        {compactHeader ? (
          /* Person question: question top-left, timer top-right, then a compact portrait. Single-actor
             shows the name BESIDE the portrait; filmography OVERLAYS the name on the portrait bottom
             (no extra height). Either way the Stage stays compact so the Panel fits its answers. */
          <div className="shrink-0 px-4 sm:px-6 pt-1 pb-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0 font-display text-base sm:text-xl text-zinc-900 leading-tight">{MODE_PROMPT[q.mode] || 'Frage'}</div>
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 flex items-center justify-center">
                {!locked && <RadialCountdown remaining={remaining} duration={dur} />}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <SubjectImage content={q.stem.content} aspect="1/1" mode={q.mode} className="h-24 w-24 sm:h-28 sm:w-28 shrink-0 ring-1 ring-zinc-300 bg-zinc-200">
                {compactFilmography && q.actor_name && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 py-1">
                    <div className="text-[11px] sm:text-xs font-semibold text-white text-center leading-tight truncate">{q.actor_name}</div>
                  </div>
                )}
              </SubjectImage>
              {compactActor && (
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Schauspieler:in</div>
                  <div className="text-lg sm:text-2xl font-semibold text-zinc-900 leading-tight">{q.stem.caption}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Prompt uses the FULL title-row width (no left spacer) so it stays on one line when it
             fits; the countdown ring sits in a reserved right slot (kept when locked so no jump). */
          <div className="shrink-0 flex items-center gap-2 px-4 sm:px-6 pt-1">
            <div className="flex-1 min-w-0 text-center font-display text-lg md:text-2xl lg:text-3xl text-zinc-900 text-balance">
              {MODE_PROMPT[q.mode] || 'Frage'}
            </div>
            <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 flex items-center justify-center">
              {!locked && !isConnect && <RadialCountdown remaining={remaining} duration={dur} />}
            </div>
          </div>
        )}

        {/* Stem (the countdown ring lives in the prompt row above, never over this card). Connect
            rounds have no stem; the single-actor portrait already lives in the compact header. */}
        {!isConnect && !compactHeader && (
        <div className={`${shortStage ? 'shrink-0' : 'flex-1 min-h-0'} px-4 sm:px-6 py-3 flex items-center justify-center overflow-hidden`}>
          {stemImage ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden">
              <SubjectImage
                content={q.stem.content}
                aspect={stemAspect}
                mode={q.mode}
                revealCorrect={revealCorrect}
                className={`${stemLandscape ? 'w-full h-auto max-h-full ring-1 ring-black/10' : q.stem.caption ? 'min-h-0 flex-1 w-auto max-w-full shadow-2xl' : 'h-full w-auto shadow-2xl'}`}
              />
              {q.stem.caption && (
                <div className="mt-2 shrink-0 text-center">
                  <div className="text-xs tracking-wide text-zinc-500">
                    {q.mode === 'director_to_movie' ? 'Regie' : q.mode === 'writer_to_movie' ? 'Drehbuch' : 'Schauspieler:in'}
                  </div>
                  <div className="text-base sm:text-lg font-semibold text-zinc-900">
                    {q.stem.caption}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-full min-h-0 max-w-2xl overflow-y-auto rounded-2xl bg-white ring-1 ring-zinc-300 p-5 md:p-6 text-center">
              <p className="text-base sm:text-lg md:text-xl leading-relaxed text-zinc-900">
                {/* Render censor bars for any stem that carries REDACT tokens (plot + censored
                    plot now both redact title/cast spoilers); a no-op for token-free text. */}
                {renderRedactedPlot(q.stem.content)}
              </p>
            </div>
          )}
        </div>
        )}
        {/* No Stage-level title badge: the film's own title is the already-visible SUBJECT for the
            attribute/cover questions, not the answer. Correctness shows via the highlighted correct
            option; ANSWER_IS_MOVIE modes reveal the answer title on the correct cover instead. */}
      </div>

      {/* Panel — dark surface, edge-to-edge, single hairline divider against the Stage. For connect
          rounds it fills the screen and hosts the matching columns + Prüfen button (QuizConnect). */}
      <div className={`flex flex-col w-full bg-zinc-950 text-zinc-100 border-t border-amber-500/50 ${isConnect || compactHeader || shortStage ? 'flex-1 min-h-0' : `h-[45%] ${wantsRight ? 'md:h-full md:w-[38%] md:border-t-0 md:border-l' : ''}`}`}>
        {isConnect ? (
          <QuizConnect question={q} locked={locked} reveal={reveal} onSubmit={(keys) => lockIn(keys)} />
        ) : (
        <>
        {!locked && q.multi_select && (
          <div role="status" aria-live="polite" className="shrink-0 px-4 sm:px-6 pt-3 flex justify-center" style={{ animation: 'pfHintIn 0.15s ease' }}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/80 text-zinc-200 px-3 py-1.5 text-xs sm:text-sm">
              <MousePointerClick className="w-4 h-4 text-amber-400 shrink-0" />
              Alle Passenden wählen, dann Bestätigen
            </span>
          </div>
        )}
        <div className={`flex-1 min-h-0 px-4 sm:px-6 pt-3 ${q.multi_select ? '' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'} ${textOptions ? 'overflow-y-auto' : 'overflow-hidden'}`}>
          {textOptions ? (
            <div key={visitSeq} className={`grid ${gridCols} gap-2 sm:gap-3 h-full auto-rows-fr ${shortStage ? 'max-w-2xl mx-auto w-full' : ''}`} style={{ animation: 'pfSlideUp 0.25s ease' }}>
              {q.options.map((o) => renderOption(o))}
            </div>
          ) : (
            <div ref={optionAreaRef} className="w-full h-full flex items-center justify-center">
              <div
                key={visitSeq}
                className="grid justify-center content-center"
                style={{
                  gridTemplateColumns: `repeat(${coverFit.cols}, ${coverFit.coverW}px)`,
                  gap: `${coverFit.gap}px`,
                  animation: 'pfSlideUp 0.25s ease',
                }}
              >
                {q.options.map((o) => renderOption(o, coverFit.coverW))}
              </div>
            </div>
          )}
        </div>
        {q.multi_select && (
          <div className="shrink-0 px-4 sm:px-6 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => lockIn(selectedIds)} disabled={locked || selectedIds.length === 0}
              className="w-full rounded-xl py-3 font-semibold bg-amber-400 text-zinc-950 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed">
              Bestätigen ({selectedIds.length})
            </button>
          </div>
        )}
        </>
        )}
      </div>
      </>
      )}

      {showRoundTwoIntro && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="Runde 2 startet"
          onClick={dismissRoundTwoIntro}
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-zinc-950/85 backdrop-blur-md"
        >
          {!reduceMotion && <Fireworks variant="mini" />}
          <div className="text-amber-400 text-sm uppercase tracking-[0.3em] mb-3">
            Wiederholungs-Runde
          </div>
          <div className="text-zinc-100 font-extrabold text-6xl sm:text-7xl mb-6">
            Runde 2
          </div>
          <div className="text-zinc-300 text-base sm:text-lg max-w-md text-center px-6 mb-10">
            Falsch beantwortete Fragen kommen jetzt nochmal dran — in zufälliger
            Reihenfolge, bis alle richtig sind.
          </div>
          <div className="w-24 h-24 rounded-full ring-4 ring-amber-400 flex items-center justify-center text-amber-300 text-5xl font-bold tabular-nums animate-pulse">
            {roundTwoCountdown}
          </div>
          {/* Stop here instead of replaying — jump straight to the Auflösung. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goSolutions(); }}
            className="mt-10 min-h-[44px] px-5 rounded-xl bg-zinc-800 text-zinc-200 font-medium flex items-center gap-2 active:scale-[0.98] transition-transform"
          >
            <LogOut className="w-4 h-4" /> Aufhören &amp; Auflösung
          </button>
        </div>
      )}

      {paused && (
        <div className="absolute inset-0 z-50 bg-zinc-950/85 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-6 text-center">
            <p className="font-display-tight text-2xl mb-1">Pausiert</p>
            <p className="text-sm text-zinc-400 mb-5">Frage pausiert · Gesamtzeit läuft weiter.</p>
            <div className="space-y-2">
              <button type="button" onClick={resume} className="w-full py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2"><Play className="w-4 h-4 fill-zinc-950" /> Weiter</button>
              <button type="button" onClick={() => leave('/quiz/setup')} className="w-full py-3 rounded-xl bg-zinc-800 text-zinc-200 font-medium flex items-center justify-center gap-2"><RotateCcw className="w-4 h-4" /> Neu starten</button>
              <button type="button" onClick={goSolutions} className="w-full py-3 rounded-xl bg-rose-500/90 text-white font-medium flex items-center justify-center gap-2"><LogOut className="w-4 h-4" /> Beenden &amp; Auflösung</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
