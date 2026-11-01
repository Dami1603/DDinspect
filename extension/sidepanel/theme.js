// DDinspect - theme for the side panel, options and welcome pages.
// Loaded in <head> before the stylesheet paints so the saved theme applies
// without a flash. The preference is 'light' (default), 'dark' or 'system' and
// lives in localStorage: every extension page shares the same origin, so a
// change on the options page reaches an open side panel through 'storage'.

(() => {
  const THEME_KEY = 'ddinspect:theme';
  const LEGACY_THEME_KEY = 'webdam:theme'; // WebDAM 1.x
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const listeners = [];

  function readPref() {
    try {
      const value = localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY);
      return value === 'dark' || value === 'system' ? value : 'light';
    } catch {
      return 'light';
    }
  }

  function resolve(pref) {
    return pref === 'system' ? (dark.matches ? 'dark' : 'light') : pref;
  }

  function apply() {
    document.documentElement.dataset.theme = resolve(readPref());
    listeners.forEach((fn) => fn());
  }

  function setPref(pref) {
    try {
      localStorage.setItem(THEME_KEY, pref);
      localStorage.removeItem(LEGACY_THEME_KEY);
    } catch { /* storage blocked: the theme just won't persist */ }
    apply();
  }

  dark.addEventListener('change', apply);
  window.addEventListener('storage', (e) => { if (e.key === THEME_KEY) apply(); });
  apply();

  globalThis.DDinspectTheme = {
    get: () => document.documentElement.dataset.theme,  // resolved: 'light' | 'dark'
    pref: readPref,                                     // stored: 'light' | 'dark' | 'system'
    set: setPref,
    toggle: () => setPref(resolve(readPref()) === 'dark' ? 'light' : 'dark'),
    onChange: (fn) => listeners.push(fn)
  };
})();
