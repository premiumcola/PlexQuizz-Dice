import { useEffect, useState } from 'react';
import { Play, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { navigate } from '../../router';
import { getLibraryStatus, quizHistory } from '../../api';
import { relativeDate, fmt } from './util';
import AppHeader from '../../components/AppHeader';

function CastBanner({ progress }) {
  const { done = 0, total = 0 } = progress || {};
  const pct = total ? Math.round((done / total) * 100) : 0;
  const remainMin = Math.max(1, Math.ceil(((total - done) * 0.1) / 60));
  return (
    <div className="mb-5 rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20 p-4">
      <div className="text-sm text-amber-100">
        Bibliothek wird angereichert — voller Modusumfang in ~{remainMin} min
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-amber-200/70 tabular-nums">
        {fmt(done)} / {fmt(total)} Filme · {pct}%
      </div>
    </div>
  );
}

function RoundCard({ round }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`/quiz/review/${round.id}`)}
      className="w-full flex items-center gap-3 rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 p-3 text-left active:scale-[0.99] transition-transform"
    >
      <div className="w-20 h-12 md:w-24 md:h-14 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
        {round.photo_id ? (
          <img src={`/api/quiz/photo/${round.photo_id}?w=200`} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="w-4 h-4 text-zinc-600" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-zinc-100 truncate">{round.name}</div>
        <div className="text-xs text-zinc-500 tabular-nums">
          {relativeDate(round.finished_at)} · {round.size} Fragen
        </div>
      </div>
      <div className="font-display-tight text-xl text-amber-400 tabular-nums shrink-0">{fmt(round.score)}</div>
    </button>
  );
}

export default function QuizHome() {
  const [status, setStatus] = useState(null);
  const [rounds, setRounds] = useState([]);

  useEffect(() => {
    getLibraryStatus().then(setStatus).catch(() => {});
    quizHistory().then((d) => setRounds(d.rounds || [])).catch(() => {});
  }, []);

  const recent = [...rounds]
    .sort((a, b) => (b.finished_at || '').localeCompare(a.finished_at || ''))
    .slice(0, 3);
  const castLoading = status && !status.meta_enriched;

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-6 sm:py-10">
        <AppHeader product="quiz" />

        {castLoading && <CastBanner progress={status.meta_progress} />}

        <button
          type="button"
          onClick={() => navigate('/quiz/setup')}
          className="w-full md:w-3/5 rounded-2xl p-6 sm:p-8 lg:p-10 text-left active:scale-[0.99] transition-transform"
          style={{
            background: 'linear-gradient(135deg, #f5a623 0%, #ffaf3a 100%)',
            boxShadow: '0 8px 24px rgba(245,166,35,0.30)',
          }}
        >
          <div className="flex items-center gap-4 text-zinc-950">
            <div className="w-12 h-12 rounded-2xl bg-zinc-950/15 flex items-center justify-center shrink-0">
              <Play className="w-6 h-6 fill-zinc-950" />
            </div>
            <div>
              <div className="font-display-tight text-2xl leading-none">Neue Runde starten</div>
              <div className="text-sm opacity-80 mt-1">Wie gut kennt ihr eure Filme?</div>
            </div>
          </div>
        </button>

        {recent.length > 0 && (
          <section className="mt-8">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500 mb-3">Letzte Runden</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {recent.map((r) => (
                <RoundCard key={r.id} round={r} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate('/quiz/history')}
              className="mt-3 w-full flex items-center justify-center gap-1 text-sm text-amber-400 active:text-amber-300 py-2"
            >
              Alle Runden anzeigen <ChevronRight className="w-4 h-4" />
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
