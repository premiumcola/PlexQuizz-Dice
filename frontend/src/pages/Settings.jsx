import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Server, RefreshCw, Loader2, Check, AlertCircle, Save, Library,
  Settings as SettingsIcon, Database, Plug, LogOut, Clipboard,
  ExternalLink, Github, Activity, ShieldCheck, Trash2,
} from 'lucide-react';
import {
  getSettings, saveSettings, discoverServers, testConnection, refreshLibrary,
  createPlexPin, checkPlexPin, plexLogout, getPlexConnectionInfo, ensurePlexClientId,
  getPersistence, clearAiCache,
} from '../api';
import DieIcon from '../components/DieIcon';
import ThemeEnrichmentPanel from '../components/ThemeEnrichmentPanel';
import SeriesCoveragePanel from '../components/SeriesCoveragePanel';
import QuizConfig from '../components/QuizConfig';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';
// Build stamp so the live (possibly PWA-cached) build is identifiable on-device.
const BUILD_HASH = import.meta.env.VITE_BUILD_HASH || 'local';
const BUILD_TIME = (import.meta.env.VITE_BUILD_TIME || '').replace('T', ' ').slice(0, 16);

// Shell-geometry diagnostics — a safety net for the iOS standalone app-height fix, shown next to
// the build stamp. html, body AND #root must ALL equal screenH (932): if a parent (html/body)
// stays the short 873 layout viewport it CLIPS the taller #root and drops the nav below the fold.
// The "full" flag reads ✓ once html == body == root == screenH. A hidden probe resolves safe-bottom.
function ShellDiag() {
  const botRef = useRef(null);
  const [d, setD] = useState({ innerH: 0, htmlH: 0, bodyH: 0, rootH: 0, screenH: 0, safeBot: 0 });

  useEffect(() => {
    const read = () => {
      const root = document.getElementById('root');
      setD({
        innerH: window.innerHeight,
        htmlH: document.documentElement.offsetHeight,
        bodyH: document.body.offsetHeight,
        rootH: root ? root.offsetHeight : 0,
        screenH: window.screen.height,
        safeBot: botRef.current ? botRef.current.offsetHeight : 0,
      });
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
      window.visualViewport?.removeEventListener('resize', read);
    };
  }, []);

  const probe = (extra) => ({
    position: 'fixed', left: 0, width: 0, visibility: 'hidden', pointerEvents: 'none', ...extra,
  });
  return (
    <>
      <div ref={botRef} aria-hidden="true" style={probe({ bottom: 0, height: 'env(safe-area-inset-bottom)' })} />
      <span className="block mt-2 text-[10px] font-mono text-zinc-500 tabular-nums break-all">
        innerH {d.innerH} · html {d.htmlH} · body {d.bodyH} · root {d.rootH} · screenH {d.screenH} · full {d.htmlH === d.screenH && d.bodyH === d.screenH && d.rootH === d.screenH ? '✓' : '✗'} · safeBot {d.safeBot} · build {BUILD_HASH}
      </span>
    </>
  );
}

// About-screen source rows; links restricted to the real public domains.
const ABOUT_SOURCES = [
  { text: 'Plex (api.plex.tv) — Bibliothek + Metadaten', href: 'https://api.plex.tv' },
  { text: 'Plex python-plexapi', href: null },
  { text: 'The Movie Database (TMDb) — wenn Poster fehlen', href: 'https://www.themoviedb.org' },
  { text: 'Anthropic Claude API — KI-Plot-Anreicherung (optional)', href: 'https://www.anthropic.com' },
];

const TABS = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'plex', label: 'Plex' },
  { id: 'bibliotheken', label: 'Bibliotheken' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'ueber', label: 'Über' },
];

const DEFAULT_PORT = '32400';
const POLL_INTERVAL = 2000;
const LOGIN_TIMEOUT = 5 * 60 * 1000;

function parseUrl(url) {
  if (!url) return { hostname: '', port: DEFAULT_PORT, ssl: true };
  try {
    const u = new URL(url);
    return {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? '443' : DEFAULT_PORT),
      ssl: u.protocol === 'https:',
    };
  } catch {
    return { hostname: url, port: DEFAULT_PORT, ssl: true };
  }
}

// A discovered server connection's reachable host, mirroring how `hostname` is stored.
function connHost(conn) {
  try { return new URL(conn.uri).hostname; } catch { return conn.address; }
}

function loginErrorMessage(e) {
  // The backend returns a specific German reason for connection/timeout/HTTP
  // errors; prefer it, then fall back to status-based wording.
  if (e?.detail) return e.detail;
  if (e?.status === 504) return 'Zeitüberschreitung beim Plex-Login';
  if (e?.status === 502) return 'plex.tv nicht erreichbar — DNS-Problem?';
  return e?.message || 'Login fehlgeschlagen';
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full transition-colors ${checked ? 'bg-amber-400' : 'bg-zinc-700'}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
      <div className="sm:w-56 shrink-0">
        <div className="text-sm font-medium text-zinc-200">{label}</div>
        {hint && <div className="text-xs text-zinc-500 mt-0.5">{hint}</div>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export default function Settings({ onConnected }) {
  const [activeTab, setActiveTab] = useState('plex');
  const [loaded, setLoaded] = useState(false);

  const [clientId, setClientId] = useState('');
  const [user, setUser] = useState(null);

  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState(DEFAULT_PORT);
  const [ssl, setSsl] = useState(true);
  const [manualUrl, setManualUrl] = useState('');
  const [connInfo, setConnInfo] = useState(null);

  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');

  const [sections, setSections] = useState([]);
  const [selectedLibraries, setSelectedLibraries] = useState([]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState('');

  const [polling, setPolling] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [toast, setToast] = useState(null);
  const [persist, setPersist] = useState(null);
  const [persistLoading, setPersistLoading] = useState(false);
  const [startTab, setStartTab] = useState('last');
  const [reduceMotion, setReduceMotion] = useState(false);

  const pollRef = useRef(null);
  const timeoutRef = useRef(null);
  const popupRef = useRef(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const copyText = useCallback((text) => {
    if (!navigator.clipboard) { showToast('error', 'Kopieren nicht verfügbar'); return; }
    navigator.clipboard.writeText(text).then(
      () => showToast('success', 'Kopiert'),
      () => showToast('error', 'Kopieren fehlgeschlagen'),
    );
  }, [showToast]);

  const runPersistenceCheck = useCallback(async () => {
    setPersistLoading(true);
    try {
      setPersist(await getPersistence());
    } catch (e) {
      setPersist({ error: e.message || 'Fehler' });
    } finally {
      setPersistLoading(false);
    }
  }, []);

  const refreshConnInfo = useCallback(async () => {
    try {
      setConnInfo(await getPlexConnectionInfo());
    } catch {
      setConnInfo(null);
    }
  }, []);

  const changeStartTab = (v) => {
    setStartTab(v);
    // Keep the home.js cache fresh so the logo "home" tap honours the new choice without a reload.
    try { localStorage.setItem('plexdice:startTab', v); } catch { /* storage unavailable */ }
    saveSettings({ ui: { start_tab: v } }).catch(() => {});
  };

  const changeReduceMotion = (v) => {
    setReduceMotion(v);
    saveSettings({ ui: { reduce_motion: v } }).catch(() => {});
  };

  const clearAi = async () => {
    try {
      const res = await clearAiCache();
      showToast('success', `AI-Cache geleert (${res.cleared || 0})`);
    } catch {
      showToast('error', 'Cache leeren fehlgeschlagen');
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings();
        const plex = s.plex || {};
        const parsed = parseUrl(plex.url);
        setClientId(plex.client_id || '');
        setUser(plex.user || null);
        setHostname(parsed.hostname);
        setPort(parsed.port);
        setSsl(plex.ssl != null ? plex.ssl : parsed.ssl);
        setSelectedLibraries(plex.libraries || []);
        setManualUrl(plex.plex_server_url || '');
        const ui = s.ui || {};
        setStartTab(ui.start_tab || 'last');
        setReduceMotion(Boolean(ui.reduce_motion));
        refreshConnInfo();
      } catch {
        /* first run */
      } finally {
        setLoaded(true);
      }
    })();
  }, [refreshConnInfo]);

  const composeUrl = useCallback(
    () => `${ssl ? 'https' : 'http'}://${hostname.trim()}:${(port || DEFAULT_PORT).toString().trim()}`,
    [ssl, hostname, port],
  );

  const doDiscover = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError('');
    try {
      const { servers: list } = await discoverServers();
      setServers(list || []);
      if (!list || list.length === 0) setDiscoverError('Keine Server gefunden');
      else if (!hostname) {
        // Auto-select the first server so the Bibliotheken tab works right after login.
        const server = list[0];
        const conn = server.connections.find((c) => c.https) || server.connections[0];
        if (conn) {
          setHostname(connHost(conn));
          setPort(String(conn.port));
          setSsl(Boolean(conn.https));
          setSelectedServer(server.name);
        }
      }
    } catch (e) {
      setDiscoverError(e.message || 'Serversuche fehlgeschlagen');
    } finally {
      setDiscovering(false);
    }
  }, [hostname]);

  const onSelectServer = (name) => {
    const server = servers.find((s) => s.name === name);
    if (!server || !server.connections.length) return;
    const conn = server.connections.find((c) => c.https) || server.connections[0];
    setHostname(connHost(conn));
    setPort(String(conn.port));
    setSsl(Boolean(conn.https));
    setSelectedServer(name);
  };

  const doTest = useCallback(async () => {
    setTesting(true);
    setTestError('');
    setTestResult(null);
    try {
      const res = await testConnection({ url: composeUrl(), ssl });
      setTestResult(res);
      setSections(res.library_sections || []);
    } catch (e) {
      setTestError(e.message || 'Verbindung fehlgeschlagen');
    } finally {
      setTesting(false);
    }
  }, [composeUrl, ssl]);

  const buildPatch = () => ({
    plex: { url: composeUrl(), ssl, libraries: selectedLibraries, plex_server_url: manualUrl.trim() },
  });

  const doSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveSettings(buildPatch());
      setSaved(true);
      onConnected?.();
      refreshConnInfo();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setTestError(e.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const toggleLibrary = (id) => {
    setSelectedLibraries((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const doSync = async () => {
    setSyncing(true);
    setSyncError('');
    setSyncResult(null);
    try {
      await saveSettings(buildPatch());
      const res = await refreshLibrary();
      setSyncResult(res);
      onConnected?.();
    } catch (e) {
      setSyncError(e.message || 'Synchronisierung fehlgeschlagen');
    } finally {
      setSyncing(false);
    }
  };

  // ---- OAuth PIN login ----
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setPolling(false);
  }, []);

  const handleLoginSuccess = useCallback((u) => {
    stopPolling();
    try { popupRef.current?.close(); } catch { /* cross-origin */ }
    setUser(u);
    showToast('success', '✓ Mit Plex verbunden');
    setActiveTab('bibliotheken');
    onConnected?.();
  }, [stopPolling, showToast, onConnected]);

  // Single failure path for the login flow: stop polling, tear down the
  // "Verbinde mit Plex …" popup (every branch — it must never hang), and surface
  // the reason BOTH as a toast and as a persistent inline message under the button.
  const failLogin = useCallback((message) => {
    stopPolling();
    try { popupRef.current?.close(); } catch { /* cross-origin */ }
    popupRef.current = null;
    setLoginError(message);
    showToast('error', message);
  }, [stopPolling, showToast]);

  const startLogin = async () => {
    setLoginError('');

    // Open the popup synchronously inside the click handler. Browsers (Safari
    // most strictly) only let window.open bypass the popup blocker when it runs
    // synchronously in a user gesture; any await before it drops that trust and
    // the call silently returns null. So we open about:blank now and navigate it
    // to the real Plex URL once the async PIN request returns.
    const popup = window.open('about:blank', 'plexlogin', 'width=560,height=720');
    if (!popup) {
      failLogin('Popup blockiert. Bitte Popups für diese Seite erlauben und nochmal versuchen.');
      return;
    }
    popupRef.current = popup;
    try {
      popup.document.write(
        '<!doctype html><meta charset="utf-8"><title>Plex</title>'
        + '<body style="margin:0;display:flex;align-items:center;justify-content:center;'
        + 'position:fixed;inset:0;background:#09090b;color:#a1a1aa;font:16px system-ui,sans-serif">'
        + 'Verbinde mit Plex …</body>',
      );
    } catch { /* popup already navigated cross-origin */ }

    // settings.json may have lost its client_id (fresh container, corrupt or
    // manual write); an empty clientID makes plex.tv silently reject the auth
    // URL. Make sure the backend has one before we build the URL.
    let id = clientId;
    if (!id) {
      try {
        const res = await ensurePlexClientId();
        id = res.client_id;
        setClientId(id);
      } catch {
        failLogin('Backend nicht erreichbar');
        return;
      }
    }

    let pin;
    try {
      pin = await createPlexPin();
    } catch (e) {
      failLogin(loginErrorMessage(e));
      return;
    }

    // Past this point any unexpected throw (popup gone, etc.) must still tear the
    // popup down, so the whole tail is guarded by failLogin too.
    try {
      const params = [
        `clientID=${encodeURIComponent(id)}`,
        `code=${encodeURIComponent(pin.code)}`,
        `context[device][product]=${encodeURIComponent('PlexDice')}`,
      ].join('&');
      popup.location.href = `https://app.plex.tv/auth#?${params}`;
      setPolling(true);

      pollRef.current = setInterval(async () => {
        try {
          const res = await checkPlexPin(pin.id);
          if (res.ok) handleLoginSuccess(res.user);
        } catch {
          /* transient network error — keep polling */
        }
      }, POLL_INTERVAL);

      timeoutRef.current = setTimeout(() => {
        stopPolling();
        const msg = 'Zeitüberschreitung – bitte erneut versuchen';
        setLoginError(msg);
        showToast('error', msg);
      }, LOGIN_TIMEOUT);
    } catch (e) {
      failLogin(loginErrorMessage(e));
    }
  };

  const cancelLogin = () => {
    stopPolling();
    try { popupRef.current?.close(); } catch { /* cross-origin */ }
  };

  const doLogout = async () => {
    try { await plexLogout(); } catch { /* ignore */ }
    setUser(null);
    setServers([]);
    setSelectedServer('');
    setSections([]);
    setTestResult(null);
    showToast('success', 'Abgemeldet');
  };

  // Auto-discover servers once logged in (State 2 "on mount").
  useEffect(() => {
    if (user && servers.length === 0 && !discovering) doDiscover();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reflect the already-active server in the dropdown: once the list is known,
  // match the saved hostname to a server by its connection host. Runs after
  // discovery and on reload so the <select> shows the active server, not a blank.
  useEffect(() => {
    if (!servers.length || !hostname) return;
    const match = servers.find((s) => s.connections?.some((c) => connHost(c) === hostname));
    if (match && match.name !== selectedServer) setSelectedServer(match.name);
  }, [servers, hostname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load movie sections when the Bibliotheken tab is shown and a host is known.
  useEffect(() => {
    if (activeTab === 'bibliotheken' && user && hostname && sections.length === 0 && !testing) doTest();
  }, [activeTab, hostname, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up timers on unmount.
  useEffect(() => () => stopPolling(), [stopPolling]);

  const serverFields = (
    <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 px-4 divide-y divide-zinc-800/60">
      <Row label="Server">
        <div className="flex gap-2">
          <select
            onChange={(e) => onSelectServer(e.target.value)}
            value={selectedServer}
            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-zinc-950 text-zinc-100 outline-none focus:ring-2 focus:ring-amber-400/60"
          >
            <option value="" disabled>{servers.length ? 'Server wählen' : 'Server werden geladen…'}</option>
            {servers.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={doDiscover}
            disabled={discovering}
            className="px-3 py-2 rounded-xl bg-amber-400 text-zinc-950 font-medium flex items-center gap-1.5 disabled:opacity-40 active:scale-[0.97] transition-transform"
            title="Verfügbare Server neu laden"
          >
            {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
        {discoverError && <p className="text-xs text-rose-300 mt-1.5">{discoverError}</p>}
      </Row>

      <Row label="Hostname oder IP-Adresse">
        <div className="flex rounded-xl bg-zinc-950 overflow-hidden focus-within:ring-2 focus-within:ring-amber-400/60">
          <span className="px-3 py-2 bg-zinc-800 text-zinc-400 text-sm select-none">{ssl ? 'https://' : 'http://'}</span>
          <input
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="192.168.1.10"
            className="flex-1 min-w-0 px-3 py-2 bg-transparent text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </div>
      </Row>

      <Row label="Port">
        <input
          type="text"
          inputMode="numeric"
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder={DEFAULT_PORT}
          className="w-32 px-3 py-2 rounded-xl bg-zinc-950 text-zinc-100 placeholder-zinc-500 outline-none focus:ring-2 focus:ring-amber-400/60"
        />
      </Row>

      <Row label="SSL verwenden">
        <Toggle checked={ssl} onChange={setSsl} />
      </Row>

      <Row label="Server-URL (manuell)">
        <input
          type="url"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="https://192.168.178.10:32400"
          className="w-full px-3 py-2 rounded-xl bg-zinc-950 text-zinc-100 placeholder-zinc-500 outline-none focus:ring-2 focus:ring-amber-400/60"
        />
        <p className="text-xs text-zinc-500 mt-1.5">
          Lass leer für automatische Plex-Erkennung. Manuell setzen wenn plex.direct DNS nicht funktioniert.
        </p>
        {connInfo?.url && (
          <div className="text-xs font-mono text-zinc-500 mt-1.5 truncate">
            Aktiv: <span className={connInfo.reachable ? 'text-emerald-400' : 'text-rose-300'}>{connInfo.url}</span>
            <span className="text-zinc-600"> · {connInfo.mode === 'manual' ? 'manuell' : 'automatisch'}</span>
          </div>
        )}
        {connInfo?.link_base && (
          <div className="text-xs font-mono text-zinc-500 mt-1 flex items-center gap-1">
            <span className="truncate">Deep-link Basis: <span className="text-zinc-300">{connInfo.link_base}</span></span>
            <button
              type="button"
              onClick={() => copyText(connInfo.link_base)}
              aria-label="Deep-link Basis kopieren"
              title="Kopieren"
              className="shrink-0 p-3.5 -my-2 rounded-lg text-zinc-400 active:text-amber-300 active:scale-95"
            >
              <Clipboard className="w-4 h-4" />
            </button>
          </div>
        )}
      </Row>
    </div>
  );

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      {toast && (
        // Bottom-anchored, centred — never under the notch/Dynamic Island. The offset clears the
        // mobile bottom tab bar (nav height = 54px base + env(safe-area-inset-bottom), App.jsx) plus
        // a 1.25rem gap so it floats just above the bar and the home indicator. z-[60] keeps it over
        // the nav (z-40). On desktop the bottom nav is hidden, so it simply floats near the bottom.
        <div
          className={`fixed left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg flex items-center gap-2 text-white ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`}
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 54px + 1.25rem)' }}
        >
          {toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:pb-12">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-amber-400 flex items-center justify-center shadow-lg shadow-amber-400/20">
            <SettingsIcon className="w-5 h-5 text-zinc-950" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-3xl lg:text-4xl tracking-tight">Einstellungen</h1>
        </div>

        <div className="flex gap-1 overflow-x-auto mb-6 p-1 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-xl text-base font-medium whitespace-nowrap transition-colors ${activeTab === t.id ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400 active:text-zinc-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!loaded && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Lädt…</div>
        )}

        {loaded && activeTab === 'plex' && (
          <section>
            <h2 className="text-lg font-semibold mb-1">Plex Einstellungen</h2>
            <p className="text-sm text-zinc-400 mb-4">Melde dich mit deinem Plex-Account an und wähle deinen Server.</p>

            {!user ? (
              <div className="py-8 flex flex-col items-center text-center">
                {!polling ? (
                  <button
                    onClick={startLogin}
                    className="h-12 px-8 rounded-xl bg-amber-400 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-amber-400/20"
                  >
                    <Plug className="w-5 h-5" /> Mit Plex anmelden
                  </button>
                ) : (
                  <>
                    <button disabled className="h-12 px-8 rounded-xl bg-amber-400/80 text-white font-semibold text-base flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" /> Warte auf Anmeldung…
                    </button>
                    <button onClick={cancelLogin} className="mt-3 text-sm text-zinc-400 active:text-zinc-200">Abbrechen</button>
                  </>
                )}
                {!polling && !loginError && <p className="text-sm text-zinc-400 mt-3">Du wirst kurz zu plex.tv weitergeleitet.</p>}
                {!polling && loginError && (
                  <div className="mt-4 w-full max-w-xs p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex flex-col items-center gap-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{loginError}</span>
                    </div>
                    <button onClick={startLogin} className="font-semibold text-amber-400 active:text-amber-300">
                      Erneut versuchen
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 p-4 rounded-xl bg-zinc-900 mb-5">
                  {user.thumb ? (
                    <img src={user.thumb} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover bg-zinc-800 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-amber-400/20 flex items-center justify-center text-amber-400 font-bold shrink-0">
                      {(user.username || '?').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-zinc-100 truncate">{user.username || 'Plex User'}</div>
                    {user.email && <div className="text-xs text-zinc-500 truncate">{user.email}</div>}
                  </div>
                  <button onClick={doLogout} className="text-zinc-400 active:text-zinc-200 text-sm flex items-center gap-1.5 shrink-0">
                    <LogOut className="w-4 h-4" /> Abmelden
                  </button>
                </div>

                {serverFields}

                {testResult && testResult.ok && (
                  <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4" /> Verbunden mit <span className="font-semibold">{testResult.server_name}</span> (v{testResult.version}) · {testResult.library_sections?.length || 0} Film-Bibliotheken
                  </div>
                )}
                {testError && (
                  <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> {testError}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-5">
                  <button
                    onClick={doTest}
                    disabled={!hostname || testing}
                    className="px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-100 font-medium flex items-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform"
                  >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />} Verbindung testen
                  </button>
                  <button
                    onClick={doSave}
                    disabled={saving || !hostname}
                    className="px-4 py-2.5 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform shadow-lg shadow-amber-400/20"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {saved ? 'Gespeichert' : 'Speichern'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {loaded && activeTab === 'bibliotheken' && (
          <section>
            <h2 className="text-lg font-semibold mb-1">Plex Bibliotheken</h2>
            <p className="text-sm text-zinc-400 mb-4">Wähle die Film-Bibliotheken, aus denen PlexDice würfeln soll, und synchronisiere sie.</p>

            {!user && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Bitte zuerst im Plex-Tab anmelden.
              </div>
            )}

            {user && testing && (
              <div className="flex items-center gap-2 text-zinc-400 text-sm mb-3"><Loader2 className="w-4 h-4 animate-spin" /> Bibliotheken werden geladen…</div>
            )}

            {user && !testing && sections.length === 0 && (
              <button
                onClick={doTest}
                disabled={!hostname}
                className="w-full p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-zinc-300 text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-40"
              >
                <RefreshCw className="w-4 h-4" /> Bibliotheken vom Server laden
              </button>
            )}

            {user && sections.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {sections.map((sec) => {
                    const on = selectedLibraries.includes(sec.id);
                    return (
                      <button
                        key={sec.id}
                        onClick={() => toggleLibrary(sec.id)}
                        className={`p-4 rounded-2xl text-left transition-colors active:scale-[0.98] ${on ? 'bg-amber-400/15 border-2 border-amber-400' : 'bg-zinc-900/60 border-2 border-zinc-800'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Library className={`w-5 h-5 ${on ? 'text-amber-400' : 'text-zinc-500'}`} />
                          {on && <Check className="w-4 h-4 text-amber-400" />}
                        </div>
                        <div className="mt-2 font-medium text-zinc-100 truncate">{sec.title}</div>
                        <div className="text-xs text-zinc-500">ID {sec.id}</div>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={doSync}
                  disabled={syncing || selectedLibraries.length === 0}
                  className="w-full mt-5 py-3 rounded-xl bg-amber-400 text-zinc-950 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform shadow-lg shadow-amber-400/20"
                >
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  {syncing ? 'Synchronisiere…' : 'Bibliotheken synchronisieren'}
                </button>
                <p className="text-xs text-zinc-500 mt-2 text-center">
                  Nach Update der Server-URL bitte synchronisieren — sonst zeigen ältere Filme noch alte Deep-links.
                </p>
              </>
            )}

            {syncResult && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm flex items-center gap-2">
                <Check className="w-4 h-4" /> {syncResult.count} Filme synchronisiert
              </div>
            )}
            {syncError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {syncError}
              </div>
            )}
          </section>
        )}

        {loaded && activeTab === 'quiz' && <QuizConfig />}

        {loaded && activeTab === 'ueber' && (
          <section className="space-y-4">
            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <div className="flex items-center gap-3">
                <DieIcon className="w-10 h-10 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-2xl text-zinc-100 leading-none">PlexDice</div>
                  <p className="text-sm text-zinc-400 mt-1">Plex Companion fürs Filmwürfeln und Quizzen.</p>
                </div>
                <div className="shrink-0 self-start text-right">
                  <span className="block text-xs font-mono text-zinc-400 px-2 py-1 rounded-lg bg-zinc-800">v{APP_VERSION}</span>
                  <span className="block mt-1 text-[10px] font-mono text-zinc-500 tabular-nums">{BUILD_HASH} · {BUILD_TIME}</span>
                </div>
              </div>
              <ShellDiag />
            </div>

            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3">Quellen & Bibliotheken</h3>
              <ul className="space-y-2 text-sm text-zinc-400">
                {ABOUT_SOURCES.map((s) => (
                  <li key={s.text}>
                    {s.href ? (
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-amber-300 active:text-amber-300">
                        {s.text} <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    ) : (
                      <span>{s.text}</span>
                    )}
                  </li>
                ))}
                <li className="flex flex-wrap items-center gap-x-1.5">
                  <span>Frontend:</span>
                  <a href="https://react.dev" target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-amber-300 active:text-amber-300 underline decoration-zinc-700">React</a>
                  <span className="text-zinc-600">·</span>
                  <a href="https://vitejs.dev" target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-amber-300 active:text-amber-300 underline decoration-zinc-700">Vite</a>
                  <span className="text-zinc-600">·</span>
                  <a href="https://tailwindcss.com" target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-amber-300 active:text-amber-300 underline decoration-zinc-700">Tailwind</a>
                  <span className="text-zinc-600">·</span>
                  <a href="https://lucide.dev" target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-amber-300 active:text-amber-300 underline decoration-zinc-700">lucide-react</a>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Datenschutz</h3>
              <ul className="space-y-2 text-sm text-zinc-400 list-disc pl-5">
                <li>Plex-Token wird ausschließlich auf diesem Server gespeichert und nie an Dritte weitergegeben.</li>
                <li>Keine Telemetrie, keine Analytics.</li>
                <li>AI-Plot-Texte werden ggf. anonymisiert an Anthropic gesendet, Filmtitel + Jahr — nichts darüber hinaus.</li>
              </ul>
            </div>

            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3">Code</h3>
              <a href="https://github.com/premiumcola/PlexDice" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-amber-300 active:text-amber-300">
                <Github className="w-4 h-4" /> github.com/premiumcola/PlexDice
              </a>
            </div>

            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3">Diagnostics</h3>
              <button
                type="button"
                onClick={runPersistenceCheck}
                disabled={persistLoading}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-100 text-sm font-medium flex items-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40"
              >
                {persistLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} Persistenz-Check
              </button>
              {persist && (
                <pre className="mt-3 p-3 rounded-xl bg-zinc-950 ring-1 ring-zinc-800 font-mono text-xs text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(persist, null, 2)}
                </pre>
              )}
            </div>
          </section>
        )}

        {loaded && activeTab === 'allgemein' && (
          <section className="space-y-4">
            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-1">Startseite</h3>
              <p className="text-xs text-zinc-500 mb-3">Welche Seite öffnen beim Start?</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: 'dice', label: 'Würfeln' },
                  { v: 'quiz', label: 'Quiz' },
                  { v: 'last', label: 'Zuletzt genutzt' },
                ].map(({ v, label }) => {
                  const on = startTab === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => changeStartTab(v)}
                      className={`min-h-[44px] px-2 py-2.5 rounded-xl text-sm font-medium active:scale-[0.97] transition-colors ${on ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3">Animationen</h3>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-200">Bewegungen reduzieren</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Schaltet Konfetti, Feuerwerk und den animierten Würfel-Hintergrund ab.</div>
                </div>
                <Toggle checked={reduceMotion} onChange={changeReduceMotion} />
              </div>
            </div>

            <ThemeEnrichmentPanel />

            <SeriesCoveragePanel />

            <div className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3">Caches</h3>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={clearAi}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-100 text-sm font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <Trash2 className="w-4 h-4" /> AI-Plot-Cache leeren
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('bibliotheken')}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-100 text-sm font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <Database className="w-4 h-4" /> Library-Cache neu aufbauen
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
