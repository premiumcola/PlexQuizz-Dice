import { useEffect, useState } from 'react';
import { Check, X, ArrowLeft, Loader2, Play, Film } from 'lucide-react';
import { navigate } from '../../router';
import { quizSolutions } from '../../api';
import { loadResults } from './store';

// V2.2 — Auflösung: the correct answer (title + cover) for EVERY question of a finished/quit
// round, including the ones the player missed, each marked right (first try) / wrong.
export default function QuizSolutions({ roundId }) {
  const [solutions, setSolutions] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    // Client-sequenced sound/series/mixed rounds store their per-question Auflösung locally
    // (no server session); prefer it, falling back to the server endpoint for normal rounds.
    const local = loadResults(roundId);
    if (local && Array.isArray(local.solutions)) {
      setSolutions(local.solutions);
      return () => { alive = false; };
    }
    quizSolutions(roundId)
      .then((d) => { if (alive) setSolutions(d.solutions || []); })
      .catch((e) => { if (alive) setError(e.status === 409 ? 'Runde läuft noch' : (e.message || 'Auflösung nicht verfügbar')); });
    return () => { alive = false; };
  }, [roundId]);

  const right = (solutions || []).filter((s) => s.correct).length;

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 pb-10">
        <header className="mb-5 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/quiz')} aria-label="Zurück"
            className="w-10 h-10 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 flex items-center justify-center active:scale-95 transition-transform">
            <ArrowLeft className="w-5 h-5 text-zinc-300" />
          </button>
          <div>
            <h1 className="font-display-tight text-2xl tracking-tight leading-none">Auflösung</h1>
            {solutions && (
              <p className="text-sm text-zinc-400 mt-1 tabular-nums">
                <span className="text-emerald-400 font-semibold">{right}</span> / {solutions.length} beim ersten Versuch richtig
              </p>
            )}
          </div>
        </header>

        {error ? (
          <div className="text-center text-zinc-400 py-12">
            <p className="mb-4">{error}</p>
            <button type="button" onClick={() => navigate('/quiz')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">Zum Quiz</button>
          </div>
        ) : !solutions ? (
          <div className="flex items-center justify-center py-16 text-zinc-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <ul className="space-y-2">
            {solutions.map((s, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-2.5">
                <div className="relative w-12 h-[72px] rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                  {s.cover_url ? (
                    <img src={s.cover_url} alt="" className="w-full h-full object-cover" loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Film className="w-5 h-5 text-zinc-600" /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-zinc-100 font-medium leading-tight truncate">{s.title}</div>
                  {s.year && <div className="text-xs text-zinc-500 tabular-nums">{s.year}</div>}
                </div>
                {s.plex_url && (
                  <a href={s.plex_url} target="_blank" rel="noopener noreferrer" aria-label="In Plex öffnen"
                    className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 active:scale-95 transition-transform">
                    <Play className="w-4 h-4 text-amber-400 fill-amber-400" />
                  </a>
                )}
                <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${s.correct ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {s.correct ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
