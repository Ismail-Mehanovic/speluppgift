/* ==========================================================================
   page-editor.js — draw/upload the artwork for every sprite.

   One sprite holder = one frame. Two or more filled holders turn the sprite
   into a 3 fps animation; an animated GIF plays with its own timing.

   Each holder shows the sprite as a box (its size and hit box in the game)
   with the picture placed inside it:
     * drag the picture to move it, drag its corners to resize it
       (Shift = free proportions, Alt = no snapping);
     * drag the orange handles on the box's sides to change the sprite's
       width and height — the pictures keep their size and stay centred.
   Every change is written to localStorage at once.
   ========================================================================== */

window.App = window.App || {};
App.pages = App.pages || {};

App.pages.editor = (function () {
  var h = App.ui.h;

  var SNAP_PX = 6;      // screen px within which the picture snaps to edges/centre
  var MIN_PIC_PX = 8;   // the picture never gets smaller than this on screen

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Re-express a box for a new sprite size so the picture keeps its size and its offset from the centre. */
  function rebox(b, w0, h0, w1, h1) {
    var cx = (b.x + b.w / 2 - 0.5) * w0;
    var cy = (b.y + b.h / 2 - 0.5) * h0;
    var w = b.w * w0;
    var hh = b.h * h0;
    return { x: 0.5 + (cx - w / 2) / w1, y: 0.5 + (cy - hh / 2) / h1, w: w / w1, h: hh / h1 };
  }

  /** Snap a rectangle (game px) to the sprite's centre lines and edges. Mutates r. */
  function snap(r, W, H, threshold) {
    var hit = { x: false, y: false };
    if (Math.abs(r.x + r.w / 2 - W / 2) < threshold) { r.x = W / 2 - r.w / 2; hit.x = true; }
    else if (Math.abs(r.x) < threshold) r.x = 0;
    else if (Math.abs(r.x + r.w - W) < threshold) r.x = W - r.w;
    if (Math.abs(r.y + r.h / 2 - H / 2) < threshold) { r.y = H / 2 - r.h / 2; hit.y = true; }
    else if (Math.abs(r.y) < threshold) r.y = 0;
    else if (Math.abs(r.y + r.h - H) < threshold) r.y = H - r.h;
    return hit;
  }

  function place(el, x, y, w, hh) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = hh + 'px';
  }

  function mount(view) {
    var currentId = 'player';
    var busy = false;
    var dragging = false;
    var holders = [];         // the holders on screen, so they can all be laid out again
    var lockedZoom = null;    // kept fixed while the sprite's size is being dragged
    var sizeNoteEl = null;

    var ro = window.ResizeObserver ? new ResizeObserver(function () { layoutAll(); }) : null;

    var listEl = h('aside', { class: 'sprite-list' }, h('h2', { text: 'Sprites' }));
    var mainEl = h('section', { class: 'editor-main' });
    view.appendChild(h('div', { class: 'editor-layout' }, [listEl, mainEl]));

    /* A single reusable file picker for every holder. */
    var picker = h('input', {
      type: 'file', accept: 'image/*', multiple: true,
      style: { display: 'none' }
    });
    var pickerTarget = 0;
    picker.addEventListener('change', function () {
      if (picker.files && picker.files.length) applyFiles(pickerTarget, picker.files);
      picker.value = '';
    });
    view.appendChild(picker);

    function pick(index) {
      pickerTarget = index;
      picker.click();
    }

    /* --- Import ---------------------------------------------------------- */
    function applyFiles(startIndex, fileList) {
      var files = Array.prototype.slice.call(fileList).filter(function (f) {
        return /^image\//.test(f.type || '');
      });
      if (!files.length) {
        App.ui.toast('Bara bildfiler går att lägga in (PNG, JPG, SVG, GIF).', 'warn');
        return;
      }

      busy = true;
      var id = currentId;

      // The first file replaces the target holder; extra files become new frames.
      var chain = Promise.resolve();
      files.forEach(function (file, i) {
        chain = chain.then(function () {
          return App.sprites.fromFile(file, id).then(function (dataUrl) {
            var index = i === 0 ? startIndex : App.store.addFrame(id);
            App.store.setFrame(id, index, dataUrl);
          });
        });
      });

      chain.then(function () {
        busy = false;
        render();
        App.ui.toast(files.length > 1 ? files.length + ' bildrutor inlagda' : 'Bilden är sparad');
      }).catch(function (err) {
        busy = false;
        render();
        App.ui.toast(err && err.message ? err.message : 'Bilden kunde inte läsas.', 'warn');
      });
    }

    /* --- Sidebar --------------------------------------------------------- */
    function frameLabel(frames) {
      if (frames.length > 1) return frames.length + ' bildrutor · ' + App.sprites.FPS + ' fps';
      if (frames.length === 1) return App.sprites.isAnimatedGif(frames[0].src) ? '1 bildruta · GIF' : '1 bildruta';
      return 'tom';
    }

    function renderList() {
      App.ui.clear(listEl);
      listEl.appendChild(h('h2', { text: 'Sprites' }));

      App.store.SPRITES.forEach(function (def) {
        var frames = App.store.framesOf(def.id);

        listEl.appendChild(h('button', {
          class: 'thumb' + (def.id === currentId ? ' active' : ''),
          type: 'button',
          'aria-pressed': def.id === currentId ? 'true' : 'false',
          onclick: function () {
            currentId = def.id;
            render();
          }
        }, [
          h('span', { class: 'thumb-img' }, App.sprites.view(def.id, { maxW: 44, maxH: 44 })),
          h('span', { class: 'thumb-meta' }, [
            h('span', { class: 'n', text: def.name }),
            h('br'),
            h('span', { class: 's', text: frameLabel(frames) })
          ])
        ]));
      });
    }

    /* --- Main body ------------------------------------------------------- */
    function sizeText(def, sprite) {
      return def.resizable
        ? 'Storlek i spelet: ' + sprite.w + ' × ' + sprite.h + ' px'
        : 'Storlek i spelet: ' + def.w + ' × ' + def.h + ' px (låst)';
    }

    function renderMain() {
      var scrollLeft = 0;
      var previousScroller = mainEl.querySelector('.strip-scroll');
      if (previousScroller) scrollLeft = previousScroller.scrollLeft;

      App.ui.clear(mainEl);
      if (ro) ro.disconnect();
      holders = [];

      var def = App.store.def(currentId);
      var sprite = App.store.sprite(currentId);
      var filled = App.store.framesOf(currentId);

      /* Head */
      var previewCaption = filled.length > 1
        ? 'Animeras · ' + App.sprites.FPS + ' fps'
        : (filled.length === 1
          ? (App.sprites.isAnimatedGif(filled[0].src) ? 'Animerad GIF' : 'Stillbild')
          : 'Ingen bild än');

      mainEl.appendChild(h('div', { class: 'editor-head' }, [
        h('div', {}, [
          h('h1', { text: def.name }),
          h('p', { class: 'hint', text: def.blurb }),
          h('p', {
            class: 'hint',
            style: { marginTop: '4px' },
            text: 'Dra in en bild i rutan, eller klicka för att välja fil (PNG, JPG, SVG eller GIF — GIF:ar animeras även i spelet). ' +
              'Lägg till fler rutor med + för att animera.'
          }),
          h('p', {
            class: 'hint',
            style: { marginTop: '4px' },
            text: def.resizable
              ? 'Dra i bilden för att flytta den och i hörnen för att ändra storleken. Dra i de orange handtagen för att ändra spritens bredd och höjd.'
              : 'Dra i bilden för att flytta den och i hörnen för att ändra storleken.'
          })
        ]),
        h('div', { class: 'editor-head-right' }, [
          h('div', { class: 'live-preview' }, [
            h('div', { class: 'box' }, App.sprites.view(currentId, { maxW: 50, maxH: 50 })),
            h('div', { class: 'cap' }, [
              h('strong', { text: 'Förhandsvisning' }),
              h('br'),
              h('span', { text: previewCaption })
            ])
          ])
        ])
      ]));

      /* Strip of holders */
      var strip = h('div', { class: 'strip' });
      sprite.frames.forEach(function (frame, index) {
        var holder = buildHolder(index, frame, sprite.frames.length);
        holders.push(holder);
        strip.appendChild(holder.el);
      });

      strip.appendChild(h('button', {
        class: 'add-frame',
        type: 'button',
        title: 'Lägg till en bildruta',
        'aria-label': 'Lägg till en bildruta',
        onclick: function () {
          App.store.addFrame(currentId);
          render();
          var scroller = mainEl.querySelector('.strip-scroll');
          if (scroller) scroller.scrollLeft = scroller.scrollWidth;
        }
      }, [
        h('span', { class: 'plus', text: '+' }),
        h('span', { text: 'Bildruta' })
      ]));

      var scroller = h('div', { class: 'strip-scroll' }, strip);
      mainEl.appendChild(scroller);
      scroller.scrollLeft = scrollLeft;

      /* Foot */
      sizeNoteEl = h('span', { text: sizeText(def, sprite) });

      mainEl.appendChild(h('div', { class: 'editor-foot' }, [
        h('div', { class: 'row' }, [
          sizeNoteEl,
          h('span', { text: '·' }),
          h('span', { text: 'Sparas automatiskt' })
        ]),
        h('div', { class: 'row' }, [
          h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Återställ till standard',
            onclick: function () { confirmReset(def); }
          }),
          h('a', {
            class: 'btn btn-sm btn-primary', href: App.router.href('/game'),
            'data-link': true, text: 'Testa i spelet'
          })
        ])
      ]));

      // The holders are in the document now, so they can be measured.
      holders.forEach(function (holder) {
        holder.layout();
        if (ro) ro.observe(holder.stage);
      });
    }

    function layoutAll() {
      holders.forEach(function (holder) { holder.layout(); });
    }

    /* --- One holder ------------------------------------------------------ */
    function buildHolder(index, frame, total) {
      var id = currentId;
      var def = App.store.def(id);
      var holder = h('div', { class: 'holder' + (def.resizable ? '' : ' wide') });

      /* Top row: frame number, replace, remove */
      var removeBtn = h('button', {
        class: 'icon-btn',
        type: 'button',
        title: frame ? 'Töm bildrutan' : 'Ta bort bildrutan',
        'aria-label': frame ? 'Töm bildrutan' : 'Ta bort bildrutan',
        text: '×',
        onclick: function () {
          var action = App.store.clearOrRemoveFrame(id, index);
          if (!action) {
            App.ui.toast('Den sista bildrutan går inte att ta bort.');
            return;
          }
          render();
        }
      });
      if (!frame && total === 1) removeBtn.disabled = true;

      var top = h('div', { class: 'holder-top' }, [
        h('span', { class: 'frame-no', text: 'Bildruta ' + (index + 1) }),
        h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [
          frame ? h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Byt bild',
            onclick: function () { pick(index); }
          }) : null,
          removeBtn
        ])
      ]);

      /* Stage: the sprite box with the picture inside it */
      var stage = h('div', { class: 'holder-stage' + (frame ? '' : ' empty') });
      var board = h('div', { class: 'artboard' });
      var guideV = h('span', { class: 'guide guide-v', hidden: true });
      var guideH = h('span', { class: 'guide guide-h', hidden: true });
      var ghost = null;
      var pic = null;
      var picFrame = null;

      if (frame) {
        // The faded copy shows the parts of the picture that fall outside the sprite.
        ghost = h('img', { class: 'art-ghost', alt: '', src: frame.src, draggable: 'false' });
        pic = h('img', {
          class: 'art-img', alt: def.name + ', bildruta ' + (index + 1),
          src: frame.src, draggable: 'false'
        });
        board.appendChild(pic);

        picFrame = h('div', {
          class: 'pic-frame',
          tabindex: '0',
          role: 'group',
          title: 'Dra för att flytta. Dra i hörnen för att ändra storleken (Shift: fri form).',
          'aria-label': 'Bilden i bildruta ' + (index + 1) +
            '. Piltangenterna flyttar bilden, plus och minus ändrar storleken, 0 passar in den.'
        }, ['nw', 'ne', 'sw', 'se'].map(function (corner) {
          return h('span', { class: 'pic-handle ' + corner, dataset: { corner: corner } });
        }));

        stage.appendChild(ghost);
        stage.appendChild(board);
        stage.appendChild(guideV);
        stage.appendChild(guideH);
        stage.appendChild(picFrame);

        pic.addEventListener('load', layout);
        picFrame.addEventListener('pointerdown', function (e) {
          var handle = e.target.closest('.pic-handle');
          if (handle) startDrag(e, 'scale', handle.dataset.corner);
          else startDrag(e, 'move');
        });
        picFrame.addEventListener('keydown', onPicKey);
        picFrame.addEventListener('keyup', saveKeyEdits);
        picFrame.addEventListener('blur', saveKeyEdits);
      } else {
        stage.setAttribute('role', 'button');
        stage.setAttribute('tabindex', '0');
        stage.setAttribute('aria-label', 'Lägg in en bild i bildruta ' + (index + 1));
        stage.appendChild(board);
        stage.appendChild(h('div', { class: 'drop-label' }, [
          App.ui.icon('upload'),
          h('span', { text: 'Dra en bild hit' }),
          h('span', { class: 'small', text: 'eller klicka för att välja fil' })
        ]));
        stage.addEventListener('click', function (e) {
          if (e.target.closest('.side-handle')) return;
          pick(index);
        });
        stage.addEventListener('keydown', function (e) {
          if (e.target !== stage) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick(index);
          }
        });
      }

      /* Handles on the sprite box's sides change the sprite's size. */
      var sides = [];
      if (def.resizable) {
        ['n', 'e', 's', 'w'].forEach(function (side) {
          var handle = h('span', {
            class: 'side-handle ' + side,
            title: side === 'n' || side === 's' ? 'Dra för att ändra höjden' : 'Dra för att ändra bredden'
          });
          handle.addEventListener('pointerdown', function (e) { startDrag(e, 'side', side); });
          sides.push({ el: handle, side: side });
          stage.appendChild(handle);
        });
      }

      /* Bottom row: quick placements and the size */
      var sizeTag = h('span', { class: 'size-tag' });
      var tools = h('div', { class: 'holder-tools' }, [
        frame ? h('span', { class: 'tool-group' }, [
          h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Passa in',
            title: 'Hela bilden syns, centrerad i rutan',
            onclick: function () {
              App.store.setFrameBox(id, index, null);
              layout();
            }
          }),
          h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Fyll ut',
            title: 'Bilden täcker hela rutan; det som sticker ut klipps bort',
            onclick: function () {
              if (!pic.naturalWidth || !pic.naturalHeight) return;
              var s = App.store.sprite(id);
              App.store.setFrameBox(id, index, App.sprites.coverBox(pic.naturalWidth, pic.naturalHeight, s.w, s.h));
              layout();
            }
          })
        ]) : h('span'),
        sizeTag
      ]);

      /* --- Geometry ---------------------------------------------------- */
      function metrics() {
        var s = App.store.sprite(id);
        var sw = stage.clientWidth;
        var sh = stage.clientHeight;
        if (!sw || !sh) return null;
        var pad = def.resizable ? 28 : 10;
        var zoom = lockedZoom || Math.min((sw - 2 * pad) / s.w, (sh - 2 * pad) / s.h);
        var bw = s.w * zoom;
        var bh = s.h * zoom;
        return { W: s.w, H: s.h, zoom: zoom, bx: (sw - bw) / 2, by: (sh - bh) / 2, bw: bw, bh: bh };
      }

      /** The picture's rectangle in game px, relative to the sprite's top-left corner. */
      function picRect(m) {
        var f = App.store.sprite(id).frames[index];
        if (!f || !pic) return null;
        var nw = pic.naturalWidth;
        var nh = pic.naturalHeight;
        if (!f.box && !(nw && nh)) return null;   // still loading
        return App.sprites.placement(f.box, nw, nh, m.W, m.H);
      }

      function layout() {
        var m = metrics();
        if (!m) return;
        place(board, m.bx, m.by, m.bw, m.bh);
        place(guideV, m.bx + m.bw / 2, m.by, 1, m.bh);
        place(guideH, m.bx, m.by + m.bh / 2, m.bw, 1);
        sides.forEach(function (s) {
          var gap = 9;   // the handles sit just outside the box
          s.el.style.left = (s.side === 'w' ? m.bx - gap : s.side === 'e' ? m.bx + m.bw + gap : m.bx + m.bw / 2) + 'px';
          s.el.style.top = (s.side === 'n' ? m.by - gap : s.side === 's' ? m.by + m.bh + gap : m.by + m.bh / 2) + 'px';
        });
        sizeTag.textContent = m.W + ' × ' + m.H + ' px';

        if (!pic) return;
        var r = picRect(m);
        [pic, ghost, picFrame].forEach(function (el) { el.style.visibility = r ? '' : 'hidden'; });
        if (!r) return;
        var x = r.x * m.zoom, y = r.y * m.zoom, w = r.w * m.zoom, hh = r.h * m.zoom;
        place(pic, x, y, w, hh);
        place(ghost, m.bx + x, m.by + y, w, hh);
        place(picFrame, m.bx + x, m.by + y, w, hh);
      }

      function setRect(r, live) {
        var s = App.store.sprite(id);
        App.store.setFrameBox(id, index, { x: r.x / s.w, y: r.y / s.h, w: r.w / s.w, h: r.h / s.h }, { live: live });
        layout();
      }

      /* --- Dragging ---------------------------------------------------- */
      var drag = null;

      function startDrag(e, kind, which) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (busy) return;
        var m = metrics();
        if (!m) return;
        var rect = pic ? picRect(m) : null;
        if (kind !== 'side' && !rect) return;

        e.preventDefault();
        e.stopPropagation();
        var target = e.currentTarget;
        try { target.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }

        drag = {
          kind: kind, which: which, target: target,
          x0: e.clientX, y0: e.clientY,
          zoom: m.zoom, W: m.W, H: m.H, rect: rect, moved: false
        };
        if (kind === 'side') {
          drag.boxes = App.store.sprite(id).frames.map(function (f) { return f ? f.box : null; });
          lockedZoom = m.zoom;
        }
        dragging = true;
        holder.classList.add('dragging');
        target.addEventListener('pointermove', onDragMove);
        target.addEventListener('pointerup', onDragEnd);
        target.addEventListener('pointercancel', onDragEnd);
      }

      function onDragMove(e) {
        if (!drag) return;
        if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 2) return;
        drag.moved = true;
        var dx = (e.clientX - drag.x0) / drag.zoom;
        var dy = (e.clientY - drag.y0) / drag.zoom;
        if (drag.kind === 'side') resizeSprite(dx, dy);
        else if (drag.kind === 'move') movePicture(dx, dy, e.altKey);
        else scalePicture(dx, dy, e.shiftKey);
      }

      function onDragEnd() {
        if (!drag) return;
        var d = drag;
        drag = null;
        d.target.removeEventListener('pointermove', onDragMove);
        d.target.removeEventListener('pointerup', onDragEnd);
        d.target.removeEventListener('pointercancel', onDragEnd);
        dragging = false;
        lockedZoom = null;
        holder.classList.remove('dragging');
        guideV.hidden = true;
        guideH.hidden = true;
        if (!d.moved) return;

        if (d.kind === 'side') {
          App.store.setShape(id, d.result.w, d.result.h, d.result.boxes);   // saves
          render();                                                          // re-fit the zoom
        } else {
          var f = App.store.sprite(id).frames[index];
          App.store.setFrameBox(id, index, f && f.box);                      // saves
          layout();
        }
      }

      function resizeSprite(dx, dy) {
        // Both sides move, so the box stays centred and the dragged edge follows the pointer.
        var w = drag.W;
        var hh = drag.H;
        if (drag.which === 'e') w += 2 * dx;
        if (drag.which === 'w') w -= 2 * dx;
        if (drag.which === 's') hh += 2 * dy;
        if (drag.which === 'n') hh -= 2 * dy;
        w = App.store.clampSize(w);
        hh = App.store.clampSize(hh);
        var W0 = drag.W, H0 = drag.H;
        var boxes = drag.boxes.map(function (b) { return b ? rebox(b, W0, H0, w, hh) : null; });
        drag.result = { w: w, h: hh, boxes: boxes };
        App.store.setShape(id, w, hh, boxes, { live: true });
        layoutAll();
        if (sizeNoteEl) sizeNoteEl.textContent = sizeText(def, App.store.sprite(id));
      }

      function movePicture(dx, dy, noSnap) {
        var R = drag.rect;
        var r = { x: R.x + dx, y: R.y + dy, w: R.w, h: R.h };
        var hit = noSnap ? { x: false, y: false } : snap(r, drag.W, drag.H, SNAP_PX / drag.zoom);
        // Keep a corner of it inside the sprite so it cannot get lost.
        var keepW = Math.min(r.w, drag.W) * 0.2;
        var keepH = Math.min(r.h, drag.H) * 0.2;
        r.x = clamp(r.x, keepW - r.w, drag.W - keepW);
        r.y = clamp(r.y, keepH - r.h, drag.H - keepH);
        guideV.hidden = !hit.x;
        guideH.hidden = !hit.y;
        setRect(r, true);
      }

      function scalePicture(dx, dy, free) {
        var R = drag.rect;
        var west = drag.which.indexOf('w') >= 0;
        var north = drag.which.indexOf('n') >= 0;
        var ax = west ? R.x + R.w : R.x;          // the opposite corner stays put
        var ay = north ? R.y + R.h : R.y;
        var cx = west ? R.x : R.x + R.w;          // the corner being dragged
        var cy = north ? R.y : R.y + R.h;
        var px = cx + dx;
        var py = cy + dy;
        var min = MIN_PIC_PX / drag.zoom;
        var max = 20 * Math.max(drag.W, drag.H);
        var w, hh;

        if (free) {
          w = clamp(west ? ax - px : px - ax, min, max);
          hh = clamp(north ? ay - py : py - ay, min, max);
        } else {
          // Project the pointer onto the diagonal: proportions stay the same.
          var vx = cx - ax;
          var vy = cy - ay;
          var s = ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy);
          s = clamp(s, min / Math.min(R.w, R.h), max / Math.max(R.w, R.h));
          w = R.w * s;
          hh = R.h * s;
        }
        setRect({ x: west ? ax - w : ax, y: north ? ay - hh : ay, w: w, h: hh }, true);
      }

      /* --- Keyboard ---------------------------------------------------- */
      var keyEdits = false;

      function onPicKey(e) {
        var m = metrics();
        var r = m && picRect(m);
        if (!r) return;
        var step = e.shiftKey ? 10 : 1;
        var key = e.key;
        if (key === 'ArrowLeft') r.x -= step;
        else if (key === 'ArrowRight') r.x += step;
        else if (key === 'ArrowUp') r.y -= step;
        else if (key === 'ArrowDown') r.y += step;
        else if (key === '+' || key === '=' || key === '-' || key === '_') {
          var f = key === '+' || key === '=' ? 1.05 : 1 / 1.05;
          var cx = r.x + r.w / 2;
          var cy = r.y + r.h / 2;
          r.w *= f;
          r.h *= f;
          r.x = cx - r.w / 2;
          r.y = cy - r.h / 2;
        } else if (key === '0') {
          e.preventDefault();
          App.store.setFrameBox(id, index, null);
          layout();
          return;
        } else {
          return;
        }
        e.preventDefault();
        keyEdits = true;
        setRect(r, true);   // saved on key up, so holding a key stays smooth
      }

      function saveKeyEdits() {
        if (!keyEdits) return;
        keyEdits = false;
        var f = App.store.sprite(id).frames[index];
        if (f) App.store.setFrameBox(id, index, f.box);
      }

      /* --- Drag & drop files onto the whole holder --------------------- */
      holder.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        holder.classList.add('drag');
      });
      holder.addEventListener('dragleave', function (e) {
        if (e.target === holder || !holder.contains(e.relatedTarget)) holder.classList.remove('drag');
      });
      holder.addEventListener('drop', function (e) {
        e.preventDefault();
        holder.classList.remove('drag');
        if (busy) return;
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          applyFiles(index, e.dataTransfer.files);
        }
      });

      holder.appendChild(top);
      holder.appendChild(stage);
      holder.appendChild(tools);

      return { el: holder, stage: stage, layout: layout };
    }

    function confirmReset(def) {
      App.ui.modal({
        title: 'Återställ ' + def.name + '?',
        sub: 'Alla bildrutor för den här spriten ersätts med standardrutan.',
        actions: [
          { label: 'Avbryt', kind: 'ghost' },
          {
            label: 'Återställ', kind: 'danger',
            onClick: function () {
              App.store.resetSprite(def.id);
              render();
              App.ui.toast(def.name + ' är återställd');
            }
          }
        ]
      });
    }

    /* --- Paste an image straight onto the page --------------------------- */
    function onPaste(e) {
      if (!e.clipboardData || !e.clipboardData.files || !e.clipboardData.files.length) return;
      var files = Array.prototype.slice.call(e.clipboardData.files).filter(function (f) {
        return /^image\//.test(f.type || '');
      });
      if (!files.length) return;
      e.preventDefault();

      var frames = App.store.sprite(currentId).frames;
      var target = frames.indexOf(null);
      if (target === -1) target = App.store.addFrame(currentId);
      applyFiles(target, files);
    }

    /* --- Page-wide drop guard: never let the browser open the file -------- */
    function swallow(e) { e.preventDefault(); }

    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);

    function render() {
      App.sprites.unbindAll(view);
      renderList();
      renderMain();
    }

    var stopListening = App.store.subscribe(function (detail) {
      if (detail.type === 'external' && !busy && !dragging) render();
    });

    render();

    return function teardown() {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
      if (ro) ro.disconnect();
      stopListening();
    };
  }

  return { mount: mount };
})();
