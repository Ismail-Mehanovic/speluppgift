/* ==========================================================================
   router.js — three real routes: /home, /game, /editor.
   Uses the History API when served over http(s) and falls back to hash routes
   (#home, #game, #editor) when the file is opened straight from disk
   (file://) or when the app runs inside a frame, such as a hosted preview,
   where the address bar belongs to the page around it.
   ========================================================================== */

window.App = window.App || {};

App.router = (function () {
  var KNOWN = ['/home', '/game', '/editor'];
  var IN_FRAME = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();
  var HASH_MODE = location.protocol === 'file:' || IN_FRAME;

  /* Works both at the domain root and inside a subfolder (GitHub Pages). */
  var BASE = (function () {
    var path = location.pathname.replace(/\/(index|404)\.html$/, '');
    for (var i = 0; i < KNOWN.length; i++) {
      var route = KNOWN[i];
      if (path === route || path.slice(-route.length) === route) {
        return path.slice(0, path.length - route.length);
      }
    }
    return path.replace(/\/$/, '');
  })();

  var routes = {};
  var currentPath = null;
  var teardown = null;

  function normalise(path) {
    if (!path) return '/home';
    path = path.split('?')[0].split('#')[0];
    if (path.charAt(0) !== '/') path = '/' + path;
    path = path.replace(/\/+$/, '') || '/home';
    return routes[path] ? path : '/home';
  }

  function readLocation() {
    if (HASH_MODE) return normalise(location.hash.replace(/^#/, ''));
    var path = location.pathname;
    if (BASE && path.indexOf(BASE) === 0) path = path.slice(BASE.length);
    path = path.replace(/\/(index|404)\.html$/, '');
    return normalise(path);
  }

  function href(path) {
    // Hash routes are plain names (#game); old links with #/game still work.
    return HASH_MODE ? '#' + path.replace(/^\//, '') : (BASE + path || '/');
  }

  /** Update the address. Sandboxed frames may refuse the History API; a plain hash change still works there. */
  function setUrl(path, replace) {
    var url = href(path);
    try {
      if (replace) history.replaceState({ path: path }, '', url);
      else history.pushState({ path: path }, '', url);
    } catch (err) {
      if (HASH_MODE && !replace) location.hash = url;
    }
  }

  function register(path, config) {
    routes[path] = config;
  }

  function render(path, opts) {
    opts = opts || {};
    path = normalise(path);
    if (path === currentPath && !opts.force) return;

    if (teardown) {
      try { teardown(); } catch (e) { /* keep navigating even if a page misbehaves */ }
      teardown = null;
    }

    var view = document.getElementById('view');
    App.sprites.unbindAll(view);
    App.ui.clear(view);

    currentPath = path;
    var route = routes[path];
    document.title = route.title ? route.title + ' · Speluppgift' : 'Speluppgift';
    document.body.dataset.route = path.slice(1);

    teardown = route.mount(view) || null;
    renderNav();

    if (!opts.keepScroll) window.scrollTo(0, 0);
  }

  function navigate(path, opts) {
    opts = opts || {};
    path = normalise(path);
    var url = href(path);
    setUrl(path, opts.replace);
    render(path, opts);
  }

  /* --- Top bar navigation ------------------------------------------------- */
  var NAV = [
    { path: '/home', label: 'Hem' },
    { path: '/game', label: 'Spel' },
    { path: '/editor', label: 'Editor' }
  ];

  function renderNav() {
    var nav = document.getElementById('topnav');
    App.ui.clear(nav);
    NAV.forEach(function (item) {
      var active = item.path === currentPath;
      nav.appendChild(App.ui.h('a', {
        class: 'btn btn-ghost btn-sm' + (active ? ' active' : ''),
        href: href(item.path),
        'data-link': true,
        'aria-current': active ? 'page' : null,
        style: active ? { background: 'var(--bg-sunken)', color: 'var(--text)' } : null,
        text: item.label
      }));
    });
  }

  function start() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('a[data-link]') : null;
      if (!link) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(link.getAttribute('href').replace(BASE, '').replace(/^#/, ''));
    });

    window.addEventListener('popstate', function () { render(readLocation()); });
    window.addEventListener('hashchange', function () { render(readLocation()); });

    var initial = readLocation();
    setUrl(initial, true);

    // The logo in the static markup points at /home; give it the right address here.
    var brand = document.querySelector('.brand[data-link]');
    if (brand) brand.setAttribute('href', href('/home'));
    render(initial, { force: true });
  }

  return {
    register: register,
    navigate: navigate,
    href: href,
    start: start,
    path: function () { return currentPath; }
  };
})();
