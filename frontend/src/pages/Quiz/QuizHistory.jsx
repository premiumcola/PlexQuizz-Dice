import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, MoreVertical, Dices, BarChart3, Trophy, Loader2, Medal } from 'lucide-react';
import { navigate } from '../../router';
import { quizHistory, quizTopMovies, quizDeleteRound, quizLeaderboard } from '../../api';
import { relativeDate, fmt, scoreRank } from './util';

const MEDALS = ['🥇', '🥈', '🥉'];

function RoundCard({ round, medal, onDelete, highlight, cardRef }) {
  const [menu, setMenu] = useState(false);
  return (
    <div ref={cardRef} className={`relative flex items-center gap-3 rounded-2xl bg-zinc-900/60 p-3 ${highlight ? 'ring-2 ring-amber-400' : 'ring-1 ring-zinc-800'}`}>
      <button
        type="button"
        onClick={() => navigate(`/quiz/review/${round.id}`)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-80"
      >
        <div className="w-24 aspect-video rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
          {round.photo_id ? (
            <img src={`/api/quiz/photo/${round.photo_id}?w=200`} alt="" className="w-full h-full object-cover" />
          ) : (
            <Dices className="w-6 h-6 text-zinc-600" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-zinc-100 truncate">
            {medal && <span className="mr-1">{medal}</span>}
            {round.name}
          </div>
          {round.player_names?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {round.player_names.slice(0, 4).map((p) => (
                <span key={p} className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400">{p}</span>
              ))}
            </div>
          )}
          <div className="text-xs text-zinc-500 tabular-nums mt-1">{relativeDate(round.finished_at)} · {round.size} Fragen</div>
        </div>
      </button>
      <div className="text-right shrink-0">
        <div className="font-display-tight text-2xl text-amber-400 tabular-nums leading-none">{fmt(round.score)}</div>
      </div>
      <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Optionen"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 active:bg-zinc-800 shrink-0">
        <MoreVertical className="w-4 h-4" />
      </button>
      {menu && (
        <div className="absolute right-2 top-12 z-10 rounded-xl bg-zinc-800 ring-1 ring-zinc-700 shadow-xl overflow-hidden">
          <button type="button" onClick={() => { setMenu(false); onDelete(round); }}
            className="px-4 py-2.5 text-sm text-rose-300 active:bg-zinc-700 whitespace-nowrap">Runde löschen</button>
        </div>
      )}
    </div>
  );
}

function StatsTab({ topMovies }) {
  if (!topMovies.length) {
    return <p className="text-sm text-zinc-500 text-center py-8">Noch keine Daten — spiel ein paar Runden.</p>;
  }
  return (
    <div className="space-y-2">
      {topMovies.map((m) => (
        <button key={m.movie_key} type="button" onClick={() => navigate(`/?movie=${encodeURIComponent(m.movie_key)}`)}
          className="w-full flex items-center gap-3 rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 p-3 text-left active:scale-[0.99] transition-transform">
          <img src={`/api/library/thumb/${m.movie_key}`} alt="" loading="lazy"
            className="rounded-md object-cover bg-zinc-800 shrink-0" style={{ width: 40, height: 60 }}
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-300 tabular-nums mb-1">{m.count}× gefragt · {Math.round(m.rate * 100)}% richtig</div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-amber-400" style={{ width: `${Math.round(m.rate * 100)}%` }} />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// Shared, server-side leaderboard (top player scores across the whole instance).
function LeaderboardTab({ board }) {
  if (!board.length) {
    return <p className="text-sm text-zinc-500 text-center py-8">Noch keine Einträge — spiel eine Runde und speichere deinen Namen.</p>;
  }
  return (
    <div className="space-y-2">
      {board.map((e, i) => (
        <div key={`${e.name}-${e.ts}-${i}`} className="flex items-center gap-3 rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800 p-3">
          <div className="w-8 text-center text-lg tabular-nums shrink-0">{MEDALS[i] || <span className="text-zinc-500">{i + 1}</span>}</div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-zinc-100 truncate">{e.name}</div>
            <div className="text-xs text-zinc-500 tabular-nums mt-0.5">✓ {e.correct} · ✗ {e.wrong} · {relativeDate(e.ts)}</div>
          </div>
          <div className="font-display-tight text-2xl text-amber-400 tabular-nums shrink-0">{fmt(e.score)}</div>
        </div>
      ))}
    </div>
  );
}

export default function QuizHistory() {
  // Arriving straight from a just-saved round: highlight it and rank by score so its placement is
  // obvious. The id rides in a ?saved= query param (the path-only router ignores the query).
  const [savedId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('saved'); } catch { return null; }
  });
  const [rounds, setRounds] = useState([]);
  const [topMovies, setTopMovies] = useState([]);
  const [board, setBoard] = useState([]); // shared server-side leaderboard entries
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('alle');
  const [sort, setSort] = useState(savedId ? 'beste' : 'neueste');
  // Default to the rounds list, but honour ?tab=board so a just-finished sessionless round can land
  // straight on the Bestenliste (where its freshly-submitted leaderboard entry shows).
  const [tab, setTab] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('tab') === 'board' ? 'board' : 'rounds'; } catch { return 'rounds'; }
  });
  const [confirmDel, setConfirmDel] = useState(null);
  const savedRef = useRef(null);

  const reload = () => {
    quizHistory().then((d) => setRounds(d.rounds || [])).catch(() => {}).finally(() => setLoading(false));
    quizTopMovies().then((d) => setTopMovies(d.movies || [])).catch(() => {});
    quizLeaderboard().then((d) => setBoard(d.entries || [])).catch(() => {});
  };
  useEffect(reload, []);

  const medalMap = useMemo(() => {
    const top = [...rounds].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
    const map = {};
    top.forEach((r, i) => { map[r.id] = MEDALS[i]; });
    return map;
  }, [rounds]);

  const view = useMemo(() => {
    let list = [...rounds];
    if (filter === 'top10') list = [...list].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
    else if (filter === 'monat') {
      const now = new Date();
      list = list.filter((r) => {
        const d = r.finished_at ? new Date(r.finished_at) : null;
        return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
    }
    if (sort === 'neueste') list.sort((a, b) => (b.finished_at || '').localeCompare(a.finished_at || ''));
    else if (sort === 'beste') list.sort((a, b) => (b.score || 0) - (a.score || 0));
    else if (sort === 'laengste') list.sort((a, b) => (b.size || 0) - (a.size || 0));
    return list;
  }, [rounds, filter, sort]);

  const savedRound = savedId ? rounds.find((r) => r.id === savedId) : null;
  const savedRank = savedRound
    ? scoreRank(savedRound.score, rounds.filter((r) => r.id !== savedId).map((r) => r.score))
    : null;

  // Bring the just-saved round into view once the list has rendered.
  useEffect(() => {
    if (savedRound) savedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [savedRound]);

  const doDelete = async () => {
    const r = confirmDel;
    setConfirmDel(null);
    try {
      await quizDeleteRound(r.id);
    } catch {
      /* ignore */
    }
    reload();
  };

  const chip = (id, label) => (
    <button type="button" onClick={() => setFilter(id)}
      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === id ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}>
      {label}
    </button>
  );

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-6 sm:py-10">
        <header className="mb-5 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/quiz')} aria-label="Zurück"
            className="w-10 h-10 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 flex items-center justify-center active:scale-95 shrink-0">
            <ArrowLeft className="w-5 h-5 text-zinc-300" />
          </button>
          <div className="flex-1">
            <h1 className="font-display-tight text-2xl lg:text-3xl tracking-tight leading-none">Scoreboard</h1>
            <div className="text-sm text-zinc-500 tabular-nums mt-0.5">{rounds.length} Runden</div>
          </div>
        </header>

        <div className="flex gap-1 mb-5 p-1 rounded-2xl bg-zinc-900/60 ring-1 ring-zinc-800">
          <button type="button" onClick={() => setTab('rounds')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium ${tab === 'rounds' ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400'}`}>
            <Trophy className="w-4 h-4" /> Runden
          </button>
          <button type="button" onClick={() => setTab('board')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium ${tab === 'board' ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400'}`}>
            <Medal className="w-4 h-4" /> Bestenliste
          </button>
          <button type="button" onClick={() => setTab('stats')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium ${tab === 'stats' ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400'}`}>
            <BarChart3 className="w-4 h-4" /> Lernkurve
          </button>
        </div>

        {savedId && savedRound && tab === 'rounds' && (
          <div className="mb-4 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-amber-400/15 ring-1 ring-amber-500/30 text-amber-200 text-center">
            <Medal className="w-5 h-5 shrink-0" />
            <span className="font-semibold">Gespeichert! Dein Platz: {savedRank} von {rounds.length}</span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
        ) : tab === 'stats' ? (
          <StatsTab topMovies={topMovies} />
        ) : tab === 'board' ? (
          <LeaderboardTab board={board} />
        ) : rounds.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-12">Noch keine Runden gespielt.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div className="flex gap-2">{chip('alle', 'Alle')}{chip('top10', 'Top 10')}{chip('monat', 'Diesen Monat')}</div>
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                className="px-3 py-1.5 rounded-full bg-zinc-800 text-sm text-zinc-300 outline-none">
                <option value="neueste">Neueste</option>
                <option value="beste">Beste</option>
                <option value="laengste">Längste Runden</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {view.map((r) => (
                <RoundCard key={r.id} round={r} medal={medalMap[r.id]} onDelete={setConfirmDel}
                  highlight={r.id === savedId} cardRef={r.id === savedId ? savedRef : undefined} />
              ))}
            </div>
          </>
        )}
      </div>

      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-6 text-center">
            <p className="text-lg font-semibold mb-1">Runde löschen?</p>
            <p className="text-sm text-zinc-400 mb-5 truncate">„{confirmDel.name}" wird dauerhaft entfernt.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDel(null)} className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-200 font-medium">Abbrechen</button>
              <button type="button" onClick={doDelete} className="flex-1 py-3 rounded-xl bg-rose-500 text-white font-medium">Löschen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
