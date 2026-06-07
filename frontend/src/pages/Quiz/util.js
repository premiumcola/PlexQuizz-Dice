export const fmt = (n) => (n ?? 0).toLocaleString('de-DE');

export function relativeDate(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return 'gerade eben';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `vor ${mins} Min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vor ${hrs} Std`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `vor ${weeks} Woche${weeks > 1 ? 'n' : ''}`;
  return then.toLocaleDateString('de-DE');
}

// Rank of `score` among `scores` (highest score = Platz 1; ties share the better rank). Used by the
// result screen and the leaderboard to show "Platz X von Y".
export function scoreRank(score, scores) {
  return scores.filter((s) => (s || 0) > (score || 0)).length + 1;
}

export const MODE_PROMPT = {
  cover_to_title: 'Welcher Film ist das?',
  cover_to_decade: 'Aus welchem Jahrzehnt?',
  cover_to_genre: 'Welches Genre?',
  cover_to_studio: 'Welches Studio?',
  title_year_to_cover: 'Welches Poster gehört dazu?',
  actor_to_movie: 'In welchem Film spielt diese Person mit?',
  movie_to_actor: 'Wer spielt in diesem Film mit?',
  plot_to_movie: 'Zu welchem Film gehört dieser Plot?',
  tagline_to_movie: 'Zu welchem Film gehört dieser Slogan?',
  director_to_movie: 'Welchen Film hat diese Person inszeniert?',
  movie_to_fsk: 'Welche Altersfreigabe (FSK)?',
  movie_to_country: 'Aus welchem Land kommt der Film?',
  movie_to_director: 'Wer führte Regie?',
  movie_to_year_exact: 'In welchem Jahr erschien der Film?',
  movie_to_runtime: 'Wie lang ist der Film?',
  plot_redacted_to_movie: 'Erkennst du den Film am zensierten Plot?',
  actor_filmography_multi: 'Welche Filme gehören zu dieser Person? (mehrere)',
  writer_to_movie: 'Welchen Film schrieb diese Person?',
  two_actors_to_shared: 'In welchem Film spielen die beiden Schauspieler:innen mit?',
  collection_member: 'Welcher Film gehört zu dieser Reihe?',
  connect: 'Verbinde die passenden Paare',
};

// Canonical, order-independent id for one connection (and for a correct pair): the two item ids
// sorted + joined. The client posts these as chosen_option_ids; the backend's correct_option_ids
// use the same form, so the existing multi-select scorer validates a connect answer unchanged.
export const connectionKey = (a, b) => [a, b].sort().join('|');

export const MODE_LABEL = {
  cover_to_title: 'Cover → Titel',
  cover_to_decade: 'Cover → Jahrzehnt',
  cover_to_genre: 'Cover → Genre',
  cover_to_studio: 'Cover → Studio',
  title_year_to_cover: 'Titel → Cover',
  actor_to_movie: 'Schauspieler:in → Film',
  movie_to_actor: 'Film → Schauspieler:in',
  plot_to_movie: 'Plot → Film',
  tagline_to_movie: 'Tagline → Film',
  director_to_movie: 'Regisseur:in → Film',
  movie_to_fsk: 'Film → FSK',
  movie_to_country: 'Film → Land',
  movie_to_director: 'Film → Regisseur:in',
  movie_to_year_exact: 'Film → Jahr',
  movie_to_runtime: 'Film → Laufzeit',
  plot_redacted_to_movie: 'Plot (zensiert)',
  actor_filmography_multi: 'Filmografie',
  writer_to_movie: 'Drehbuch → Film',
  two_actors_to_shared: 'Zwei Stars → Film',
  collection_member: 'Filmreihe',
  connect: 'Verbinden',
  // Client-sequenced round types (sound/series/mixed) — for the per-mode result breakdown.
  sound: 'Sound',
  series: 'Serien-Themes',
  normal: 'Normale Fragen',
};

// Short uppercase category for the progress chip strip's active tile — derived from the existing
// question `mode` (no new backend field). Keeps the active tile compact (FILM / GENRE / JAHR …).
export const MODE_CATEGORY = {
  cover_to_title: 'FILM',
  cover_to_decade: 'JAHRZEHNT',
  cover_to_genre: 'GENRE',
  cover_to_studio: 'STUDIO',
  title_year_to_cover: 'COVER',
  actor_to_movie: 'SCHAUSPIELER',
  movie_to_actor: 'SCHAUSPIELER',
  plot_to_movie: 'PLOT',
  tagline_to_movie: 'SLOGAN',
  director_to_movie: 'REGIE',
  movie_to_fsk: 'FSK',
  movie_to_country: 'LAND',
  movie_to_director: 'REGIE',
  movie_to_year_exact: 'JAHR',
  movie_to_runtime: 'LAUFZEIT',
  plot_redacted_to_movie: 'PLOT',
  actor_filmography_multi: 'FILMOGRAFIE',
  writer_to_movie: 'DREHBUCH',
  two_actors_to_shared: 'STARS',
  collection_member: 'REIHE',
  connect: 'VERBINDEN',
};

export const TIER_LABEL = { 1: 'Leicht', 2: 'Mittel', 3: 'Schwer' };

// Modes whose image stem is a person photo (anchor the crop to the top → faces).
export const STEM_IS_PERSON = new Set([
  'actor_to_movie', 'director_to_movie', 'writer_to_movie', 'actor_filmography_multi',
]);
// Modes whose image options are person photos (top-anchor + keep the name label).
export const OPTIONS_ARE_PERSONS = new Set(['movie_to_actor', 'movie_to_director']);

// Modes where the ANSWER is a film and you pick its poster/still: on a correct answer the film
// title is the genuinely hidden answer → reveal it as an overlay on the correct cover. (Excludes
// title_year_to_cover, where the title IS the question, and the attribute/person modes, where the
// title is the already-visible subject — those reveal nothing extra.)
export const ANSWER_IS_MOVIE = new Set([
  'plot_to_movie', 'tagline_to_movie', 'plot_redacted_to_movie',
  'actor_to_movie', 'director_to_movie', 'writer_to_movie',
  'two_actors_to_shared', 'collection_member',
]);

// Actor→film modes: the answer is which film an actor is in, and that actor's name is often
// printed at the very top/bottom edge of the poster — a spoiler. Blur a band there on the
// answer covers (centre stays sharp). Posters keep their aspect ratio (the blur is an overlay).
export const OPTIONS_BLUR_NAME_BANDS = new Set([
  'actor_to_movie', 'two_actors_to_shared', 'actor_filmography_multi',
]);

// md+ panel side. By default the Stage sits on the left (cover / face / plot) and the
// answers fill a Panel on the right. Two cases drop to a Panel below, where the wide
// bottom tray serves them better. Below md the Panel is always below (QuizPlay CSS).
export function panelOnRight(q) {
  // Short text stem ("A & B") with image options needs the wide bottom panel.
  if (q.mode === 'two_actors_to_shared') return false;
  // Multi-select with > 4 options needs the wide bottom tray.
  if (q.multi_select && (q.options?.length || 0) > 4) return false;
  // Everything else: Stage left holds the cover / face / plot, Panel right the answers.
  return true;
}
