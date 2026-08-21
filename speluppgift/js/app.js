/* ==========================================================================
   app.js — wires the routes together and starts the app.
   ========================================================================== */

(function () {
  App.router.register('/home',   { title: 'Hem',    mount: App.pages.home.mount });
  App.router.register('/game',   { title: 'Spelet', mount: App.pages.game.mount });
  App.router.register('/editor', { title: 'Editor', mount: App.pages.editor.mount });

  App.router.start();

  // Opened straight from disk: routing falls back to #-paths, which is fine,
  // but localStorage is blocked in a few browsers under file://.
  if (window.__FILE_MODE__) {
    try {
      localStorage.setItem('speluppgift.probe', '1');
      localStorage.removeItem('speluppgift.probe');
    } catch (err) {
      App.ui.toast('Webbläsaren blockerar sparning när sidan öppnas som fil. Starta en lokal server (se README).', 'warn');
    }
  }
})();
