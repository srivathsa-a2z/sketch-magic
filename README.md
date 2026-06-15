# ✨ Sketch Magic

Turn a child's hand-drawn character into a playful, moving, **colorable**
animation — right from a phone. A mobile-first, fully-offline experience built
for **CMCA** to gamify kids' drawing. Inspired by Meta's *Animated Drawings*
(sketch.metademolab.com), but with no build step, no server, and no ML
downloads.

## The kid flow (two taps to magic)

1. **Snap** 📷 — take a photo of the drawing (or pick from the gallery / try
   the example). It's auto-cut-out, auto-rigged, and **starts dancing right
   away** — no setup.
2. **Play** ✨ — pick a **motion** (idle / wave / walk / jump / dance / wiggle)
   and an animated **scene**, hit **🎲 Surprise** for a random combo, toggle
   **sound & music**, and **save as 🎁 GIF or ⏺ video** to share.

Optional fun, one tap away:
- **🎨 Colour it!** — tap a bright colour then tap a region to fill, or
  **🪄 Magic colour** to auto-colourize the whole drawing (eraser + undo too).
- **✏️ Fix-up** — refine the outline (with a re-detect sensitivity slider) or
  the skeleton. Joints are **colour-coded** and snap to the limb centre;
  **🪞 Mirror** moves both sides together, and **tapping a joint shows its
  name** ("Right elbow").

## Run it

- **Quick (local):** open **`index.html`** in any modern browser.
- **Hosted link for a demo (recommended):** the whole app is static files, so
  drag this folder onto **https://app.netlify.com/drop** — you get an instant
  HTTPS link in ~10 seconds, no account or build needed. HTTPS makes the phone
  **camera** and **share sheet** work everywhere. (GitHub Pages / Vercel work
  too if you prefer.)
- **On the same Wi-Fi (no internet):** `npx serve -l 5173 .` then open
  `http://<your-computer-ip>:5173` on the phone. Camera capture works over
  plain HTTP; the native *share* sheet may need HTTPS (it falls back to a
  download).

A ready-made test drawing lives at `assets/sample-character.svg`.

## How it works

| Stage | Technique |
|-------|-----------|
| Cut-out | **"ink-blob"**: detect the paper (largest bright region, so a desk / spiral binding / shadows are ignored) → find dark ink inside it → dilate + fill + erode the strokes into a solid silhouette. Works for open **stick figures** and filled drawings alike; falls back to background flood for solid-colour art on a plain background. |
| Rig | **hybrid pipeline**, best result wins: (1) **AI pose** — MoveNet (TensorFlow.js) predicts joints, like Meta's learned approach; (2) **medial-axis skeleton tracing** — Zhang–Suen thinning + crossing-number branch analysis finds real limbs & bends; (3) **silhouette extremes** as the base. Results merge over the base, then a **distance-transform "centerline magnet"** snaps every joint onto its limb. Color-coded; 16-joint humanoid + FK |
| Color | scanline bucket fill; auto-color sweeps light regions inside the silhouette |
| Mesh | Bowyer–Watson Delaunay over boundary + interior points |
| Deform | **2D ARAP** (as-rigid-as-possible) — joints are positional handles, mesh solved local/global (Gauss–Seidel, warm-started) so limbs stay rigid through bends with ≈ 0 folding, like the reference. Locality-capped + Laplacian-smoothed **skinning** is the fallback (toggle under Fix-up → ✨ Smooth) |
| Motion | 6 **pose-agnostic** procedural motions (idle / wave / walk / jump / dance / wiggle) — relative joint swings around the drawing's rest pose, so they read naturally whatever the pose |
| Render | WebGL textured mesh with **limb layering** (per-vertex depth + z-buffer) so arms/legs pass in front of/behind the body; composited over a procedural 2D scene |
| Scenes / sound | procedurally drawn backdrops; Web Audio synthesized SFX + music |
| Share | `MediaRecorder` → video and a built-in GIF encoder, via the share sheet |

## Source layout

| File | Responsibility |
|------|----------------|
| `src/util.js` | geometry / math helpers |
| `src/segmentation.js` | background removal + silhouette tracing |
| `src/skeleton.js` | humanoid template + forward kinematics |
| `src/medial.js` | medial-axis skeleton tracing (rig fallback) |
| `src/pose.js` | AI pose estimation (MoveNet / TF.js) |
| `src/mesh.js` | Delaunay triangulation of the silhouette |
| `src/skinning.js` | vertex→bone binding + transform-blend skinning (fallback) |
| `src/arap.js` | 2D as-rigid-as-possible mesh deformation (default) |
| `src/animations.js` | procedural joint-angle motions |
| `src/paint.js` | bucket fill + auto-colorize |
| `src/scenes.js` | procedural animated backgrounds |
| `src/audio.js` | synthesized sound effects + music |
| `src/recorder.js` | record-to-video + share/download |
| `src/renderer.js` | WebGL textured-mesh renderer |
| `src/app.js` | step flow, touch interaction, animation loop |

## Tests

`node test/smoke.js` exercises the non-DOM modules end-to-end: cut-out,
medial-axis rigging, mesh, skinning, **ARAP** (folding ≈ 0), FK, all
animations, auto-outline, bucket fill, auto-color — plus regression guards on
deformation folding.

See [COMPARISON.md](COMPARISON.md) for a stage-by-stage comparison with Meta's
Animated Drawings and the remaining roadmap.

## Optional next step: cloud AI

Coloring and backgrounds run **on-device** today (instant, offline,
demo-proof). For *generative* coloring or AI-invented backgrounds, add a small
backend with an image-generation API and call it from an "AI Magic" button —
the architecture already isolates coloring (`paint.js`) and backgrounds
(`scenes.js`) so this drops in cleanly when hosting is decided.

## AI pose rigging (online vs offline)

The AI rig (MoveNet) loads from a CDN on first use and needs internet **once**
(it's cached after). If it can't load, or it isn't confident about the figure,
the app silently falls back to medial-axis skeleton tracing, then silhouette
extremes — so rigging always works offline, just less precisely. The model is
warmed up during the welcome screen so the first snap is fast. Toggle it under
**Fix-up → Skeleton → 🤖 AI**. For a *fully* offline deployment, vendor the
TF.js + MoveNet files locally and point `TFJS_URL` / `POSE_URL` in
`src/pose.js` at them.

## Known limits

- Auto cut-out assumes a light, fairly even background (a drawing on white
  paper). Busy backgrounds need a quick **Adjust**.
- Auto-rig uses a standard humanoid template; very non-standard poses benefit
  from a few seconds in **Adjust → Skeleton**.
- Recording uses WebM (`MediaRecorder`); great on Android Chrome, more limited
  on iOS Safari — falls back to download where share isn't available.
