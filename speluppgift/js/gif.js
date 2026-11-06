/* ==========================================================================
   gif.js — a small GIF decoder and encoder. No dependencies.

   A <canvas> only ever draws the first frame of an animated GIF, so the game
   decodes GIFs itself and plays the frames back with the GIF's own timing.
   The encoder is used when an uploaded GIF is too large for localStorage:
   the frames are scaled down and written back out as a new, smaller GIF.
   ========================================================================== */

window.App = window.App || {};

App.gif = (function () {

  /* --- Reading ------------------------------------------------------------ */

  function isGif(bytes) {
    return !!bytes && bytes.length > 13 &&
      bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46; // "GIF"
  }

  function u16(b, p) { return b[p] | (b[p + 1] << 8); }

  /** Position just after a run of data sub-blocks starting at p. */
  function skipSubBlocks(b, p) {
    while (p < b.length) {
      var n = b[p++];
      if (n === 0) break;
      p += n;
    }
    return Math.min(p, b.length);
  }

  /** The data of a run of sub-blocks, glued together. */
  function readSubBlocks(b, p, end) {
    var total = 0;
    var q = p;
    while (q < end) {
      var n = b[q++];
      if (n === 0) break;
      total += Math.min(n, end - q);
      q += n;
    }
    var data = new Uint8Array(total);
    var o = 0;
    q = p;
    while (q < end && o < total) {
      var m = b[q++];
      if (m === 0) break;
      var chunk = b.subarray(q, Math.min(q + m, end));
      data.set(chunk, o);
      o += chunk.length;
      q += m;
    }
    return data;
  }

  /** Browsers play 0 and 10 ms frames at 100 ms; do the same. */
  function normaliseDelay(centiseconds) {
    var ms = centiseconds * 10;
    return ms <= 10 ? 100 : ms;
  }

  /**
   * Split a GIF into its blocks.
   * @param {Uint8Array} bytes
   * @param {boolean} withData  false = only count/measure frames (faster)
   * @returns {{ width, height, frames: Array }}
   */
  function parse(bytes, withData) {
    if (!isGif(bytes)) throw new Error('Filen är ingen GIF.');

    var width = u16(bytes, 6);
    var height = u16(bytes, 8);
    var packed = bytes[10];
    var p = 13;

    var globalPalette = null;
    if (packed & 0x80) {
      var gsize = 3 * (2 << (packed & 7));
      globalPalette = bytes.subarray(p, p + gsize);
      p += gsize;
    }

    var frames = [];
    var gce = null;

    while (p < bytes.length) {
      var block = bytes[p++];

      if (block === 0x21) {                       // extension
        var label = bytes[p++];
        if (label === 0xF9 && bytes[p] >= 4) {    // graphic control extension
          var gp = bytes[p + 1];
          gce = {
            disposal: (gp >> 2) & 7,
            transparent: (gp & 1) ? bytes[p + 4] : -1,
            delay: u16(bytes, p + 2)
          };
        }
        p = skipSubBlocks(bytes, p);

      } else if (block === 0x2C) {                // image
        if (p + 9 > bytes.length) break;
        var frame = {
          x: u16(bytes, p),
          y: u16(bytes, p + 2),
          w: u16(bytes, p + 4),
          h: u16(bytes, p + 6),
          interlaced: !!(bytes[p + 8] & 0x40),
          palette: globalPalette,
          disposal: gce ? gce.disposal : 0,
          transparent: gce ? gce.transparent : -1,
          delay: normaliseDelay(gce ? gce.delay : 0)
        };
        var fp = bytes[p + 8];
        p += 9;
        if (fp & 0x80) {
          var lsize = 3 * (2 << (fp & 7));
          frame.palette = bytes.subarray(p, p + lsize);
          p += lsize;
        }
        frame.minCode = bytes[p++];
        var end = skipSubBlocks(bytes, p);
        if (withData) frame.data = readSubBlocks(bytes, p, end);
        p = end;
        gce = null;
        if (frame.w && frame.h) frames.push(frame);

      } else {                                    // 0x3B trailer, or junk
        break;
      }
    }

    if (!frames.length) throw new Error('GIF:en innehåller inga bilder.');

    // A few encoders write a 0 × 0 screen; use the frames' extent instead.
    if (!width || !height) {
      frames.forEach(function (f) {
        width = Math.max(width, f.x + f.w);
        height = Math.max(height, f.y + f.h);
      });
    }

    return { width: width, height: height, frames: frames };
  }

  function decode(bytes) { return parse(bytes, true); }

  function countFrames(bytes) {
    try { return parse(bytes, false).frames.length; } catch (e) { return 0; }
  }

  /* --- LZW decompression ------------------------------------------------- */

  function lzwDecode(minCode, data, count) {
    var out = new Uint8Array(count);
    if (minCode < 1 || minCode > 11) return out;

    var clear = 1 << minCode;
    var eoi = clear + 1;
    var size = minCode + 1;
    var mask = (1 << size) - 1;
    var next = eoi + 1;

    var prefix = new Uint16Array(4096);
    var suffix = new Uint8Array(4096);
    var stack = new Uint8Array(4097);
    for (var c = 0; c < clear; c++) suffix[c] = c;

    var datum = 0;
    var bits = 0;
    var pos = 0;
    var op = 0;
    var prev = -1;
    var first = 0;

    while (op < count) {
      while (bits < size && pos < data.length) {
        datum |= data[pos++] << bits;
        bits += 8;
      }
      if (bits < size) break;

      var code = datum & mask;
      datum >>>= size;
      bits -= size;

      if (code === clear) {
        size = minCode + 1;
        mask = (1 << size) - 1;
        next = eoi + 1;
        prev = -1;
        continue;
      }
      if (code === eoi) break;

      if (prev === -1) {
        if (code >= clear) break;      // corrupt stream
        out[op++] = code;
        prev = code;
        first = code;
        continue;
      }

      var top = 0;
      var cur = code;
      if (code >= next) {               // the "KwKwK" case: code not in the table yet
        if (code > next) break;         // corrupt stream
        stack[top++] = first;
        cur = prev;
      }
      while (cur >= clear) {
        stack[top++] = suffix[cur];
        cur = prefix[cur];
      }
      first = cur;
      stack[top++] = first;

      if (next < 4096) {
        prefix[next] = prev;
        suffix[next] = first;
        next++;
        if (next > mask && size < 12) {
          size++;
          mask = (1 << size) - 1;
        }
      }
      prev = code;

      while (top > 0 && op < count) out[op++] = stack[--top];
    }
    return out;
  }

  /* --- Compositing ------------------------------------------------------- */

  function interlaceRows(h) {
    var map = new Array(h);
    var i = 0;
    [[0, 8], [4, 8], [2, 4], [1, 2]].forEach(function (pass) {
      for (var r = pass[0]; r < h; r += pass[1]) map[i++] = r;
    });
    return map;
  }

  function paint(canvas, W, H, f) {
    var pal = f.palette;
    if (!pal) return;
    var colours = pal.length / 3;
    var indices = lzwDecode(f.minCode, f.data, f.w * f.h);
    var rows = f.interlaced ? interlaceRows(f.h) : null;
    var cols = Math.min(f.w, W - f.x);

    for (var row = 0; row < f.h; row++) {
      var y = f.y + (rows ? rows[row] : row);
      if (y >= H) continue;
      var src = row * f.w;
      var dst = (y * W + f.x) * 4;
      for (var x = 0; x < cols; x++, dst += 4) {
        var ci = indices[src + x];
        if (ci === f.transparent || ci >= colours) continue;
        var pi = ci * 3;
        canvas[dst] = pal[pi];
        canvas[dst + 1] = pal[pi + 1];
        canvas[dst + 2] = pal[pi + 2];
        canvas[dst + 3] = 255;
      }
    }
  }

  function clearRect(canvas, W, H, f) {
    var x1 = Math.min(W, f.x + f.w);
    var y1 = Math.min(H, f.y + f.h);
    if (f.x >= x1) return;
    for (var y = f.y; y < y1; y++) canvas.fill(0, (y * W + f.x) * 4, (y * W + x1) * 4);
  }

  /**
   * Paint every frame onto a shared canvas the way browsers do and hand each
   * finished picture to onFrame(rgba, index, delayMs). The rgba buffer is
   * reused between calls, so copy it if you need to keep it.
   */
  function compose(gif, onFrame) {
    var W = gif.width;
    var H = gif.height;
    var canvas = new Uint8ClampedArray(W * H * 4);
    var saved = null;
    var prev = null;

    gif.frames.forEach(function (f, index) {
      if (prev) {
        if (prev.disposal === 2) clearRect(canvas, W, H, prev);
        else if (prev.disposal === 3 && saved) canvas.set(saved);
      }
      if (f.disposal === 3) saved = new Uint8ClampedArray(canvas);
      paint(canvas, W, H, f);
      onFrame(canvas, index, f.delay);
      prev = f;
    });
  }

  /* --- Writing ----------------------------------------------------------- */

  function Writer() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
  }
  Writer.prototype.room = function (n) {
    if (this.len + n <= this.buf.length) return;
    var bigger = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    bigger.set(this.buf.subarray(0, this.len));
    this.buf = bigger;
  };
  Writer.prototype.byte = function (b) {
    this.room(1);
    this.buf[this.len++] = b;
  };
  Writer.prototype.u16 = function (v) {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  };
  Writer.prototype.bytes = function (arr) {
    this.room(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  };
  Writer.prototype.ascii = function (s) {
    for (var i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  };
  Writer.prototype.result = function () {
    return this.buf.slice(0, this.len);
  };

  /* --- Colour reduction --------------------------------------------------
     GIF allows 256 colours. Colours are bucketed to 5 bits per channel; if
     there are few enough buckets each one gets its own palette entry,
     otherwise a median cut merges them. One palette for every frame keeps
     colours steady and lets unchanged pixels be skipped between frames. */

  function keyOf(r, g, b) { return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); }

  function quantize(frames, pixels, maxColours) {
    var count = new Uint32Array(32768);
    var sumR = new Float64Array(32768);
    var sumG = new Float64Array(32768);
    var sumB = new Float64Array(32768);

    frames.forEach(function (fr) {
      var d = fr.data;
      for (var p = 0, end = pixels * 4; p < end; p += 4) {
        if (d[p + 3] < 128) continue;
        var k = keyOf(d[p], d[p + 1], d[p + 2]);
        count[k]++;
        sumR[k] += d[p];
        sumG[k] += d[p + 1];
        sumB[k] += d[p + 2];
      }
    });

    var keys = [];
    for (var k = 0; k < 32768; k++) if (count[k]) keys.push(k);

    var groups;
    if (keys.length <= maxColours) {
      groups = keys.map(function (key) { return [key]; });
    } else {
      groups = medianCut(keys, count, maxColours);
    }

    var lut = new Uint8Array(32768);
    var palette = [];
    groups.forEach(function (group, index) {
      var n = 0, r = 0, g = 0, b = 0;
      group.forEach(function (key) {
        lut[key] = index;
        n += count[key];
        r += sumR[key];
        g += sumG[key];
        b += sumB[key];
      });
      palette.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
    });
    if (!palette.length) palette.push(0, 0, 0);   // a fully transparent GIF

    return { lut: lut, palette: palette, colours: palette.length / 3 };
  }

  function channel(key, c) {
    return c === 0 ? key >> 10 : c === 1 ? (key >> 5) & 31 : key & 31;
  }

  function makeBox(keys, count) {
    var lo = [31, 31, 31];
    var hi = [0, 0, 0];
    var total = 0;
    keys.forEach(function (key) {
      for (var c = 0; c < 3; c++) {
        var v = channel(key, c);
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
      total += count[key];
    });
    var axis = 0;
    for (var c2 = 1; c2 < 3; c2++) if (hi[c2] - lo[c2] > hi[axis] - lo[axis]) axis = c2;
    var range = hi[axis] - lo[axis];
    return { keys: keys, total: total, axis: axis, score: keys.length > 1 ? total * (range + 1) : 0 };
  }

  function medianCut(keys, count, maxColours) {
    var boxes = [makeBox(keys, count)];
    while (boxes.length < maxColours) {
      var best = -1;
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].score > 0 && (best < 0 || boxes[i].score > boxes[best].score)) best = i;
      }
      if (best < 0) break;

      var box = boxes[best];
      var axis = box.axis;
      var sorted = box.keys.slice().sort(function (a, b) { return channel(a, axis) - channel(b, axis); });
      var half = box.total / 2;
      var acc = 0;
      var split = 1;
      for (var j = 0; j < sorted.length - 1; j++) {
        acc += count[sorted[j]];
        if (acc >= half) { split = j + 1; break; }
        split = j + 1;
      }
      boxes.splice(best, 1, makeBox(sorted.slice(0, split), count), makeBox(sorted.slice(split), count));
    }
    return boxes.map(function (b) { return b.keys; });
  }

  /* --- LZW compression --------------------------------------------------- */

  // Dictionary indexed by (prefix << 8 | byte). A generation stamp makes a
  // table reset free instead of clearing a million entries every time.
  var dictCodes = null;
  var dictGens = null;
  var generation = 0;

  function lzwEncode(w, minCode, pixels) {
    if (!dictCodes) {
      dictCodes = new Int16Array(1 << 20);
      dictGens = new Uint32Array(1 << 20);
    }

    w.byte(minCode);

    var clear = 1 << minCode;
    var eoi = clear + 1;
    var size = minCode + 1;
    var next = eoi + 1;
    var gen = ++generation;

    var block = new Uint8Array(255);
    var blockLen = 0;
    var acc = 0;
    var bits = 0;

    function flush() {
      if (!blockLen) return;
      w.byte(blockLen);
      w.bytes(block.subarray(0, blockLen));
      blockLen = 0;
    }

    function put(code) {
      acc |= code << bits;
      bits += size;
      while (bits >= 8) {
        block[blockLen++] = acc & 255;
        acc >>>= 8;
        bits -= 8;
        if (blockLen === 255) flush();
      }
    }

    put(clear);
    var prefix = pixels[0];
    for (var i = 1; i < pixels.length; i++) {
      var k = pixels[i];
      var key = (prefix << 8) | k;
      if (dictGens[key] === gen) {
        prefix = dictCodes[key];
        continue;
      }
      put(prefix);
      if (next === 4096) {
        put(clear);
        size = minCode + 1;
        next = eoi + 1;
        gen = ++generation;
      } else {
        if (next >= (1 << size)) size++;
        dictCodes[key] = next++;
        dictGens[key] = gen;
      }
      prefix = k;
    }
    put(prefix);
    put(eoi);
    if (bits > 0) {
      block[blockLen++] = acc & 255;
      if (blockLen === 255) flush();
    }
    flush();
    w.byte(0);
  }

  /* --- Encoding ---------------------------------------------------------- */

  function sameBytes(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Bounding box of the pixels where test(i) is true, or null. */
  function bounds(width, height, test) {
    var x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (var y = 0, i = 0; y < height; y++) {
      for (var x = 0; x < width; x++, i++) {
        if (!test(i)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function union(a, b) {
    if (!a) return b;
    if (!b) return a;
    var x = Math.min(a.x, b.x);
    var y = Math.min(a.y, b.y);
    return {
      x: x, y: y,
      w: Math.max(a.x + a.w, b.x + b.w) - x,
      h: Math.max(a.y + a.h, b.y + b.h) - y
    };
  }

  /**
   * Write RGBA frames as a looping GIF.
   * @param {number} width
   * @param {number} height
   * @param {Array<{data: Uint8ClampedArray, delay: number}>} frames  full-size RGBA, delay in ms
   * @returns {Uint8Array}
   */
  function encode(width, height, frames) {
    var pixels = width * height;
    var q = quantize(frames, pixels, 255);
    var T = q.colours;                              // the transparent index
    var bits = 1;
    while ((1 << bits) < T + 1) bits++;
    var minCode = Math.max(2, bits);

    // Map every frame to palette indices; merge frames that do not change.
    var list = [];
    frames.forEach(function (fr) {
      var idx = new Uint8Array(pixels);
      var d = fr.data;
      for (var i = 0, p = 0; i < pixels; i++, p += 4) {
        idx[i] = d[p + 3] < 128 ? T : q.lut[keyOf(d[p], d[p + 1], d[p + 2])];
      }
      var last = list[list.length - 1];
      if (last && sameBytes(last.idx, idx)) last.delay += fr.delay;
      else list.push({ idx: idx, delay: fr.delay });
    });

    var w = new Writer();
    w.ascii('GIF89a');
    w.u16(width);
    w.u16(height);
    w.byte(0x80 | ((bits - 1) << 4) | (bits - 1));
    w.byte(0);
    w.byte(0);
    for (var c = 0; c < (1 << bits); c++) {
      w.byte(q.palette[c * 3] || 0);
      w.byte(q.palette[c * 3 + 1] || 0);
      w.byte(q.palette[c * 3 + 2] || 0);
    }

    if (list.length > 1) {
      // Loop forever.
      w.bytes([0x21, 0xFF, 0x0B]);
      w.ascii('NETSCAPE2.0');
      w.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
    }

    // `screen` mirrors what a decoder shows, so each frame only needs to
    // store the pixels that actually change.
    var screen = new Uint8Array(pixels).fill(T);

    list.forEach(function (entry, k) {
      var cur = entry.idx;
      var nextIdx = list[k + 1] ? list[k + 1].idx : null;

      var rect = bounds(width, height, function (i) { return cur[i] !== screen[i]; });

      // Pixels that turn transparent in the next frame can only be erased by
      // clearing this frame's rectangle afterwards (disposal 2).
      var disposal = 1;
      if (nextIdx) {
        var erase = bounds(width, height, function (i) { return cur[i] !== T && nextIdx[i] === T; });
        if (erase) {
          disposal = 2;
          rect = union(rect, erase);
        }
      }
      if (!rect) rect = { x: 0, y: 0, w: 1, h: 1 };

      var data = new Uint8Array(rect.w * rect.h);
      for (var y = 0, j = 0; y < rect.h; y++) {
        var row = (rect.y + y) * width + rect.x;
        for (var x = 0; x < rect.w; x++, j++) {
          var i = row + x;
          data[j] = cur[i] === screen[i] ? T : cur[i];
          if (data[j] !== T) screen[i] = data[j];
        }
      }

      var delay = Math.max(2, Math.min(65535, Math.round(entry.delay / 10)));
      w.bytes([0x21, 0xF9, 0x04, (disposal << 2) | 1]);
      w.u16(delay);
      w.bytes([T, 0x00]);

      w.byte(0x2C);
      w.u16(rect.x);
      w.u16(rect.y);
      w.u16(rect.w);
      w.u16(rect.h);
      w.byte(0);
      lzwEncode(w, minCode, data);

      if (disposal === 2) {
        for (var cy = rect.y; cy < rect.y + rect.h; cy++) {
          screen.fill(T, cy * width + rect.x, cy * width + rect.x + rect.w);
        }
      }
    });

    w.byte(0x3B);
    return w.result();
  }

  return {
    isGif: isGif,
    decode: decode,
    countFrames: countFrames,
    compose: compose,
    encode: encode
  };
})();
