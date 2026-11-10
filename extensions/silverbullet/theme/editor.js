// Presentation only: no wiki writes, editor reloads or SilverBullet API patches.
(() => {
  const root = document.documentElement;
  const panelOrigin = location.origin.replace('://docs.', '://panel.');
  const embedded = parent !== window;
  const colors = ['surface', 'surface-2', 'bg', 'text', 'mute', 'line', 'line-2',
    'accent', 'accent-hover', 'accent-text', 'accent-soft', 'focus', 'scrim', 'warn', 'ok', 'down'];
  const setTheme = theme => {
    if (theme === 'light' || theme === 'dark') root.dataset.fysoTheme = theme;
  };
  setTheme(new URLSearchParams(location.search).get('theme'));
  if (embedded && panelOrigin !== location.origin) {
    addEventListener('message', event => {
      const data = event.data;
      if (event.source !== parent || event.origin !== panelOrigin ||
          data?.type !== 'fyso-kb-theme' || !['light', 'dark'].includes(data.theme)) return;
      setTheme(data.theme);
      for (const key of colors) {
        const value = data.colors?.[key];
        if (typeof value === 'string' && value.length < 128 && CSS.supports('color', value))
          root.style.setProperty(`--fy-${key}`, value);
      }
    });
    parent.postMessage({type: 'fyso-kb-theme-ready'}, panelOrigin);
  } else if (!embedded && root.dataset.fysoTheme) {
    // The link opens in the panel's mode; subsequent native theme changes win.
    let initialized = root.hasAttribute('data-theme');
    const observer = new MutationObserver(() => {
      if (!initialized) { initialized = true; return; }
      delete root.dataset.fysoTheme;
      observer.disconnect();
    });
    observer.observe(root, {attributes: true, attributeFilter: ['data-theme']});
  }
})();
