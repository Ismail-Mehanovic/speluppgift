/* ==========================================================================
   page-game.js — the playable game.

   Flappy-style: the player falls, space (or a click) gives an upward boost.
   Touching "Aj" costs a life, "Poäng" gives a point. When the last life is
   gone the controls stop responding and the player drops out of the game
   area, which brings up the game over card.
   ========================================================================== */

window.App = window.App || {};
App.pages = App.pages || {};

App.pages.game = (function () {
  var h = App.ui.h;

  /* --- Tuning ------------------------------------------------------------ */
  var W = App.store.GAME.W;
  var H = App.store.GAME.H;
  var BG_W = W * App.store.GAME.BG_SCALE;

  var GRAVITY    = 1250;   // px/s²
  var FLAP       = -430;   // px/s, instant upward boost
  var MAX_FALL   = 900;    // px/s
  var PLAYER_X   = W * 0.26;
  var BASE_SPEED = 200;    // px/s the world moves left
  var BG_SPEED   = 55;     // px/s — slower, so the background sits behind
  var START_LIVES = 3;
  var INVULN     = 1.5;    // seconds of blinking after a hit

  function mount(view) {
    /* --- Markup --------------------------------------------------------- */
    var canvas = h('canvas', { 'aria-label': 'Spelyta' });

    var scoreValue = h('span', { class: 'value', text: '0' });
    var livesRow = h('div', { class: 'hud-lives', 'aria-label': 'Liv' });
    var lifeIcons = [];
    for (var i = 0; i < START_LIVES; i++) {
      var icon = h('img', { alt: '' });
      App.sprites.bindSprite(icon, 'life');
      lifeIcons.push(icon);
      livesRow.appendChild(icon);
    }

    var hud = h('div', { class: 'hud' }, [
      h('div', { class: 'hud-score' }, [
        h('span', { class: 'label', text: 'Poäng' }),
        scoreValue
      ]),
      livesRow
    ]);

    var startOverlay = h('div', { class: 'overlay' });
    var overOverlay = h('div', { class: 'overlay', hidden: true });
    var pauseOverlay = h('div', { class: 'overlay', hidden: true });

    var stage = h('div', { class: 'stage' }, [canvas, hud, startOverlay, overOverlay, pauseOverlay]);

    var highLabel = h('span', { class: 'hint', text: 'Rekord: ' + App.store.highScore() });

    var wrap = h('div', { class: 'game-wrap' }, [
      h('div', { class: 'game-head' }, [
        h('div', { class: 'title' }, [h('h1', { text: 'Spelet' }), highLabel]),
        h('div', { class: 'game-actions' }, [
          h('button', {
            class: 'btn btn-sm', type: 'button', text: 'Storlekar',
            onclick: function () { openSizeEditor(); }
          }),
          h('a', {
            class: 'btn btn-sm btn-primary', href: App.router.href('/editor'),
            'data-link': true, text: 'Editor'
          })
        ])
      ]),
      stage,
      buildLegend()
    ]);

    view.appendChild(wrap);

    /* --- Canvas sizing --------------------------------------------------- */
    var ctx = canvas.getContext('2d');

    function resize() {
      var rect = stage.getBoundingClientRect();
      if (!rect.width) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      var scale = (rect.width / W) * dpr;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }

    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(resize);
      ro.observe(stage);
    }
    window.addEventListener('resize', resize);
    resize();

    /* --- Game state ------------------------------------------------------ */
    var g = null;

    function size(id) {
      var s = App.store.sprite(id);
      return { w: s.w, h: s.h };
    }

    function reset() {
      var p = size('player');
      g = {
        mode: 'idle',        // idle | playing | dying | over | paused
        resumeMode: null,
        time: 0,
        score: 0,
        lives: START_LIVES,
        bgX: 0,
        speed: BASE_SPEED,
        invuln: 0,
        hitFlash: 0,
        shake: 0,
        nextHazard: 1.1,
        nextPoint: 1.4,
        pops: [],
        player: { x: PLAYER_X, y: H / 2 - p.h / 2, vy: 0 },
        hazards: [],
        points: []
      };
      syncHud();
    }

    function syncHud() {
      scoreValue.textContent = String(g.score);
      lifeIcons.forEach(function (img, index) {
        img.classList.toggle('spent', index >= g.lives);
      });
    }

    /* --- Overlays -------------------------------------------------------- */
    function buildStartPanel() {
      App.ui.clear(startOverlay);
      startOverlay.appendChild(h('div', { class: 'panel' }, [
        h('h2', { text: 'Redo?' }),
        h('p', { text: 'Håll dig i luften, samla Poäng och undvik Aj. Du har tre liv.' }),
        h('div', { class: 'panel-actions' }, [
          h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: 'Spela', onclick: startGame })
        ]),
        h('p', { class: 'hint', style: { marginTop: '16px', marginBottom: '0' }, text: 'Mellanslag eller klick för att flyga' })
      ]));
      startOverlay.hidden = false;
    }

    function buildPausePanel() {
      App.ui.clear(pauseOverlay);
      pauseOverlay.appendChild(h('div', { class: 'panel' }, [
        h('h2', { text: 'Pausad' }),
        h('div', { class: 'panel-actions' }, [
          h('button', { class: 'btn btn-primary', type: 'button', text: 'Fortsätt', onclick: resume })
        ])
      ]));
      pauseOverlay.hidden = false;
    }

    function buildGameOverPanel() {
      App.store.reportScore(g.score);
      highLabel.textContent = 'Rekord: ' + App.store.highScore();

      App.ui.clear(overOverlay);
      overOverlay.appendChild(h('div', { class: 'panel' }, [
        h('h2', { text: 'Game over' }),
        h('p', { text: 'Alla liv är slut.' }),
        h('div', { class: 'score-readout' }, [
          h('div', {}, [h('div', { class: 'k', text: 'Poäng' }), h('div', { class: 'v', text: String(g.score) })]),
          h('div', {}, [h('div', { class: 'k', text: 'Rekord' }), h('div', { class: 'v', text: String(App.store.highScore()) })])
        ]),
        h('div', { class: 'panel-actions' }, [
          h('button', { class: 'btn btn-primary', type: 'button', text: 'Starta om', onclick: restart }),
          h('button', { class: 'btn', type: 'button', text: 'Redigera sprites', onclick: function () { openSizeEditor(); } })
        ])
      ]));
      overOverlay.hidden = false;
    }

    /* --- Flow ------------------------------------------------------------ */
    function startGame() {
      startOverlay.hidden = true;
      overOverlay.hidden = true;
      g.mode = 'playing';
      g.player.vy = FLAP * 0.6;
    }

    function restart() {
      reset();
      overOverlay.hidden = true;
      pauseOverlay.hidden = true;
      startGame();
    }

    function pause() {
      if (g.mode !== 'playing' && g.mode !== 'dying') return;
      g.resumeMode = g.mode;
      g.mode = 'paused';
      buildPausePanel();
    }

    function resume() {
      if (g.mode !== 'paused') return;
      pauseOverlay.hidden = true;
      g.mode = g.resumeMode || 'playing';
      last = performance.now();
    }

    function flap() {
      if (g.mode === 'idle') { startGame(); return; }
      if (g.mode !== 'playing') return;   // no controls once the lives are gone
      g.player.vy = FLAP;
    }

    function loseLife() {
      if (g.invuln > 0 || g.mode !== 'playing') return;
      g.lives = Math.max(0, g.lives - 1);
      g.invuln = INVULN;
      g.hitFlash = 0.22;
      g.shake = 0.35;
      syncHud();
      if (g.lives === 0) g.mode = 'dying';
    }

    /* --- Spawning -------------------------------------------------------- */
    function spawnHazard() {
      var s = size('hazard');
      var margin = 24;
      var y = margin + Math.random() * (H - s.h - margin * 2);
      g.hazards.push({ x: W + s.w, y: y, w: s.w, h: s.h, drift: (Math.random() - 0.5) * 22 });
    }

    function spawnPoint() {
      var s = size('point');
      var margin = 36;
      var lo = margin;
      var hi = Math.max(lo, H - s.h - margin);
      var y = lo;

      // A few tries so a point does not land inside a hazard that is about to enter.
      for (var attempt = 0; attempt < 6; attempt++) {
        if (Math.random() < 0.55) {
          // Keep some of them near the player's current height, so there is
          // always something within reach to chase.
          var around = g.player.y + size('player').h / 2 - s.h / 2;
          y = around + (Math.random() - 0.5) * 260;
        } else {
          y = lo + Math.random() * (hi - lo);
        }
        y = Math.max(lo, Math.min(hi, y));

        var clash = g.hazards.some(function (hz) {
          return hz.x > W - 140 && Math.abs((hz.y + hz.h / 2) - (y + s.h / 2)) < (hz.h + s.h) * 0.7;
        });
        if (!clash) break;
      }
      g.points.push({ x: W + s.w, y: y, w: s.w, h: s.h, bob: Math.random() * Math.PI * 2 });
    }

    function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    /** Slightly generous hit boxes so drawings with padding still feel fair. */
    function inset(box, factor) {
      return {
        x: box.x + box.w * (1 - factor) / 2,
        y: box.y + box.h * (1 - factor) / 2,
        w: box.w * factor,
        h: box.h * factor
      };
    }

    /* --- Update ---------------------------------------------------------- */
    function update(dt) {
      g.time += dt;
      g.bgX = (g.bgX + BG_SPEED * dt) % BG_W;

      if (g.hitFlash > 0) g.hitFlash -= dt;
      if (g.shake > 0) g.shake -= dt;
      if (g.invuln > 0) g.invuln -= dt;

      g.pops = g.pops.filter(function (p) {
        p.life -= dt;
        return p.life > 0;
      });

      if (g.mode === 'idle') {
        // Gentle hover on the start screen.
        var ps = size('player');
        g.player.y = H / 2 - ps.h / 2 + Math.sin(g.time * 2) * 10;
        return;
      }

      if (g.mode !== 'playing' && g.mode !== 'dying') return;

      var p = size('player');
      var player = g.player;

      player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);
      player.y += player.vy * dt;

      if (g.mode === 'playing') {
        g.speed = BASE_SPEED + Math.min(g.score * 4, 130);

        // Ceiling: block it, no penalty.
        if (player.y < 0) { player.y = 0; player.vy = 0; }

        // Floor: costs a life and bounces the player back up.
        if (player.y + p.h > H) {
          player.y = H - p.h;
          if (g.invuln <= 0) {
            loseLife();
            player.vy = -320;
          } else {
            player.vy = Math.min(player.vy, 0);
          }
        }

        g.nextHazard -= dt;
        g.nextPoint -= dt;
        if (g.nextHazard <= 0) {
          spawnHazard();
          g.nextHazard = Math.max(0.9, 1.55 - g.score * 0.02) * (0.85 + Math.random() * 0.4);
        }
        if (g.nextPoint <= 0) {
          spawnPoint();
          g.nextPoint = 1.5 + Math.random() * 1.1;
        }
      }

      var hitBox = inset({ x: player.x, y: player.y, w: p.w, h: p.h }, 0.78);

      // Hazards
      for (var i = g.hazards.length - 1; i >= 0; i--) {
        var hz = g.hazards[i];
        hz.x -= g.speed * dt;
        hz.y += hz.drift * dt;
        hz.w = size('hazard').w;
        hz.h = size('hazard').h;
        if (hz.x + hz.w < -40) { g.hazards.splice(i, 1); continue; }
        if (g.mode !== 'playing') continue;
        var hb = inset(hz, 0.84);
        if (overlaps(hitBox.x, hitBox.y, hitBox.w, hitBox.h, hb.x, hb.y, hb.w, hb.h)) loseLife();
      }

      // Points
      for (var j = g.points.length - 1; j >= 0; j--) {
        var pt = g.points[j];
        pt.x -= g.speed * dt;
        pt.w = size('point').w;
        pt.h = size('point').h;
        if (pt.x + pt.w < -40) { g.points.splice(j, 1); continue; }
        if (g.mode !== 'playing') continue;
        var pb = inset(pt, 0.95);
        if (overlaps(hitBox.x, hitBox.y, hitBox.w, hitBox.h, pb.x, pb.y, pb.w, pb.h)) {
          g.score += 1;
          syncHud();
          g.pops.push({ x: pt.x + pt.w / 2, y: pt.y + pt.h / 2, life: 0.45, max: 0.45 });
          g.points.splice(j, 1);
        }
      }

      // Dropped out of the game area → game over.
      if (g.mode === 'dying' && player.y > H + 60) {
        g.mode = 'over';
        buildGameOverPanel();
      }
    }

    /* --- Draw ------------------------------------------------------------ */
    function drawSprite(id, x, y, w, hgt) {
      var img = App.sprites.currentImage(id);
      if (img) {
        ctx.drawImage(img, x, y, w, hgt);
      } else {
        var def = App.store.def(id);
        ctx.fillStyle = def ? def.fill : '#ccc';
        ctx.fillRect(x, y, w, hgt);
      }
    }

    function drawBackground() {
      var img = App.sprites.currentImage('background');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      if (!img) return;
      var x = -g.bgX;
      ctx.drawImage(img, x, 0, BG_W, H);
      ctx.drawImage(img, x + BG_W, 0, BG_W, H);
    }

    function draw() {
      ctx.save();
      if (g.shake > 0) {
        var amount = g.shake * 12;
        ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      }

      drawBackground();

      g.points.forEach(function (pt) {
        var bob = Math.sin(g.time * 3 + pt.bob) * 4;
        drawSprite('point', pt.x, pt.y + bob, pt.w, pt.h);
      });

      g.hazards.forEach(function (hz) {
        drawSprite('hazard', hz.x, hz.y, hz.w, hz.h);
      });

      // Collected-point rings
      ctx.save();
      g.pops.forEach(function (pop) {
        var k = 1 - pop.life / pop.max;
        ctx.globalAlpha = (1 - k) * 0.6;
        ctx.strokeStyle = '#d97757';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pop.x, pop.y, 12 + k * 34, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();

      // Player — blinks while invulnerable.
      var p = size('player');
      var blink = g.invuln > 0 && Math.floor(g.time * 14) % 2 === 0;
      ctx.save();
      ctx.globalAlpha = blink ? 0.28 : 1;
      var tilt = Math.max(-0.35, Math.min(0.9, g.player.vy / 900));
      ctx.translate(g.player.x + p.w / 2, g.player.y + p.h / 2);
      ctx.rotate(tilt * 0.5);
      drawSprite('player', -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();

      if (g.hitFlash > 0) {
        ctx.fillStyle = 'rgba(217, 119, 87,' + (g.hitFlash * 1.4) + ')';
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();
    }

    /* --- Loop ------------------------------------------------------------ */
    var raf = null;
    var last = performance.now();
    var alive = true;

    function frame(now) {
      if (!alive) return;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }

    /* --- Input ----------------------------------------------------------- */
    function onKeyDown(e) {
      if (document.getElementById('modal-root').children.length) return;
      var target = e.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        if (g.mode === 'over') return;   // the card's buttons take over here
        e.preventDefault();
        flap();
      } else if (e.key === 'Escape') {
        pause();
      } else if (e.key === 'Enter' && g.mode === 'over') {
        restart();
      }
    }

    function onPointerDown(e) {
      if (e.target.closest('.panel')) return;   // let overlay buttons work
      e.preventDefault();
      flap();
    }

    function onVisibility() {
      if (document.hidden) pause();
    }

    window.addEventListener('keydown', onKeyDown);
    stage.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('visibilitychange', onVisibility);

    var stopListening = App.store.subscribe(function () { syncHud(); });

    /* --- Size editor ("Redigera sprites") --------------------------------- */
    function openSizeEditor() {
      var wasPlaying = g.mode === 'playing' || g.mode === 'dying';
      if (wasPlaying) pause();

      App.ui.modal({
        title: 'Redigera sprites',
        sub: 'Ändra bredd och höjd på varje sprite. Ändringarna sparas direkt och syns i spelet.',
        wide: true,
        body: buildSizeGrid(),
        actions: [
          {
            label: 'Öppna editorn', kind: 'ghost',
            onClick: function () { App.router.navigate('/editor'); }
          },
          { label: 'Klart', kind: 'primary' }
        ]
      });
    }

    function buildSizeGrid() {
      var grid = h('div', { class: 'size-grid' });

      App.store.SPRITES.forEach(function (def) {
        var stored = App.store.sprite(def.id);
        var preview = h('img', { alt: def.name });
        App.sprites.bindSprite(preview, def.id);

        var box = h('div', { class: 'size-preview' }, preview);

        function applyPreview() {
          var s = App.store.sprite(def.id);
          if (!def.resizable) {
            preview.style.width = '100%';
            preview.style.height = 'auto';
            return;
          }
          var scale = Math.min(1, 80 / Math.max(s.w, s.h));
          preview.style.width = Math.round(s.w * scale) + 'px';
          preview.style.height = Math.round(s.h * scale) + 'px';
          preview.style.objectFit = 'fill';
        }
        applyPreview();

        var fields = h('div', { class: 'size-fields' }, h('div', { class: 'name', text: def.name }));

        if (def.resizable) {
          ['w', 'h'].forEach(function (key) {
            var readout = h('span', { class: 'num', text: stored[key] + '' });
            var slider = h('input', {
              type: 'range', min: '12', max: '200', step: '1', value: String(stored[key]),
              'aria-label': def.name + (key === 'w' ? ' bredd' : ' höjd')
            });
            slider.addEventListener('input', function () {
              var value = parseInt(slider.value, 10);
              readout.textContent = String(value);
              App.store.setSize(def.id, key === 'w' ? value : null, key === 'h' ? value : null);
              applyPreview();
            });
            fields.appendChild(h('div', { class: 'size-row' }, [
              h('span', { text: key === 'w' ? 'B' : 'H' }), slider, readout
            ]));
          });

          fields.appendChild(h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Standardstorlek',
            onclick: function (e) {
              App.store.resetSize(def.id);
              var s = App.store.sprite(def.id);
              var rows = e.target.parentNode.querySelectorAll('.size-row');
              [s.w, s.h].forEach(function (value, index) {
                if (!rows[index]) return;
                rows[index].querySelector('input').value = String(value);
                rows[index].querySelector('.num').textContent = String(value);
              });
              applyPreview();
            }
          }));
        } else {
          fields.appendChild(h('p', {
            class: 'hint', style: { margin: '0' },
            text: 'Bakgrunden är låst till ' + BG_W + ' × ' + H + ' px (3× spelytan).'
          }));
        }

        grid.appendChild(h('div', { class: 'size-card' }, [box, fields]));
      });

      return grid;
    }

    /* --- Boot ------------------------------------------------------------ */
    reset();
    buildStartPanel();
    App.sprites.preload().then(function () { resize(); });
    raf = requestAnimationFrame(frame);

    return function teardown() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      stopListening();
    };
  }

  /* --- Legend under the stage ------------------------------------------- */
  function buildLegend() {
    var legend = h('div', { class: 'legend' });

    legend.appendChild(h('span', { class: 'item' }, [
      h('kbd', { text: 'Mellanslag' }),
      h('span', { text: 'flyg uppåt' })
    ]));

    [['player', 'du'], ['hazard', 'undvik'], ['point', '+1 poäng'], ['life', 'liv kvar']]
      .forEach(function (pair) {
        var def = App.store.def(pair[0]);
        var img = h('img', { alt: def.name });
        App.sprites.bindSprite(img, pair[0]);
        legend.appendChild(h('span', { class: 'item' }, [
          img, h('span', { text: def.name + ' — ' + pair[1] })
        ]));
      });

    return legend;
  }

  return { mount: mount };
})();
