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
    const weights = new Float32Array(verts.length * MAX_INFLUENCES);
    const indices = new Int32Array(verts.length * MAX_INFLUENCES).fill(-1);

    // average bone length sets the falloff + locality scale
    let avgLen = 0;
    for (const b of bones) avgLen += Geo.dist(J[b.parent].x, J[b.parent].y, J[b.child].x, J[b.child].y);
    avgLen = Math.max(8, avgLen / Math.max(1, bones.length));
    const eps = avgLen * 0.14;
    const cap = avgLen * 0.7; // bones farther than (nearest + cap) are ignored

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
      const chosen = cand.filter((c) => c.d <= limit).sort((a, b) => a.d - b.d).slice(0, MAX_INFLUENCES);
      let sum = 0;
      for (const ch of chosen) { ch.w = 1 / ((ch.d + eps) * (ch.d + eps)); sum += ch.w; }
      for (let k = 0; k < chosen.length; k++) {
        weights[v * MAX_INFLUENCES + k] = chosen[k].w / sum;
        indices[v * MAX_INFLUENCES + k] = chosen[k].pivot;
      }
    }
    return { weights, indices, max: MAX_INFLUENCES };
  }

  function deform(mesh, skel, binding, out) {
    const J = skel.joints, verts = mesh.verts;
    const W = binding.weights, I = binding.indices, M = binding.max;
    for (let v = 0; v < verts.length; v++) {
      const rx = verts[v].x, ry = verts[v].y;
      let ox = 0, oy = 0;
      for (let k = 0; k < M; k++) {
        const ji = I[v * M + k];
        if (ji < 0) continue;
        const w = W[v * M + k];
        if (w === 0) continue;
        const j = J[ji];
        const c = Math.cos(j.worldRot), s = Math.sin(j.worldRot);
        const lx = rx - j.x, ly = ry - j.y;
        ox += w * (j.animX + (lx * c - ly * s));
        oy += w * (j.animY + (lx * s + ly * c));
      }
      out[v * 2] = ox;
      out[v * 2 + 1] = oy;
    }
  }

  window.Skinning = { bind, deform, MAX_INFLUENCES };
})();
