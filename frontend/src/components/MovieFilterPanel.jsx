import { Tag, Eye, EyeOff, Check, Calendar, Clock, ShieldAlert, Star, X } from 'lucide-react';
import { HistogramRange } from './HistogramRange';
import GenrePicker from './GenrePicker';
import { FSK_VALUES, formatRuntime, genreSummary } from './movieFilters';

const ACCENT = '#f5a623';

// The shared filter controls (genre, seen/unseen, year, runtime, FSK, rating + reset), reused by the
// dice page AND the quiz pre-filter so both stay in sync. Fully controlled: the caller owns the state
// (via useMovieFilters or its own) and the scroll/collapse chrome around this panel. `highlightSection`
// pulses one section (used by the dice funnel's "jump to stage"); omit it elsewhere.
export default function MovieFilterPanel({
  movies,
  genreGroups, setGenreGroups, allGenres,
  watched, setWatched,
  yearBounds, effYearMin, effYearMax, setYearMin, setYearMax,
  runtimeMin, runtimeMax, setRuntimeMin, setRuntimeMax, RUNTIME_MIN_BOUND, RUNTIME_MAX_BOUND,
  fskMin, fskMax, setFskMin, setFskMax,
  ratingMin, ratingMax, setRatingMin, setRatingMax,
  onReset,
  highlightSection = null,
}) {
  const selectedFlat = genreGroups.flat();
  const sectionClass = (id) => (highlightSection === id ? 'filter-pulse' : undefined);

  return (
    <div className="space-y-5">
      <div id="filter-genre" className={sectionClass('genre')}>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2 uppercase tracking-wide">
            <Tag className="w-3.5 h-3.5" /> Genres
          </label>
          {selectedFlat.length > 0 && (
            <button onClick={() => setGenreGroups([])} className="text-xs text-amber-400/80 active:text-amber-300 font-medium">leeren</button>
          )}
        </div>
        <GenrePicker groups={genreGroups} allGenres={allGenres} onChange={setGenreGroups} />
        {selectedFlat.length > 0 && (
          <p className="text-xs text-amber-400/90 mt-2 tabular-nums">{genreSummary(genreGroups)}</p>
        )}
      </div>

      <div id="filter-watched" className={sectionClass('watched')}>
        <label className="text-sm font-medium text-zinc-200 flex items-center gap-2 mb-2 uppercase tracking-wide">
          <Eye className="w-3.5 h-3.5" /> Gesehen
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: 'all', label: 'Alle', Icon: Eye },
            { v: 'unseen', label: 'Ungesehen', Icon: EyeOff },
            { v: 'seen', label: 'Gesehen', Icon: Check },
          ].map(({ v, label, Icon }) => {
            const on = watched === v;
            return (
              <button
                key={v}
                onClick={() => setWatched(v)}
                className={`min-h-[44px] px-2 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.97] transition-colors ${on ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
              >
                <Icon className="w-4 h-4 shrink-0" /> <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div id="filter-year" className={sectionClass('year')}>
        <label className="text-sm font-medium text-zinc-200 flex items-center gap-2 mb-2 uppercase tracking-wide">
          <Calendar className="w-3.5 h-3.5" /> Jahr: <span className="text-amber-400 font-mono normal-case">{effYearMin}</span> – <span className="text-amber-400 font-mono normal-case">{effYearMax}</span>
        </label>
        <HistogramRange
          data={movies.map((m) => m.y).filter(Boolean)}
          min={yearBounds.min} max={yearBounds.max}
          valueMin={effYearMin} valueMax={effYearMax}
          onChangeMin={setYearMin} onChangeMax={setYearMax}
          bucketCount={31} step={1}
        />
      </div>

      <div id="filter-runtime" className={sectionClass('runtime')}>
        <label className="text-sm font-medium text-zinc-200 flex items-center gap-2 mb-2 uppercase tracking-wide">
          <Clock className="w-3.5 h-3.5" /> Spielzeit: <span className="text-amber-400 font-mono normal-case">{formatRuntime(runtimeMin)}</span> – <span className="text-amber-400 font-mono normal-case">{formatRuntime(runtimeMax)}</span>
        </label>
        <HistogramRange
          data={movies.map((m) => m.r).filter(Boolean)}
          min={RUNTIME_MIN_BOUND} max={RUNTIME_MAX_BOUND}
          valueMin={runtimeMin} valueMax={runtimeMax}
          onChangeMin={setRuntimeMin} onChangeMax={setRuntimeMax}
          bucketCount={24} step={5} formatValue={formatRuntime}
        />
      </div>

      <div id="filter-fsk" className={sectionClass('fsk')}>
        <label className="text-sm font-medium text-zinc-200 flex items-center gap-2 mb-2 uppercase tracking-wide">
          <ShieldAlert className="w-3.5 h-3.5" /> FSK: <span className="text-amber-400 font-mono">{fskMin}</span> – <span className="text-amber-400 font-mono">{fskMax}</span>
        </label>
        {(() => {
          const counts = FSK_VALUES.map((f) => movies.filter((m) => m.f === f).length);
          const maxC = Math.max(1, ...counts);
          const minIdx = FSK_VALUES.indexOf(fskMin);
          const maxIdx = FSK_VALUES.indexOf(fskMax);
          return (
            <div>
              <div className="flex items-end gap-1.5 h-14 mb-2 px-[10px]">
                {FSK_VALUES.map((f, i) => {
                  const active = f >= fskMin && f <= fskMax;
                  const h = (counts[i] / maxC) * 100;
                  return (
                    <div key={f} className="flex-1 flex flex-col justify-end" style={{ height: '100%' }}>
                      <div className="w-full rounded-t-md transition-colors" style={{ height: `${Math.max(8, h)}%`, background: active ? ACCENT : 'rgba(82,82,91,0.5)' }} />
                    </div>
                  );
                })}
              </div>
              <div className="dual-range relative h-9 px-[10px] mb-2">
                <div className="absolute top-1/2 left-[10px] right-[10px] h-1 -translate-y-1/2 rounded-full bg-zinc-700/60" />
                <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-amber-400" style={{ left: `calc(10px + ${(minIdx / (FSK_VALUES.length - 1)) * 100}%)`, right: `calc(10px + ${100 - (maxIdx / (FSK_VALUES.length - 1)) * 100}%)` }} />
                <input type="range" min={0} max={FSK_VALUES.length - 1} step={1} value={minIdx}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); setFskMin(FSK_VALUES[Math.min(v, maxIdx)]); }}
                  className="dual-range-input" style={{ zIndex: 2 }} />
                <input type="range" min={0} max={FSK_VALUES.length - 1} step={1} value={maxIdx}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); setFskMax(FSK_VALUES[Math.max(v, minIdx)]); }}
                  className="dual-range-input" style={{ zIndex: 3 }} />
              </div>
              <div className="flex gap-1.5 px-1">
                {FSK_VALUES.map((f, i) => (
                  <div key={f} className="flex-1 text-center">
                    <div className={`text-xs font-bold ${f >= fskMin && f <= fskMax ? 'text-amber-400' : 'text-zinc-500'}`}>{f}</div>
                    <div className="text-[9px] text-zinc-500">{counts[i]}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      <div id="filter-rating" className={sectionClass('rating')}>
        <label className="text-sm font-medium text-zinc-200 flex items-center gap-2 mb-2 uppercase tracking-wide">
          <Star className="w-3.5 h-3.5" /> Bewertung: <span className="text-amber-400 font-mono">{ratingMin.toFixed(1)}</span> – <span className="text-amber-400 font-mono">{ratingMax.toFixed(1)}</span>
        </label>
        <HistogramRange
          data={movies.map((m) => m.s).filter((s) => s != null)}
          min={0} max={10}
          valueMin={ratingMin} valueMax={ratingMax}
          onChangeMin={setRatingMin} onChangeMax={setRatingMax}
          bucketCount={20} step={0.1} formatValue={(v) => v.toFixed(1)}
        />
      </div>

      <button onClick={onReset}
        className="w-full py-2 rounded-xl bg-zinc-800/60 text-zinc-300 text-sm font-medium border border-zinc-800 active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
        <X className="w-3.5 h-3.5" /> Filter zurücksetzen
      </button>
    </div>
  );
}
