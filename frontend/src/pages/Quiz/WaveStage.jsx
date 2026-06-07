import { useEffect, useRef } from 'react';

// L4.3 — calm "Slow Waves" playback animation. Three translucent accent layers, each the
// sum of TWO travelling sine components, redrawn every frame in a requestAnimationFrame loop
// so crests slowly travel AND the shape morphs (moving water, not rigid sliding bands). The
// layers run at deliberately UNEVEN heights / speeds / drift directions, with a subtle global
// amplitude "breath" (~0.9..1.05 over ~6s). The loop runs only while audio plays and freezes
// softly on pause; one static frame is drawn on mount so calm water shows before first play.
//
// Implementation note: the rAF loop mutates each <path>'s `d` imperatively (no React re-render
// per frame). A fixed viewBox + preserveAspectRatio="none" lets the SVG stretch to any width.

const ACCENT = '#f5a623';
const W = 1000;
const H = 200;
const STEP = 16; // ~8px on a phone after the viewBox is stretched down — lightweight (~63 samples)

// Tall+slow back, short+medium middle, medium+faster front drifting the other way.
const LAYERS = [
  { amp: 34, k1: 1.1, k2: 2.3, s1: 0.55, s2: 0.85, dir: 1, opacity: 0.09, base: 0.50 },
  { amp: 18, k1: 1.7, k2: 3.2, s1: 1.05, s2: 1.55, dir: 1, opacity: 0.16, base: 0.64 },
  { amp: 27, k1: 1.4, k2: 2.7, s1: 1.75, s2: 1.15, dir: -1, opacity: 0.28, base: 0.74 },
];

function waveY(layer, t, x, amp, baseY) {
  const px = (x / W) * Math.PI * 2;
  return baseY
    + amp * Math.sin(layer.k1 * px + layer.dir * layer.s1 * t)
    + amp * 0.5 * Math.sin(layer.k2 * px - layer.dir * layer.s2 * t);
}

function buildPath(layer, t) {
  const breath = 0.975 + 0.075 * Math.sin((t * 2 * Math.PI) / 6); // 0.9 .. 1.05 over ~6s
  const amp = layer.amp * breath;
  const baseY = H * layer.base;
  let d = `M 0 ${H} L 0 ${baseY.toFixed(1)}`;
  for (let x = 0; x <= W; x += STEP) {
    d += ` L ${x} ${waveY(layer, t, x, amp, baseY).toFixed(1)}`;
  }
  // The loop lands on the last multiple of STEP <= W (e.g. 992); emit the exact right edge at
  // x=W at its true wave height so the top reaches the wall before closing — no right-edge wedge.
  d += ` L ${W} ${waveY(layer, t, W, amp, baseY).toFixed(1)}`;
  return `${d} L ${W} ${H} Z`;
}

export default function WaveStage({ playing }) {
  const pathRefs = [useRef(null), useRef(null), useRef(null)];
  const rafRef = useRef(0);

  const draw = (t) => {
    LAYERS.forEach((layer, i) => {
      const p = pathRefs[i].current;
      if (p) p.setAttribute('d', buildPath(layer, t));
    });
  };

  // One static frame on mount so calm water is visible before the first play.
  useEffect(() => {
    draw(0);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current); // freeze softly on pause — last frame stays
      return undefined;
    }
    let start = null;
    const loop = (ts) => {
      if (start == null) start = ts;
      draw((ts - start) / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 overflow-hidden" aria-hidden="true">
      <svg className="w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {LAYERS.map((layer, i) => (
          <path key={i} ref={pathRefs[i]} fill={ACCENT} opacity={layer.opacity} />
        ))}
      </svg>
    </div>
  );
}
