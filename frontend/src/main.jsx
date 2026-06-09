import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initDebug } from './debug';
import './index.css';

// Start on-device devtools (eruda) before anything renders, but only when debug mode is enabled
// (?debug=1 or the plexdice_debug flag). Lazy — when disabled nothing is imported. See debug.js.
initDebug();

// Viewport height: a browser tab uses pure CSS 100dvh (the dynamic visible viewport), so <main> —
// the only scroller — is exactly the visible height. An installed standalone PWA additionally pins
// --app-height to the full screen height (inline script in index.html) because there 100dvh
// undershoots to the layout viewport, which would float the bottom nav up over a black band.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the service worker on production builds only, and reload once when a new worker
// takes control so the installed PWA never stays on stale assets after a deploy. The SW
// uses skipWaiting()+clients.claim(), so a new version activates immediately and fires
// controllerchange here; the guard prevents a reload loop.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let reloading = false;
  // Only reload on an UPDATE (a worker already controlled this page at load). On a
  // first-ever install the SW's clients.claim() also fires controllerchange, but there's
  // nothing stale then — reloading would just flicker the first launch.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((reg) => { reg.update?.(); })
      .catch(() => {});
  });
}
