/* Build a deformable triangle mesh from the silhouette polygon.
   Bowyer–Watson Delaunay over boundary + interior grid points, then
   discard triangles whose centroid falls outside the polygon.
   Exposed on window.Mesh. */
(function () {
  const Mesh = {};

  // Bowyer–Watson on an array of {x,y}. Returns triangles as index triples.
  function delaunay(points) {
    const n = points.length;
    if (n < 3) return [];

    // Super-triangle enclosing every point.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const dx = maxX - minX, dy = maxY - minY;
    const dmax = Math.max(dx, dy) * 10 + 10;
    const midx = (minX + maxX) / 2, midy = (minY + maxY) / 2;
    const pts = points.slice();
    const i0 = pts.push({ x: midx - dmax, y: midy - dmax }) - 1;
    const i1 = pts.push({ x: midx, y: midy + dmax }) - 1;
    const i2 = pts.push({ x: midx + dmax, y: midy - dmax }) - 1;

    const circum = (a, b, c) => {
      const ax = pts[a].x, ay = pts[a].y;
      const bx = pts[b].x, by = pts[b].y;
      const cx = pts[c].x, cy = pts[c].y;
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) < 1e-9) return { x: 0, y: 0, r2: Infinity };
      const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
      const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
      const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
      const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
      return { x: ux, y: uy, r2 };
    };

    let tris = [{ a: i0, b: i1, c: i2, cc: circum(i0, i1, i2) }];

    for (let ip = 0; ip < n; ip++) {
      const px = pts[ip].x, py = pts[ip].y;
      const bad = [];
      for (const t of tris) {
        const ddx = px - t.cc.x, ddy = py - t.cc.y;
        if (ddx * ddx + ddy * ddy <= t.cc.r2) bad.push(t);
      }
      // Boundary of the polygonal hole left by the bad triangles.
      const edges = [];
      for (const t of bad) {
        const e = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
        for (const [u, v] of e) {
          let shared = false;
          for (const t2 of bad) {
            if (t2 === t) continue;
            const has = (x, y) =>
              (t2.a === x || t2.b === x || t2.c === x) &&
              (t2.a === y || t2.b === y || t2.c === y);
            if (has(u, v)) { shared = true; break; }
          }
          if (!shared) edges.push([u, v]);
        }
      }
      tris = tris.filter((t) => !bad.includes(t));
      for (const [u, v] of edges) {
        tris.push({ a: u, b: v, c: ip, cc: circum(u, v, ip) });
      }
    }

    // Drop triangles touching the super-triangle vertices.
    const out = [];
    for (const t of tris) {
      if (t.a >= n || t.b >= n || t.c >= n) continue;
      out.push([t.a, t.b, t.c]);
    }
    return out;
  }

  // poly: silhouette as [{x,y}]. spacing in px for interior sampling.
  Mesh.build = function (poly, spacing) {
    const b = Geo.polyBounds(poly);
    const step = spacing || Math.max(6, Math.min(b.w, b.h) / 20);

    // Resample the boundary so long edges get intermediate points.
    const verts = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c = poly[(i + 1) % poly.length];
      verts.push({ x: a.x, y: a.y });
      const seg = Geo.dist(a.x, a.y, c.x, c.y);
      const sub = Math.floor(seg / step);
      for (let k = 1; k < sub; k++) {
        const t = k / sub;
        verts.push({ x: Geo.lerp(a.x, c.x, t), y: Geo.lerp(a.y, c.y, t) });
      }
    }
    const boundaryCount = verts.length;

    // Interior grid points kept strictly inside the polygon.
    const inset = step * 0.45;
    for (let y = b.minY + step; y < b.maxY; y += step) {
      for (let x = b.minX + step; x < b.maxX; x += step) {
        if (insetInside(x, y, poly, inset)) verts.push({ x, y });
      }
    }

    const tris = delaunay(verts);
    // Keep triangles whose centroid is inside the polygon (handles concavity).
    const kept = [];
    for (const [a, c, d] of tris) {
      const cx = (verts[a].x + verts[c].x + verts[d].x) / 3;
      const cy = (verts[a].y + verts[c].y + verts[d].y) / 3;
      if (Geo.pointInPoly(cx, cy, poly)) kept.push([a, c, d]);
    }
    return { verts, tris: kept, boundaryCount };
  };

  // Point is inside the polygon and at least `inset` away from its edges.
  function insetInside(x, y, poly, inset) {
    if (!Geo.pointInPoly(x, y, poly)) return false;
    const inset2 = inset * inset;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const { d2 } = Geo.pointSegDist2(x, y, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
      if (d2 < inset2) return false;
    }
    return true;
  }

  window.Mesh = Mesh;
})();
