/* Humanoid skeleton: template, placement (fixed + silhouette-aware), FK.
   window.Skeleton. Coordinates are image pixel space. */
(function () {
  // name, parent, and a fallback position as a fraction of the bbox.
  const TEMPLATE = [
    { name: 'root',     parent: null,       fx: 0.50, fy: 0.52 },
    { name: 'torso',    parent: 'root',     fx: 0.50, fy: 0.36 },
    { name: 'neck',     parent: 'torso',    fx: 0.50, fy: 0.22 },
    { name: 'head',     parent: 'neck',     fx: 0.50, fy: 0.09 },
    { name: 'arm_r_up', parent: 'torso',    fx: 0.37, fy: 0.26 },
    { name: 'arm_r_lo', parent: 'arm_r_up', fx: 0.30, fy: 0.42 },
    { name: 'hand_r',   parent: 'arm_r_lo', fx: 0.26, fy: 0.58 },
    { name: 'arm_l_up', parent: 'torso',    fx: 0.63, fy: 0.26 },
    { name: 'arm_l_lo', parent: 'arm_l_up', fx: 0.70, fy: 0.42 },
    { name: 'hand_l',   parent: 'arm_l_lo', fx: 0.74, fy: 0.58 },
    { name: 'leg_r_up', parent: 'root',     fx: 0.43, fy: 0.55 },
    { name: 'leg_r_lo', parent: 'leg_r_up', fx: 0.42, fy: 0.76 },
    { name: 'foot_r',   parent: 'leg_r_lo', fx: 0.41, fy: 0.97 },
    { name: 'leg_l_up', parent: 'root',     fx: 0.57, fy: 0.55 },
    { name: 'leg_l_lo', parent: 'leg_l_up', fx: 0.58, fy: 0.76 },
    { name: 'foot_l',   parent: 'leg_l_lo', fx: 0.59, fy: 0.97 },
  ];

  function assemble(pos) {
    const joints = TEMPLATE.map((t, i) => ({
      index: i, name: t.name, parent: t.parent, parentIndex: -1,
      x: pos[t.name].x, y: pos[t.name].y,
    }));
    const byName = {};
    joints.forEach((j) => (byName[j.name] = j));
    joints.forEach((j) => (j.parentIndex = j.parent == null ? -1 : byName[j.parent].index));
    return { joints, byName };
  }

  function build(bounds) {
    const { minX, minY, w, h } = bounds;
    const pos = {};
    TEMPLATE.forEach((t) => (pos[t.name] = { x: minX + t.fx * w, y: minY + t.fy * h }));
    return assemble(pos);
  }

  // Estimate joints from the actual silhouette mask: head at the top, hands at
  // the widest reach, feet at the bottom extremes, hips/shoulders on the torso
  // centre line. Far better than fixed fractions for leaning / arms-out poses.
  function autoRig(mask, w, h) {
    const b = boundsOf(mask, w, h);
    if (!b) return build({ minX: 0, minY: 0, w, h });
    const H = b.maxY - b.minY, W = b.maxX - b.minX;
    const occ = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    const rowExtent = (y) => {
      let l = -1, r = -1;
      for (let x = b.minX; x <= b.maxX; x++) if (occ(x, y)) { if (l < 0) l = x; r = x; }
      return l < 0 ? null : [l, r];
    };
    const bandCenter = (f0, f1) => {
      let sx = 0, c = 0;
      for (let y = (b.minY + f0 * H) | 0; y < (b.minY + f1 * H) | 0; y++) {
        const e = rowExtent(y); if (e) { sx += (e[0] + e[1]) / 2; c++; }
      }
      return c ? sx / c : (b.minX + b.maxX) / 2;
    };

    const midX = bandCenter(0.3, 0.75);

    // hands: extreme left/right reach in the upper body
    let lx = Infinity, rx = -Infinity, lh = null, rh = null;
    for (let y = b.minY; y < b.minY + 0.62 * H; y++) {
      const e = rowExtent(y | 0); if (!e) continue;
      if (e[0] < lx) { lx = e[0]; lh = { x: e[0], y }; }
      if (e[1] > rx) { rx = e[1]; rh = { x: e[1], y }; }
    }
    lh = lh || { x: b.minX, y: b.minY + 0.3 * H };
    rh = rh || { x: b.maxX, y: b.minY + 0.3 * H };

    // feet: lowest-reaching left/right points in the bottom band
    let lf = null, rf = null, lfx = Infinity, rfx = -Infinity;
    for (let y = b.maxY; y >= b.minY + 0.78 * H; y--) {
      const e = rowExtent(y | 0); if (!e) continue;
      if (e[0] < lfx) { lfx = e[0]; lf = { x: e[0], y }; }
      if (e[1] > rfx) { rfx = e[1]; rf = { x: e[1], y }; }
    }
    lf = lf || { x: midX - 0.1 * W, y: b.maxY };
    rf = rf || { x: midX + 0.1 * W, y: b.maxY };

    const lerp = (a, c, t) => ({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t });
    // mid-limb joint: the point along a→c that stays inside the silhouette and
    // is closest to the middle (handles bent/angled limbs far better than 0.5).
    const limbMid = (a, c) => {
      let best = null, bestT = 2;
      for (let k = 1; k <= 9; k++) {
        const t = k / 10;
        const x = a.x + (c.x - a.x) * t, y = a.y + (c.y - a.y) * t;
        if (occ(x | 0, y | 0) && Math.abs(t - 0.5) < bestT) { bestT = Math.abs(t - 0.5); best = { x, y }; }
      }
      return best || lerp(a, c, 0.5);
    };
    const shY = b.minY + 0.24 * H, shC = bandCenter(0.2, 0.3);
    const sh_r = { x: shC - 0.12 * W, y: shY };
    const sh_l = { x: shC + 0.12 * W, y: shY };
    const hipY = b.minY + 0.55 * H;
    const hip_r = { x: midX - 0.08 * W, y: hipY };
    const hip_l = { x: midX + 0.08 * W, y: hipY };

    const pos = {
      root:     { x: midX, y: b.minY + 0.52 * H },
      torso:    { x: midX, y: b.minY + 0.36 * H },
      neck:     { x: bandCenter(0.12, 0.2), y: b.minY + 0.18 * H },
      head:     { x: bandCenter(0, 0.13), y: b.minY + 0.07 * H },
      arm_r_up: sh_r, arm_r_lo: limbMid(sh_r, lh), hand_r: lh,
      arm_l_up: sh_l, arm_l_lo: limbMid(sh_l, rh), hand_l: rh,
      leg_r_up: hip_r, leg_r_lo: limbMid(hip_r, lf), foot_r: lf,
      leg_l_up: hip_l, leg_l_lo: limbMid(hip_l, rf), foot_l: rf,
    };

    // Snap joints onto limb centerlines. Tips (hands/feet) move little so they
    // stay at the extremities; mid-limb joints center more aggressively.
    const D = distanceTransform(mask, w, h);
    const big = Math.min(w, h) * 0.06, small = Math.min(w, h) * 0.03;
    const moveBy = {
      hand_r: small, hand_l: small, foot_r: small, foot_l: small, head: big,
    };
    for (const name in pos) {
      const mm = moveBy[name] == null ? big : moveBy[name];
      const s = snapToCenter(pos[name].x, pos[name].y, D, w, h, mm);
      pos[name] = s;
    }
    return assemble(pos);
  }

  // Two-pass chamfer distance transform: D[i] = distance from pixel i to the
  // nearest background pixel (0 outside the silhouette). The ridges of D are
  // the limb centerlines.
  function distanceTransform(mask, w, h) {
    const n = w * h, D = new Float32Array(n);
    const INF = 1e9, d1 = 1, d2 = 1.41421356;
    for (let i = 0; i < n; i++) D[i] = mask[i] ? INF : 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let v = D[i];
        if (x > 0) v = Math.min(v, D[i - 1] + d1);
        if (y > 0) v = Math.min(v, D[i - w] + d1);
        if (x > 0 && y > 0) v = Math.min(v, D[i - w - 1] + d2);
        if (x < w - 1 && y > 0) v = Math.min(v, D[i - w + 1] + d2);
        D[i] = v;
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let v = D[i];
        if (x < w - 1) v = Math.min(v, D[i + 1] + d1);
        if (y < h - 1) v = Math.min(v, D[i + w] + d1);
        if (x < w - 1 && y < h - 1) v = Math.min(v, D[i + w + 1] + d2);
        if (x > 0 && y < h - 1) v = Math.min(v, D[i + w - 1] + d2);
        D[i] = v;
      }
    return D;
  }

  // Hill-climb on the distance field toward the limb centerline, capped to
  // `maxMove` px so a joint stays on its own limb. If the point starts in the
  // background (D==0), first project it to the nearest interior pixel.
  function snapToCenter(px, py, D, w, h, maxMove) {
    let x = Math.max(0, Math.min(w - 1, Math.round(px)));
    let y = Math.max(0, Math.min(h - 1, Math.round(py)));
    if (D[y * w + x] <= 0) {
      const R = Math.max(6, Math.round(maxMove * 1.5));
      let best = -1, bx = x, by = y;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (D[ny * w + nx] > 0) {
            const dd = dx * dx + dy * dy;
            if (best < 0 || dd < best) { best = dd; bx = nx; by = ny; }
          }
        }
      if (best < 0) return { x: px, y: py };
      x = bx; y = by;
    }
    const ox = x, oy = y;
    for (let step = 0; step < 30; step++) {
      let bx = x, by = y, bd = D[y * w + x];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const d = D[ny * w + nx];
          if (d > bd) { bd = d; bx = nx; by = ny; }
        }
      if (bx === x && by === y) break;
      if (Math.hypot(bx - ox, by - oy) > maxMove) break;
      x = bx; y = by;
    }
    return { x, y };
  }

  function boundsOf(mask, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (mask[y * w + x]) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    return maxX < 0 ? null : { minX, minY, maxX, maxY };
  }

  function bones(skel) {
    return skel.joints
      .filter((j) => j.parentIndex >= 0)
      .map((j) => ({ child: j.index, parent: j.parentIndex }));
  }

  // Forward kinematics: localRot[i] applied at joint i, rootOffset translates
  // the whole figure. Writes animX/animY/worldRot on each joint.
  function solveFK(skel, localRot, rootOffset) {
    const J = skel.joints;
    const worldRot = new Float32Array(J.length);
    for (let i = 0; i < J.length; i++) {
      const j = J[i], p = j.parentIndex;
      if (p < 0) {
        worldRot[i] = localRot[i] || 0;
        j.animX = j.x + (rootOffset ? rootOffset.x : 0);
        j.animY = j.y + (rootOffset ? rootOffset.y : 0);
      } else {
        const pr = worldRot[p];
        worldRot[i] = pr + (localRot[i] || 0);
        const ox = j.x - J[p].x, oy = j.y - J[p].y;
        const c = Math.cos(pr), s = Math.sin(pr);
        j.animX = J[p].animX + (ox * c - oy * s);
        j.animY = J[p].animY + (ox * s + oy * c);
      }
      j.worldRot = worldRot[i];
    }
    return worldRot;
  }

  window.Skeleton = { TEMPLATE, build, autoRig, bones, solveFK, distanceTransform, snapToCenter };
})();
