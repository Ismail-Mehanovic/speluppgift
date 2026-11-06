/* ==========================================================================
   sprites.js — image cache, GIF playback, the shared 3 fps animation clock,
   sprite previews and file import.
   ========================================================================== */

window.App = window.App || {};

App.sprites = (function () {
  var FPS = 3;
  var FRAME_MS = 1000 / FPS;

  var TRANSPARENT =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

  /* --- Image cache ------------------------------------------------------- */
  var cache = Object.create(null);

  function image(src) {
    if (!src) return null;
    var img = cache[src];
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.__ready = false;
      img.__done = new Promise(function (resolve) {
        img.addEventListener('load', function () { img.__ready = true; resolve(); });
        img.addEventListener('error', function () { img.__broken = true; resolve(); });
      });
      img.src = src;
      cache[src] = img;
    }
    return img;
  }

  /* --- Animated GIFs -----------------------------------------------------
     An <img> plays a GIF by itself, but a canvas only ever draws its first
     frame. For the game the GIF is decoded once and the right frame is picked
     from the clock, with the GIF's own frame timing. */
  var anims = Object.create(null);
  var PLAYBACK_EDGE = 640;   // decoded frames are kept at most this large

  function isGifSrc(src) {
    return typeof src === 'string' && src.slice(0, 14) === 'data:image/gif';
  }

  function bytesToBase64(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return btoa(parts.join(''));
  }

  function dataUrlBytes(src) {
    var comma = src.indexOf(',');
    if (comma < 0 || src.slice(0, comma).indexOf(';base64') < 0) return null;
    try {
      var bin = atob(src.slice(comma + 1));
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) {
      return null;
    }
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /** Drop decoded GIFs and cached images that no sprite uses any more. */
  function prune() {
    var live = Object.create(null);
    App.store.SPRITES.forEach(function (def) {
      App.store.framesOf(def.id).forEach(function (f) { live[f.src] = true; });
    });
    [anims, cache, gifCounts].forEach(function (store) {
      Object.keys(store).forEach(function (src) { if (!live[src]) delete store[src]; });
    });
  }

  function anim(src) {
    if (!isGifSrc(src)) return null;
    var a = anims[src];
    if (!a) {
      prune();
      a = anims[src] = { ready: false };
      a.done = new Promise(function (resolve) {
        // Decode outside the current frame so the game never stutters on it.
        setTimeout(function () { buildAnim(a, src); resolve(); }, 0);
      });
    }
    return a;
  }

  function buildAnim(a, src) {
    try {
      var bytes = dataUrlBytes(src);
      var gif = bytes && App.gif.decode(bytes);
      if (!gif || gif.frames.length < 2) return;   // a still GIF: the plain image is enough

      var W = gif.width;
      var H = gif.height;
      var scale = Math.min(1, PLAYBACK_EDGE / Math.max(W, H));
      var cw = Math.max(1, Math.round(W * scale));
      var ch = Math.max(1, Math.round(H * scale));
      var full = scale < 1 ? makeCanvas(W, H) : null;
      var pixels = new ImageData(W, H);
      var frames = [];
      var ends = [];
      var total = 0;

      App.gif.compose(gif, function (rgba, index, delay) {
        pixels.data.set(rgba);
        var c = makeCanvas(cw, ch);
        if (full) {
          full.getContext('2d').putImageData(pixels, 0, 0);
          var ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(full, 0, 0, cw, ch);
        } else {
          c.getContext('2d').putImageData(pixels, 0, 0);
        }
        frames.push(c);
        total += delay;
        ends.push(total);
      });

      a.frames = frames;
      a.ends = ends;
      a.total = total;
      a.width = W;
      a.height = H;
      a.ready = true;
    } catch (e) {
      a.failed = true;   // fall back to the browser's first frame
    }
  }

  function animFrame(a) {
    var t = Date.now() % a.total;
    for (var i = 0; i < a.ends.length; i++) if (t < a.ends[i]) return a.frames[i];
    return a.frames[a.frames.length - 1];
  }

  /** Frame count of a GIF data URL (cached). 0 when it is not a GIF. */
  var gifCounts = Object.create(null);
  function gifFrameCount(src) {
    if (!isGifSrc(src)) return 0;
    if (!(src in gifCounts)) {
      var bytes = dataUrlBytes(src);
      gifCounts[src] = bytes ? App.gif.countFrames(bytes) : 0;
    }
    return gifCounts[src];
  }

  function isAnimatedGif(src) { return gifFrameCount(src) > 1; }

  /* --- Frames and placement ---------------------------------------------- */

  /** Index of the frame that should be visible right now. */
  function frameIndex(count) {
    if (count <= 1) return 0;
    return Math.floor(Date.now() / FRAME_MS) % count;
  }

  /** The sprite's current frame ({ src, box }), or null when it has no art. */
  function currentFrame(id) {
    var frames = App.store.framesOf(id);
    if (!frames.length) return null;
    return frames[frameIndex(frames.length)];
  }

  function currentSrc(id) {
    var frame = currentFrame(id);
    return frame ? frame.src : null;
  }

  /**
   * Where a picture lands inside a sprite of bw × bh, in the same units.
   * No box = fit inside and keep the proportions (like object-fit: contain).
   */
  function placement(box, naturalW, naturalH, bw, bh) {
    if (box) return { x: box.x * bw, y: box.y * bh, w: box.w * bw, h: box.h * bh };
    if (!naturalW || !naturalH) return { x: 0, y: 0, w: bw, h: bh };
    var s = Math.min(bw / naturalW, bh / naturalH);
    var w = naturalW * s;
    var h = naturalH * s;
    return { x: (bw - w) / 2, y: (bh - h) / 2, w: w, h: h };
  }

  /** "Fill" placement: cover the whole sprite, keep proportions, crop the rest. */
  function coverBox(naturalW, naturalH, bw, bh) {
    if (!naturalW || !naturalH) return { x: 0, y: 0, w: 1, h: 1 };
    var s = Math.max(bw / naturalW, bh / naturalH);
    var w = naturalW * s / bw;
    var h = naturalH * s / bh;
    return { x: (1 - w) / 2, y: (1 - h) / 2, w: w, h: h };
  }

  /** Something drawable for this picture right now, or null while loading. */
  function drawable(src) {
    var a = anim(src);
    if (a && a.ready) return { source: animFrame(a), width: a.width, height: a.height };
    var img = image(src);
    if (img && img.__ready) return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    return null;
  }

  /**
   * Draw the sprite's current frame into the rectangle x, y, w, h.
   * Returns false when there is nothing to draw (yet).
   */
  function draw(ctx, id, x, y, w, h) {
    var frame = currentFrame(id);
    if (!frame) return false;
    var d = drawable(frame.src);
    if (!d) return false;

    var r = placement(frame.box, d.width, d.height, w, h);
    var spill = r.x < -0.01 || r.y < -0.01 || r.x + r.w > w + 0.01 || r.y + r.h > h + 0.01;
    if (spill) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.drawImage(d.source, x + r.x, y + r.y, r.w, r.h);
    if (spill) ctx.restore();
    return true;
  }

  /* --- Live previews ------------------------------------------------------
     One clock drives every preview on the page so all sprites stay in sync.
     A view is a box with the sprite's proportions and the current frame
     placed in it exactly like the game draws it. */
  var bound = [];
  var timer = null;

  function tick() {
    for (var i = bound.length - 1; i >= 0; i--) {
      var entry = bound[i];
      if (!entry.el.isConnected) { bound.splice(i, 1); continue; }
      entry.update();
    }
    if (!bound.length && timer) { clearInterval(timer); timer = null; }
  }

  function track(el, update) {
    bound.push({ el: el, update: update });
    if (!timer) timer = setInterval(tick, FRAME_MS);
    update();
  }

  function pct(v) { return (v * 100) + '%'; }

  function placeImg(img, box) {
    var st = img.style;
    if (box) {
      st.left = pct(box.x);
      st.top = pct(box.y);
      st.width = pct(box.w);
      st.height = pct(box.h);
      st.objectFit = 'fill';
    } else {
      st.left = '0';
      st.top = '0';
      st.width = '100%';
      st.height = '100%';
      st.objectFit = 'contain';
    }
  }

  /**
   * A live preview of a sprite.
   * @param {string} id
   * @param {Object} opts  maxW, maxH: the largest size in CSS px;
   *                       upscale: false to never show it larger than in the game
   * @returns {HTMLElement} with a refresh() method for instant updates
   */
  function view(id, opts) {
    opts = opts || {};
    var maxW = opts.maxW || 48;
    var maxH = opts.maxH || maxW;

    var img = document.createElement('img');
    img.className = 'sv-img';
    img.alt = '';
    img.draggable = false;

    var el = document.createElement('span');
    el.className = 'sprite-view' + (opts.className ? ' ' + opts.className : '');
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(img);

    var last = { w: -1, h: -1, src: undefined, box: undefined };

    function update() {
      var s = App.store.sprite(id);
      if (!s) return;
      var scale = Math.min(maxW / s.w, maxH / s.h);
      if (opts.upscale === false) scale = Math.min(1, scale);
      var w = Math.max(1, Math.round(s.w * scale));
      var h = Math.max(1, Math.round(s.h * scale));
      if (w !== last.w || h !== last.h) {
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        last.w = w;
        last.h = h;
      }

      var frame = currentFrame(id);
      var src = frame ? frame.src : null;
      if (src !== last.src) {
        last.src = src;
        img.src = src || TRANSPARENT;
        img.style.visibility = src ? '' : 'hidden';
      }
      var box = frame ? frame.box : null;
      if (box !== last.box) {
        last.box = box;
        placeImg(img, box);
      }
    }

    el.refresh = update;
    track(el, update);
    return el;
  }

  function unbindAll(root) {
    for (var i = bound.length - 1; i >= 0; i--) {
      if (root.contains(bound[i].el)) bound.splice(i, 1);
    }
  }

  /* --- File import -------------------------------------------------------
     Uploads are downscaled before they are stored: localStorage only holds a
     few megabytes and a class of students will fill it with phone photos.
     Animated GIFs are shrunk as GIFs, so they keep animating. */
  var MAX_EDGE = { normal: 512, wide: 1600 };
  var KEEP_RAW_LIMIT = 900 * 1024; // data URL length worth keeping as-is

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('Kunde inte läsa filen.')); };
      reader.readAsDataURL(file);
    });
  }

  function readAsBytes(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.onerror = function () { reject(new Error('Kunde inte läsa filen.')); };
      reader.readAsArrayBuffer(file);
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

    var canvas = makeCanvas(cw, ch);
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);

    var png = canvas.toDataURL('image/png');
    if (png.length <= 700 * 1024) return png;

    // Too heavy for localStorage — flatten onto white and use JPEG instead.
    var flat = makeCanvas(cw, ch);
    var fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, cw, ch);
    fctx.drawImage(canvas, 0, 0);
    var jpg = flat.toDataURL('image/jpeg', 0.85);
    if (jpg.length > 700 * 1024) jpg = flat.toDataURL('image/jpeg', 0.7);
    return jpg;
  }

  function later(fn) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(fn()); } catch (e) { reject(e); }
      }, 0);
    });
  }

  /**
   * Scale an animated GIF down until it fits in KEEP_RAW_LIMIT, re-encoding
   * it as a GIF. Frames are only dropped once the picture gets really small.
   */
  function shrinkGif(gif, maxEdge, originalLength) {
    var W = gif.width;
    var H = gif.height;
    var longest = Math.max(W, H);
    var count = gif.frames.length;

    // A first guess from the file size, so a huge GIF is not encoded at full size first.
    var guess = originalLength > KEEP_RAW_LIMIT ? Math.sqrt(KEEP_RAW_LIMIT / originalLength) * 1.15 : 1;
    var edge = Math.max(48, Math.min(maxEdge, longest, Math.round(longest * guess)));

    // Keep the working copy of all frames below ~24 megapixels of memory.
    var step = 1;
    var area = function (e) { var s = e / longest; return Math.max(1, Math.round(W * s)) * Math.max(1, Math.round(H * s)); };
    while (area(edge) * Math.ceil(count / step) > 24e6) {
      if (edge > 160) edge = Math.max(160, Math.floor(edge * 0.85));
      else step *= 2;
    }

    // Composite every frame once, scaled to the working size.
    var full = makeCanvas(W, H);
    var fctx = full.getContext('2d');
    var pixels = new ImageData(W, H);
    var workW = Math.max(1, Math.round(W * edge / longest));
    var workH = Math.max(1, Math.round(H * edge / longest));
    var work = makeCanvas(workW, workH);
    var wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingQuality = 'high';
    var frames = [];

    App.gif.compose(gif, function (rgba, index, delay) {
      if (index % step) {
        frames[frames.length - 1].delay += delay;
        return;
      }
      pixels.data.set(rgba);
      fctx.putImageData(pixels, 0, 0);
      wctx.clearRect(0, 0, workW, workH);
      wctx.drawImage(full, 0, 0, workW, workH);
      frames.push({ data: wctx.getImageData(0, 0, workW, workH).data, delay: delay });
    });

    function attempt(targetEdge, keepEvery, tries) {
      return later(function () {
        var tw = Math.max(1, Math.round(W * targetEdge / longest));
        var th = Math.max(1, Math.round(H * targetEdge / longest));
        var picked = [];
        frames.forEach(function (f, i) {
          if (i % keepEvery) { picked[picked.length - 1].delay += f.delay; return; }
          picked.push({ data: f.data, delay: f.delay });
        });
        if (tw !== workW || th !== workH) {
          var small = makeCanvas(tw, th);
          var sctx = small.getContext('2d', { willReadFrequently: true });
          sctx.imageSmoothingQuality = 'high';
          var src = new ImageData(workW, workH);
          picked.forEach(function (f) {
            src.data.set(f.data);
            fctx.putImageData(src, 0, 0);
            sctx.clearRect(0, 0, tw, th);
            sctx.drawImage(full, 0, 0, workW, workH, 0, 0, tw, th);
            f.data = sctx.getImageData(0, 0, tw, th).data;
          });
        }
        return { bytes: App.gif.encode(tw, th, picked), edge: targetEdge };
      }).then(function (result) {
        var url = 'data:image/gif;base64,' + bytesToBase64(result.bytes);
        if (url.length <= KEEP_RAW_LIMIT) return url;
        if (tries >= 8) throw new Error('GIF:en är för stor. Prova med färre bildrutor eller en mindre bild.');

        var shrink = Math.sqrt(KEEP_RAW_LIMIT / url.length) * 0.92;
        var nextEdge = Math.floor(result.edge * shrink);
        var framesLeft = Math.ceil(frames.length / keepEvery);
        if (nextEdge < 128 && framesLeft > 6) {
          // Smaller would be unreadable: halve the frame rate instead.
          return attempt(Math.min(result.edge, Math.max(128, nextEdge * 1.4)), keepEvery * 2, tries + 1);
        }
        return attempt(Math.max(32, nextEdge), keepEvery, tries + 1);
      });
    }

    return attempt(edge, 1, 0);
  }

  function fromGif(file, maxEdge) {
    return readAsBytes(file).then(function (bytes) {
      var url = 'data:image/gif;base64,' + bytesToBase64(bytes);
      var gif = null;
      try { gif = App.gif.decode(bytes); } catch (e) { gif = null; }

      // Still GIFs (or ones we cannot read) are handled like any other image.
      if (!gif || gif.frames.length < 2) {
        return loadImage(url).then(function (img) {
          return url.length <= KEEP_RAW_LIMIT ? url : rasterise(img, maxEdge);
        });
      }

      if (url.length <= KEEP_RAW_LIMIT && Math.max(gif.width, gif.height) <= maxEdge) {
        return loadImage(url).then(function () { return url; });
      }

      App.ui.toast('GIF:en är stor — packar ihop den …');
      return shrinkGif(gif, maxEdge, url.length);
    });
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

    if (file.type === 'image/gif') return fromGif(file, maxEdge);

    return readAsDataUrl(file).then(function (dataUrl) {
      if (file.type === 'image/svg+xml' && dataUrl.length <= KEEP_RAW_LIMIT) {
        // Vectors stay crisp if we don't touch them.
        return loadImage(dataUrl).then(function () { return dataUrl; });
      }
      return loadImage(dataUrl).then(function (img) { return rasterise(img, maxEdge); });
    });
  }

  /** Warm the caches so the first game frame is not blank. */
  function preload() {
    prune();
    var jobs = [];
    App.store.SPRITES.forEach(function (def) {
      App.store.framesOf(def.id).forEach(function (frame) {
        var img = image(frame.src);
        if (img) jobs.push(img.__done);
        var a = anim(frame.src);
        if (a) jobs.push(a.done);
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
    currentFrame: currentFrame,
    currentSrc: currentSrc,
    placement: placement,
    coverBox: coverBox,
    draw: draw,
    view: view,
    unbindAll: unbindAll,
    isAnimatedGif: isAnimatedGif,
    fromFile: fromFile,
    preload: preload
  };
})();
