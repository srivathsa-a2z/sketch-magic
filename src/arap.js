/* 2D As-Rigid-As-Possible (ARAP) mesh deformation — the technique the
   reference (Meta Animated Drawings) uses instead of linear-blend skinning.
   Skeleton joints act as positional "handles"; the rest of the mesh deforms
   as-rigidly-as-possible to follow them, preserving limb shape (no collapse,
   no folding). Local/global solve with Gauss–Seidel, warm-started from the
   previous frame so a few iterations suffice in real time. window.ARAP. */
(function () {
  // Build the solver state for a mesh + skeleton (joints become handles).
  function prepare(mesh, skel) {
    const V = mesh.verts, n = V.length;
    const nbr = Array.from({ length: n }, () => []);
    for (const t of mesh.tris) {
      const e = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
      for (const [a, b] of e) {
        if (nbr[a].indexOf(b) < 0) nbr[a].push(b);
        if (nbr[b].indexOf(a) < 0) nbr[b].push(a);
      }
    }
    const restX = new Float32Array(n), restY = new Float32Array(n);
    for (let i = 0; i < n; i++) { restX[i] = V[i].x; restY[i] = V[i].y; }

    // each joint pins its nearest (still-free) mesh vertex
    const fixed = new Uint8Array(n);
    const handleJoint = new Int32Array(n).fill(-1);
    const used = new Uint8Array(n);
    for (const j of skel.joints) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        const dx = V[i].x - j.x, dy = V[i].y - j.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { used[best] = 1; fixed[best] = 1; handleJoint[best] = j.index; }
    }

    return {
      n, nbr, restX, restY, fixed, handleJoint,
      px: restX.slice(), py: restY.slice(),         // warm-start positions
      theta: new Float32Array(n), ct: new Float32Array(n), st: new Float32Array(n),
    };
  }

  // Solve one frame given the skeleton's current animated joint positions.
  function solve(s, skel, out, opts) {
    const { n, nbr, restX, restY, fixed, handleJoint, px, py, theta, ct, st } = s;
    const J = skel.joints;
    const OUTER = (opts && opts.outer) || 3;
    const SWEEPS = (opts && opts.sweeps) || 4;

    // pin handles to their joints' animated positions
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { const j = J[handleJoint[i]]; px[i] = j.animX; py[i] = j.animY; }
    }

    for (let o = 0; o < OUTER; o++) {
      // local step: best-fit rotation per vertex (2D Procrustes, closed form)
      for (let i = 0; i < n; i++) {
        const N = nbr[i], rxi = restX[i], ryi = restY[i], pxi = px[i], pyi = py[i];
        let num = 0, den = 0;
        for (let m = 0; m < N.length; m++) {
          const j = N[m];
          const ex = rxi - restX[j], ey = ryi - restY[j];
          const fx = pxi - px[j], fy = pyi - py[j];
          num += ex * fy - ey * fx;
          den += ex * fx + ey * fy;
        }
        const a = Math.atan2(num, den);
        theta[i] = a; ct[i] = Math.cos(a); st[i] = Math.sin(a);
      }
      // global step: Gauss–Seidel toward L p' = b (uniform weights)
      for (let sw = 0; sw < SWEEPS; sw++) {
        for (let i = 0; i < n; i++) {
          if (fixed[i]) continue;
          const N = nbr[i], rxi = restX[i], ryi = restY[i], ci = ct[i], si = st[i];
          let sx = 0, sy = 0;
          for (let m = 0; m < N.length; m++) {
            const j = N[m];
            const ex = rxi - restX[j], ey = ryi - restY[j];
            const cj = ct[j], sj = st[j];
            // 0.5 (R_i + R_j) (rest_i - rest_j)
            sx += px[j] + 0.5 * ((ex * ci - ey * si) + (ex * cj - ey * sj));
            sy += py[j] + 0.5 * ((ex * si + ey * ci) + (ex * sj + ey * cj));
          }
          const inv = 1 / N.length;
          px[i] = sx * inv; py[i] = sy * inv;
        }
      }
    }
    for (let i = 0; i < n; i++) { out[i * 2] = px[i]; out[i * 2 + 1] = py[i]; }
  }

  window.ARAP = { prepare, solve };
})();
