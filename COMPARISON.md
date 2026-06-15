# Sketch Magic vs. Meta "Animated Drawings" — gap analysis & roadmap

Reference: *A Method for Animating Children's Drawings of the Human Figure*
(Smith et al., ACM TOG 2023) — the system behind sketch.metademolab.com.
Sources at the bottom.

## Stage-by-stage comparison

| Stage | Meta Animated Drawings | Sketch Magic (ours) | Gap |
|---|---|---|---|
| **Detect figure** | Trained detector (Mask R-CNN) finds a bounding box | We assume one figure fills the page | Small for single-character demos |
| **Segment (mask)** | Classical CV (threshold + morphology + flood-fill + largest contour), user-correctable | "Ink-blob": paper-detect → ink threshold → dilate/fill/erode, + flood fallback, user-correctable | **≈ parity** |
| **Pose / rig** | **Learned** keypoint net (ResNet-50 + heatmaps) trained on 178k drawings | **Hybrid**: AI pose (MoveNet) → medial-axis tracing → silhouette extremes, merged + centerline-snapped | Meta's net is drawing-trained; MoveNet is photo-trained → we lean on fallbacks for abstract art |
| **Deform** | **ARAP** (as-rigid-as-possible) mesh, joints as handles | **2D ARAP** (joints as handles, local/global Gauss–Seidel, warm-started) — default; transform-blend skinning is a fallback | **≈ parity** — folding ≈ 0 |
| **Layering** | Per-limb z-ordering | Per-part depth + z-buffer + dynamic per-motion swing | **≈ parity (simpler)** |
| **Motion** | Retargeted **mocap (BVH)** clips | Procedural joint oscillations (6 motions) | Mocap is more lifelike |

## What was implemented to close the gap

- **2D ARAP deformation** (`arap.js`) — the reference's core technique. Joints
  are positional handles; the mesh deforms as-rigidly-as-possible via a
  local/global solve (closed-form 2D rotations + Gauss–Seidel), warm-started
  from the previous frame. Measured: **folded-triangle fraction ≈ 0.002–0.028**
  vs 0.047 for skinning, at **0.23 ms/frame**. Toggle under Fix-up → Skeleton →
  ✨ Smooth; linear/transform-blend skinning remains the fallback.
- **Transform-blend skinning** (`skinning.js`): blends rigid bone transforms
  then applies once (no "candy-wrapper" collapse) — the fallback path.
- **Laplacian weight smoothing** (`skinning.js`): –50% folding on the skinning
  path; guarded by the test suite.
- **AI-joint validation** (`app.js`): a stray MoveNet keypoint far outside the
  silhouette is dropped; the base rig fills it.
- **Dynamic layering** extended to wave / jump / wiggle.

## Roadmap — remaining gaps (priority order)

> **2D ARAP is now implemented** (see above) — the biggest deformation gap is
> closed. The remaining items below are what still separates us from the
> reference.

1. **Mocap (BVH) motion** *(high realism, medium effort, needs clips)*. Parse a
   few CC0 BVH walk/dance/jump clips, project the 3D skeleton to 2D, retarget
   onto our joint hierarchy. Decision needed: which clips / licensing. Keep
   procedural motions as the offline default.

3. **Drawing-tuned pose** *(robustness on abstract art, medium effort)*. Two
   options: (a) preprocess the image before MoveNet (normalize size/contrast,
   composite on neutral bg) to lift detection on stylised figures; (b) longer
   term, fine-tune / ship a small pose model trained on drawings (this is
   exactly Meta's edge — they built a 178k-drawing dataset; we can't fully
   match without similar data).

4. **Adaptive mesh** *(quality, low effort)*. Add extra triangulation density
   around joints (more bend resolution) and along the silhouette; cheap and
   reduces residual folding further.

5. **Medial-axis robustness** *(reliability, low-med effort)*. Better handle
   props (crown/cape/sword) by classifying spurs, and recover limbs that merge
   with the torso (the one place ours under-detects today).

6. **Figure detection / crop** *(edge cases, low effort)*. Auto-crop to the
   character so busy photos (multiple sketches, big margins) work without
   manual help.

## Honest summary

**Masking, layering, and now deformation (ARAP) are at parity** with the
reference. The only remaining substantive gap is **motion realism** — Meta
retargets real mocap; we use procedural motion. Closing that fully needs
licensed BVH clips (item 1, your call on assets). The *other* gap — **learned
drawing-specific pose** — is fundamentally a data problem (their 178k-drawing
dataset); our AI + medial-axis + extremes hybrid is a strong offline
substitute. Items 2 (drawing-tuned pose preprocessing) and 4 (adaptive mesh)
are cheap offline polish.

## Sources
- [A Method for Animating Children's Drawings of the Human Figure (ACM TOG 2023)](https://dl.acm.org/doi/10.1145/3592788)
- [arXiv preprint 2303.12741](https://arxiv.org/pdf/2303.12741)
- [facebookresearch/AnimatedDrawings (code + weights)](https://github.com/facebookresearch/AnimatedDrawings)
