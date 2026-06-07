import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Dices, SlidersHorizontal, ChevronDown, ChevronUp, Clock, Calendar, Star,
  AlertCircle, History as HistoryIcon, Youtube,
  ExternalLink, Tv2, Sparkles, Play, Loader2, RefreshCw, BarChart3,
} from 'lucide-react';
import { getLibrary, movieInfo, getSettings, saveSettings } from '../api';
import FilterFunnel from '../components/FilterFunnel';
import MovieFilterPanel from '../components/MovieFilterPanel';
import { buildFilterStages, formatRuntime, RUNTIME_MIN_BOUND, RUNTIME_MAX_BOUND } from '../components/movieFilters';
import AppHeader from '../components/AppHeader';
import DieIcon from '../components/DieIcon';
import Fireworks from '../components/Fireworks';
import { usePrefs } from '../usePrefs';
import { plexAppUrl } from '../lib/plexLink';

const PREFS_KEY = 'plexdice:prefs:v1';
const LOADING_VERBS = ['ausgegraben', 'zusammengetragen', 'hochgeholt'];
const FACT_SHOW = 4;

function fskColor(f) {
  if (f === 0) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (f === 6) return 'bg-lime-500/15 text-lime-300 border-lime-500/30';
  if (f === 12) return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (f === 16) return 'bg-orange-500/15 text-orange-300 border-orange-500/30';
  if (f === 18) return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Dice({ onNeedSettings }) {
  const { reduceMotion } = usePrefs();
  const [movies, setMovies] = useState([]);
  const [moviesReady, setMoviesReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [showFilters, setShowFilters] = useState(false);
  const [genreGroups, setGenreGroups] = useState([]); // string[][]: inner = AND, outer = OR
  const [yearMin, setYearMin] = useState(null);
  const [yearMax, setYearMax] = useState(null);
  const [runtimeMin, setRuntimeMin] = useState(RUNTIME_MIN_BOUND);
  const [runtimeMax, setRuntimeMax] = useState(RUNTIME_MAX_BOUND);
  const [fskMin, setFskMin] = useState(0);
  const [fskMax, setFskMax] = useState(16);
  const [ratingMin, setRatingMin] = useState(6.0);
  const [ratingMax, setRatingMax] = useState(10.0);
  const [watched, setWatched] = useState('all'); // 'all' | 'unseen' | 'seen'
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [picked, setPicked] = useState(null);
  const [rollSeq, setRollSeq] = useState(0); // bumps per completed roll, so the scroll-to-top fires even when the same film is re-rolled
  const [rolling, setRolling] = useState(false);
  const [ticker, setTicker] = useState(null);
  const [fireworks, setFireworks] = useState(false);
  const [fireworksKey, setFireworksKey] = useState(0);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [highlightSection, setHighlightSection] = useState(null);
  const [funnelExpanded, setFunnelExpanded] = useState(true); // open by default; collapses after a roll
  const [showFiltersOnResult, setShowFiltersOnResult] = useState(false); // sticky-header toggle
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const resultRef = useRef(null); // the rolled movie card, scrolled into focus after a roll

  const [aiInfo, setAiInfo] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [loadingVerb, setLoadingVerb] = useState('zusammengetragen');
  const [factView, setFactView] = useState([]);

  // Library bounds derived from the fetched movies.
  const yearBounds = useMemo(() => {
    const years = movies.map((m) => m.y).filter(Boolean);
    return {
      min: years.length ? Math.min(...years) : 1950,
      max: years.length ? Math.max(...years) : new Date().getFullYear(),
    };
  }, [movies]);

  const allGenres = useMemo(
    () => [...new Set(movies.flatMap((m) => m.g || []))].sort(),
    [movies],
  );

  // Load saved preferences (once), then fetch the library.
  useEffect(() => {
    const p = loadPrefs();
    if (p) {
      if (Array.isArray(p.genreGroups)) {
        setGenreGroups(p.genreGroups.filter((grp) => Array.isArray(grp) && grp.length));
      } else if (Array.isArray(p.selectedGenres) && p.selectedGenres.length) {
        setGenreGroups([p.selectedGenres]); // migrate old flat AND-list → one AND-group
      }
      if (typeof p.yearMin === 'number') setYearMin(p.yearMin);
      if (typeof p.yearMax === 'number') setYearMax(p.yearMax);
      if (typeof p.runtimeMin === 'number') setRuntimeMin(p.runtimeMin);
      if (typeof p.runtimeMax === 'number') setRuntimeMax(p.runtimeMax);
      if (typeof p.fskMin === 'number') setFskMin(p.fskMin);
      if (typeof p.fskMax === 'number') setFskMax(p.fskMax);
      if (typeof p.ratingMin === 'number') setRatingMin(p.ratingMin);
      if (typeof p.ratingMax === 'number') setRatingMax(p.ratingMax);
    }
    setPrefsLoaded(true);

    (async () => {
      try {
        const { movies: list } = await getLibrary();
        setMovies(list);
        if (list.length === 0) onNeedSettings?.();
      } catch (e) {
        setLoadError(e.message || 'Bibliothek konnte nicht geladen werden');
      } finally {
        setMoviesReady(true);
      }
    })();
  }, [onNeedSettings]);

  // Once movies + prefs are ready, snap any unset year range to the library bounds.
  useEffect(() => {
    if (!moviesReady || !prefsLoaded) return;
    setYearMin((prev) => (prev == null ? yearBounds.min : Math.max(yearBounds.min, prev)));
    setYearMax((prev) => (prev == null ? yearBounds.max : Math.min(yearBounds.max, prev)));
  }, [moviesReady, prefsLoaded, yearBounds.min, yearBounds.max]);

  // Persist preferences whenever they change (after initial load).
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          genreGroups, yearMin, yearMax, runtimeMin, runtimeMax,
          fskMin, fskMax, ratingMin, ratingMax,
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [prefsLoaded, genreGroups, yearMin, yearMax, runtimeMin, runtimeMax, fskMin, fskMax, ratingMin, ratingMax]);

  // Load the persisted watched-status choice from server settings (ui.last_filters).
  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings();
        const w = s?.ui?.last_filters?.watched;
        if (w === 'all' || w === 'unseen' || w === 'seen') setWatched(w);
      } catch {
        /* settings unavailable — keep default */
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  // Persist the watched-status choice back to server settings once loaded.
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings({ ui: { last_filters: { watched } } }).catch(() => {});
  }, [settingsLoaded, watched]);

  // Re-open the funnel whenever a filter changes, so the effect on the hit count is
  // visible even after a roll collapsed it. The ref skips the initial mount + the
  // prefs/settings hydration (which fire before the user touches anything).
  const filterTouched = useRef(false);
  useEffect(() => {
    if (!filterTouched.current) { filterTouched.current = true; return; }
    setFunnelExpanded(true);
  }, [genreGroups, yearMin, yearMax, runtimeMin, runtimeMax, fskMin, fskMax, ratingMin, ratingMax, watched]);

  // Deep-link from the Quiz review (/?movie=<key>) → show that movie's card.
  useEffect(() => {
    if (!moviesReady || movies.length === 0) return;
    const key = new URLSearchParams(window.location.search).get('movie');
    if (!key) return;
    const m = movies.find((x) => String(x.key) === String(key));
    if (m) {
      setPicked(m);
      setAiInfo(null);
    }
    window.history.replaceState({}, '', '/');
  }, [moviesReady, movies]);

  // After a roll resolves, scroll the result column back to the top so the post-roll stack
  // reads cleanly from the (non-sticky) header down — header → mini-filter → Nochmal würfeln
  // → film, with no gap above the header. No auto-scroll on reset (picked === null).
  useEffect(() => {
    if (!picked) return undefined;
    const t = setTimeout(() => {
      resultRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 600);
    return () => clearTimeout(t);
  }, [picked, rollSeq]);

  const effYearMin = yearMin ?? yearBounds.min;
  const effYearMax = yearMax ?? yearBounds.max;

  // One pipeline of ACTIVE filters, shared by the funnel (per-stage counts) and the
  // final list — so the funnel's last count always equals filtered.length, and an
  // empty pipeline means the full, unfiltered library.
  const activeStages = useMemo(
    () => buildFilterStages(
      { genreGroups, yearMin, yearMax, runtimeMin, runtimeMax, fskMin, fskMax, ratingMin, ratingMax, watched },
      yearBounds,
    ),
    [genreGroups, yearMin, yearMax, runtimeMin, runtimeMax, fskMin, fskMax, ratingMin, ratingMax, watched, yearBounds],
  );

  const filtered = useMemo(() => {
    let pool = movies;
    for (const stage of activeStages) pool = pool.filter(stage.pred);
    return pool;
  }, [movies, activeStages]);

  // Step-by-step counts driving the funnel visualization.
  const funnelStages = useMemo(() => {
    let pool = movies;
    return activeStages.map(({ pred, ...meta }) => {
      const count_in = pool.length;
      pool = pool.filter(pred);
      return { ...meta, count_in, count_out: pool.length };
    });
  }, [movies, activeStages]);

  const pick = () => {
    if (filtered.length === 0) return;
    setRolling(true);
    setShowFilters(false);
    setShowHistory(false);
    setAiInfo(null);
    setFunnelExpanded(false); // each new roll starts collapsed in result mode
    setShowFiltersOnResult(false); // …and the filter bars stay tucked away

    const choice = filtered[Math.floor(Math.random() * filtered.length)];

    const tickInterval = setInterval(() => {
      setTicker(filtered[Math.floor(Math.random() * filtered.length)]);
    }, 90);

    setTimeout(() => {
      clearInterval(tickInterval);
      setTicker(null);
      setPicked(choice);
      setRollSeq((s) => s + 1);
      setHistory((h) => [choice, ...h.filter((x) => x.key !== choice.key)].slice(0, 12));
      setRolling(false);
      // Fire celebration AFTER the card has settled in its final position:
      // revealCard 0.55s animation + the +600ms scroll kickoff + ~400ms smooth-scroll
      // settle ≈ 1.05s. Trigger at 1.2s so the burst lands on the fully laid-out view.
      setTimeout(() => {
        setFireworksKey((k) => k + 1);
        setFireworks(true);
        setTimeout(() => setFireworks(false), 1800);
      }, 1200);
    }, 2400);
  };

  const fetchInfo = async (force = false) => {
    if (!picked) return;
    setLoadingVerb(LOADING_VERBS[Math.floor(Math.random() * LOADING_VERBS.length)]);
    setAiLoading(true);
    try {
      const data = await movieInfo(picked.key, force);
      setAiInfo(data);
      setFactView((data.facts || []).slice(0, FACT_SHOW));
    } catch (e) {
      setAiInfo({ error: e.message || 'Fehler' });
    } finally {
      setAiLoading(false);
    }
  };

  // Swap one shown fact for an unused one from the pool (per-fact reroll).
  const rerollFact = (slot) => {
    const shown = new Set(factView.map((f) => f.category));
    const spare = (aiInfo?.facts || []).find((f) => !shown.has(f.category));
    if (spare) setFactView((view) => view.map((f, i) => (i === slot ? spare : f)));
  };

  const resetFilters = () => {
    setGenreGroups([]);
    setYearMin(yearBounds.min);
    setYearMax(yearBounds.max);
    setRuntimeMin(RUNTIME_MIN_BOUND);
    setRuntimeMax(RUNTIME_MAX_BOUND);
    setFskMin(0);
    setFskMax(16);
    setRatingMin(6.0);
    setRatingMax(10.0);
    setWatched('all');
  };

  const activeFilterCount = activeStages.length;

  // Open the drawer scrolled to a stage's section, with a brief highlight pulse.
  const openStage = (target) => {
    setShowHistory(false);
    setShowFilters(true);
    setHighlightSection(target);
    setTimeout(() => {
      document.getElementById(`filter-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    setTimeout(() => setHighlightSection(null), 1300);
  };

  // Clear a single filter dimension to its neutral (inactive) value.
  const resetStage = (id) => {
    if (id === 'genre') setGenreGroups([]);
    else if (id === 'year') { setYearMin(yearBounds.min); setYearMax(yearBounds.max); }
    else if (id === 'runtime') { setRuntimeMin(RUNTIME_MIN_BOUND); setRuntimeMax(RUNTIME_MAX_BOUND); }
    else if (id === 'fsk') { setFskMin(0); setFskMax(18); }
    else if (id === 'rating') { setRatingMin(0); setRatingMax(10); }
    else if (id === 'watched') setWatched('all');
  };

  const selectPicked = (m) => {
    setPicked(m);
    setAiInfo(null);
    setShowHistory(false);
  };

  return (
    <>
      <style>{`
        @keyframes danceBg {
          0% { background-position: 0% 50%; opacity: 0.55; }
          25% { background-position: 50% 100%; opacity: 0.85; }
          50% { background-position: 100% 50%; opacity: 0.7; }
          75% { background-position: 50% 0%; opacity: 0.95; }
          100% { background-position: 0% 50%; opacity: 0.55; }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 24px 2px rgba(245,166,35,0.45), 0 0 60px 6px rgba(245,166,35,0.18); }
          50% { box-shadow: 0 0 36px 6px rgba(245,166,35,0.75), 0 0 100px 18px rgba(244,114,182,0.35), 0 0 140px 30px rgba(124,58,237,0.18); }
        }
        @keyframes diceShake {
          0%, 100% { transform: rotate(0deg); }
          20% { transform: rotate(-18deg) translateY(-1px); }
          40% { transform: rotate(14deg) translateY(1px); }
          60% { transform: rotate(-12deg); }
          80% { transform: rotate(18deg); }
        }
        @keyframes revealCard {
          0% { transform: scale(0.92); opacity: 0; filter: blur(8px); }
          60% { transform: scale(1.02); opacity: 1; filter: blur(0); }
          100% { transform: scale(1); opacity: 1; filter: blur(0); }
        }
        .reveal-card { animation: revealCard 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .rolling-bg {
          background: linear-gradient(125deg,
            rgba(245,166,35,0.22) 0%, rgba(244,114,182,0.18) 25%,
            rgba(124,58,237,0.16) 50%, rgba(34,211,238,0.14) 75%, rgba(245,166,35,0.22) 100%);
          background-size: 400% 400%;
          animation: danceBg 2.4s ease-in-out infinite;
          filter: blur(2px);
        }
        .glow-pulse { animation: glowPulse 0.9s ease-in-out infinite; }
        .dice-shake { display: inline-block; animation: diceShake 0.4s ease-in-out infinite; }
      `}</style>
      <div className="flex flex-col min-h-full bg-zinc-950 text-zinc-100 relative overflow-x-clip">
        {rolling && !reduceMotion && <div className="fixed inset-0 pointer-events-none rolling-bg" />}
        {fireworks && !reduceMotion && <Fireworks key={fireworksKey} />}

        <div className="relative w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 pb-6 sm:py-10 flex-1 flex flex-col">
          <AppHeader
            product="dice"
            rightSlot={picked ? (
              <button
                type="button"
                onClick={() => setShowFiltersOnResult((s) => !s)}
                aria-label={showFiltersOnResult ? 'Filter ausblenden' : 'Filter einblenden'}
                aria-expanded={showFiltersOnResult}
                className="relative shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-xl bg-zinc-900/70 text-zinc-300 active:scale-[0.96] transition-transform"
              >
                <SlidersHorizontal className="w-5 h-5" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 text-zinc-950 text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            ) : null}
          />

          {/* Empty / error states */}
          {moviesReady && movies.length === 0 && (
            <button
              onClick={() => onNeedSettings?.()}
              className="w-full mb-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-left active:scale-[0.99] transition-transform"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-100">
                  {loadError
                    ? `Bibliothek konnte nicht geladen werden: ${loadError}`
                    : 'Noch keine Filme. Tippe hier, um Plex zu verbinden und die Bibliothek zu synchronisieren.'}
                </div>
              </div>
            </button>
          )}

          {/* Mini-filter row — compact "Filter (n)" (opens the drawer) on the left, a wider
              "start → hits" summary chip (toggles the funnel chart) on the right; tucked away
              on a result until the sliders icon reveals it. Desktop: the cluster right-aligns
              to the top-right. The expanded chart renders full-width below, unchanged. */}
          {(!picked || showFiltersOnResult) && (<>
          <div className="flex items-stretch gap-2 mb-3 sm:w-auto sm:ml-auto">
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              className="shrink-0 inline-flex items-center gap-2 px-3 min-h-[44px] rounded-2xl bg-zinc-900 active:scale-[0.98] transition-transform"
            >
              <SlidersHorizontal className="w-4 h-4 text-zinc-400 shrink-0" />
              <span className="text-sm font-medium">Filter</span>
              {activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-zinc-950 text-xs font-bold tabular-nums">{activeFilterCount}</span>
              )}
              {showFilters ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
            </button>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory((s) => !s)}
                aria-label="Verlauf"
                className="shrink-0 w-11 min-h-[44px] inline-flex items-center justify-center rounded-2xl bg-zinc-900 active:scale-[0.98] transition-transform"
              >
                <HistoryIcon className="w-4 h-4 text-zinc-400" />
              </button>
            )}
            {movies.length > 0 && (funnelStages.length > 0 ? (
              <button
                type="button"
                onClick={() => setFunnelExpanded((e) => !e)}
                aria-expanded={funnelExpanded}
                className="flex-1 sm:flex-none min-w-0 inline-flex items-center justify-between gap-2 px-3 min-h-[44px] rounded-2xl bg-zinc-900/60 active:scale-[0.98] transition-transform"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <BarChart3 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm tabular-nums truncate">
                    <span className="text-zinc-400">{movies.length.toLocaleString('de-DE')}</span>
                    <span className="text-zinc-600 mx-1">→</span>
                    <span className="text-amber-400 font-semibold">{filtered.length.toLocaleString('de-DE')}</span>
                  </span>
                </span>
                {funnelExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />}
              </button>
            ) : (
              <div className="flex-1 sm:flex-none min-w-0 inline-flex items-center gap-2 px-3 min-h-[44px] rounded-2xl bg-zinc-900/60 text-sm text-zinc-500">
                <BarChart3 className="w-4 h-4 shrink-0" />
                <span className="tabular-nums truncate">{movies.length.toLocaleString('de-DE')} Filme</span>
              </div>
            ))}
          </div>

          {movies.length > 0 && funnelStages.length > 0 && funnelExpanded && (
            <FilterFunnel
              stages={funnelStages}
              total={movies.length}
              onOpenStage={openStage}
              onResetStage={resetStage}
            />
          )}
          </>)}

          {/* Filter panel — bounded to a fraction of the DYNAMIC viewport (dvh, not vh) and
              internally scrollable, so every filter down to BEWERTUNG and the reset button is
              reachable on iPhone (PWA) and desktop. Bottom padding + safe-area-inset-bottom keeps
              the last control clear of the home indicator; overscroll-contain stops the scroll from
              chaining to the page. No position:fixed (which jumps on iOS). */}
          {showFilters && (
            <div className="mb-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] rounded-2xl bg-zinc-900/60 border border-zinc-800 max-h-[70dvh] overflow-y-auto overscroll-contain">
              <MovieFilterPanel
                movies={movies}
                genreGroups={genreGroups} setGenreGroups={setGenreGroups} allGenres={allGenres}
                watched={watched} setWatched={setWatched}
                yearBounds={yearBounds} effYearMin={effYearMin} effYearMax={effYearMax}
                setYearMin={setYearMin} setYearMax={setYearMax}
                runtimeMin={runtimeMin} runtimeMax={runtimeMax}
                setRuntimeMin={setRuntimeMin} setRuntimeMax={setRuntimeMax}
                RUNTIME_MIN_BOUND={RUNTIME_MIN_BOUND} RUNTIME_MAX_BOUND={RUNTIME_MAX_BOUND}
                fskMin={fskMin} fskMax={fskMax} setFskMin={setFskMin} setFskMax={setFskMax}
                ratingMin={ratingMin} ratingMax={ratingMax} setRatingMin={setRatingMin} setRatingMax={setRatingMax}
                onReset={resetFilters}
                highlightSection={highlightSection}
              />
            </div>
          )}

          {/* History panel */}
          {showHistory && history.length > 0 && (
            <div className="mb-4 p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-zinc-300">Letzte Würfe</h3>
                <button onClick={() => setHistory([])} className="text-xs text-amber-400/80 active:text-amber-300 font-medium">leeren</button>
              </div>
              <div className="space-y-1.5">
                {history.map((m, i) => (
                  <button key={m.key ?? i} onClick={() => selectPicked(m)}
                    className="w-full text-left px-3 py-2 rounded-xl bg-zinc-950/60 border border-zinc-800/60 active:scale-[0.98] transition-transform">
                    <div className="text-sm font-medium text-zinc-200 truncate">{m.t}</div>
                    <div className="text-xs text-zinc-400">{m.y} · {(m.g || []).slice(0, 2).join(', ')}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Roll button — orange primary on initial roll or while spinning, muted
              zinc secondary once a film is picked so "In Plex abspielen" is the only
              accent CTA. Touch target stays >= 44px (py-3 + content). */}
          {(() => {
            const secondary = picked && !rolling;
            return (
              <button
                onClick={pick}
                disabled={filtered.length === 0 || rolling}
                style={secondary ? undefined : {
                  background: 'linear-gradient(135deg, #f5a623 0%, #ffaf3a 100%)',
                  boxShadow: rolling
                    ? undefined
                    : '0 4px 12px rgba(245,166,35,0.28), 0 8px 24px rgba(245,166,35,0.10), inset 0 1px 0 rgba(255,255,255,0.20)',
                }}
                className={`w-full rounded-2xl flex items-center justify-center gap-3 active:scale-[0.985] transition-transform disabled:opacity-40 disabled:active:scale-100 ${
                  secondary
                    ? 'py-3 text-sm font-medium bg-zinc-900 text-zinc-300'
                    : `text-zinc-950 font-semibold tracking-wide ${picked ? 'py-2.5 text-base' : 'py-5 text-lg'}`
                } ${rolling ? 'glow-pulse' : ''}`}
              >
                <span className={rolling ? 'dice-shake' : 'inline-block'}>
                  <Dices className={secondary ? 'w-5 h-5' : 'w-7 h-7'} strokeWidth={2.5} />
                </span>
                {rolling ? 'Würfle…' : picked ? 'Nochmal würfeln' : 'Film würfeln'}
              </button>
            );
          })()}

          {filtered.length === 0 && movies.length > 0 && (
            <div className="mt-4 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-sm text-rose-200">Keine Filme entsprechen deinen Filtern. Reduziere ein paar Kriterien.</div>
            </div>
          )}

          {/* Rolling ticker card */}
          {rolling && ticker && (
            <article className="mt-6 rounded-3xl bg-gradient-to-br from-amber-500/15 to-zinc-900/40 border border-amber-400/30 overflow-hidden">
              <div className="p-6 sm:p-8 text-center">
                <span className="text-xs uppercase tracking-widest text-amber-400 font-medium block mb-3">Würfle…</span>
                <h2 className="font-display-tight text-2xl sm:text-3xl leading-tight tracking-tight text-zinc-300 truncate">
                  {ticker.t}
                </h2>
                <p className="text-sm text-zinc-500 mt-2">{ticker.y} · {(ticker.g || []).slice(0, 2).join(', ')}</p>
              </div>
            </article>
          )}

          {/* Picked movie card */}
          {picked && !rolling && (
            <article ref={resultRef} key={picked.key} className="mt-3 rounded-3xl bg-gradient-to-br from-zinc-900 to-zinc-900/40 overflow-hidden reveal-card">
              <div className="p-4 pb-3 sm:p-6 sm:pb-4">
                {/* Kicker + title span the full card width; underneath, a two-column
                    band sets the poster beside the meta chips and plot so the card
                    spends its horizontal space instead of stacking one tall column. */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-amber-400/80 font-medium">Dein Zufallsfilm</span>
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                </div>
                <h2 className="font-display-tight text-3xl sm:text-4xl leading-tight tracking-tight">
                  {picked.t}
                </h2>
                {picked.o && picked.o !== picked.t && (
                  <p className="text-sm text-zinc-400 mt-1 italic">{picked.o}</p>
                )}

                <div className="mt-4 flex gap-4">
                  {picked.thumb_url && (
                    <img
                      src={picked.thumb_url}
                      alt=""
                      loading="lazy"
                      className="w-[132px] sm:w-[180px] shrink-0 aspect-[2/3] rounded-xl object-cover bg-zinc-800 block"
                      style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 0 32px rgba(245, 166, 35, 0.15)' }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 tabular-nums">
                      {picked.y && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/60 text-zinc-300 text-sm">
                          <Calendar className="w-3.5 h-3.5" /> {picked.y}
                        </span>
                      )}
                      {picked.r && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/60 text-zinc-300 text-sm">
                          <Clock className="w-3.5 h-3.5" /> {formatRuntime(picked.r)}
                        </span>
                      )}
                      {picked.s != null && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-sm font-medium">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {picked.s.toFixed(1).replace('.', ',')}
                        </span>
                      )}
                      {picked.f != null && (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-sm font-medium ${fskColor(picked.f)}`}>
                          FSK {picked.f}
                        </span>
                      )}
                    </div>

                    {/* Plex summary — clamps beside the poster so the band stays tidy */}
                    {picked.summary && (
                      <p className="text-sm sm:text-base text-zinc-300 leading-relaxed line-clamp-5 sm:line-clamp-6 opsz-20">{picked.summary}</p>
                    )}
                  </div>
                </div>

                {/* Genres — full width below the band, where pills wrap cleanly */}
                {(picked.g || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {picked.g.map((g) => (
                      <span key={g} className="px-2 py-0.5 rounded-md bg-zinc-800/40 text-zinc-400 text-xs">{g}</span>
                    ))}
                  </div>
                )}

                {/* AI enrichment */}
                <div className="mt-3">
                  {!aiInfo && !aiLoading && (
                    <button onClick={() => fetchInfo()}
                      className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-sm font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                      <Sparkles className="w-4 h-4" /> Erzähl mir was über den Film
                    </button>
                  )}
                  {aiLoading && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Fakten werden {loadingVerb}…
                    </div>
                  )}
                  {aiInfo && aiInfo.error && (
                    <p className="text-xs text-rose-300 italic">Konnte keine Infos laden: {aiInfo.error}</p>
                  )}
                  {aiInfo && !aiInfo.error && factView.length === 0 && !aiInfo.plot && (
                    <p className="text-sm text-zinc-400 italic">
                      Zu diesem Film habe ich keine Hintergrundinfos — manche Perlen müssen ein Geheimnis bleiben.
                    </p>
                  )}
                  {aiInfo && !aiInfo.error && (factView.length > 0 || aiInfo.plot) && (
                    <div className="rounded-2xl bg-zinc-900/60 ring-1 ring-amber-500/10 p-5 sm:p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-widest text-amber-400">Wissenswert</span>
                        <button type="button" onClick={() => fetchInfo(true)} title="Neue Infos würfeln"
                          className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-amber-300 active:scale-95 transition">
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                      {aiInfo.source === 'wikipedia' && aiInfo.plot && (
                        <p className="text-base text-zinc-300 leading-relaxed opsz-20">{aiInfo.plot}</p>
                      )}
                      <div className="space-y-4">
                        {factView.map((f, i) => (
                          <div key={f.category + i} className="flex items-start gap-3 group">
                            <div className="w-10 h-10 rounded-full bg-zinc-800 ring-2 ring-transparent group-hover:ring-amber-500/30 transition flex items-center justify-center text-[22px] leading-none shrink-0">{f.emoji}</div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] tracking-widest uppercase text-amber-400 mb-1">{f.category}</div>
                              <div className="text-base leading-relaxed text-zinc-200">{f.text}</div>
                            </div>
                            {(aiInfo.facts || []).length > factView.length && (
                              <button type="button" onClick={() => rerollFact(i)} title="Diesen Fakt austauschen"
                                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-zinc-600 hover:text-amber-300 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-zinc-500">
                        Fakten aus deiner Plex-Bibliothek{aiInfo.source === 'wikipedia' ? ' · Inhalt von Wikipedia' : ''}
                        {aiInfo.wiki_url && (
                          <>
                            {' · '}
                            <a href={aiInfo.wiki_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">Quelle</a>
                          </>
                        )}
                      </p>
                    </div>
                  )}
                </div>

                {/* External + Plex links — the three search links first, then the primary
                    "In Plex abspielen" CTA as the final, full-width element of the card.
                    Separated by spacing (no hairline divider) with comfortable button gaps. */}
                <div className="mt-5 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        const q = encodeURIComponent((picked.o || picked.t) + ' ' + (picked.y || '') + ' trailer');
                        const appUrl = `youtube://results?search_query=${q}`;
                        const webUrl = `https://www.youtube.com/results?search_query=${q}+deutsch`;
                        const fallbackTimer = setTimeout(() => { window.open(webUrl, '_blank', 'noopener'); }, 800);
                        const cancel = () => { if (document.hidden) clearTimeout(fallbackTimer); };
                        document.addEventListener('visibilitychange', cancel, { once: true });
                        window.location.href = appUrl;
                      }}
                      className="py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    >
                      <Youtube className="w-4 h-4" /> Trailer
                    </button>
                    <a
                      href={`https://www.imdb.com/find/?q=${encodeURIComponent(picked.o || picked.t)}&s=tt&ttype=ft`}
                      target="_blank" rel="noopener noreferrer"
                      className="py-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    >
                      <ExternalLink className="w-4 h-4" /> IMDb
                    </a>
                    <a
                      href={`https://thetvdb.com/search?query=${encodeURIComponent(picked.o && picked.o !== picked.t ? picked.o : picked.t)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    >
                      <Tv2 className="w-4 h-4" /> TheTVDB
                    </a>
                  </div>
                  {(() => {
                    // Open the movie in the NATIVE Plex app (iOS app / desktop app) via Plex's
                    // plex:// deep link — never a browser or the "#!/server/.../details" web route,
                    // which makes the desktop app throw "Etwas ist schief gelaufen". The SAME trigger
                    // works on every platform: a plain location assignment hands the URL to the OS
                    // scheme handler (window.open can leave a blank tab and may not fire it). type 1
                    // = movie (PlexDice is movies). Gated on the local server id + ratingKey.
                    const plexUrl = plexAppUrl(picked.machineIdentifier, picked.ratingKey);
                    if (!plexUrl) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => { window.location.href = plexUrl; }}
                        className="w-full py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-amber-400/20"
                      >
                        <Play className="w-4 h-4 fill-zinc-950" /> In Plex abspielen
                      </button>
                    );
                  })()}
                </div>
              </div>
            </article>
          )}

          {/* Subtle bottom branding — pushed to the bottom of the content area (just
              above the tab bar) via mt-auto, low-emphasis, no divider above it. */}
          <footer className="mt-auto pt-8 text-center">
            <p className="inline-flex items-center justify-center gap-2 text-xs text-zinc-500">
              <DieIcon className="w-4 h-4 opacity-70" /> Entdecke deine Filme neu!
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
