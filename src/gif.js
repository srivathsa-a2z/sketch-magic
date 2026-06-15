/* Minimal offline animated-GIF encoder (GIF89a + LZW).
   Fixed 216-colour cube palette with 8×8 ordered dithering to smooth
   gradients. window.Gif.encode(frames, opts) → Uint8Array. */
(function () {
  // 6×6×6 colour cube → 216 entries (rest of the 256 table is black/unused).
  const PALETTE = new Uint8Array(256 * 3);
  let pi = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) {
        PALETTE[pi++] = r * 51; PALETTE[pi++] = g * 51; PALETTE[pi++] = b * 51;
      }

  // Normalised 8×8 Bayer matrix (0..63).
  const BAYER = [
    0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31,
    8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
    2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29,
    10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
  ];

  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  function quantize(rgba, w, h) {
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x, o = p * 4;
        const t = (BAYER[(y & 7) * 8 + (x & 7)] / 64 - 0.5) * 51;
        const r6 = Math.round(clamp255(rgba[o] + t) / 51);
        const g6 = Math.round(clamp255(rgba[o + 1] + t) / 51);
        const b6 = Math.round(clamp255(rgba[o + 2] + t) / 51);
        idx[p] = r6 * 36 + g6 * 6 + b6;
      }
    }
    return idx;
  }

  // LZW compress an index stream → array of bytes (pre sub-blocking).
  const DICT = new Int32Array(1 << 20);
  function lzwEncode(indices, minCodeSize) {
    const out = [];
    let accum = 0, nbits = 0;
    const write = (code, size) => {
      accum |= code << nbits; nbits += size;
      while (nbits >= 8) { out.push(accum & 0xff); accum >>= 8; nbits -= 8; }
    };
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let next = eoiCode + 1;
    DICT.fill(-1);
    write(clearCode, codeSize);

    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = DICT[key];
      if (found !== -1) { prefix = found; continue; }
      write(prefix, codeSize);
      DICT[key] = next++;
      if (next === (1 << codeSize)) {
        if (codeSize < 12) codeSize++;
        else { write(clearCode, codeSize); DICT.fill(-1); codeSize = minCodeSize + 1; next = eoiCode + 1; }
      }
      prefix = k;
    }
    write(prefix, codeSize);
    write(eoiCode, codeSize);
    if (nbits > 0) out.push(accum & 0xff);
    return out;
  }

  // frames: array of RGBA Uint8ClampedArray (each w*h*4).
  // opts: { width, height, delay (1/100s), repeat (0 = forever) }
  function encode(frames, opts) {
    const w = opts.width, h = opts.height;
    const delay = opts.delay == null ? 8 : opts.delay;
    const repeat = opts.repeat == null ? 0 : opts.repeat;
    const out = [];
    const u8 = (v) => out.push(v & 0xff);
    const u16 = (v) => { out.push(v & 0xff); out.push((v >> 8) & 0xff); };
    const str = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };

    str('GIF89a');
    u16(w); u16(h);
    u8(0xf7);          // global colour table, 256 entries
    u8(0); u8(0);      // bg index, aspect ratio
    for (let i = 0; i < 768; i++) out.push(PALETTE[i]);

    // NETSCAPE loop extension
    u8(0x21); u8(0xff); u8(0x0b); str('NETSCAPE2.0');
    u8(0x03); u8(0x01); u16(repeat); u8(0x00);

    for (const f of frames) {
      u8(0x21); u8(0xf9); u8(0x04); u8(0x00); u16(delay); u8(0x00); u8(0x00); // GCE
      u8(0x2c); u16(0); u16(0); u16(w); u16(h); u8(0x00);                     // image descriptor
      const idx = quantize(f, w, h);
      const minCodeSize = 8;
      u8(minCodeSize);
      const data = lzwEncode(idx, minCodeSize);
      for (let i = 0; i < data.length; i += 255) {
        const len = Math.min(255, data.length - i);
        u8(len);
        for (let j = 0; j < len; j++) out.push(data[i + j]);
      }
      u8(0x00); // block terminator
    }
    u8(0x3b); // trailer
    return Uint8Array.from(out);
  }

  window.Gif = { encode, PALETTE };
})();
