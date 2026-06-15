/* Offline "smart" coloring: tap-to-fill bucket paint + auto-colorize.
   Operates on a working RGBA buffer (the drawing). Dark lines act as
   natural boundaries, so fills stay inside regions. window.Paint. */
(function () {
  const Paint = {};

  Paint.PALETTE = [
    '#ff5a5f', '#ff8a3d', '#ffb400', '#ffe14d', '#7bd389',
    '#3ad17a', '#36c5f0', '#5b8cff', '#b06cff', '#ff79c6',
  ];

  Paint.hexToRgb = (h) => {
    h = h.replace('#', '');
    return {
      r: parseInt(h.substr(0, 2), 16),
      g: parseInt(h.substr(2, 2), 16),
      b: parseInt(h.substr(4, 2), 16),
    };
  };

  // Scanline flood fill from (sx,sy). Fills pixels whose colour is within
  // `tol` (summed channel distance) of the seed. Marks `visited` (shared so
  // auto-colour can sweep the whole image once). Returns filled pixel count.
  function scanFill(data, w, h, sx, sy, rgb, tol, visited) {
    sx |= 0; sy |= 0;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;
    const seed = (sy * w + sx) * 4;
    const sr = data[seed], sg = data[seed + 1], sb = data[seed + 2], sa = data[seed + 3];
    const match = (p) => {
      if (visited[p]) return false;
      const o = p * 4;
      if (data[o + 3] < sa - 40) return false; // don't bleed into transparency
      return Math.abs(data[o] - sr) + Math.abs(data[o + 1] - sg) +
             Math.abs(data[o + 2] - sb) <= tol;
    };
    let count = 0;
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      let xl = x;
      while (xl >= 0 && match(y * w + xl)) xl--;
      xl++;
      let xr = x;
      while (xr < w && match(y * w + xr)) xr++;
      xr--;
      for (let xx = xl; xx <= xr; xx++) {
        const p = y * w + xx;
        visited[p] = 1;
        const o = p * 4;
        data[o] = rgb.r; data[o + 1] = rgb.g; data[o + 2] = rgb.b; data[o + 3] = 255;
        count++;
        if (y > 0 && match((y - 1) * w + xx)) stack.push(xx, y - 1);
        if (y < h - 1 && match((y + 1) * w + xx)) stack.push(xx, y + 1);
      }
    }
    return count;
  }

  // Public bucket fill (one tap). Returns true if anything changed.
  Paint.fill = function (data, w, h, x, y, hex, tol) {
    const rgb = Paint.hexToRgb(hex);
    return scanFill(data, w, h, x, y, rgb, tol == null ? 70 : tol, new Uint8Array(w * h)) > 0;
  };

  // Auto-colorize: sweep every light region inside the silhouette and give
  // each a palette colour. Surprise-but-pleasant ("magic color").
  Paint.autoColor = function (data, w, h, poly, palette, tol) {
    const pal = palette || Paint.PALETTE;
    const visited = new Uint8Array(w * h);
    const t = tol == null ? 70 : tol;
    let ci = 0;
    const minRegion = (w * h) * 0.0008;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (visited[p]) continue;
        const o = p * 4;
        const light = data[o] > 170 && data[o + 1] > 170 && data[o + 2] > 170 && data[o + 3] > 200;
        if (!light) { visited[p] = 1; continue; }
        if (!Geo.pointInPoly(x, y, poly)) { visited[p] = 1; continue; }
        const rgb = Paint.hexToRgb(pal[ci % pal.length]);
        const n = scanFill(data, w, h, x, y, rgb, t, visited);
        if (n > minRegion) ci++;
      }
    }
    return ci;
  };

  window.Paint = Paint;
})();
