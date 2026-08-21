/* ==========================================================================
   ui.js — tiny DOM helper, modal cards and toasts.
   ========================================================================== */

window.App = window.App || {};

App.ui = (function () {

  /* --- Element builder ---------------------------------------------------
     h('button', { class: 'btn', text: 'Spela', onclick: fn }, [childNode])   */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};

    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;

      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset' && typeof value === 'object') Object.assign(el.dataset, value);
      else if (key.indexOf('on') === 0 && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    });

    append(el, children);
    return el;
  }

  function append(parent, children) {
    if (children === null || children === undefined || children === false) return parent;
    if (Array.isArray(children)) {
      children.forEach(function (child) { append(parent, child); });
      return parent;
    }
    parent.appendChild(children.nodeType ? children : document.createTextNode(String(children)));
    return parent;
  }

  function clear(node) {
    if (node) while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /* --- Icons -------------------------------------------------------------- */
  var ICONS = {
    upload:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>'
  };

  function icon(name) {
    var span = document.createElement('span');
    span.innerHTML = ICONS[name] || '';
    span.setAttribute('aria-hidden', 'true');
    span.style.display = 'inline-flex';
    return span.firstChild;
  }

  /* --- Modal -------------------------------------------------------------- */
  var openModals = [];

  /**
   * @param {Object} opts
   *   title, sub          – header texts
   *   body                – Node or array of Nodes
   *   actions             – [{ label, kind: 'primary'|'ghost'|'danger', onClick(close), keepOpen }]
   *   wide, dismissable, onClose, onOpen(modalEl)
   * @returns {Function} close
   */
  function modal(opts) {
    opts = opts || {};
    var root = document.getElementById('modal-root');
    var previousFocus = document.activeElement;

    var card = h('div', {
      class: 'modal' + (opts.wide ? ' modal-wide' : ''),
      role: 'dialog',
      'aria-modal': 'true'
    });

    if (opts.title) card.appendChild(h('h2', { text: opts.title }));
    if (opts.sub) card.appendChild(h('p', { class: 'modal-sub', text: opts.sub }));
    if (opts.body) append(card, opts.body);

    var backdrop = h('div', { class: 'modal-backdrop' }, card);

    function close() {
      if (!backdrop.parentNode) return;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      var i = openModals.indexOf(close);
      if (i > -1) openModals.splice(i, 1);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      if (opts.onClose) opts.onClose();
    }

    function onKey(e) {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === close) {
        if (opts.dismissable === false) return;
        e.stopPropagation();
        close();
      }
    }

    if (opts.actions && opts.actions.length) {
      var bar = h('div', { class: 'modal-actions' });
      opts.actions.forEach(function (action) {
        bar.appendChild(h('button', {
          class: 'btn' + (action.kind ? ' btn-' + action.kind : ''),
          type: 'button',
          text: action.label,
          onclick: function () {
            var result = action.onClick ? action.onClick(close) : undefined;
            if (!action.keepOpen && result !== false) close();
          }
        }));
      });
      card.appendChild(bar);
    }

    backdrop.addEventListener('mousedown', function (e) {
      if (e.target === backdrop && opts.dismissable !== false) close();
    });

    root.appendChild(backdrop);
    openModals.push(close);
    document.addEventListener('keydown', onKey, true);

    var focusTarget = card.querySelector('input, textarea, button.btn-primary, button');
    if (focusTarget) focusTarget.focus();
    if (opts.onOpen) opts.onOpen(card, close);

    return close;
  }

  function shake(node) {
    node.classList.remove('shake');
    void node.offsetWidth; // restart the animation
    node.classList.add('shake');
  }

  /* --- Toast -------------------------------------------------------------- */
  var stack = null;

  function toast(message, kind) {
    if (!stack) {
      stack = h('div', { class: 'toast-stack' });
      document.body.appendChild(stack);
    }
    var node = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: message });
    stack.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s ease';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 260);
    }, kind === 'warn' ? 4200 : 2200);
  }

  return {
    h: h,
    append: append,
    clear: clear,
    icon: icon,
    modal: modal,
    shake: shake,
    toast: toast
  };
})();
