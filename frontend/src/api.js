// Thin fetch wrappers for the PlexDice backend API.
// Dev: Vite proxies /api -> http://localhost:8080. Prod: same origin.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function unwrap(res) {
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data.error || '';
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(detail || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.detail = detail; // backend-provided message, empty when none
    throw err;
  }
  return res.json();
}

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body || {}),
  }).then(unwrap);
}

// Map backend movie dicts to the short keys the Dice UI was written against,
// while keeping the long keys (thumb_url, plex_url, summary, …) available.
function adaptMovie(m) {
  return {
    ...m,
    t: m.title,
    o: m.originalTitle,
    y: m.year,
    r: m.duration_min,
    g: m.genres || [],
    f: m.fsk,
    s: m.rating,
  };
}

export async function getLibrary() {
  const data = await fetch('/api/library').then(unwrap);
  return {
    movies: (data.movies || []).map(adaptMovie),
    refreshedAt: data.refreshed_at || null,
    castEnriched: Boolean(data.cast_enriched),
    castProgress: data.cast_progress || { done: 0, total: 0 },
    schemaVersion: data.schema_version || 1,
  };
}

export function refreshLibrary() {
  return postJson('/api/library/refresh', {});
}

export function getSettings() {
  return fetch('/api/settings').then(unwrap);
}

export function saveSettings(patch) {
  return postJson('/api/settings', patch);
}

// Token lives server-side after OAuth login; these endpoints read it themselves.
export function discoverServers() {
  return postJson('/api/plex/discover', {});
}

export function testConnection({ url, ssl }) {
  return postJson('/api/plex/test', { url, ssl });
}

export function ensurePlexClientId() {
  return postJson('/api/plex/auth/client-id', {});
}

export function createPlexPin() {
  return postJson('/api/plex/auth/pin', {});
}

export function checkPlexPin(id) {
  return fetch(`/api/plex/auth/pin/${id}`).then(unwrap);
}

export function plexLogout() {
  return postJson('/api/plex/auth/logout', {});
}

export function getPlexConnectionInfo() {
  return fetch('/api/plex/connection-info').then(unwrap);
}

export function getLibraryStatus() {
  return fetch('/api/library/status').then(unwrap);
}

export function getPersistence() {
  return fetch('/api/health/persistence').then(unwrap);
}

export function clearAiCache() {
  return postJson('/api/cache/ai/clear', {});
}

function del(url) {
  return fetch(url, { method: 'DELETE' }).then(unwrap);
}

// ---- Quiz ----
export function quizNewRound(body) {
  return postJson('/api/quiz/round/new', body);
}
export function quizAnswer(roundId, body) {
  return postJson(`/api/quiz/round/${roundId}/answer`, body);
}
export function quizComplete(roundId, body) {
  return postJson(`/api/quiz/round/${roundId}/complete`, body);
}
export function quizState(roundId) {
  return fetch(`/api/quiz/round/${roundId}/state`).then(unwrap);
}
export function quizSolutions(roundId) {
  return fetch(`/api/quiz/${roundId}/solutions`).then(unwrap);
}
export function quizAbandon(roundId) {
  return del(`/api/quiz/round/${roundId}`);
}
export function quizHistory() {
  return fetch('/api/quiz/history').then(unwrap);
}
export function quizRound(roundId) {
  return fetch(`/api/quiz/history/${roundId}`).then(unwrap);
}
export function quizDeleteRound(roundId) {
  return del(`/api/quiz/history/${roundId}`);
}
export function quizTopMovies() {
  return fetch('/api/quiz/history/top').then(unwrap);
}
export function quizLeaderboard() {
  return fetch('/api/quiz/leaderboard').then(unwrap);
}
export function quizSubmitScore(body) {
  return postJson('/api/quiz/leaderboard', body);
}
export function quizPlayers() {
  return fetch('/api/quiz/players').then(unwrap);
}
export function quizAddPlayer(name) {
  return postJson('/api/quiz/players', { name });
}
export function quizMovieStats(movieKey) {
  return fetch(`/api/quiz/movie/${movieKey}/stats`).then(unwrap);
}
export function quizUploadPhoto(file) {
  const fd = new FormData();
  fd.append('photo', file);
  return fetch('/api/quiz/photo', { method: 'POST', body: fd }).then(unwrap);
}
export function quizGetConfig() {
  return fetch('/api/quiz/config').then(unwrap);
}
export function quizSaveConfig(patch) {
  return postJson('/api/quiz/config', patch);
}

export function movieInfo(key, force = false) {
  return postJson('/api/movie/info', { key, force });
}

// ---- Film-music themes ----
export function getThemeStatus() {
  return fetch('/api/themes/status').then(unwrap);
}
export function startThemeEnrich(count = 200) {
  return postJson('/api/themes/enrich', { count });
}
export function retryThemePreviews(count = 200) {
  return postJson('/api/themes/retry-previews', { count });
}
export function getThemeSample() {
  return fetch('/api/themes/sample').then(unwrap);
}
export function getThemeEligible() {
  return fetch('/api/themes/eligible').then(unwrap);
}
export function getThemeQuestion(difficulty = 'medium') {
  return fetch(`/api/themes/question?difficulty=${encodeURIComponent(difficulty)}`).then(unwrap);
}
export function scoreThemeGuess(questionId, guess) {
  return postJson('/api/themes/score', { question_id: questionId, guess });
}
export function answerThemeGuess(questionId, guess) {
  return postJson('/api/themes/answer', { question_id: questionId, guess });
}
export function themeHint(questionId, level) {
  return postJson('/api/themes/hint', { question_id: questionId, level });
}

// ---- TV-series themes ----
export function getSeriesEligible() {
  return fetch('/api/series/eligible').then(unwrap);
}
export function getSeriesCoverage() {
  return fetch('/api/series/coverage').then(unwrap);
}
export function scoreSeriesGuess(ratingKey, guess) {
  return postJson('/api/series/score', { ratingKey, guess });
}
export function answerSeriesGuess(ratingKey, guess) {
  return postJson('/api/series/answer', { ratingKey, guess });
}
export function rescanSeries() {
  return postJson('/api/series/rescan', {});
}
export function seriesHint(ratingKey, level) {
  return postJson('/api/series/hint', { ratingKey, level });
}
