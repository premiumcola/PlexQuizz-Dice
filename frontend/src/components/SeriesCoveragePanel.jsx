import { useEffect, useState, useCallback } from 'react';
import { Tv, Loader2, ChevronDown, RefreshCw } from 'lucide-react';
import { getSeriesCoverage, rescanSeries } from '../api';

// T2.9 — "Serien-Themes" coverage section for the Settings status area. Shows how many shows
// have a Plex theme, an expandable list of those WITHOUT one, and a rescan trigger.
export default function SeriesCoveragePanel() {
  const [cov, setCov] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await getSeriesCoverage();
      setCov(c);
    } catch {
      /* leave previous */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRescan = async () => {
    setRescanning(true);
    try {
      await rescanSeries();
      // Give the background scan a moment, then refresh the numbers + list in place.
      setTimeout(() => { load(); setRescanning(false); }, 4000);
    } catch {
      setRescanning(false);
    }
  };

  const total = cov?.total || 0;
  const withTheme = cov?.with_theme || 0;
  const percent = cov?.percent ?? (total ? Math.round((withTheme / total) * 1000) / 10 : 0);
  const missing = cov?.missing || [];

  return (
    <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-2">
        <Tv className="w-4 h-4 text-amber-400" /> Serien-Themes
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Lädt…</div>
      ) : (
        <>
          <p className="text-xs text-zinc-400 mb-2 tabular-nums">
            Plex-Scan: {withTheme} / {total} Serien mit Theme ({percent}%)
          </p>
          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-[width] duration-500" style={{ width: `${total ? (withTheme / total) * 100 : 0}%` }} />
          </div>

          <details className="mt-3 group">
            <summary className="list-none cursor-pointer min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-xl bg-zinc-800 text-zinc-200 text-sm active:scale-[0.99] transition-transform">
              <span>Fehlende Themes anzeigen ({missing.length})</span>
              <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            {missing.length > 0 ? (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl bg-zinc-950/40 divide-y divide-zinc-800/60">
                {missing.map((s) => (
                  <li key={s.ratingKey} className="px-3 py-2 text-sm text-zinc-300 flex items-center justify-between gap-3">
                    <span className="truncate">{s.title}</span>
                    {s.year && <span className="text-zinc-500 tabular-nums shrink-0">{s.year}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-zinc-500 px-1">Alle Serien haben ein Theme. 🎉</p>
            )}
          </details>

          <button
            type="button"
            onClick={onRescan}
            disabled={rescanning}
            className="w-full min-h-[44px] mt-3 px-4 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {rescanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {rescanning ? 'Scanne…' : 'Neu scannen'}
          </button>
        </>
      )}
    </div>
  );
}
