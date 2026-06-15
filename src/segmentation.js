/* Character extraction → silhouette polygon + mask. Offline, no ML.
   window.Segmentation.

   Primary "ink-blob" strategy (robust for line art AND messy phone photos):
     1. find the PAPER  = largest bright connected region (ignores desk,
        spiral binding, shadows around the sheet);
     2. find INK inside the paper (dark strokes);
     3. dilate → largest blob → fill holes → erode  ⇒ a solid silhouette,
        even for open stick figures whose limbs are just lines.
   Fallback "flood" strategy handles solid-colour drawings on a plain
   background (no dark outline to key on). */
(function () {
  const Seg = {};

  const lum = (data, i) =>
    0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  /* ---------- small mask utilities ---------- */
  function maskCount(m) { let c = 0; for (let i = 0; i < m.length; i++) c += m[i]; return c; }

  function maskBounds(m, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (m[y * w + x]) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    if (maxX < 0) return null;
    return { minX, minY, maxX, maxY };
  }

  function largestComponentMask(mask, w, h) {
    const n = w * h;
    const label = new Int32Array(n).fill(-1);
    let best = -1, bestSize = 0, cur = 0;
    const stack = [];
    for (let s = 0; s < n; s++) {
      if (mask[s] !== 1 || label[s] !== -1) continue;
      label[s] = cur; stack.length = 0; stack.push(s);
      let size = 0;
      while (stack.length) {
        const i = stack.pop(); size++;
        const x = i % w, y = (i / w) | 0;
        if (x > 0 && mask[i - 1] === 1 && label[i - 1] === -1) { label[i - 1] = cur; stack.push(i - 1); }
        if (x < w - 1 && mask[i + 1] === 1 && label[i + 1] === -1) { label[i + 1] = cur; stack.push(i + 1); }
        if (y > 0 && mask[i - w] === 1 && label[i - w] === -1) { label[i - w] = cur; stack.push(i - w); }
        if (y < h - 1 && mask[i + w] === 1 && label[i + w] === -1) { label[i + w] = cur; stack.push(i + w); }
      }
      if (size > bestSize) { bestSize = size; best = cur; }
      cur++;
    }
    const out = new Uint8Array(n);
    if (best < 0) return out;
    for (let i = 0; i < n; i++) out[i] = label[i] === best ? 1 : 0;
    return out;
  }

  function fillHoles(mask, w, h) {
    const n = w * h;
    const reach = new Uint8Array(n);
    const st = [];
    const seed = (i) => { if (!mask[i] && !reach[i]) { reach[i] = 1; st.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (st.length) {
      const i = st.pop(); const x = i % w, y = (i / w) | 0;
      if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1);
      if (y > 0) seed(i - w); if (y < h - 1) seed(i + w);
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = (mask[i] || !reach[i]) ? 1 : 0;
    return out;
  }

  // Separable square dilation / erosion (radius r).
  function morph(mask, w, h, r, dilate) {
    if (r <= 0) return mask.slice();
    const n = w * h, tmp = new Uint8Array(n), out = new Uint8Array(n);
    const hit = dilate ? 1 : 0;          // value that "wins" along the line
    const def = dilate ? 0 : 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = def;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) { if (!dilate) { v = 0; break; } continue; }
          if (mask[y * w + xx] === hit) { v = hit; break; }
        }
        tmp[y * w + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = def;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) { if (!dilate) { v = 0; break; } continue; }
          if (tmp[yy * w + x] === hit) { v = hit; break; }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }
  const dilate = (m, w, h, r) => morph(m, w, h, r, true);
  const erode = (m, w, h, r) => morph(m, w, h, r, false);

  function otsu(L, n) {
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[Math.min(255, L[i] | 0)]++;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, max = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (wB === 0) continue;
      const wF = n - wB; if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; thr = t; }
    }
    return thr;
  }

  /* ---------- strategy A: ink-blob ---------- */
  function inkBlob(data, L, w, h, sensitivity) {
    const n = w * h;

    // 1. paper = largest bright region; its (inset) box bounds the search.
    const thr = otsu(L, n);
    const bright = new Uint8Array(n);
    for (let i = 0; i < n; i++) bright[i] = L[i] > thr ? 1 : 0;
    const paper = largestComponentMask(bright, w, h);
    let pb = maskBounds(paper, w, h) || { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 };
    const ix = (pb.maxX - pb.minX) * 0.03, iy = (pb.maxY - pb.minY) * 0.03;
    pb = { minX: pb.minX + ix, minY: pb.minY + iy, maxX: pb.maxX - ix, maxY: pb.maxY - iy };

    // paper tone (mean brightness of the sheet) drives the ink threshold.
    let ps = 0, pc = 0;
    for (let i = 0; i < n; i++) if (paper[i]) { ps += L[i]; pc++; }
    const paperTone = pc ? ps / pc : 220;
    const inkT = Math.min(paperTone - 12, paperTone * (0.5 + sensitivity * 0.0045));

    // 2. ink mask within the paper box.
    const ink = new Uint8Array(n);
    const x0 = Math.max(0, pb.minX | 0), x1 = Math.min(w - 1, pb.maxX | 0);
    const y0 = Math.max(0, pb.minY | 0), y1 = Math.min(h - 1, pb.maxY | 0);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (L[i] < inkT) ink[i] = 1;
      }
    if (maskCount(ink) < n * 0.0008) return null;

    // 3. dilate to fuse strokes into a body, keep the biggest blob, fill
    //    enclosed regions, then erode back to tighten the outline.
    const R = Math.max(2, Math.min(14, Math.round(Math.min(w, h) * 0.016)));
    let blob = dilate(ink, w, h, R);
    blob = largestComponentMask(blob, w, h);
    blob = fillHoles(blob, w, h);
    blob = erode(blob, w, h, Math.round(R * 0.55));
    blob = largestComponentMask(blob, w, h);
    blob = fillHoles(blob, w, h);
    return blob;
  }

  /* ---------- strategy B: background flood (solid colour on plain bg) ---------- */
  function floodForeground(data, L, w, h, tolerance) {
    const n = w * h;
    let borderSum = 0, bc = 0;
    for (let x = 0; x < w; x += 2) { borderSum += L[x] + L[(h - 1) * w + x]; bc += 2; }
    for (let y = 0; y < h; y += 2) { borderSum += L[y * w] + L[y * w + w - 1]; bc += 2; }
    const paper = borderSum / Math.max(1, bc);
    const inkCut = Math.max(60, paper * 0.55);
    const localTol = tolerance * 3;

    const bg = new Uint8Array(n), stack = [];
    const seed = (i) => { if (!bg[i] && L[i] >= inkCut) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const x = i % w, y = (i / w) | 0;
      const grow = (j) => {
        if (bg[j]) return;
        if (L[j] < inkCut) return;
        const o = j * 4;
        const d = Math.abs(data[o] - r) + Math.abs(data[o + 1] - g) + Math.abs(data[o + 2] - b);
        if (d <= localTol) { bg[j] = 1; stack.push(j); }
      };
      if (x > 0) grow(i - 1); if (x < w - 1) grow(i + 1);
      if (y > 0) grow(i - w); if (y < h - 1) grow(i + w);
    }
    const fg = new Uint8Array(n);
    for (let i = 0; i < n; i++) fg[i] = bg[i] ? 0 : 1;
    let blob = largestComponentMask(fg, w, h);
    blob = fillHoles(blob, w, h);
    return blob;
  }

  /* ---------- public ---------- */

  // Returns { poly, mask, bounds } or null. mask is the filled silhouette.
  Seg.cutout = function (data, w, h, sensitivity) {
    const n = w * h;
    sensitivity = sensitivity == null ? 32 : sensitivity;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = lum(data, i);

    // Transparent PNG → alpha is the mask outright.
    let transparent = 0;
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 250) transparent++;
    let mask = null;
    if (transparent > n * 0.04) {
      mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] > 50 ? 1 : 0;
      mask = fillHoles(largestComponentMask(mask, w, h), w, h);
    } else {
      mask = inkBlob(data, L, w, h, sensitivity);
      let frac = mask ? maskCount(mask) / n : 0;
      if (!mask || frac < 0.02 || frac > 0.92) {
        const alt = floodForeground(data, L, w, h, sensitivity);
        const af = maskCount(alt) / n;
        if (af >= 0.02 && af <= 0.92) mask = alt;
      }
    }
    if (!mask) return null;
    const frac = maskCount(mask) / n;
    if (frac < 0.01 || frac > 0.95) return null;

    const contour = traceAndSimplify(mask, w, h);
    if (!contour) return null;
    return { poly: contour, mask, bounds: Geo.polyBounds(contour) };
  };

  // Back-compat: just the polygon.
  Seg.autoOutline = function (data, w, h, sensitivity) {
    const r = Seg.cutout(data, w, h, sensitivity);
    return r ? r.poly : null;
  };

  // Bounding box of inky pixels — a sensible manual fallback region.
  Seg.contentBounds = function (data, w, h) {
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (lum(data, y * w + x) < 150) {
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    if (!found) return null;
    const px = (maxX - minX) * 0.06 + 4, py = (maxY - minY) * 0.06 + 4;
    return {
      minX: Math.max(0, minX - px), minY: Math.max(0, minY - py),
      maxX: Math.min(w, maxX + px), maxY: Math.min(h, maxY + py),
    };
  };

  /* ---------- contour tracing ---------- */
  function traceContour(mask, w, h) {
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    const N = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    let sx = -1, sy = -1;
    outer: for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (inside(x, y)) { sx = x; sy = y; break outer; }
    if (sx < 0) return [];
    const dirIndex = (fx, fy, tx, ty) => {
      const dx = tx - fx, dy = ty - fy;
      for (let i = 0; i < 8; i++) if (N[i][0] === dx && N[i][1] === dy) return i;
      return 0;
    };
    const contour = [{ x: sx, y: sy }];
    let bx = sx - 1, by = sy, cx = sx, cy = sy;
    const maxSteps = w * h * 4;
    for (let s = 0; s < maxSteps; s++) {
      const d = dirIndex(cx, cy, bx, by);
      let found = false;
      for (let k = 1; k <= 8; k++) {
        const idx = (d + k) % 8;
        const nx = cx + N[idx][0], ny = cy + N[idx][1];
        if (inside(nx, ny)) {
          bx = cx + N[(idx + 7) % 8][0]; by = cy + N[(idx + 7) % 8][1];
          cx = nx; cy = ny; found = true; break;
        }
      }
      if (!found) break;
      if (cx === sx && cy === sy) break;
      contour.push({ x: cx, y: cy });
    }
    return contour;
  }

  function traceAndSimplify(mask, w, h) {
    let contour = traceContour(mask, w, h);
    if (contour.length < 4) return null;
    const eps = Math.max(1.5, Math.min(w, h) * 0.005);
    contour = Geo.simplify(contour, eps);
    if (contour.length > 150) contour = Geo.simplify(contour, eps * 2);
    return contour.length >= 3 ? contour : null;
  }

  window.Segmentation = Seg;
})();
