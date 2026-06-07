import { useEffect, useMemo, useRef, useState } from 'react';

// V3 — Wheel-of-Fortune letter tiles ("Würfel") that double as the typing surface.
// One tile per answer character; spaces are gaps, punctuation is shown as itself, letters are
// blank tiles to fill. Typing fills left→right (auto-advance, overtype); tap a tile to move the
// cursor; backspace steps back. A hidden input drives the keyboard on iOS (16px font → no zoom).
//
// HARD RULE: the component never knows the answer. Letter tiles are revealed ONLY by the parent's
// hint flow (lockedLetters) — when a new hint arrives the typed guess is cleared, the previously
// revealed letters stay LOCKED, and the new batch is added.

function isFreeLetter(slots, locked, i) {
  return i >= 0 && i < slots.length && !slots[i].gap && locked[i] == null;
}

function firstFree(slots, locked) {
  for (let i = 0; i < slots.length; i += 1) if (isFreeLetter(slots, locked, i)) return i;
  return null;
}

export default function WuerfelInput({ slots, lockedLetters, onGuessChange, onSubmit, disabled }) {
  const [typed, setTyped] = useState({});
  const [cursor, setCursor] = useState(null);
  const typedRef = useRef({});
  const cursorRef = useRef(null);
  const hiddenRef = useRef(null);
  const locked = lockedLetters || {};

  const letterSlots = useMemo(
    () => slots.map((s, i) => (s.gap ? -1 : i)).filter((i) => i >= 0),
    [slots],
  );

  const sync = () => { setTyped({ ...typedRef.current }); setCursor(cursorRef.current); };

  const nextFree = (from) => {
    for (let i = from + 1; i < slots.length; i += 1) if (isFreeLetter(slots, locked, i)) return i;
    return null;
  };
  const prevFree = (from) => {
    for (let i = from - 1; i >= 0; i -= 1) if (isFreeLetter(slots, locked, i)) return i;
    return null;
  };

  // A new hint (lockedLetters changed): clear the typed guess, keep locked letters, reset cursor.
  useEffect(() => {
    typedRef.current = {};
    cursorRef.current = firstFree(slots, locked);
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedLetters, slots]);

  // Emit the current guess (gaps + locked + typed; empty letter slots contribute nothing).
  useEffect(() => {
    const g = slots
      .map((s, i) => (s.gap ? s.char : (locked[i] || typed[i] || '')))
      .join('');
    onGuessChange(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, lockedLetters, slots]);

  const focusHidden = () => { if (hiddenRef.current) hiddenRef.current.focus({ preventScroll: true }); };

  const placeChar = (ch) => {
    const i = cursorRef.current;
    if (i == null || !isFreeLetter(slots, locked, i)) return;
    typedRef.current = { ...typedRef.current, [i]: ch };
    const n = nextFree(i);
    cursorRef.current = n == null ? i : n;
    sync();
  };

  const onHiddenInput = (e) => {
    const val = e.target.value;
    e.target.value = '';
    if (disabled) return;
    for (const ch of val) if (/[\p{L}\p{N}]/u.test(ch)) placeChar(ch);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'Enter') { e.preventDefault(); onSubmit(); return; }
    if (e.key === 'Backspace') {
      e.preventDefault();
      const i = cursorRef.current;
      if (i != null && typedRef.current[i] != null) {
        const t = { ...typedRef.current }; delete t[i]; typedRef.current = t;
      } else {
        const p = prevFree(i == null ? slots.length : i);
        if (p != null) {
          const t = { ...typedRef.current }; delete t[p]; typedRef.current = t;
          cursorRef.current = p;
        }
      }
      sync();
    }
  };

  const tapTile = (i) => {
    if (disabled || !isFreeLetter(slots, locked, i)) { focusHidden(); return; }
    cursorRef.current = i;
    setCursor(i);
    focusHidden();
  };

  return (
    <div className="relative" onClick={focusHidden}>
      <input
        ref={hiddenRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-label="Antwort eintippen"
        value=""
        onChange={onHiddenInput}
        onKeyDown={onKeyDown}
        disabled={disabled}
        // 16px font avoids iOS zoom-on-focus; kept off-screen but focusable.
        className="absolute opacity-0 pointer-events-none w-px h-px"
        style={{ fontSize: '16px' }}
      />
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {slots.map((s, i) => {
          if (s.gap) {
            // Space → a visible gap; punctuation → shown as itself (no tile).
            return s.char === ' '
              ? <span key={i} className="w-3" aria-hidden="true" />
              : <span key={i} className="text-zinc-500 text-xl font-semibold px-0.5">{s.char}</span>;
          }
          const lockedCh = locked[i];
          const typedCh = typed[i];
          const active = i === cursor && !disabled;
          let cls = 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700';
          if (lockedCh != null) cls = 'bg-amber-400/20 text-amber-200 ring-2 ring-amber-400/70'; // hint-locked
          else if (active) cls = 'bg-zinc-800 text-zinc-100 ring-2 ring-[#f5a623] shadow-[0_0_10px_rgba(245,166,35,0.4)]';
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); tapTile(i); }}
              disabled={disabled}
              className={`w-9 h-11 sm:w-10 sm:h-12 rounded-lg flex items-center justify-center text-xl font-bold uppercase transition-all ${cls}`}
            >
              {lockedCh != null ? lockedCh : (typedCh || '')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
