import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Check, X, ExternalLink, Lightbulb } from 'lucide-react';
import { scoreSeriesGuess, answerSeriesGuess, seriesHint } from '../../api';
import { playSound } from './audio';
import WaveStage from './WaveStage';
import WuerfelInput from './WuerfelInput';

// The series title is known client-side (it came from /eligible), so the tile skeleton is built
// locally; hint letters still come from the server endpoint for one shared code path.
function slotsFromTitle(title) {
  return Array.from(title || '', (ch) => (/[\p{L}\p{N}]/u.test(ch) ? { gap: false } : { gap: true, char: ch }));
}
function lockedFromHint(resp, slots) {
  const out = {};
  for (const r of resp.revealed || []) if (slots[r.index] && !slots[r.index].gap) out[r.index] = r.char;
  return out;
}

// T2.3/T2.4 — one TV-series theme question: stream the show's Plex theme (user-gesture Play),
// type the series title, watch a debounced live meter, and on a correct guess reveal the poster
// + Plex/IMDB links (NO Apple Music / Spotify), then auto-advance. Wrong = no reveal. Reuses the
// L3 calm WaveStage. Series /score returns 0-100 already.

const DEBOUNCE_MS = 400;
const REVEAL_MS = 4000;
const WRONG_MS = 1400;

export default function SeriesQuestion({ show, soundOn = true, paused = false, onResolved }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [guess, setGuess] = useState('');
  const [meter, setMeter] = useState({ score: 0, accepted: false });
  const [resolved, setResolved] = useState(null); // null | 'correct' | 'wrong'
  const [reveal, setReveal] = useState(null);
  const [slots, setSlots] = useState([]);
  const [locked, setLocked] = useState({});
  const [hintLevel, setHintLevel] = useState(0);

  const audioRef = useRef(null);
  const debounceRef = useRef(null);
  const advanceRef = useRef(null);
  const resolvedRef = useRef(false);

  useEffect(() => {
    resolvedRef.current = false;
    setPlaying(false); setProgress(0); setGuess('');
    setMeter({ score: 0, accepted: false }); setResolved(null); setReveal(null);
    setSlots(slotsFromTitle(show.title)); setLocked({}); setHintLevel(0);
    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(advanceRef.current);
      const a = audioRef.current;
      if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    };
  }, [show.ratingKey]);

  const stopAudio = () => { const a = audioRef.current; if (a) a.pause(); setPlaying(false); };

  // Parent pause (quit overlay): stop the theme; the user re-taps Play to resume.
  useEffect(() => { if (paused) stopAudio(); }, [paused]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else { a.pause(); setPlaying(false); }
  };

  const seek = (frac) => { const a = audioRef.current; if (a && a.duration) a.currentTime = frac * a.duration; };

  const resolveCorrect = (rev) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    stopAudio(); setReveal(rev); setResolved('correct');
    if (soundOn) playSound('correct');
    const info = {
      correct: true,
      hints: hintLevel,
      title: rev?.title || show.title || null,
      year: rev?.year ?? show.year ?? null,
      cover_url: rev?.poster_url || show.thumb_url || null,
      plex_url: rev?.plex_url || null,
    };
    advanceRef.current = setTimeout(() => onResolved(true, info), REVEAL_MS);
  };

  const resolveWrong = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    stopAudio(); setResolved('wrong');
    if (soundOn) playSound('loser');
    // The series title is known client-side (from /eligible) → capture it for the Auflösung.
    const info = {
      correct: false,
      hints: hintLevel,
      title: show.title || null,
      year: show.year ?? null,
      cover_url: show.thumb_url || null,
      plex_url: null,
    };
    advanceRef.current = setTimeout(() => onResolved(false, info), WRONG_MS);
  };

  const onGuess = (value) => {
    setGuess(value);
    if (resolvedRef.current) return;
    clearTimeout(debounceRef.current);
    const text = value.trim();
    if (!text) { setMeter({ score: 0, accepted: false }); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await scoreSeriesGuess(show.ratingKey, text);
        if (resolvedRef.current) return;
        setMeter(res);
        if (res.accepted) {
          const ans = await answerSeriesGuess(show.ratingKey, text);
          if (ans.correct && ans.reveal) resolveCorrect(ans.reveal);
        }
      } catch { /* keep typing */ }
    }, DEBOUNCE_MS);
  };

  const submit = async () => {
    if (resolvedRef.current || !guess.trim()) return;
    try {
      const ans = await answerSeriesGuess(show.ratingKey, guess.trim());
      if (ans.correct && ans.reveal) resolveCorrect(ans.reveal);
      else resolveWrong();
    } catch { resolveWrong(); }
  };

  const onHint = async () => {
    if (resolvedRef.current) return;
    const lvl = hintLevel + 1;
    try {
      const resp = await seriesHint(show.ratingKey, lvl);
      setLocked(lockedFromHint(resp, slots));
      setHintLevel(lvl);
      setMeter({ score: 0, accepted: false });
    } catch { /* ignore */ }
  };

  const meterPct = Math.max(0, Math.min(100, Math.round(meter.score || 0)));
  const meterColor = meter.accepted ? '#22c55e' : '#f5a623';

  const cover = resolved === 'correct' ? (reveal?.poster_url || null) : null;
  // Optional: once hints start, fade the poster in BLURRED behind the tiles; de-blur a little
  // per hint, but never fully clear until solved.
  const hintBlur = hintLevel > 0 && resolved !== 'correct' ? Math.max(4, 16 - hintLevel * 3) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <audio
        ref={audioRef}
        src={`/api/series/theme/${show.ratingKey}`}
        playsInline
        preload="auto"
        onTimeUpdate={(e) => { const a = e.currentTarget; if (a.duration) setProgress(a.currentTime / a.duration); }}
        onEnded={() => setPlaying(false)}
      />

      {/* Consistent question header — poster appears here on a correct answer (V2.3/V2.4) */}
      <div className="shrink-0 flex items-center gap-3 mb-3 min-h-[2rem]">
        {cover && (
          <img src={cover} alt="" className="w-11 h-16 rounded-lg object-cover shrink-0"
            style={{ boxShadow: '0 0 14px rgba(245,166,35,0.35)' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <h2 className="text-lg font-semibold text-zinc-100 leading-tight">Welche Serie ist das?</h2>
      </div>

      <div className="relative flex-1 min-h-0 rounded-2xl bg-zinc-900 overflow-hidden flex items-center justify-center">
        <WaveStage playing={playing} />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Abspielen'}
            className="w-20 h-20 rounded-full bg-[#f5a623] text-zinc-950 flex items-center justify-center shadow-lg shadow-amber-400/30 active:scale-95 transition-transform"
          >
            {playing ? <Pause className="w-9 h-9 fill-zinc-950" /> : <Play className="w-9 h-9 fill-zinc-950 ml-1" />}
          </button>
        </div>
      </div>

      <input
        type="range" min={0} max={1} step={0.001} value={progress}
        onChange={(e) => seek(parseFloat(e.target.value))}
        aria-label="Position" className="w-full mt-3 accent-[#f5a623] h-2"
      />

      {resolved === 'correct' && reveal ? (
        <div className="mt-3 rounded-2xl bg-zinc-900 ring-1 ring-emerald-500/30 p-4">
          <div className="flex items-center gap-3">
            {reveal.poster_url && (
              <img
                src={reveal.poster_url} alt=""
                className="w-16 h-24 rounded-xl object-cover shrink-0"
                style={{ boxShadow: '0 0 18px rgba(245,166,35,0.25)' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-semibold mb-0.5"><Check className="w-4 h-4" /> Richtig!</div>
              <div className="text-zinc-100 font-semibold text-lg leading-tight truncate">{reveal.title}</div>
              {reveal.year && <div className="text-zinc-500 text-sm tabular-nums">{reveal.year}</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <a href={reveal.plex_url} target="_blank" rel="noopener noreferrer"
              className="min-h-[44px] px-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform">
              <Play className="w-4 h-4 fill-zinc-950" /> In Plex öffnen
            </a>
            <a href={reveal.imdb_url} target="_blank" rel="noopener noreferrer"
              className="min-h-[44px] px-3 rounded-xl bg-zinc-800 text-zinc-100 text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform">
              <ExternalLink className="w-3.5 h-3.5 shrink-0" /> IMDB
            </a>
          </div>
        </div>
      ) : resolved === 'wrong' ? (
        <div className="mt-3 rounded-2xl bg-zinc-900 ring-1 ring-rose-500/30 p-4 flex items-center gap-2 text-rose-300 min-h-[80px]">
          <X className="w-5 h-5 shrink-0" /> <span className="font-medium">Leider falsch — weiter geht's…</span>
        </div>
      ) : (
        <div className="mt-3">
          {/* Tiles, optionally over a blurred poster that de-blurs with each hint */}
          <div className="relative rounded-2xl overflow-hidden">
            {hintBlur > 0 && show.thumb_url && (
              <img src={show.thumb_url} alt="" aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover opacity-40 transition-[filter] duration-500"
                style={{ filter: `blur(${hintBlur}px)` }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            )}
            <div className="relative z-10 py-2">
              <WuerfelInput slots={slots} lockedLetters={locked} onGuessChange={onGuess} onSubmit={submit} disabled={false} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${meterPct}%`, background: meterColor }} />
            </div>
            <span className="text-xs tabular-nums font-medium" style={{ color: meterColor }}>{meterPct}%</span>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            <button type="button" onClick={onHint} className="col-span-1 min-h-[44px] rounded-xl bg-zinc-800 text-amber-300 text-sm font-medium flex items-center justify-center gap-1 active:scale-[0.98] transition-transform">
              <Lightbulb className="w-4 h-4" /> Tipp
            </button>
            <button type="button" onClick={resolveWrong} className="col-span-1 min-h-[44px] rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium active:scale-[0.98] transition-transform">Skip</button>
            <button type="button" onClick={submit} disabled={!guess.trim()} className="col-span-2 min-h-[44px] rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform">
              <Check className="w-4 h-4" /> Prüfen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
