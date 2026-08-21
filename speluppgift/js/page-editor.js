/* ==========================================================================
   page-editor.js — draw/upload the artwork for every sprite.

   One sprite holder = one frame. Two or more filled holders turn the sprite
   into a 3 fps animation. Every change is written to localStorage at once.
   ========================================================================== */

window.App = window.App || {};
App.pages = App.pages || {};

App.pages.editor = (function () {
  var h = App.ui.h;

  function mount(view) {
    var currentId = 'player';
    var busy = false;

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
    function renderList() {
      App.ui.clear(listEl);
      listEl.appendChild(h('h2', { text: 'Sprites' }));

      App.store.SPRITES.forEach(function (def) {
        var frames = App.store.framesOf(def.id);
        var img = h('img', { alt: '' });
        App.sprites.bindSprite(img, def.id);

        var label = frames.length > 1
          ? frames.length + ' bildrutor · ' + App.sprites.FPS + ' fps'
          : (frames.length === 1 ? '1 bildruta' : 'tom');

        listEl.appendChild(h('button', {
          class: 'thumb' + (def.id === currentId ? ' active' : ''),
          type: 'button',
          'aria-pressed': def.id === currentId ? 'true' : 'false',
          onclick: function () {
            currentId = def.id;
            render();
          }
        }, [
          h('span', { class: 'thumb-img' }, img),
          h('span', { class: 'thumb-meta' }, [
            h('span', { class: 'n', text: def.name }),
            h('br'),
            h('span', { class: 's', text: label })
          ])
        ]));
      });
    }

    /* --- Main body ------------------------------------------------------- */
    function renderMain() {
      var scrollLeft = 0;
      var previousScroller = mainEl.querySelector('.strip-scroll');
      if (previousScroller) scrollLeft = previousScroller.scrollLeft;

      App.ui.clear(mainEl);

      var def = App.store.def(currentId);
      var sprite = App.store.sprite(currentId);
      var filled = App.store.framesOf(currentId);

      /* Head */
      var previewImg = h('img', { alt: '' });
      App.sprites.bindSprite(previewImg, currentId);

      var previewCaption = filled.length > 1
        ? 'Animeras · ' + App.sprites.FPS + ' fps'
        : (filled.length === 1 ? 'Stillbild' : 'Ingen bild än');

      mainEl.appendChild(h('div', { class: 'editor-head' }, [
        h('div', {}, [
          h('h1', { text: def.name }),
          h('p', { class: 'hint', text: def.blurb }),
          h('p', {
            class: 'hint',
            style: { marginTop: '4px' },
            text: 'Dra in en bild i rutan, eller klicka för att välja fil. Lägg till fler rutor med + för att animera.'
          })
        ]),
        h('div', { class: 'editor-head-right' }, [
          h('div', { class: 'live-preview' }, [
            h('div', { class: 'box' }, previewImg),
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
        strip.appendChild(buildHolder(index, frame, sprite.frames.length));
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
      var sizeNote = def.resizable
        ? 'Storlek i spelet: ' + sprite.w + ' × ' + sprite.h + ' px'
        : 'Storlek i spelet: ' + def.w + ' × ' + def.h + ' px (låst)';

      mainEl.appendChild(h('div', { class: 'editor-foot' }, [
        h('div', { class: 'row' }, [
          h('span', { text: sizeNote }),
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
    }

    function buildHolder(index, frame, total) {
      var def = App.store.def(currentId);
      var holder = h('div', { class: 'holder' + (def.resizable ? '' : ' wide') });

      /* Top row: frame number, replace, remove */
      var removeBtn = h('button', {
        class: 'icon-btn',
        type: 'button',
        title: frame ? 'Töm bildrutan' : 'Ta bort bildrutan',
        'aria-label': frame ? 'Töm bildrutan' : 'Ta bort bildrutan',
        text: '×',
        onclick: function () {
          var action = App.store.clearOrRemoveFrame(currentId, index);
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
            onclick: function () { pickerTarget = index; picker.click(); }
          }) : null,
          removeBtn
        ])
      ]);

      /* Image area or dropzone */
      var area = h('div', { class: 'holder-canvas' });

      if (frame) {
        var img = h('img', { alt: def.name + ', bildruta ' + (index + 1), src: frame });
        area.appendChild(img);
      } else {
        area.appendChild(h('div', {
          class: 'dropzone',
          role: 'button',
          tabindex: '0',
          onclick: function () { pickerTarget = index; picker.click(); },
          onkeydown: function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pickerTarget = index;
              picker.click();
            }
          }
        }, [
          App.ui.icon('upload'),
          h('span', { text: 'Dra en bild hit' }),
          h('span', { class: 'small', text: 'eller klicka för att välja fil' })
        ]));
      }

      /* Drag & drop onto the whole holder */
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
      holder.appendChild(area);
      return holder;
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
      if (detail.type === 'external' && !busy) render();
    });

    render();

    return function teardown() {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
      stopListening();
    };
  }

  return { mount: mount };
})();
