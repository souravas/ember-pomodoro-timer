// Loaded synchronously in <head> (MV3 CSP bars inline scripts) so the saved
// theme lands before first paint — no flash of the default. localStorage is
// just a mirror; chrome.storage state remains the source of truth and
// applyTheme() reconciles the two as soon as it loads.
try {
  var theme = localStorage.getItem('ember-theme');
  if (theme) document.documentElement.dataset.theme = theme;
} catch (e) {
  // First paint uses the default theme; state will correct it moments later.
}
