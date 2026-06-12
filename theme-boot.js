// Loaded synchronously in <head> (MV3 CSP bars inline scripts) so the saved
// theme and flame accent land before first paint — no flash of the default.
// localStorage is just a mirror; chrome.storage state remains the source of
// truth and applyTheme() reconciles the two as soon as it loads.
try {
  var theme = localStorage.getItem('ember-theme');
  // 'auto' is stored unresolved; the OS decides at paint time.
  if (theme === 'auto') {
    theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'ember';
  }
  if (theme) document.documentElement.dataset.theme = theme;
  var accent = localStorage.getItem('ember-accent');
  if (accent) document.documentElement.dataset.accent = accent;
} catch (e) {
  // First paint uses the default theme; state will correct it moments later.
}
