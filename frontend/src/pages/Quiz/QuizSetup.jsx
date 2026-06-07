import { useEffect, useState } from 'react';
import { X, Camera, Play, Loader2, AlertCircle, Clapperboard, Music2, Tv, Shuffle, History, Dices, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { navigate } from '../../router';
import { quizNewRound, quizUploadPhoto, quizGetConfig, quizPlayers, getThemeEligible, getSeriesEligible, getLibrary } from '../../api';
import { saveRound } from './store';
import { initAudio } from './audio';
import AppHeader from '../../components/AppHeader';
import MovieFilterPanel from '../../components/MovieFilterPanel';
import { useMovieFilters, RUNTIME_MIN_BOUND, RUNTIME_MAX_BOUND } from '../../components/movieFilters';

const SIZES = [20, 50, 100];
const MIN_POOL = 8; // Sound / Series / Mixed need at least this many eligible items
const MODES = [
  { v: 'normal', label: 'Nur normale Fragen', sub: 'Bild- und Wissensfragen', Icon: Clapperboard, need: 'none' },
  { v: 'sound', label: 'Nur Sound', sub: 'Errate Filme an ihrer Titelmelodie', Icon: Music2, need: 'themes' },
  { v: 'series', label: 'Serien-Themes', sub: 'Errate Serien an ihrer Titelmelodie', Icon: Tv, need: 'series' },
  { v: 'mixed', label: 'Mixed', sub: 'Normale Fragen + Sound + Serien', Icon: Shuffle, need: 'either' },
];
const DIFFS = [
  { v: 'easy', label: '🟢 Leicht' },
  { v: 'medium', label: '🟡 Mittel' },
  { v: 'hard', label: '🔴 Schwer' },
  { v: 'mixed', label: '🎲 Mixed' },
];

// Fun German round names, pre-filled so the player never has to type one (still editable).
const ROUND_NAMES = [
  'Filmabend', 'Kinorunde', 'Popcorn-Session', 'Couch-Kino', 'Leinwand-Nacht',
  'Film-Battle', 'Movie-Quiz', 'Cineasten-Runde', 'Streaming-Abend', 'Blockbuster-Night',
];
function randomRoundName() {
  const base = ROUND_NAMES[Math.floor(Math.random() * ROUND_NAMES.length)];
  return `${base} #${Math.floor(Math.random() * 99) + 1}`;
}

export default function QuizSetup() {
  const [name, setName] = useState(() => randomRoundName());
  const [players, setPlayers] = useState([]);
  const [playerInput, setPlayerInput] = useState('');
  const [playerFocused, setPlayerFocused] = useState(false);
  const [roster, setRoster] = useState([]); // shared saved names (server-side), reusable quick-picks
  const [size, setSize] = useState(50);
  const [difficulty, setDifficulty] = useState('medium');
  const [mode, setMode] = useState('normal');
  const [themeCount, setThemeCount] = useState(null); // null until /eligible resolves
  const [seriesCount, setSeriesCount] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoId, setPhotoId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [movies, setMovies] = useState([]); // for the shared pre-filter (histograms + bounds)
  const [showFilters, setShowFilters] = useState(false);
  const filters = useMovieFilters(movies);

  useEffect(() => {
    quizGetConfig()
      .then((c) => {
        if (c.default_difficulty) setDifficulty(c.default_difficulty);
        if (c.default_size) setSize(c.default_size);
      })
      .catch(() => {});
    quizPlayers().then((d) => setRoster(d.players || [])).catch(() => {});
    getLibrary().then((d) => setMovies(d.movies || [])).catch(() => {});
  }, []);

  // Eligible counts reflect the active pre-filter — re-fetched whenever the criteria change.
  const criteriaKey = JSON.stringify(filters.criteria);
  useEffect(() => {
    getThemeEligible(filters.criteria).then((d) => setThemeCount(d.count || 0)).catch(() => setThemeCount(0));
    getSeriesEligible(filters.criteria).then((d) => setSeriesCount(d.count || 0)).catch(() => setSeriesCount(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaKey]);

  const themesReady = (themeCount ?? 0) >= MIN_POOL;
  const seriesReady = (seriesCount ?? 0) >= MIN_POOL;
  // Difficulty drives the question pool only for normal/mixed; for sound/series the title is simply
  // guessed, so the selector is greyed out there.
  const diffDisabled = mode === 'sound' || mode === 'series';
  const isReady = (need) => {
    if (need === 'themes') return themesReady;
    if (need === 'series') return seriesReady;
    if (need === 'either') return themesReady || seriesReady;
    return true;
  };

  // Saved roster names not yet added, filtered case-insensitively by the current input.
  const playerSuggestions = roster.filter(
    (p) => !players.includes(p) && p.toLowerCase().includes(playerInput.trim().toLowerCase()),
  );

  const addPlayer = () => {
    const p = playerInput.trim();
    if (p && !players.includes(p)) setPlayers([...players, p]);
    setPlayerInput('');
  };
  const pickPlayer = (p) => setPlayers((cur) => (cur.includes(p) ? cur : [...cur, p]));

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const resp = await quizUploadPhoto(file);
      setPhotoId(resp.photo_id);
    } catch {
      /* keep the local preview even if upload failed */
    } finally {
      setUploading(false);
    }
  };

  const start = async () => {
    if (!name.trim() || starting) return;
    initAudio(); // unlock the audio context on this user gesture (iOS Safari)
    setStarting(true);
    setError('');
    const setup = { name: name.trim(), playerNames: players, photoId };
    // Shared dice-style pre-filter, applied to the round's pool (omitted when nothing is active).
    const criteria = filters.criteria;
    const filterPayload = Object.keys(criteria).length ? criteria : null;
    try {
      if (mode === 'sound' || mode === 'series') {
        // Pure client-sequenced sound/series round (no server session needed).
        const rid = `${mode === 'series' ? 'r' : 's'}${Date.now()}`;
        saveRound(rid, { mode, difficulty, size, sound_enabled: true, setup, filters: filterPayload });
        navigate(`/quiz/sound/${rid}`);
        return;
      }
      // normal + mixed both generate a server round (normal questions); mixed interleaves
      // sound questions client-side over those, scored client-side.
      const resp = await quizNewRound({ size, difficulty, name: name.trim(), filters: filterPayload });
      saveRound(resp.round_id, { ...resp, mode, setup, filters: filterPayload });
      navigate(`${mode === 'mixed' ? '/quiz/sound' : '/quiz/play'}/${resp.round_id}`);
    } catch (e) {
      setError(e.message || 'Runde konnte nicht gestartet werden');
      setStarting(false);
    }
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:pb-12">
        <AppHeader
          product="quiz"
          rightSlot={(
            <button type="button" onClick={() => navigate('/quiz/history')}
              className="min-h-[44px] px-3 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 text-sm text-zinc-300 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
              <History className="w-4 h-4" /> Verlauf
            </button>
          )}
        />
        <div className="mb-6" />

        <div className="space-y-6">
          {/* Shared dice-style pre-filter (collapsed) — narrows the round's pool before starting. */}
          {movies.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowFilters((s) => !s)}
                aria-expanded={showFilters}
                className="w-full flex items-center gap-2 px-4 min-h-[48px] rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 active:scale-[0.99] transition-transform"
              >
                <SlidersHorizontal className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="text-sm font-medium text-zinc-200">Pool filtern</span>
                {filters.activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-zinc-950 text-xs font-bold tabular-nums">{filters.activeFilterCount}</span>
                )}
                <span className="ml-auto flex items-center gap-2 text-sm tabular-nums">
                  <span className="text-amber-400 font-semibold">{filters.filtered.length}</span>
                  <span className="text-zinc-600">/ {movies.length}</span>
                  {showFilters ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </span>
              </button>
              {showFilters && (
                <div className="mt-2 p-4 rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 max-h-[60dvh] overflow-y-auto overscroll-contain">
                  <MovieFilterPanel
                    movies={movies}
                    genreGroups={filters.genreGroups} setGenreGroups={filters.setGenreGroups} allGenres={filters.allGenres}
                    watched={filters.watched} setWatched={filters.setWatched}
                    yearBounds={filters.yearBounds} effYearMin={filters.effYearMin} effYearMax={filters.effYearMax}
                    setYearMin={filters.setYearMin} setYearMax={filters.setYearMax}
                    runtimeMin={filters.runtimeMin} runtimeMax={filters.runtimeMax}
                    setRuntimeMin={filters.setRuntimeMin} setRuntimeMax={filters.setRuntimeMax}
                    RUNTIME_MIN_BOUND={RUNTIME_MIN_BOUND} RUNTIME_MAX_BOUND={RUNTIME_MAX_BOUND}
                    fskMin={filters.fskMin} fskMax={filters.fskMax} setFskMin={filters.setFskMin} setFskMax={filters.setFskMax}
                    ratingMin={filters.ratingMin} ratingMax={filters.ratingMax} setRatingMin={filters.setRatingMin} setRatingMax={filters.setRatingMax}
                    onReset={filters.reset}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-zinc-200 uppercase tracking-wide mb-2 block">Modus</label>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map(({ v, label, sub, Icon, need }) => {
                const disabled = !isReady(need);
                const active = mode === v;
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMode(v)}
                    className={`text-left rounded-2xl p-3 min-h-[44px] transition-colors ${active ? 'bg-zinc-900 ring-2 ring-[#f5a623]' : 'bg-zinc-900 ring-1 ring-zinc-800'} ${disabled ? 'opacity-40' : 'active:scale-[0.98]'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-amber-400' : 'text-zinc-400'}`} />
                      <span className="font-semibold text-zinc-100 leading-tight">{label}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">{sub}</div>
                  </button>
                );
              })}
            </div>
            {(!themesReady || !seriesReady) && (
              <div className="text-xs text-zinc-500 mt-2 space-y-0.5">
                {!themesReady && (
                  <p>Sound: mind. {MIN_POOL} analysierte Film-Themes{themeCount != null ? ` (aktuell ${themeCount})` : ''}.</p>
                )}
                {!seriesReady && (
                  <p>Serien-Themes: mind. {MIN_POOL} Serien mit Titelmelodie{seriesCount != null ? ` (aktuell ${seriesCount})` : ''}.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-200 uppercase tracking-wide mb-2 block">Rundenname</label>
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Filmabend bei Roman"
                className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 text-zinc-100 placeholder-zinc-600 outline-none focus:ring-2 focus:ring-amber-400/60"
              />
              <button
                type="button"
                onClick={() => setName(randomRoundName())}
                aria-label="Neuen Namen würfeln"
                className="w-12 h-12 shrink-0 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 text-amber-400 flex items-center justify-center active:scale-95 transition-transform"
              >
                <Dices className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-200 uppercase tracking-wide mb-2 block">Spieler</label>
            {players.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {players.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-amber-400/15 text-amber-200 text-sm">
                    {p}
                    <button type="button" onClick={() => setPlayers(players.filter((x) => x !== p))} aria-label={`${p} entfernen`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Focusing the field reveals matching saved names as tappable suggestions. */}
            <div className="relative">
              <input
                value={playerInput}
                onChange={(e) => setPlayerInput(e.target.value)}
                onFocus={() => setPlayerFocused(true)}
                onBlur={() => setTimeout(() => setPlayerFocused(false), 120)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPlayer(); } }}
                placeholder="Name + Enter"
                className="w-full px-4 py-3 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 text-zinc-100 placeholder-zinc-600 outline-none focus:ring-2 focus:ring-amber-400/60"
              />
              {playerFocused && playerSuggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl bg-zinc-900 ring-1 ring-zinc-700 shadow-lg shadow-black/40 overflow-hidden max-h-56 overflow-y-auto">
                  {playerSuggestions.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { pickPlayer(p); setPlayerInput(''); }}
                      className="w-full min-h-[44px] px-4 text-left text-zinc-200 active:bg-zinc-800 flex items-center border-b border-zinc-800/60 last:border-b-0"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-200 uppercase tracking-wide mb-2 block">Foto vom Abend</label>
            <input id="photoCapture" type="file" accept="image/*" capture="user" className="hidden" onChange={onPhoto} />
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => document.getElementById('photoCapture').click()}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 text-zinc-200 active:scale-[0.98] transition-transform">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                {photoPreview ? 'Neu aufnehmen' : 'Foto aufnehmen'}
              </button>
              {photoPreview && (
                <div className="relative">
                  <img src={photoPreview} alt="" className="w-16 h-16 rounded-xl object-cover ring-1 ring-zinc-700" />
                  {photoId && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] text-white">✓</span>}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-200 uppercase tracking-wide mb-2 block">Schwierigkeit</label>
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${diffDisabled ? 'opacity-40' : ''}`}>
              {DIFFS.map(({ v, label }) => (
                <button key={v} type="button" disabled={diffDisabled} onClick={() => setDifficulty(v)}
                  className={`min-h-[44px] rounded-xl text-sm font-medium transition-colors ${difficulty === v ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'} ${diffDisabled ? 'cursor-not-allowed' : 'active:scale-[0.98]'}`}>
                  {label}
                </button>
              ))}
            </div>
            {diffDisabled && (
              <p className="text-xs text-zinc-500 mt-2">Bei Sound &amp; Serien wird der Titel erraten — die Schwierigkeit gilt nur für normale Fragen.</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-200 uppercase tracking-wide mb-2 block">Anzahl Fragen</label>
            <div className="grid grid-cols-3 gap-2">
              {SIZES.map((s) => (
                <button key={s} type="button" onClick={() => setSize(s)}
                  className={`min-h-[48px] rounded-xl text-sm font-semibold tabular-nums transition-colors ${size === s ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-200 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <button
            type="button"
            onClick={start}
            disabled={!name.trim() || starting}
            className="w-full py-4 rounded-2xl text-zinc-950 font-semibold text-lg tracking-wide flex items-center justify-center gap-2 active:scale-[0.985] transition-transform disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #f5a623 0%, #ffaf3a 100%)' }}
          >
            {starting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6 fill-zinc-950" />}
            Los geht's
          </button>
        </div>
      </div>
    </div>
  );
}
