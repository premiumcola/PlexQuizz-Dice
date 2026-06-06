import { useState, useEffect, useRef, useCallback } from 'react';
import { Music2, Loader2, AlertCircle, Sparkles } from 'lucide-react';
// Wires the "Film-Themes" settings section to the backend enrichment API:
//   GET  /api/themes/status  — live batch progress + library/cache totals (polled)
//   POST /api/themes/enrich  — start a background batch of N random uncached movies
import { getThemeStatus, startThemeEnrich } from '../api';

const POLL_MS = 2500;
const BATCH = 200;

// "Film-Themes" panel: shows how many movies have a cached main-theme + playable
// preview, and lets the user enrich another batch in the background. While a batch
// runs it polls /api/themes/status every 2.5s and shows live "<processed> / <target>".
export default function ThemeEnrichmentPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const tick = useCallback(async () => {
    try {
      const s = await getThemeStatus();
      setStatus(s);
      if (!s.running) stopPolling(); // batch done → stop polling, totals already refreshed
    } catch {
      /* transient network blip — keep polling */
    }
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
        if (s.running) startPolling(); // a batch from a previous visit is still running
      } catch (e) {
        if (alive) setError(e.message || 'Status nicht verfügbar');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const onEnrich = async () => {
    setStarting(true);
    setError('');
    try {
      await startThemeEnrich(BATCH);
      const s = await getThemeStatus(); // reflect running state immediately, then poll
      setStatus(s);
      startPolling();
    } catch (e) {
      setError(e.message || 'Start fehlgeschlagen');
    } finally {
      setStarting(false);
    }
  };

  const running = Boolean(status?.running);
  const totalMovies = status?.total_movies || 0;
  const totalCached = status?.total_cached || 0;
  const eligible = status?.eligible_count || 0;
  const remaining = status?.remaining ?? Math.max(0, totalMovies - totalCached);
  const pct = totalMovies > 0 ? Math.min(100, Math.round((totalCached / totalMovies) * 100)) : 0;
  const statusError = status?.error || error;

  return (
    <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-2">
        <Music2 className="w-4 h-4 text-amber-400" /> Film-Themes
      </h3>
      <p className="text-xs text-zinc-500 mb-3">
        Erkennt das Haupt-Thema jedes Films und sucht eine spielbare 30-Sekunden-Hörprobe für das Quiz.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Lädt…
        </div>
      ) : (
        <>
          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mt-2 text-xs tabular-nums">
            <span className="text-zinc-300">{totalCached} / {totalMovies} analysiert</span>
            <span className="text-amber-300">{eligible} mit Theme</span>
            <span className="text-zinc-500">{remaining} offen</span>
          </div>

          {statusError && (
            <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{statusError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={onEnrich}
            disabled={running || starting}
            className="w-full min-h-[44px] mt-3 px-4 py-2.5 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform shadow-lg shadow-amber-400/20"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {status.processed} / {status.target} analysiert…
              </>
            ) : starting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Starte…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> {BATCH} weitere analysieren
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}
