import { useState, useEffect, useRef, useCallback } from 'react';
import { Music2, Loader2, AlertCircle, Sparkles, Search } from 'lucide-react';
// Wires the "Film-Themes" settings section to the backend enrichment API:
//   GET  /api/themes/status          — live progress + two-stage totals (polled)
//   POST /api/themes/enrich          — identify themes for N random uncached movies
//   POST /api/themes/retry-previews  — keyless: re-find previews for themes that lack one
import { getThemeStatus, startThemeEnrich, retryThemePreviews } from '../api';

const POLL_MS = 2500;
const BATCH = 200;

function Bar({ value, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div className="h-full bg-amber-400 rounded-full transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

// "Film-Themes" panel — two stages: (1) a theme is identified (composer/title), (2) a
// playable iTunes preview is found. Shows both fulfilment bars and offers two keyless
// actions: identify more themes, or re-search previews for themes that still lack one.
export default function ThemeEnrichmentPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const tick = useCallback(async () => {
    try {
      const s = await getThemeStatus();
      setStatus(s);
      if (!s.running) stopPolling();
    } catch { /* transient blip — keep polling */ }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(tick, POLL_MS);
  }, [stopPolling, tick]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await getThemeStatus();
        if (!alive) return;
        setStatus(s);
        if (s.running) startPolling();
      } catch (e) {
        if (alive) setError(e.message || 'Status nicht verfügbar');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; stopPolling(); };
  }, [startPolling, stopPolling]);

  const runAction = async (fn) => {
    setStarting(true);
    setError('');
    try {
      const res = await fn(BATCH);
      if (res && res.started === false) {
        if (res.reason === 'nothing_to_retry') setError('Keine Themes ohne Hörprobe.');
        else if (res.reason === 'already_running') setError('Läuft bereits.');
      }
      const s = await getThemeStatus();
      setStatus(s);
      if (s.running) startPolling();
    } catch (e) {
      setError(e.message || 'Start fehlgeschlagen');
    } finally {
      setStarting(false);
    }
  };

  const running = Boolean(status?.running);
  const totalMovies = status?.total_movies || 0;
  const identified = status?.theme_identified || 0;
  const previews = status?.preview_found || 0;
  const withoutPreview = status?.theme_without_preview || 0;
  const p1 = totalMovies > 0 ? Math.round((identified / totalMovies) * 100) : 0;
  const p2 = totalMovies > 0 ? Math.round((previews / totalMovies) * 100) : 0;
  const statusError = status?.error || error;
  const runLabel = status?.mode === 'retry' ? 'suche Hörproben…' : 'analysiere…';

  return (
    <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-2">
        <Music2 className="w-4 h-4 text-amber-400" /> Film-Themes
      </h3>
      <p className="text-xs text-zinc-500 mb-3">
        Erkennt das Haupt-Thema jedes Films und sucht eine spielbare 30-Sekunden-Hörprobe für das Quiz.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Lädt…</div>
      ) : (
        <>
          {/* Stage 1 — theme identified */}
          <div className="flex items-center justify-between text-xs text-zinc-300 mb-1">
            <span>Theme erkannt</span>
            <span className="tabular-nums text-zinc-400">{identified} / {totalMovies} ({p1}%)</span>
          </div>
          <Bar value={identified} total={totalMovies} />

          {/* Stage 2 — preview found */}
          <div className="flex items-center justify-between text-xs text-zinc-300 mb-1 mt-3">
            <span>Hörprobe gefunden</span>
            <span className="tabular-nums text-zinc-400">{previews} / {totalMovies} ({p2}%)</span>
          </div>
          <Bar value={previews} total={totalMovies} />
          <div className="text-[11px] text-zinc-500 mt-1 tabular-nums">{withoutPreview} ohne Hörprobe</div>

          {statusError && (
            <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{statusError}</span>
            </div>
          )}

          {running ? (
            <div className="w-full min-h-[44px] mt-3 px-4 py-2.5 rounded-xl bg-amber-400/90 text-zinc-950 font-semibold flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status.processed} / {status.target} {runLabel}
            </div>
          ) : (
            <div className="grid gap-2 mt-3">
              <button
                type="button"
                onClick={() => runAction(startThemeEnrich)}
                disabled={starting}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform shadow-lg shadow-amber-400/20"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {BATCH} weitere analysieren
              </button>
              <button
                type="button"
                onClick={() => runAction(retryThemePreviews)}
                disabled={starting || withoutPreview === 0}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-100 font-medium flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                <Search className="w-4 h-4" /> Hörproben nachsuchen ({withoutPreview})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
