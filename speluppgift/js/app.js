/* ==========================================================================
   app.js — wires the routes together and starts the app.
   ========================================================================== */

(function () {
  App.router.register('/home',   { title: 'Hem',    mount: App.pages.home.mount });
  App.router.register('/game',   { title: 'Spelet', mount: App.pages.game.mount });
  App.router.register('/editor', { title: 'Editor', mount: App.pages.editor.mount });

  App.router.start();

  // localStorage is blocked in some browsers under file://, in private
  // windows and in some embedded previews. Everything still works, but
  // nothing is remembered after a reload — say so once.
  if (!App.store.canSave()) {
    App.ui.toast(window.__FILE_MODE__
      ? 'Webbläsaren blockerar sparning när sidan öppnas som fil. Starta en lokal server (se README).'
      : 'Webbläsaren blockerar sparning här — ändringarna försvinner när sidan laddas om.', 'warn');
  }
})();
