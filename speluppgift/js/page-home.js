/* ==========================================================================
   page-home.js — landing page + the project description document.
   The document is read-only until the teacher unlocks it with a password.
   ========================================================================== */

window.App = window.App || {};

App.pages = App.pages || {};

App.pages.home = (function () {
  var h = App.ui.h;

  // Deliberately in plain sight: it only keeps students from editing by mistake.
  var PASSWORD = 'Jens123';

  function mount(view) {
    var editing = false;
    var saveTimer = null;

    var wrap = h('div', { class: 'wrap' });

    /* --- Hero ------------------------------------------------------------ */
    wrap.appendChild(h('section', { class: 'hero' }, [
      h('p', { class: 'eyebrow', text: 'Grafisk design' }),
      h('h1', { text: 'Rita spelet.' }),
      h('p', {
        class: 'lede',
        text: 'Spelet är färdigt att spelas — men grafiken är er. Rita spelare, hinder, ' +
              'poäng, liv och bakgrund, lägg in dem i editorn och se dem röra sig direkt.'
      }),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } }, [
        h('a', { class: 'btn btn-primary btn-lg', href: App.router.href('/game'), 'data-link': true, text: 'Öppna spelet' }),
        h('a', { class: 'btn btn-lg', href: App.router.href('/editor'), 'data-link': true, text: 'Till editorn' })
      ])
    ]));

    /* --- Document -------------------------------------------------------- */
    var shell = h('section', { class: 'doc-shell' });

    shell.appendChild(h('div', { class: 'doc-head' }, [
      h('h2', { text: 'Projektbeskrivning' }),
      h('span', { class: 'hint', text: 'Skrivs av läraren' })
    ]));

    var toolbar = buildToolbar();
    toolbar.hidden = true;
    shell.appendChild(toolbar);

    var page = h('div', {
      class: 'doc-page',
      role: 'document',
      'aria-label': 'Projektbeskrivning'
    });
    page.innerHTML = App.store.doc();
    shell.appendChild(page);

    var editBtn = h('button', { class: 'btn', type: 'button', text: 'Redigera' });
    var resetBtn = h('button', { class: 'btn btn-ghost btn-sm btn-danger', type: 'button', text: 'Återställ standardtext' });
    resetBtn.hidden = true;
    var flag = h('span', { class: 'doc-editing-flag', text: 'Redigeringsläge — allt sparas automatiskt' });
    flag.hidden = true;

    shell.appendChild(h('div', { class: 'doc-actions' }, [editBtn, resetBtn, flag]));
    wrap.appendChild(shell);
    view.appendChild(wrap);

    /* --- Behaviour -------------------------------------------------------- */
    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      // Short debounce: the whole state (sprites included) is re-serialised on save.
      saveTimer = setTimeout(flushSave, 400);
    }

    function flushSave() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (editing) App.store.setDoc(page.innerHTML);
    }

    function setEditing(on) {
      editing = on;
      page.contentEditable = on ? 'true' : 'false';
      page.spellcheck = on;
      toolbar.hidden = !on;
      flag.hidden = !on;
      resetBtn.hidden = !on;
      editBtn.textContent = on ? 'Klar' : 'Redigera';
      editBtn.className = on ? 'btn btn-primary' : 'btn';
      if (on) page.focus();
    }

    editBtn.addEventListener('click', function () {
      if (editing) {
        flushSave();
        setEditing(false);
        App.ui.toast('Texten är sparad');
        return;
      }
      askForPassword(function () { setEditing(true); });
    });

    resetBtn.addEventListener('click', function () {
      App.ui.modal({
        title: 'Återställ texten?',
        sub: 'Projektbeskrivningen ersätts med standardtexten. Det går inte att ångra.',
        actions: [
          { label: 'Avbryt', kind: 'ghost' },
          {
            label: 'Återställ', kind: 'danger',
            onClick: function () {
              App.store.resetDoc();
              page.innerHTML = App.store.doc();
              App.ui.toast('Standardtexten är återställd');
            }
          }
        ]
      });
    });

    page.addEventListener('input', function () {
      if (editing) scheduleSave();
    });

    // Keep pasted text clean — no foreign fonts or colours in the document.
    page.addEventListener('paste', function (e) {
      if (!editing) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    var stopListening = App.store.subscribe(function (detail) {
      if (detail.type === 'external' && !editing) page.innerHTML = App.store.doc();
    });

    return function teardown() {
      flushSave();
      stopListening();
    };
  }

  /* --- Toolbar ------------------------------------------------------------ */
  function buildToolbar() {
    var bar = h('div', { class: 'doc-toolbar', role: 'toolbar', 'aria-label': 'Textformatering' });

    var buttons = [
      { cmd: 'undo', label: '↺', title: 'Ångra' },
      { cmd: 'redo', label: '↻', title: 'Gör om' },
      { sep: true },
      { cmd: 'formatBlock', value: 'h2', label: 'Rubrik', title: 'Rubrik' },
      { cmd: 'formatBlock', value: 'p', label: 'Brödtext', title: 'Brödtext' },
      { sep: true },
      { cmd: 'bold', label: 'B', title: 'Fet', style: { fontWeight: '700' } },
      { cmd: 'italic', label: 'I', title: 'Kursiv', style: { fontStyle: 'italic', fontFamily: 'Georgia, serif' } },
      { cmd: 'underline', label: 'U', title: 'Understruken', style: { textDecoration: 'underline' } },
      { sep: true },
      { cmd: 'insertUnorderedList', label: '•—', title: 'Punktlista' },
      { cmd: 'insertOrderedList', label: '1.', title: 'Numrerad lista' },
      { sep: true },
      { cmd: 'removeFormat', label: 'Rensa', title: 'Ta bort formatering' }
    ];

    buttons.forEach(function (item) {
      if (item.sep) {
        bar.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }));
        return;
      }
      var btn = h('button', {
        class: 'tool',
        type: 'button',
        title: item.title,
        'aria-label': item.title,
        text: item.label,
        style: item.style || null
      });
      // mousedown, so the caret keeps its place in the document.
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        document.execCommand(item.cmd, false, item.value || null);
      });
      bar.appendChild(btn);
    });

    return bar;
  }

  /* --- Password gate ------------------------------------------------------ */
  function askForPassword(onSuccess) {
    var input = h('input', {
      class: 'input',
      type: 'password',
      autocomplete: 'off',
      placeholder: 'Lösenord'
    });
    var error = h('p', { class: 'form-error', role: 'alert' });

    var card = null;

    function attempt(close) {
      if (input.value === PASSWORD) {
        close();
        onSuccess();
        return true;
      }
      error.textContent = 'Fel lösenord. Försök igen.';
      input.value = '';
      input.focus();
      if (card) App.ui.shake(card);
      return false;
    }

    var close = App.ui.modal({
      title: 'Lås upp redigering',
      sub: 'Projektbeskrivningen skrivs av läraren. Ange lösenordet för att ändra den.',
      body: [
        h('label', { class: 'field' }, [
          h('span', { class: 'flabel', text: 'Lösenord' }),
          input
        ]),
        error
      ],
      actions: [
        { label: 'Avbryt', kind: 'ghost' },
        {
          label: 'Lås upp', kind: 'primary', keepOpen: true,
          onClick: function (closeFn) { attempt(closeFn); }
        }
      ],
      onOpen: function (modalCard) { card = modalCard; }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        attempt(close);
      }
    });
  }

  return { mount: mount, PASSWORD: PASSWORD };
})();
