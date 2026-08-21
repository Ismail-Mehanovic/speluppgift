/* ==========================================================================
   store.js — all persistent state lives here.
   Everything is written to localStorage the moment it changes.
   ========================================================================== */

window.App = window.App || {};

App.store = (function () {
  var KEY = 'speluppgift.v1';

  /* --- Game geometry (logical pixels; the canvas is scaled to fit) -------- */
  var GAME = { W: 900, H: 540, BG_SCALE: 3 };

  /* --- Sprite catalogue -------------------------------------------------- */
  var SPRITES = [
    {
      id: 'player', name: 'Spelare',
      blurb: 'Figuren som eleven styr med mellanslag.',
      resizable: true, w: 60, h: 60,
      fill: '#3d3d3a', text: '#ffffff'
    },
    {
      id: 'hazard', name: 'Aj',
      blurb: 'Hindret. Nuddar spelaren det försvinner ett liv.',
      resizable: true, w: 64, h: 64,
      fill: '#d97757', text: '#ffffff'
    },
    {
      id: 'point', name: 'Poäng',
      blurb: 'Plocka den för att få poäng.',
      resizable: true, w: 46, h: 46,
      fill: '#c9c4b4', text: '#1f1e1d'
    },
    {
      id: 'life', name: 'Liv',
      blurb: 'Visas uppe till vänster, ett per liv.',
      resizable: true, w: 30, h: 30,
      fill: '#7a776f', text: '#ffffff'
    },
    {
      id: 'background', name: 'Bakgrund',
      blurb: 'Rullar från höger till vänster. Bredden är låst till 3× spelytan.',
      resizable: false, w: GAME.W * GAME.BG_SCALE, h: GAME.H,
      fill: '#ffffff', text: '#e0dcd1'
    }
  ];

  var BY_ID = {};
  SPRITES.forEach(function (s) { BY_ID[s.id] = s; });

  /* --- Default artwork: labelled boxes in different shades --------------- */
  function svgUrl(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function defaultFrame(id) {
    var def = BY_ID[id];
    var font = 'Georgia, \'Times New Roman\', serif';

    if (id === 'background') {
      // Plain white sheet with a hairline frame so it is visible in the editor.
      return svgUrl(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1350" height="270" viewBox="0 0 1350 270">' +
        '<rect width="1350" height="270" fill="#ffffff"/>' +
        '<rect x="1" y="1" width="1348" height="268" fill="none" stroke="#eeece5" stroke-width="2"/>' +
        '<text x="675" y="140" font-family="' + font + '" font-size="20" letter-spacing="6" fill="' + def.text +
        '" text-anchor="middle" dominant-baseline="middle">Bakgrund</text>' +
        '</svg>'
      );
    }

    var S = 256;
    return svgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + S + '" height="' + S + '" viewBox="0 0 ' + S + ' ' + S + '">' +
      '<rect x="10" y="10" width="' + (S - 20) + '" height="' + (S - 20) + '" rx="28" fill="' + def.fill + '"/>' +
      '<text x="' + (S / 2) + '" y="' + (S / 2) + '" font-family="' + font + '" font-size="34" fill="' + def.text +
      '" text-anchor="middle" dominant-baseline="middle">' + def.name + '</text>' +
      '</svg>'
    );
  }

  /* --- Default project description --------------------------------------- */
  var DEFAULT_DOC = [
    '<h1>Speluppgift: rita spelets grafik</h1>',
    '<p class="lede">I den här uppgiften ritar ni all grafik till ett litet spel. ',
    'Spelet är redan färdigprogrammerat — det är formspråket ni ansvarar för.</p>',
    '<h2>Uppgiften</h2>',
    '<p>Ni ska ta fram fem grafiska element: <strong>Spelare</strong>, <strong>Aj</strong> (hindret), ',
    '<strong>Poäng</strong>, <strong>Liv</strong> och <strong>Bakgrund</strong>. ',
    'Elementen ska hänga ihop visuellt: samma färgskala, samma linjetjocklek, samma känsla.</p>',
    '<h2>Så gör ni</h2>',
    '<ol>',
    '<li>Skissa för hand eller digitalt. Bestäm en tydlig idé innan ni börjar rita rent.</li>',
    '<li>Rita rent i valfritt program och exportera som <strong>PNG med genomskinlig bakgrund</strong>.</li>',
    '<li>Gå till <strong>Editor</strong> och dra in bilderna på rätt plats.</li>',
    '<li>Vill ni animera något — lägg till fler bildrutor med <strong>+</strong>. Två eller fler rutor spelas upp i 3 bilder per sekund.</li>',
    '<li>Testa i <strong>Spelet</strong> och justera tills det känns rätt.</li>',
    '</ol>',
    '<h2>Tekniska krav</h2>',
    '<ul>',
    '<li>Format: PNG (genomskinlig bakgrund) eller JPG för bakgrunden.</li>',
    '<li>Rita kvadratiskt, ca 512 × 512 px, för Spelare, Aj, Poäng och Liv.</li>',
    '<li>Bakgrunden ritas liggande och bred, ca 1500 × 300 px. Den rullar i sidled och loopar.</li>',
    '<li>Motivet ska läsas tydligt i liten storlek — testa alltid i spelet.</li>',
    '</ul>',
    '<h2>Bedömning</h2>',
    '<ul>',
    '<li>Enhetligt formspråk mellan de fem elementen.</li>',
    '<li>Läsbarhet och tydlig silhuett i spelets skala.</li>',
    '<li>Hantverk: rena linjer, medveten färgsättning, genomtänkta detaljer.</li>',
    '<li>Idé och originalitet.</li>',
    '</ul>',
    '<hr>',
    '<p class="muted">Inlämning: visa spelet på skärmen och lämna in era källfiler i Classroom.</p>'
  ].join('');

  /* --- State ------------------------------------------------------------- */
  function freshSprite(id) {
    var def = BY_ID[id];
    return { frames: [defaultFrame(id)], w: def.w, h: def.h };
  }

  function freshState() {
    var s = { version: 1, sprites: {}, doc: DEFAULT_DOC, highScore: 0 };
    SPRITES.forEach(function (def) { s.sprites[def.id] = freshSprite(def.id); });
    return s;
  }

  var state = freshState();
  var listeners = [];

  function migrate(raw) {
    var next = freshState();
    if (!raw || typeof raw !== 'object') return next;
    if (typeof raw.doc === 'string') next.doc = raw.doc;
    if (typeof raw.highScore === 'number') next.highScore = raw.highScore;
    if (raw.sprites && typeof raw.sprites === 'object') {
      SPRITES.forEach(function (def) {
        var stored = raw.sprites[def.id];
        if (!stored) return;
        var target = next.sprites[def.id];
        if (Array.isArray(stored.frames) && stored.frames.length) {
          // `null` is a legal value: an empty frame holder.
          target.frames = stored.frames.map(function (f) {
            return typeof f === 'string' && f ? f : null;
          });
        }
        if (def.resizable) {
          if (typeof stored.w === 'number' && stored.w > 0) target.w = clampSize(stored.w);
          if (typeof stored.h === 'number' && stored.h > 0) target.h = clampSize(stored.h);
        }
      });
    }
    return next;
  }

  function clampSize(v) {
    return Math.max(8, Math.min(320, Math.round(v)));
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      state = migrate(raw ? JSON.parse(raw) : null);
    } catch (err) {
      state = freshState();
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      if (App.ui && App.ui.toast) {
        App.ui.toast('Kunde inte spara — lagringen är full. Använd mindre bildfiler.', 'warn');
      }
      return false;
    }
  }

  function emit(detail) {
    listeners.forEach(function (fn) {
      try { fn(detail || {}); } catch (e) { /* a bad listener must not stop the rest */ }
    });
  }

  function commit(detail) {
    persist();
    emit(detail);
  }

  /* --- Public API -------------------------------------------------------- */
  var api = {
    GAME: GAME,
    SPRITES: SPRITES,

    def: function (id) { return BY_ID[id]; },

    state: function () { return state; },

    sprite: function (id) { return state.sprites[id]; },

    /** Frames with the empty holders stripped out — what the game renders. */
    framesOf: function (id) {
      var s = state.sprites[id];
      if (!s) return [];
      return s.frames.filter(function (f) { return !!f; });
    },

    setFrame: function (id, index, dataUrl) {
      var s = state.sprites[id];
      if (!s || index < 0 || index >= s.frames.length) return;
      s.frames[index] = dataUrl;
      commit({ type: 'sprite', id: id });
    },

    addFrame: function (id) {
      var s = state.sprites[id];
      if (!s) return -1;
      s.frames.push(null);
      commit({ type: 'sprite', id: id });
      return s.frames.length - 1;
    },

    /** x on a filled holder → empty it. x on an empty holder → drop it. */
    clearOrRemoveFrame: function (id, index) {
      var s = state.sprites[id];
      if (!s || index < 0 || index >= s.frames.length) return null;
      var action;
      if (s.frames[index]) {
        s.frames[index] = null;
        action = 'cleared';
      } else if (s.frames.length > 1) {
        s.frames.splice(index, 1);
        action = 'removed';
      } else {
        return null; // the last holder always stays
      }
      commit({ type: 'sprite', id: id });
      return action;
    },

    resetSprite: function (id) {
      if (!state.sprites[id]) return;
      state.sprites[id] = freshSprite(id);
      commit({ type: 'sprite', id: id });
    },

    setSize: function (id, w, h) {
      var s = state.sprites[id];
      var def = BY_ID[id];
      if (!s || !def || !def.resizable) return;
      if (typeof w === 'number') s.w = clampSize(w);
      if (typeof h === 'number') s.h = clampSize(h);
      commit({ type: 'size', id: id });
    },

    resetSize: function (id) {
      var def = BY_ID[id];
      if (!def || !def.resizable) return;
      api.setSize(id, def.w, def.h);
    },

    doc: function () { return state.doc; },

    setDoc: function (html) {
      state.doc = html;
      commit({ type: 'doc' });
    },

    resetDoc: function () {
      state.doc = DEFAULT_DOC;
      commit({ type: 'doc' });
    },

    highScore: function () { return state.highScore || 0; },

    reportScore: function (score) {
      if (score > (state.highScore || 0)) {
        state.highScore = score;
        commit({ type: 'score' });
      }
    },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    },

    reload: load
  };

  load();

  // Keep a second tab in sync (editor open next to the game).
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    load();
    emit({ type: 'external' });
  });

  return api;
})();
