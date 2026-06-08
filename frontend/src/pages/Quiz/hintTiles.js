// Shared hint-tile helpers for the theme-song question components (Sound + Series).
// Tiles are either gaps (punctuation/space, shown literally) or letter slots that
// get progressively revealed by server hint levels.

// Build the tile skeleton from a level-0 hint ({length, revealed:[only gaps]}).
export function slotsFromSkeleton(resp) {
  const gaps = {};
  for (const r of resp.revealed || []) gaps[r.index] = r.char;
  return Array.from({ length: resp.length || 0 }, (_, i) => (
    i in gaps ? { gap: true, char: gaps[i] } : { gap: false }
  ));
}

// The series title is known client-side (it came from /eligible), so the tile skeleton is built
// locally; hint letters still come from the server endpoint for one shared code path.
export function slotsFromTitle(title) {
  return Array.from(title || '', (ch) => (/[\p{L}\p{N}]/u.test(ch) ? { gap: false } : { gap: true, char: ch }));
}

// Letter positions (non-gap) revealed by a hint level.
export function lockedFromHint(resp, slots) {
  const out = {};
  for (const r of resp.revealed || []) if (slots[r.index] && !slots[r.index].gap) out[r.index] = r.char;
  return out;
}
