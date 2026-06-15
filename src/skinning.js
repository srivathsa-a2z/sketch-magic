/* Bind mesh vertices to skeleton bones, then deform via linear blend
   skinning each frame. window.Skinning.

   Weights use distance to the nearest bone *segments*, but only bones within a
   locality cap of the closest one contribute — so a forearm vertex can't be
   yanked by a far-off leg bone (the cause of the old "deformity"). */
(function () {
  const MAX_INFLUENCES = 4;

  function bind(mesh, skel) {
    const bones = Skeleton.bones(skel);
    const J = skel.joints;
    const verts = mesh.verts;
    const NJ = J.length;

    let avgLen = 0;
    for (const b of bones) avgLen += Geo.dist(J[b.parent].x, J[b.parent].y, J[b.child].x, J[b.child].y);
    avgLen = Math.max(8, avgLen / Math.max(1, bones.length));
    const eps = avgLen * 0.14;
    const cap = avgLen * 0.7;

    // Dense weights over pivot joints (column = pivot joint index), so we can
    // smooth them across the mesh before extracting the top influences.
    const dense = new Float32Array(verts.length * NJ);
    const cand = [];
    for (let v = 0; v < verts.length; v++) {
      const px = verts[v].x, py = verts[v].y;
      cand.length = 0;
      let nearest = Infinity;
      for (let bi = 0; bi < bones.length; bi++) {
        const p = J[bones[bi].parent], c = J[bones[bi].child];
        const { d2 } = Geo.pointSegDist2(px, py, p.x, p.y, c.x, c.y);
        const d = Math.sqrt(d2);
        if (d < nearest) nearest = d;
        cand.push({ pivot: bones[bi].parent, d });
      }
      const limit = nearest + cap;
      let sum = 0;
      const row = v * NJ;
      for (const c of cand) {
        if (c.d > limit) continue;
        const wgt = 1 / ((c.d + eps) * (c.d + eps));
        dense[row + c.pivot] += wgt; sum += wgt;
      }
      if (sum > 0) for (let j = 0; j < NJ; j++) dense[row + j] /= sum;
    }

    // Laplacian weight smoothing over the mesh graph — removes the abrupt
    // weight jumps at limb/torso seams that cause triangles to fold.
    smoothWeights(dense, verts.length, NJ, buildAdjacency(mesh, verts.length), 4);

    // Extract the top MAX_INFLUENCES per vertex.
    const weights = new Float32Array(verts.length * MAX_INFLUENCES);
    const indices = new Int32Array(verts.length * MAX_INFLUENCES).fill(-1);
    const part = new Int8Array(verts.length);
    const depth = new Float32Array(verts.length);
    for (let v = 0; v < verts.length; v++) {
      const row = v * NJ;
      const top = [];
      for (let j = 0; j < NJ; j++) if (dense[row + j] > 0) top.push({ j, w: dense[row + j] });
      top.sort((a, b) => b.w - a.w);
      const chosen = top.slice(0, MAX_INFLUENCES);
      let sum = 0;
      for (const t of chosen) sum += t.w;
      for (let k = 0; k < chosen.length; k++) {
        weights[v * MAX_INFLUENCES + k] = chosen[k].w / (sum || 1);
        indices[v * MAX_INFLUENCES + k] = chosen[k].j;
      }
      const domName = chosen.length ? J[chosen[0].j].name : 'root';
      part[v] = partOf(domName);
      depth[v] = BASE_DEPTH[part[v]];
    }
    return { weights, indices, max: MAX_INFLUENCES, part, depth };
  }

  function buildAdjacency(mesh, n) {
    const adj = Array.from({ length: n }, () => []);
    const add = (a, b) => { if (adj[a].indexOf(b) < 0) adj[a].push(b); };
    for (const t of mesh.tris) {
      add(t[0], t[1]); add(t[1], t[0]);
      add(t[1], t[2]); add(t[2], t[1]);
      add(t[2], t[0]); add(t[0], t[2]);
    }
    return adj;
  }

  // In-place Laplacian smoothing of the dense weight rows.
  function smoothWeights(dense, n, NJ, adj, iters) {
    let buf = new Float32Array(dense.length);
    for (let it = 0; it < iters; it++) {
      for (let v = 0; v < n; v++) {
        const nb = adj[v], row = v * NJ;
        const k = nb.length;
        for (let j = 0; j < NJ; j++) {
          let s = dense[row + j];
          for (let m = 0; m < k; m++) s += dense[nb[m] * NJ + j];
          buf[row + j] = s / (k + 1);
        }
      }
      // re-normalize each row and copy back
      for (let v = 0; v < n; v++) {
        const row = v * NJ;
        let sum = 0;
        for (let j = 0; j < NJ; j++) sum += buf[row + j];
        if (sum > 0) for (let j = 0; j < NJ; j++) dense[row + j] = buf[row + j] / sum;
      }
    }
  }

  // part ids: 0 leg_r, 1 leg_l, 2 torso/core, 3 head, 4 arm_r, 5 arm_l
  const BASE_DEPTH = [1.0, 1.2, 2.0, 3.0, 4.0, 4.2];
  function partOf(name) {
    if (/^arm_r|^hand_r/.test(name)) return 4;
    if (/^arm_l|^hand_l/.test(name)) return 5;
    if (/^leg_r|^foot_r/.test(name)) return 0;
    if (/^leg_l|^foot_l/.test(name)) return 1;
    if (/^head|^neck/.test(name)) return 3;
    return 2;
  }

  const TAU = Math.PI * 2;
  const wrap = (a) => a - TAU * Math.round(a / TAU);

  // Deform via blended RIGID transforms (not blended positions). For each
  // vertex we blend the influencing bones' rotation ANGLE and their rest/anim
  // pivots, then apply one rigid transform. Unlike classic linear-blend
  // skinning — which averages already-rotated points and so collapses ("candy
  // wrapper") where two bones rotate apart — this keeps limbs rigid through a
  // bend, much closer to the as-rigid-as-possible look of the reference.
  function deform(mesh, skel, binding, out) {
    const J = skel.joints, verts = mesh.verts;
    const W = binding.weights, I = binding.indices, M = binding.max;
    for (let v = 0; v < verts.length; v++) {
      const rx = verts[v].x, ry = verts[v].y;
      const ref = I[v * M];
      if (ref < 0) { out[v * 2] = rx; out[v * 2 + 1] = ry; continue; }
      const refAng = J[ref].worldRot;
      let theta = 0, cx = 0, cy = 0, ax = 0, ay = 0, wsum = 0;
      for (let k = 0; k < M; k++) {
        const ji = I[v * M + k];
        if (ji < 0) continue;
        const w = W[v * M + k];
        if (w === 0) continue;
        const j = J[ji];
        theta += w * wrap(j.worldRot - refAng);   // blend angle near the dominant bone
        cx += w * j.x;  cy += w * j.y;             // blended rest pivot
        ax += w * j.animX; ay += w * j.animY;      // blended animated pivot
        wsum += w;
      }
      if (wsum > 0 && wsum !== 1) { theta /= wsum; cx /= wsum; cy /= wsum; ax /= wsum; ay /= wsum; }
      const ang = refAng + theta;
      const c = Math.cos(ang), s = Math.sin(ang);
      const lx = rx - cx, ly = ry - cy;
      out[v * 2] = ax + (lx * c - ly * s);
      out[v * 2 + 1] = ay + (lx * s + ly * c);
    }
  }

  window.Skinning = { bind, deform, MAX_INFLUENCES };
})();
