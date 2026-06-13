import { useEffect, useState } from 'react';
import { ArrowLeft, Check, X, Clock, Loader2, Minus, Film } from 'lucide-react';
import { navigate } from '../../router';
import { quizRound } from '../../api';
import { MODE_LABEL, connectionKey, fmt } from './util';

function learningBadge(attempts) {
  if (!attempts || attempts.length < 2) return null;
  const sorted = [...attempts].sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  const n = sorted.length;
  const last = sorted[n - 1];
  const prev = sorted[n - 2];
  if (last.correct && prev.correct) return '📈 2× richtig in Folge';
  if (last.correct && !prev.correct) return `🔁 Beim ${n}. Mal endlich`;
  if (!last.correct) return `🌀 Schon zum ${n}. Mal verpasst`;
  return null;
}

// Did the player submit anything for this question? Single rounds carry chosen_option_id, multi /
// connect rounds carry a chosen_option_ids set — an empty/null both means "nicht beantwortet".
function answered(q) {
  return q.chosen_option_id != null || (q.chosen_option_ids?.length || 0) > 0;
}

function ResultIcon({ q }) {
  if (q.correct) return <Check className="w-5 h-5 text-emerald-400" />;
  if (!answered(q)) return <Clock className="w-5 h-5 text-amber-400" />;
  return <X className="w-5 h-5 text-rose-400" />;
}

// One revealed answer line: optional thumbnail (image options) + its label.
function MiniItem({ thumb, text }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {thumb && (
        <img src={thumb} alt="" loading="lazy"
          className="w-6 h-9 rounded object-cover bg-zinc-800 shrink-0"
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      )}
      <span className="truncate">{text || '–'}</span>
    </span>
  );
}

// Single-answer reveal: always show the correct answer; on a miss also show what the player chose.
function SingleReveal({ q }) {
  return (
    <div className="mt-1 text-xs space-y-0.5">
      {!q.correct && (
        <div className="text-zinc-400">
          Du: <span className={answered(q) ? 'text-rose-300' : 'text-amber-300'}>
            {answered(q) ? (q.chosen_text || '–') : 'nicht beantwortet'}
          </span>
        </div>
      )}
      <div className="text-emerald-300">Richtig: {q.correct_text || '–'}</div>
    </div>
  );
}

const MULTI_TONE = {
  hit: { Icon: Check, icon: 'text-emerald-400', text: 'text-zinc-200' },
  missed: { Icon: Minus, icon: 'text-zinc-500', text: 'text-zinc-400' },
  wrong: { Icon: X, icon: 'text-rose-400', text: 'text-rose-300 line-through' },
};

// Multi-select reveal: every correct option (✓ hit / – missed) plus the player's wrong picks (✗).
function MultiReveal({ q }) {
  const correctSet = new Set(q.correct_option_ids || []);
  const chosenSet = new Set(q.chosen_option_ids || []);
  const opts = q.options || [];
  const rows = [
    ...opts.filter((o) => correctSet.has(o.id)).map((o) => ({ o, kind: chosenSet.has(o.id) ? 'hit' : 'missed' })),
    ...opts.filter((o) => !correctSet.has(o.id) && chosenSet.has(o.id)).map((o) => ({ o, kind: 'wrong' })),
  ];
  if (!rows.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {rows.map(({ o, kind }) => {
        const t = MULTI_TONE[kind];
        return (
          <div key={o.id} className={`flex items-center gap-2 text-sm ${t.text}`}>
            <t.Icon className={`w-4 h-4 shrink-0 ${t.icon}`} />
            <MiniItem thumb={o.thumb} text={o.text} />
          </div>
        );
      })}
    </div>
  );
}

// Connect reveal: the correct left↔right pairs, each marked ✓ if the player connected it, else ✗.
function ConnectReveal({ q }) {
  const chosenSet = new Set(q.chosen_option_ids || []);
  const items = q.items || {};
  const pairs = q.pairs || [];
  if (!pairs.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {pairs.map((p, i) => {
        const got = chosenSet.has(connectionKey(p.left, p.right));
        const L = items[p.left] || {};
        const R = items[p.right] || {};
        return (
          <div key={i} className={`flex items-center gap-2 text-sm ${got ? 'text-zinc-200' : 'text-zinc-400'}`}>
            {got
              ? <Check className="w-4 h-4 shrink-0 text-emerald-400" />
              : <X className="w-4 h-4 shrink-0 text-rose-400" />}
            <span className="min-w-0 flex-1 flex items-center gap-1.5">
              <MiniItem thumb={L.thumb} text={L.text} />
              <span className="text-zinc-500 shrink-0">↔</span>
              <MiniItem thumb={R.thumb} text={R.text} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Reveal({ q }) {
  if (q.mode === 'connect') return <ConnectReveal q={q} />;
  if (q.multi_select) return <MultiReveal q={q} />;
  return <SingleReveal q={q} />;
}

export default function QuizReview({ roundId }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    quizRound(roundId).then(setRecord).catch(() => setError(true));
  }, [roundId]);

  if (error) {
    return (
      <div className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-zinc-400">Runde nicht gefunden.</p>
        <button type="button" onClick={() => navigate('/quiz')} className="px-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold">Zum Quiz</button>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="min-h-full bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  const stats = record.movie_stats || {};

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-6 sm:py-10">
        <header className="mb-5 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/quiz')} aria-label="Zurück"
            className="w-10 h-10 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 flex items-center justify-center active:scale-95 shrink-0">
            <ArrowLeft className="w-5 h-5 text-zinc-300" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display-tight text-2xl lg:text-3xl tracking-tight leading-none truncate">{record.name}</h1>
            <div className="text-sm text-zinc-500 tabular-nums mt-0.5">{fmt(record.score)} Punkte · {record.size} Fragen</div>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {(record.questions || []).map((q) => {
            const badge = learningBadge(stats[q.movie_key]);
            const isConnect = q.mode === 'connect';
            return (
              <div key={q.id} className="rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 p-3">
                <div className="flex items-start gap-3">
                  {!isConnect && (
                    <img src={`/api/library/thumb/${q.movie_key}`} alt="" loading="lazy"
                      className="rounded-md object-cover bg-zinc-800 shrink-0" style={{ width: 40, height: 60 }}
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-100 truncate">
                      {isConnect
                        ? 'Verbinden-Runde'
                        : <>{q.movie_title} {q.movie_year ? <span className="text-zinc-500 tabular-nums">· {q.movie_year}</span> : null}</>}
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">{MODE_LABEL[q.mode] || q.mode}</div>
                    {badge && <div className="text-xs text-amber-300 mt-0.5">{badge}</div>}
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <ResultIcon q={q} />
                    {!isConnect && q.movie_key && (
                      <button type="button" aria-label="Film öffnen"
                        onClick={() => navigate(`/?movie=${encodeURIComponent(q.movie_key)}`)}
                        className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center active:scale-95 transition-transform">
                        <Film className="w-5 h-5 text-amber-400" />
                      </button>
                    )}
                  </div>
                </div>
                <Reveal q={q} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
