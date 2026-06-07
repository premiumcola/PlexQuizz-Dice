import { useEffect, useState, useCallback, useRef } from 'react';
import { Tv, Loader2, ChevronDown, RefreshCw, Play, Square } from 'lucide-react';
import { getSeriesCoverage, rescanSeries, getSeriesSample } from '../api';

// T2.9 — "Serien-Themes" coverage section for the Settings status area. Shows how many shows
// have a Plex theme, an expandable list of those WITHOUT one, a rescan trigger, and a sample.
export default function SeriesCoveragePanel() {
  const [cov, setCov] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [sample, setSample] = useState(null);
  const [sampleErr, setSampleErr] = useState('');
  const [playing, setPlaying] = useState(false); // is the Hörprobe currently playing?
  const audioRef = useRef(null);

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

  const playSample = async () => {
    setSampleErr('');
    try {
      const s = await getSeriesSample();
      setSample(s);
      if (audioRef.current && s.ratingKey != null) {
        audioRef.current.src = `/api/series/theme/${s.ratingKey}`;
        audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    } catch (e) {
      setSample(null);
      setSampleErr(e.status === 404 ? 'Noch keine Hörprobe vorhanden.' : (e.message || 'Fehler'));
    }
  };

  // Stop the Hörprobe: pause + rewind so the next play starts fresh.
  const stopSample = () => {
    const a = audioRef.current;
    if (a) { a.pause(); a.currentTime = 0; }
    setPlaying(false);
  };

  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); }, []);

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

          <audio ref={audioRef} className="hidden" onEnded={() => setPlaying(false)} />
          {/* Hear a sample — play + Stop in one row */}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={playSample}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-zinc-800 text-amber-300 font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <Play className="w-4 h-4 fill-amber-300" /> Hörprobe testen
            </button>
            <button
              type="button"
              onClick={stopSample}
              disabled={!playing}
              aria-label="Stopp"
              className="w-12 min-h-[44px] shrink-0 rounded-xl bg-zinc-700 text-zinc-100 flex items-center justify-center active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          </div>
          {sample && <div className="mt-2 text-xs text-zinc-400 text-center truncate">♪ {sample.title}{sample.year ? ` (${sample.year})` : ''}</div>}
          {sampleErr && <div className="mt-2 text-xs text-zinc-500 text-center">{sampleErr}</div>}

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
