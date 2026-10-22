import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { getPref, setPref, getStarredTools, starTool, unstarTool, getRecentFiles, addRecentFile } from '../services/storage';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [theme, setThemeState] = useState('light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [starredTools, setStarredTools] = useState(new Set());
  const [recentFiles, setRecentFiles] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(() => window.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches || navigator.standalone === true);
  const [isInstalling, setIsInstalling] = useState(false);
  const installLock = useRef(false);
  const [toasts, setToasts] = useState([]);

  // Load preferences
  useEffect(() => {
    async function loadPrefs() {
      const savedTheme = await getPref('theme', 'light');
      const savedCollapsed = await getPref('sidebarCollapsed', false);
      setThemeState(savedTheme);
      setSidebarCollapsed(savedCollapsed);
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
    loadPrefs();
  }, []);

  // Load starred tools
  useEffect(() => {
    getStarredTools().then((tools) => {
      setStarredTools(new Set(tools.map((t) => t.toolId)));
    });
  }, []);

  // Load recent files
  useEffect(() => {
    getRecentFiles().then(setRecentFiles);
  }, []);

  // Online/offline
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // PWA install
  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)');
    const handler = (e) => {
      if (displayMode.matches || navigator.standalone === true) return;
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };
    const installed = () => { setIsAppInstalled(true); setDeferredInstallPrompt(null); };
    const modeChanged = () => setIsAppInstalled(displayMode.matches || navigator.standalone === true);
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installed);
    displayMode.addEventListener('change', modeChanged);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
      displayMode.removeEventListener('change', modeChanged);
    };
  }, []);

  // Keyboard shortcut Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    setPref('theme', t);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      setPref('sidebarCollapsed', next);
      return next;
    });
  }, []);

  const toggleStarTool = useCallback(async (toolId) => {
    if (starredTools.has(toolId)) {
      await unstarTool(toolId);
      setStarredTools((prev) => { const s = new Set(prev); s.delete(toolId); return s; });
    } else {
      await starTool(toolId);
      setStarredTools((prev) => new Set([...prev, toolId]));
    }
  }, [starredTools]);

  const recordRecentFile = useCallback(async (meta) => {
    await addRecentFile(meta);
    const updated = await getRecentFiles();
    setRecentFiles(updated);
  }, []);

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const installPwa = useCallback(async () => {
    if (installLock.current) return 'busy';
    if (!deferredInstallPrompt || isAppInstalled) return 'unavailable';
    installLock.current = true;
    setIsInstalling(true);
    // Browser install events can be used only once, including after dismissal.
    setDeferredInstallPrompt(null);
    try {
      await deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      return result.outcome;
    } catch {
      return 'unavailable';
    } finally {
      installLock.current = false;
      setIsInstalling(false);
    }
  }, [deferredInstallPrompt, isAppInstalled]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <AppContext.Provider value={{
      theme, setTheme, toggleTheme,
      sidebarCollapsed, toggleSidebar,
      mobileSidebarOpen, setMobileSidebarOpen,
      starredTools, toggleStarTool,
      recentFiles, recordRecentFile,
      searchOpen, setSearchOpen,
      isOnline,
      deferredInstallPrompt, installPwa, isAppInstalled, isInstalling,
      toasts, showToast, dismissToast,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
