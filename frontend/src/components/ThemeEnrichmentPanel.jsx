import { useState, useEffect, useRef, useCallback } from 'react';
import { Music2, Loader2, AlertCircle, Sparkles, Search, Play, Layers, ChevronDown } from 'lucide-react';
// Film-Themes pipeline (movies): seed coverage → (1) theme identified (Seed/KI) → (2) iTunes
// preview. Wires the backend enrichment API:
//   GET  /api/themes/status          — two-stage totals + seed diagnostics (polled)
//   GET  /api/themes/sample          — a random eligible theme to hear (Settings diagnostic)
//   POST /api/themes/enrich          — identify themes for N (or "all") uncached movies
//   POST /api/themes/retry-previews  — keyless: re-find previews for themes that lack one
import { getThemeStatus, startThemeEnrich, retryThemePreviews, getThemeSample } from '../api';

const POLL_MS = 2500;
const BATCH = 200;

function Bar({ value, total, dim = false }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full transition-[width] duration-500 ${dim ? 'bg-amber-400/50' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ThemeEnrichmentPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [sample, setSample] = useState(null);  // {title, composer, theme_title}
  const [sampleErr, setSampleErr] = useState('');
  const pollRef = useRef(null);
  const audioRef = useRef(null);

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
    return () => { alive = false; stopPolling(); if (audioRef.current) audioRef.current.pause(); };
  }, [startPolling, stopPolling]);

  const runAction = async (fn) => {
    setStarting(true);
    setError('');
    try {
      const res = await fn();
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

  const playSample = async () => {
    setSampleErr('');
    try {
      const s = await getThemeSample();
      setSample(s);
      if (audioRef.current && s.preview_url) {
        audioRef.current.src = s.preview_url;
        audioRef.current.play().catch(() => {});
      }
    } catch (e) {
      setSample(null);
      setSampleErr(e.status === 404 ? 'Noch keine Hörprobe vorhanden.' : (e.message || 'Fehler'));
    }
  };

  const running = Boolean(status?.running);
  const total = status?.total_movies || 0;
  const identified = status?.theme_identified || 0;
  const previews = status?.preview_found || 0;
  const withoutPreview = status?.theme_without_preview || 0;
  const seedCovers = status?.seed_covers_library || 0;
  const p1 = total > 0 ? Math.round((identified / total) * 100) : 0;
  const p2 = total > 0 ? Math.round((previews / total) * 100) : 0;
  const statusError = status?.error || error;
  const runLabel = status?.mode === 'retry' ? 'suche Hörproben…' : 'analysiere…';

  return (
    <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
      <h3 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-2">
        <Music2 className="w-4 h-4 text-amber-400" /> Film-Themes
      </h3>
      <p className="text-xs text-zinc-500 mb-3">
        Pipeline: vor-gescannter Seed → Theme erkannt (Seed/KI) → spielbare iTunes-Hörprobe.
      </p>

      <audio ref={audioRef} className="hidden" />

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Lädt…</div>
      ) : (
        <>
          {/* Seed coverage — proof the pre-scan is in use */}
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span>Seed verfügbar</span>
            <span className="tabular-nums">{seedCovers} / {total}</span>
          </div>
          <Bar value={seedCovers} total={total} dim />

          {/* Stage 1 — theme identified */}
          <div className="flex items-center justify-between text-xs text-zinc-300 mb-1 mt-3">
            <span>1 · Theme erkannt (Seed/KI)</span>
            <span className="tabular-nums text-zinc-400">{identified} / {total} ({p1}%)</span>
          </div>
          <Bar value={identified} total={total} />

          {/* Stage 2 — preview found */}
          <div className="flex items-center justify-between text-xs text-zinc-300 mb-1 mt-3">
            <span>2 · Hörprobe (iTunes)</span>
            <span className="tabular-nums text-zinc-400">{previews} / {total} ({p2}%)</span>
          </div>
          <Bar value={previews} total={total} />
          <div className="text-[11px] text-zinc-500 mt-1 tabular-nums">{withoutPreview} ohne Hörprobe</div>

          {/* Hear a sample */}
          <button
            type="button"
            onClick={playSample}
            className="w-full min-h-[44px] mt-3 px-4 rounded-xl bg-zinc-800 text-amber-300 font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Play className="w-4 h-4 fill-amber-300" /> Hörprobe testen
          </button>
          {sample && (
            <div className="mt-2 text-xs text-zinc-400 text-center truncate">
              ♪ {[sample.theme_title, sample.composer].filter(Boolean).join(' · ')}
              {sample.title ? ` — ${sample.title}` : ''}
            </div>
          )}
          {sampleErr && <div className="mt-2 text-xs text-zinc-500 text-center">{sampleErr}</div>}

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
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => runAction(() => startThemeEnrich(BATCH))} disabled={starting}
                  className="min-h-[44px] px-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-1.5 text-sm disabled:opacity-50 active:scale-[0.98] transition-transform">
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {BATCH} weitere
                </button>
                <button type="button" onClick={() => runAction(() => startThemeEnrich('all'))} disabled={starting}
                  className="min-h-[44px] px-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-1.5 text-sm disabled:opacity-50 active:scale-[0.98] transition-transform">
                  <Layers className="w-4 h-4" /> Alle analysieren
                </button>
              </div>
              <button type="button" onClick={() => runAction(() => retryThemePreviews(BATCH))} disabled={starting || withoutPreview === 0}
                className="w-full min-h-[44px] px-4 rounded-xl bg-zinc-800 text-zinc-100 font-medium flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform">
                <Search className="w-4 h-4" /> Hörproben nachsuchen ({withoutPreview})
              </button>
            </div>
          )}

          {/* Debug */}
          <details className="mt-3 group">
            <summary className="list-none cursor-pointer min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-xl bg-zinc-800/60 text-zinc-400 text-xs active:scale-[0.99] transition-transform">
              <span>Debug</span>
              <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <pre className="mt-2 p-3 rounded-xl bg-zinc-950/60 text-[11px] text-zinc-400 overflow-x-auto whitespace-pre-wrap break-words tabular-nums">
{`seed_loaded: ${status?.seed_loaded}
seed_size: ${status?.seed_size}
seed_path: ${status?.seed_path}
seed_covers_library: ${seedCovers}
last_pass.seed_hits: ${status?.last_pass?.seed_hits}
last_pass.haiku_calls: ${status?.last_pass?.haiku_calls}
theme_identified: ${identified}
preview_found: ${previews}`}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
