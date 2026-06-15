/* Shared math / geometry helpers. Exposed on window.Geo */
(function () {
  const Geo = {};

  Geo.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  Geo.lerp = (a, b, t) => a + (b - a) * t;
  Geo.dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  Geo.dist = (ax, ay, bx, by) => Math.sqrt(Geo.dist2(ax, ay, bx, by));

  // Squared distance from point p to segment ab, plus the closest point.
  Geo.pointSegDist2 = (px, py, ax, ay, bx, by) => {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 1e-9 ? (apx * abx + apy * aby) / len2 : 0;
    t = Geo.clamp(t, 0, 1);
    const cx = ax + abx * t, cy = ay + aby * t;
    const dx = px - cx, dy = py - cy;
    return { d2: dx * dx + dy * dy, t, cx, cy };
  };

  // Ray-casting point-in-polygon. poly = [{x,y}, ...]
  Geo.pointInPoly = (px, py, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  Geo.polyArea = (poly) => {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    }
    return Math.abs(a) / 2;
  };

  Geo.polyBounds = (poly) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  };

  // Douglas–Peucker polyline simplification (open or closed contour).
  Geo.simplify = (pts, eps) => {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let maxD = 0, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const { d2 } = Geo.pointSegDist2(
          pts[i].x, pts[i].y, pts[s].x, pts[s].y, pts[e].x, pts[e].y);
        if (d2 > maxD) { maxD = d2; idx = i; }
      }
      if (idx !== -1 && maxD > eps * eps) {
        keep[idx] = true;
        stack.push([s, idx], [idx, e]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };

  Geo.rotate = (x, y, cos, sin) => ({
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  });

  window.Geo = Geo;
})();
