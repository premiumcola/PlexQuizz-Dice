// Shared movie-filter logic for the dice ("Würfel") page AND the quiz pre-filter, so both stay in
// sync. Holds the filter constants, the predicate/stage builder, a serialisable criteria builder for
// the backend, and a small state hook. The UI lives in MovieFilterPanel.jsx.
import { useEffect, useMemo, useState } from 'react';
import { Tag, Calendar, Clock, Shield, Star, Eye } from 'lucide-react';

export const RUNTIME_MIN_BOUND = 60;
export const RUNTIME_MAX_BOUND = 240;
export const FSK_VALUES = [0, 6, 12, 16, 18];

export function formatRuntime(m) {
  if (!m) return '?';
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}m`;
  return `${h}h ${min.toString().padStart(2, '0')}m`;
}

// Genre groups: inner array = AND, outer = OR. Joins genres with " & ", groups with " ODER ";
// parens around multi-genre groups only when >1 group.
export function genreSummary(groups) {
  const active = groups.filter((g) => g.length > 0);
  const multi = active.length > 1;
  return active
    .map((g) => (multi && g.length > 1 ? `(${g.join(' & ')})` : g.join(' & ')))
    .join(' ODER ');
}

// One pipeline of ACTIVE filter stages (a stage is active only when it differs from the library
// bounds). Each stage carries a movie predicate for client-side filtering plus funnel metadata.
export function buildFilterStages(s, bounds) {
  const effYearMin = s.yearMin ?? bounds.min;
  const effYearMax = s.yearMax ?? bounds.max;
  const fmtRating = (v) => v.toFixed(1).replace('.', ',');
  const runtimeSummary =
    s.runtimeMin === RUNTIME_MIN_BOUND ? `≤ ${formatRuntime(s.runtimeMax)}`
      : s.runtimeMax === RUNTIME_MAX_BOUND ? `≥ ${formatRuntime(s.runtimeMin)}`
        : `${formatRuntime(s.runtimeMin)}–${formatRuntime(s.runtimeMax)}`;
  const ratingSummary =
    s.ratingMax >= 10 ? `Ab ${fmtRating(s.ratingMin)}`
      : s.ratingMin <= 0 ? `Bis ${fmtRating(s.ratingMax)}`
        : `${fmtRating(s.ratingMin)}–${fmtRating(s.ratingMax)}`;
  const genreActive = s.genreGroups.filter((grp) => grp.length > 0);
  return [
    genreActive.length > 0 && {
      id: 'genre', label: 'Genres', icon: Tag, drawer_target: 'genre',
      summary: genreSummary(s.genreGroups),
      pred: (m) => genreActive.some((grp) => grp.every((g) => (m.g || []).includes(g))),
    },
    (effYearMin !== bounds.min || effYearMax !== bounds.max) && {
      id: 'year', label: 'Jahr', icon: Calendar, drawer_target: 'year',
      summary: `${effYearMin}–${effYearMax}`,
      pred: (m) => !m.y || (m.y >= effYearMin && m.y <= effYearMax),
    },
    (s.runtimeMin !== RUNTIME_MIN_BOUND || s.runtimeMax !== RUNTIME_MAX_BOUND) && {
      id: 'runtime', label: 'Spielzeit', icon: Clock, drawer_target: 'runtime',
      summary: runtimeSummary,
      pred: (m) => !m.r || (m.r >= s.runtimeMin && m.r <= s.runtimeMax),
    },
    (s.fskMin > 0 || s.fskMax < 18) && {
      id: 'fsk', label: 'FSK', icon: Shield, drawer_target: 'fsk',
      summary: s.fskMin > 0 ? `FSK ${s.fskMin}–${s.fskMax}` : `FSK ≤ ${s.fskMax}`,
      pred: (m) => m.f == null || (m.f >= s.fskMin && m.f <= s.fskMax),
    },
    (s.ratingMin > 0 || s.ratingMax < 10) && {
      id: 'rating', label: 'Bewertung', icon: Star, drawer_target: 'rating',
      summary: ratingSummary,
      pred: (m) => m.s == null || (m.s >= s.ratingMin && m.s <= s.ratingMax),
    },
    s.watched !== 'all' && {
      id: 'watched', label: 'Gesehen', icon: Eye, drawer_target: 'watched',
      summary: s.watched === 'unseen' ? 'Ungesehen' : 'Gesehen',
      pred: (m) => (s.watched === 'unseen' ? (m.view_count || 0) === 0 : (m.view_count || 0) > 0),
    },
  ].filter(Boolean);
}

// A JSON-serialisable filter spec for the backend — only the ACTIVE dimensions, so an untouched
// filter never restricts the round (matches the dice "active stage only" semantics).
export function buildCriteria(s, bounds) {
  const ids = new Set(buildFilterStages(s, bounds).map((st) => st.id));
  const effYearMin = s.yearMin ?? bounds.min;
  const effYearMax = s.yearMax ?? bounds.max;
  const c = {};
  if (ids.has('genre')) c.genres = s.genreGroups.filter((grp) => grp.length > 0);
  if (ids.has('year')) { c.year_min = effYearMin; c.year_max = effYearMax; }
  if (ids.has('runtime')) { c.runtime_min = s.runtimeMin; c.runtime_max = s.runtimeMax; }
  if (ids.has('fsk')) { c.fsk_min = s.fskMin; c.fsk_max = s.fskMax; }
  if (ids.has('rating')) { c.rating_min = s.ratingMin; c.rating_max = s.ratingMax; }
  if (ids.has('watched')) c.watched = s.watched;
  return c;
}

// State hook for callers that don't already manage the filter state (the quiz). The dice page keeps
// its own state + prefs and only reuses buildFilterStages/MovieFilterPanel.
export function useMovieFilters(movies) {
  const [genreGroups, setGenreGroups] = useState([]);
  const [yearMin, setYearMin] = useState(null);
  const [yearMax, setYearMax] = useState(null);
  const [runtimeMin, setRuntimeMin] = useState(RUNTIME_MIN_BOUND);
  const [runtimeMax, setRuntimeMax] = useState(RUNTIME_MAX_BOUND);
  const [fskMin, setFskMin] = useState(0);
  const [fskMax, setFskMax] = useState(16);
  const [ratingMin, setRatingMin] = useState(6.0);
  const [ratingMax, setRatingMax] = useState(10.0);
  const [watched, setWatched] = useState('all');

  const yearBounds = useMemo(() => {
    const years = movies.map((m) => m.y).filter(Boolean);
    return {
      min: years.length ? Math.min(...years) : 1950,
      max: years.length ? Math.max(...years) : new Date().getFullYear(),
    };
  }, [movies]);
  const allGenres = useMemo(() => [...new Set(movies.flatMap((m) => m.g || []))].sort(), [movies]);

  // Snap an unset year range to the library bounds once the library arrives.
  useEffect(() => {
    setYearMin((prev) => (prev == null ? yearBounds.min : Math.max(yearBounds.min, prev)));
    setYearMax((prev) => (prev == null ? yearBounds.max : Math.min(yearBounds.max, prev)));
  }, [yearBounds.min, yearBounds.max]);

  const effYearMin = yearMin ?? yearBounds.min;
  const effYearMax = yearMax ?? yearBounds.max;

  const state = {
    genreGroups, yearMin, yearMax, runtimeMin, runtimeMax,
    fskMin, fskMax, ratingMin, ratingMax, watched,
  };
  const activeStages = useMemo(() => buildFilterStages(state, yearBounds), [
    genreGroups, yearMin, yearMax, runtimeMin, runtimeMax,
    fskMin, fskMax, ratingMin, ratingMax, watched, yearBounds,
  ]);
  const filtered = useMemo(() => {
    let pool = movies;
    for (const stage of activeStages) pool = pool.filter(stage.pred);
    return pool;
  }, [movies, activeStages]);
  const criteria = useMemo(() => buildCriteria(state, yearBounds), [
    genreGroups, yearMin, yearMax, runtimeMin, runtimeMax,
    fskMin, fskMax, ratingMin, ratingMax, watched, yearBounds,
  ]);

  const reset = () => {
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

  return {
    genreGroups, setGenreGroups,
    yearMin, yearMax, setYearMin, setYearMax,
    runtimeMin, runtimeMax, setRuntimeMin, setRuntimeMax,
    fskMin, fskMax, setFskMin, setFskMax,
    ratingMin, ratingMax, setRatingMin, setRatingMax,
    watched, setWatched,
    yearBounds, allGenres, effYearMin, effYearMax,
    filtered, activeFilterCount: activeStages.length, criteria, reset,
  };
}
