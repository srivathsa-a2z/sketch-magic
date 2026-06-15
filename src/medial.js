/* Medial-axis ("skeleton tracing") rig estimate. Thins the silhouette to a
   1-px skeleton, prunes short spurs (crowns, fingers, capes), then reads limb
   endpoints/junctions to place joints on the ACTUAL limbs — including bends.
   Returns a PARTIAL name→{x,y} map (image coords) of the joints it is
   confident about; the caller merges it over a full base rig. window.Medial. */
(function () {
  const Medial = {};

  function downscale(mask, w, h, target) {
    const scale = Math.min(1, target / Math.max(w, h));
    const sw = Math.max(8, Math.round(w * scale));
    const sh = Math.max(8, Math.round(h * scale));
    const out = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const sx = Math.min(w - 1, Math.floor(x / scale));
        const sy = Math.min(h - 1, Math.floor(y / scale));
        out[y * sw + x] = mask[sy * w + sx];
      }
    return { small: out, sw, sh, scale };
  }

  // Zhang–Suen thinning → 1-px skeleton.
  function thin(src, w, h) {
    const img = src.slice();
    const P = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : img[y * w + x];
    let changed = true, guard = 0;
    while (changed && guard++ < 300) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        const rem = [];
        for (let y = 1; y < h - 1; y++)
          for (let x = 1; x < w - 1; x++) {
            if (!img[y * w + x]) continue;
            const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y),
                  p5 = P(x + 1, y + 1), p6 = P(x, y + 1), p7 = P(x - 1, y + 1),
                  p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
            const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            const s = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
            let A = 0;
            for (let k = 0; k < 8; k++) if (s[k] === 0 && s[k + 1] === 1) A++;
            if (A !== 1) continue;
            if (step === 0) { if (p2 * p4 * p6) continue; if (p4 * p6 * p8) continue; }
            else { if (p2 * p4 * p8) continue; if (p2 * p6 * p8) continue; }
            rem.push(y * w + x);
          }
        if (rem.length) { changed = true; for (const i of rem) img[i] = 0; }
      }
    }
    return img;
  }

  // 3×3 majority filter — removes the staircase jaggies that nearest-neighbour
  // downscaling leaves, so thinning yields clean 1-px lines (not noisy webs).
  function smooth(mask, w, h, passes) {
    let cur = mask;
    for (let p = 0; p < passes; p++) {
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let on = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h && cur[ny * w + nx]) on++;
            }
          out[y * w + x] = on >= 5 ? 1 : 0;
        }
      cur = out;
    }
    return cur;
  }

  function neighbors(skel, w, h, i) {
    const x = i % w, y = (i / w) | 0, r = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (skel[ny * w + nx]) r.push(ny * w + nx);
      }
    return r;
  }

  // Crossing number = number of separate neighbour arcs around a skeleton
  // pixel. 1 = endpoint (limb tip), 2 = mid-line (incl. diagonal staircases),
  // ≥3 = junction. Raw neighbour COUNT miscounts staircases as junctions.
  function branches(skel, w, h, i) {
    const x = i % w, y = (i / w) | 0;
    const P = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : (skel[yy * w + xx] ? 1 : 0);
    const r = [P(x, y - 1), P(x + 1, y - 1), P(x + 1, y), P(x + 1, y + 1),
               P(x, y + 1), P(x - 1, y + 1), P(x - 1, y), P(x - 1, y - 1)];
    let a = 0;
    for (let k = 0; k < 8; k++) if (r[k] === 0 && r[(k + 1) % 8] === 1) a++;
    return a;
  }

  // Walk from an endpoint along the line to the next junction/endpoint.
  function trace(skel, w, h, start) {
    const path = [start];
    const seen = new Set([start]);
    let cur = start;
    for (let g = 0; g < 100000; g++) {
      const nb = neighbors(skel, w, h, cur).filter((n) => !seen.has(n));
      if (nb.length === 0) break;
      cur = nb[0]; seen.add(cur); path.push(cur);
      if (branches(skel, w, h, cur) !== 2) break;
    }
    return path;
  }

  function prune(skel, w, h, minLen) {
    let changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      for (let i = 0; i < skel.length; i++) {
        if (!skel[i] || branches(skel, w, h, i) !== 1) continue;
        const path = trace(skel, w, h, i);
        const term = path[path.length - 1];
        if (branches(skel, w, h, term) >= 3 && path.length < minLen) {
          for (let k = 0; k < path.length - 1; k++) skel[path[k]] = 0; // keep junction
          changed = true;
        }
      }
    }
  }

  Medial.positions = function (mask, w, h) {
    const { small, sw, sh, scale } = downscale(mask, w, h, 256);
    // scaled silhouette bounds
    let minX = sw, minY = sh, maxX = 0, maxY = 0, any = false;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++)
        if (small[y * sw + x]) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (!any) return null;
    const Hs = maxY - minY, midXs = (minX + maxX) / 2;

    const clean = smooth(small, sw, sh, 2);
    const skel = thin(clean, sw, sh);
    prune(skel, sw, sh, Math.max(4, Hs * 0.12));

    const eps = [];
    let junc = 0, skelCount = 0;
    for (let i = 0; i < skel.length; i++) {
      if (!skel[i]) continue;
      skelCount++;
      const a = branches(skel, sw, sh, i);
      if (a === 1) eps.push({ i, x: i % sw, y: (i / sw) | 0 });
      else if (a >= 3) junc++;
    }
    Medial._dbg = { sw, sh, scale: +scale.toFixed(2), Hs, skelCount, eps: eps.length, junc };
    if (eps.length < 3) return null; // too little structure to trust

    const toImg = (i) => ({ x: (i % sw) / scale, y: ((i / sw) | 0) / scale });
    const along = (path, t) => path[Math.max(0, Math.min(path.length - 1, Math.round((path.length - 1) * t)))];

    // head = topmost endpoint
    eps.sort((a, b) => a.y - b.y);
    const head = eps[0];
    let rest = eps.slice(1);

    // feet = two lowest endpoints
    rest.sort((a, b) => b.y - a.y);
    const feet = rest.slice(0, 2).sort((a, b) => a.x - b.x); // left→right
    rest = rest.filter((e) => feet.indexOf(e) < 0);

    // hands = remaining endpoints, most horizontally extreme
    rest.sort((a, b) => Math.abs(b.x - midXs) - Math.abs(a.x - midXs));
    const hands = rest.slice(0, 2).sort((a, b) => a.x - b.x);

    const pos = {};
    const limb = (ep, tipName, midName, upName) => {
      const path = trace(skel, sw, sh, ep.i);
      pos[tipName] = toImg(path[0]);
      pos[midName] = toImg(along(path, 0.5));
      if (upName) pos[upName] = toImg(along(path, 0.82));
      return path;
    };

    const headPath = limb(head, 'head', 'neck'); // head tip + neck
    pos.head = toImg(along(headPath, 0.3));        // pull head joint into the blob
    if (feet[0]) limb(feet[0], 'foot_r', 'leg_r_lo', 'leg_r_up');
    if (feet[1]) limb(feet[1], 'foot_l', 'leg_l_lo', 'leg_l_up');
    if (hands[0]) limb(hands[0], 'hand_r', 'arm_r_lo', 'arm_r_up');
    if (hands[1]) limb(hands[1], 'hand_l', 'arm_l_lo', 'arm_l_up');

    // torso / root from the head-path junction and the hips we found
    const upperJ = along(headPath, 1.0);
    const hips = [pos.leg_r_up, pos.leg_l_up].filter(Boolean);
    if (hips.length) {
      const root = { x: hips.reduce((s, p) => s + p.x, 0) / hips.length, y: hips.reduce((s, p) => s + p.y, 0) / hips.length };
      pos.root = root;
      pos.torso = { x: (toImg(upperJ).x + root.x) / 2, y: (toImg(upperJ).y + root.y) / 2 };
    }
    return pos;
  };

  window.Medial = Medial;
})();
