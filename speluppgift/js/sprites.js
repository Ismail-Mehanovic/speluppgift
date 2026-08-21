/* ==========================================================================
   sprites.js — image cache, the shared 3 fps animation clock and file import.
   ========================================================================== */

window.App = window.App || {};

App.sprites = (function () {
  var FPS = 3;
  var FRAME_MS = 1000 / FPS;

  /* --- Image cache ------------------------------------------------------- */
  var cache = Object.create(null);

  function image(src) {
    if (!src) return null;
    var img = cache[src];
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.__ready = false;
      img.addEventListener('load', function () { img.__ready = true; });
      img.addEventListener('error', function () { img.__broken = true; });
      img.src = src;
      cache[src] = img;
    }
    return img;
  }

  /** Index of the frame that should be visible right now. */
  function frameIndex(count) {
    if (count <= 1) return 0;
    return Math.floor(Date.now() / FRAME_MS) % count;
  }

  /** Current frame of a sprite as a data URL, or null when it has no art. */
  function currentSrc(id) {
    var frames = App.store.framesOf(id);
    if (!frames.length) return null;
    return frames[frameIndex(frames.length)];
  }

  /** Current frame as a drawable image, or null when not ready yet. */
  function currentImage(id) {
    var src = currentSrc(id);
    if (!src) return null;
    var img = image(src);
    return img && img.__ready ? img : null;
  }

  /* --- Animated <img> elements ------------------------------------------
     One clock drives every preview on the page so all sprites stay in sync. */
  var bound = [];
  var timer = null;

  function tick() {
    for (var i = bound.length - 1; i >= 0; i--) {
      var entry = bound[i];
      if (!entry.el.isConnected) { bound.splice(i, 1); continue; }
      var src = entry.pick();
      if (src !== entry.last) {
        entry.last = src;
        entry.el.src = src || TRANSPARENT;
        entry.el.style.visibility = src ? '' : 'hidden';
      }
    }
    if (!bound.length && timer) { clearInterval(timer); timer = null; }
  }

  var TRANSPARENT =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

  /**
   * Keep an <img> showing the live (possibly animated) sprite.
   * `pick` defaults to the sprite's current frame; pass one to show a fixed frame.
   */
  function bind(el, pick) {
    var entry = { el: el, pick: pick, last: undefined };
    bound.push(entry);
    if (!timer) timer = setInterval(tick, FRAME_MS);
    // Paint immediately instead of waiting for the first tick.
    var src = pick();
    entry.last = src;
    el.src = src || TRANSPARENT;
    el.style.visibility = src ? '' : 'hidden';
    return entry;
  }

  function bindSprite(el, id) {
    return bind(el, function () { return currentSrc(id); });
  }

  function unbindAll(root) {
    for (var i = bound.length - 1; i >= 0; i--) {
      if (root.contains(bound[i].el)) bound.splice(i, 1);
    }
  }

  /* --- File import -------------------------------------------------------
     Uploads are downscaled before they are stored: localStorage only holds a
     few megabytes and a class of students will fill it with phone photos. */
  var MAX_EDGE = { normal: 512, wide: 1600 };
  var KEEP_RAW_LIMIT = 900 * 1024; // vector / animated files worth keeping as-is

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('Kunde inte läsa filen.')); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Filen är inte en bild som webbläsaren kan visa.')); };
      img.src = src;
    });
  }

  function rasterise(img, maxEdge) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('Bilden saknar storlek.');

    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));

    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);

    var png = canvas.toDataURL('image/png');
    if (png.length <= 700 * 1024) return png;

    // Too heavy for localStorage — flatten onto white and use JPEG instead.
    var flat = document.createElement('canvas');
    flat.width = cw;
    flat.height = ch;
    var fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, cw, ch);
    fctx.drawImage(canvas, 0, 0);
    var jpg = flat.toDataURL('image/jpeg', 0.85);
    if (jpg.length > 700 * 1024) jpg = flat.toDataURL('image/jpeg', 0.7);
    return jpg;
  }

  /**
   * Turn a dropped/picked file into a data URL ready for the store.
   * @param {File} file
   * @param {string} spriteId  decides how large the result may be
   */
  function fromFile(file, spriteId) {
    if (!file || !/^image\//.test(file.type || '')) {
      return Promise.reject(new Error('Det där är ingen bildfil.'));
    }
    var def = App.store.def(spriteId);
    var maxEdge = def && !def.resizable ? MAX_EDGE.wide : MAX_EDGE.normal;

    return readAsDataUrl(file).then(function (dataUrl) {
      var keepRaw =
        (file.type === 'image/svg+xml' || file.type === 'image/gif') &&
        dataUrl.length <= KEEP_RAW_LIMIT;

      if (keepRaw) {
        // Vectors stay crisp and GIFs keep animating if we don't touch them.
        return loadImage(dataUrl).then(function () { return dataUrl; });
      }
      return loadImage(dataUrl).then(function (img) { return rasterise(img, maxEdge); });
    });
  }

  /** Warm the cache so the first game frame is not blank. */
  function preload() {
    var jobs = [];
    App.store.SPRITES.forEach(function (def) {
      App.store.framesOf(def.id).forEach(function (src) {
        var img = image(src);
        if (img && !img.__ready && !img.__broken) {
          jobs.push(new Promise(function (resolve) {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          }));
        }
      });
    });
    // Never block the UI for more than a moment on a broken file.
    return Promise.race([
      Promise.all(jobs),
      new Promise(function (r) { setTimeout(r, 1500); })
    ]);
  }

  return {
    FPS: FPS,
    FRAME_MS: FRAME_MS,
    TRANSPARENT: TRANSPARENT,
    image: image,
    frameIndex: frameIndex,
    currentSrc: currentSrc,
    currentImage: currentImage,
    bind: bind,
    bindSprite: bindSprite,
    unbindAll: unbindAll,
    fromFile: fromFile,
    preload: preload
  };
})();
