import { useState, useEffect, useCallback } from 'react';
import { Dices, Target, Settings as SettingsIcon, AlertCircle, ArrowLeft } from 'lucide-react';
import Dice from './pages/Dice';
import Settings from './pages/Settings';
import QuizRouter from './pages/Quiz';
import { getSettings } from './api';
import { usePathname, navigate } from './router';
import { homePath } from './home';

const TABS = [
  { id: 'dice', label: 'PlexDice', icon: Dices, path: '/' },
  { id: 'quiz', label: 'PlexQuiz', icon: Target, path: '/quiz/setup' },
  { id: 'settings', label: 'Einstellungen', icon: SettingsIcon, path: '/settings' },
];

// Settings sub-sections — driven from the top nav (Settings.jsx no longer renders its own row).
const SETTINGS_TABS = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'plex', label: 'Plex' },
  { id: 'bibliotheken', label: 'Bibliotheken' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'ueber', label: 'Über' },
];

function activeTab(pathname) {
  if (pathname.startsWith('/quiz')) return 'quiz';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'dice';
}

function NavItem({ active, onClick, icon: Icon, label, vertical }) {
  // Mobile tab: icon over label, vertically CENTERED across the FULL bar. The safe-area space lives
  // in the button's min-height (calc below) — not the nav's padding — so justify-center centres the
  // icon+label in the whole bar instead of leaving them at the top with empty space toward the home
  // indicator. min-height also keeps the touch target well above the 44px floor.
  const base = vertical
    ? 'flex-1 flex flex-col items-center justify-center gap-1 py-1.5 text-[11px]'
    : 'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium';
  const tone = active
    ? vertical
      ? 'text-[#f5a623]' // PlexDice accent on the active mobile tab
      : 'bg-amber-400 text-zinc-950'
    : 'text-zinc-400 active:text-zinc-200';
  return (
    <button
      onClick={onClick}
      className={`${base} ${tone} transition-colors`}
      style={vertical ? { minHeight: 'calc(54px + env(safe-area-inset-bottom))' } : undefined}
    >
      <Icon className={vertical ? 'w-7 h-7' : 'w-4 h-4'} strokeWidth={2} />
      <span>{label}</span>
    </button>
  );
}

export default function App() {
  const pathname = usePathname();
  const [needSettings, setNeedSettings] = useState(false);
  // Which settings sub-section is shown — lifted out of Settings.jsx so the top nav drives it.
  const [settingsSection, setSettingsSection] = useState('plex');
  const tab = activeTab(pathname);
  const inSettings = tab === 'settings';
  // "Back" out of the settings bar → return to the main bar (the last content tab).
  const leaveSettings = () => navigate(homePath());
  // Full-screen quiz play (normal + sound/series/mixed): hide the global nav so it never
  // overlaps the 100dvh play screen or clips its top-bar controls. The Auflösung/result pages
  // stay non-immersive (they scroll and keep the nav).
  const immersive = pathname.startsWith('/quiz/play') || pathname.startsWith('/quiz/sound');

  // On first load: to Settings if Plex isn't connected; otherwise honour the
  // start-tab preference when landing on the root.
  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings();
        // Cache the Startseite preference so the logo "home" tap (home.js) resolves the same path.
        try { localStorage.setItem('plexdice:startTab', s?.ui?.start_tab || 'last'); } catch { /* storage unavailable */ }
        if (!(s?.plex?.tokenSet && s?.plex?.url)) {
          setNeedSettings(true);
          if (!window.location.pathname.startsWith('/settings')) navigate('/settings');
          return;
        }
        if (window.location.pathname === '/') {
          const dest = homePath();
          if (dest !== '/') navigate(dest, { replace: true });
        }
      } catch {
        setNeedSettings(true);
      }
    })();
  }, []);

  // Remember the last content tab so "Zuletzt genutzt" can restore it next launch.
  useEffect(() => {
    if (tab === 'dice' || tab === 'quiz') {
      try { localStorage.setItem('plexdice:lastTab', tab); } catch { /* storage unavailable */ }
    }
  }, [tab]);

  const handleNeedSettings = useCallback(() => {
    setNeedSettings(true);
    navigate('/settings');
  }, []);

  let page;
  if (tab === 'settings') page = <Settings onConnected={() => setNeedSettings(false)} section={settingsSection} setSection={setSettingsSection} />;
  else if (tab === 'quiz') page = <QuizRouter pathname={pathname} />;
  else page = <Dice onNeedSettings={handleNeedSettings} />;

  const showBanner = needSettings && tab === 'settings';

  return (
    // Children mount DIRECTLY into #root (index.css: display:flex; flex-direction:column;
    // height: var(--app-height) = the full screen) — no wrapper div. A redundant intermediate
    // flex column can fail to fill #root on iOS, leaving empty #root space (a black strip) below
    // the nav. <main> (flex-1) is the only scroll area; it grows and pushes the mobile bottom nav
    // — the LAST flex child (flex-none) — flush to the true screen bottom, where the nav's own
    // zinc-900 background + padding-bottom env(safe-area-inset-bottom) fill to the physical edge.
    <>
      {/* Status-bar scrim — the STRONG top dark gradient: fully opaque black at the very top
          edge (0%) → an even linear fade to fully transparent exactly at the blue mark, the
          bottom of the Dynamic Island (height = safe-area-inset-top). Nothing renders below
          that mark. Own layer (translateZ) so it never jumps on iOS scroll. */}
      {!immersive && (
        <div
          aria-hidden="true"
          className="fixed top-0 inset-x-0 z-50 pointer-events-none"
          style={{
            height: 'env(safe-area-inset-top)',
            transform: 'translateZ(0)',
            background:
              'linear-gradient(to bottom, '
              + 'rgba(0, 0, 0, 1) 0%, '
              + 'rgba(0, 0, 0, 0) 100%)',
          }}
        />
      )}
      {showBanner && (
        <div className="safe-top shrink-0 z-50 bg-amber-400 text-zinc-950 text-sm font-semibold px-4 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> Bitte zuerst Plex verbinden
        </div>
      )}

      {/* Immersive quiz play locks itself to one 100dvh viewport, so main must NOT scroll there
          (otherwise the app-height overshoot below the dvh cap would add a scrollable strip). */}
      <main className={`flex-1 min-h-0 ${immersive ? 'overflow-hidden' : 'overflow-y-auto'} ${immersive || showBanner ? '' : 'safe-top'}`}>
        {/* Mobile: the settings sub-sections live in a top bar (the bottom bar keeps the main items).
            Desktop shows them in the morphed top-right nav instead (lg:hidden here). */}
        {inSettings && (
          <div className="lg:hidden max-w-3xl mx-auto px-4 sm:px-6 pt-4">
            <div className="flex items-center gap-1 overflow-x-auto p-1 rounded-2xl bg-zinc-900/60">
              <button
                type="button"
                onClick={leaveSettings}
                aria-label="Zurück"
                className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-400 active:text-zinc-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              {SETTINGS_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSettingsSection(t.id)}
                  className={`shrink-0 min-h-[44px] px-4 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${settingsSection === t.id ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400 active:text-zinc-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {page}
      </main>

      {!immersive && (
        <>
          {/* Desktop (lg+): a VERTICAL nav stacked in the very top-right corner — no hairline
              border (depth via the translucent surface + shadow). Only at lg+, where the
              centered content column leaves a clear right gutter, so it never overlaps the
              header or the J1 mini-filters (which live right-aligned inside the column). */}
          <nav
            className="hidden lg:flex lg:flex-col fixed right-4 z-40 gap-1 p-1 rounded-2xl bg-zinc-900/90 backdrop-blur shadow-lg shadow-black/40"
            style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
          >
            {inSettings ? (
              <>
                {/* The same bar, morphed: a back control + the settings sub-sections. */}
                <button
                  type="button"
                  onClick={leaveSettings}
                  className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-sm font-medium text-zinc-400 active:text-zinc-200 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Zurück
                </button>
                {SETTINGS_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSettingsSection(t.id)}
                    className={`flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-sm font-medium transition-colors ${settingsSection === t.id ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400 active:text-zinc-200'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </>
            ) : (
              TABS.map((t) => (
                <NavItem key={t.id} active={tab === t.id} onClick={() => navigate(t.path)} icon={t.icon} label={t.label} />
              ))
            )}
          </nav>

          {/* Mobile: bottom tab bar — the LAST flex child of #root (flex:0 0 auto via shrink-0;
              NORMAL flow, NOT fixed), reaching the physical screen bottom. The zinc-900 background
              sits on the nav; each tab's min-height includes env(safe-area-inset-bottom) so the
              icon+label pair centres across the FULL bar (not the top edge) while the bg still
              fills to the home-indicator edge. FLAT: separation is the zinc-900↔zinc-950 colour
              step alone — no drop-shadow scrim above the bar. */}
          <nav className="lg:hidden shrink-0 z-40 bg-zinc-900 flex">
            <div className="flex flex-1">
              {TABS.map((t) => (
                <NavItem key={t.id} vertical active={tab === t.id} onClick={() => navigate(t.path)} icon={t.icon} label={t.label} />
              ))}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
