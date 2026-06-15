/* Sketch Magic — mobile-first kid flow:
   Snap → (auto cut-out + rig) → Color → Play (scenes, sound, record). */
(function () {
  const MAX_DIM = 640;
  const HIT_R = 16;
  const UNDO_MAX = 12;

  const $ = (id) => document.getElementById(id);
  const editor = $('editor'), ectx = editor.getContext('2d');
  const stage2d = $('stage2d'), sctx = stage2d.getContext('2d');
  const glCanvas = $('gl');
  const welcome = $('welcome'), busy = $('busy'), busyMsg = $('busyMsg'), toastEl = $('toast');
  const controls = $('controls'), restartBtn = $('restart');
  const fileInput = $('fileInput'), cameraInput = $('cameraInput');
  const dots = Array.from(document.querySelectorAll('.dot'));

  const S = {
    view: 'snap',
    image: null, imgW: 0, imgH: 0,
    work: null, wctx: null,        // working (colourable) drawing canvas
    poly: [], mask: null, skel: null, mesh: null, binding: null, dist: null,
    color: '#ff5a5f', tol: 70, segTol: 32,
    anim: 'dance', scene: 'park', speed: 1, playing: true, soundOn: true,
    adjustMode: 'outline', mirror: false,
    renderer: null, raf: 0,
    drag: null, hover: -1, undo: [],
  };

  // friendly joint names + left/right pairing (for mirror editing)
  const JOINT_LABEL = {
    root: 'Hips', torso: 'Tummy', neck: 'Neck', head: 'Head',
    arm_r_up: 'Right shoulder', arm_r_lo: 'Right elbow', hand_r: 'Right hand',
    arm_l_up: 'Left shoulder', arm_l_lo: 'Left elbow', hand_l: 'Left hand',
    leg_r_up: 'Right hip', leg_r_lo: 'Right knee', foot_r: 'Right foot',
    leg_l_up: 'Left hip', leg_l_lo: 'Left knee', foot_l: 'Left foot',
  };
  function pairOf(name) {
    if (name.indexOf('_r') >= 0) return name.replace('_r', '_l');
    if (name.indexOf('_l') >= 0) return name.replace('_l', '_r');
    return null;
  }

  /* ---------------- helpers ---------------- */
  function showBusy(msg) { busyMsg.textContent = msg || 'Working…'; busy.classList.remove('hidden'); }
  function hideBusy() { busy.classList.add('hidden'); }
  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.add('hidden'), 1800);
  }
  const fitSize = (w, h) => {
    const s = Math.min(1, MAX_DIM / Math.max(w, h));
    return { w: Math.max(2, Math.round(w * s)), h: Math.max(2, Math.round(h * s)) };
  };

  /* ---------------- load + auto-process ---------------- */
  function beginWithImage(img) {
    showBusy('Bringing it to life…');
    // let the spinner paint before heavy sync work
    setTimeout(() => {
      const { w, h } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
      S.image = img; S.imgW = w; S.imgH = h;
      editor.width = w; editor.height = h;
      stage2d.width = w; stage2d.height = h;
      glCanvas.width = w; glCanvas.height = h;

      S.work = document.createElement('canvas');
      S.work.width = w; S.work.height = h;
      S.wctx = S.work.getContext('2d', { willReadFrequently: true });
      S.wctx.drawImage(img, 0, 0, w, h);

      const data = S.wctx.getImageData(0, 0, w, h).data;
      const cut = Segmentation.cutout(data, w, h, S.segTol);
      if (cut) {
        S.poly = cut.poly;
        S.mask = cut.mask;
        S.skel = Skeleton.autoRig(cut.mask, w, h);
      } else {
        // Fall back to a box hugging the actual drawing (ink bounds).
        const b = Segmentation.contentBounds(data, w, h) ||
          { minX: w * 0.12, minY: h * 0.08, maxX: w * 0.88, maxY: h * 0.92 };
        S.poly = [
          { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
          { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY },
        ];
        S.mask = null;
        S.skel = Skeleton.build(Geo.polyBounds(S.poly));
        toast('Tap “Adjust” to fine-tune the outline');
      }
      S.undo = []; S.dist = null;
      welcome.classList.add('hidden');
      restartBtn.hidden = false;
      hideBusy();
      setView('play');   // straight to the magic — it's already animating
      toast('✨ Tap 🎨 to colour it!');
    }, 30);
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Please choose an image'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); beginWithImage(img); };
    img.onerror = () => { hideBusy(); toast('Could not load that image'); };
    img.src = url;
  }

  $('btnCamera').onclick = () => cameraInput.click();
  $('btnGallery').onclick = () => fileInput.click();
  $('btnSample').onclick = () => {
    const img = new Image();
    img.onload = () => beginWithImage(img);
    img.onerror = () => toast('Sample not found');
    img.src = 'assets/sample-character.svg';
  };
  fileInput.onchange = (e) => loadFile(e.target.files[0]);
  cameraInput.onchange = (e) => loadFile(e.target.files[0]);
  restartBtn.onclick = () => location.reload();

  /* ---------------- view switching ---------------- */
  function setView(view) {
    stopLoop();
    S.view = view;
    // Color & Adjust are optional tools that live "under" Play.
    const stepOf = view === 'snap' ? 'snap' : 'play';
    const order = ['snap', 'play'];
    dots.forEach((d) => {
      const i = order.indexOf(d.dataset.step), cur = order.indexOf(stepOf);
      d.classList.toggle('active', d.dataset.step === stepOf);
      d.classList.toggle('done', i < cur);
    });
    editor.classList.toggle('hidden', view === 'play');
    stage2d.classList.toggle('hidden', view !== 'play');

    if (view === 'play') startPlay();
    else renderEditor();
    buildControls();
  }

  /* ---------------- editor (color / adjust) ---------------- */
  function renderEditor() {
    if (S.view === 'play' || !S.image) return;
    ectx.clearRect(0, 0, editor.width, editor.height);
    if (S.view === 'adjust') {
      ectx.globalAlpha = 0.6; ectx.drawImage(S.work, 0, 0); ectx.globalAlpha = 1;
      if (S.adjustMode === 'outline') drawOutline();
      else { drawOutline(true); drawSkeleton(); }
    } else {
      ectx.drawImage(S.work, 0, 0);
    }
  }

  function drawOutline(faint) {
    const p = S.poly; if (!p.length) return;
    ectx.lineWidth = 2.5;
    ectx.strokeStyle = faint ? 'rgba(43,189,126,.4)' : '#2bbd7e';
    ectx.fillStyle = 'rgba(43,189,126,.12)';
    ectx.beginPath(); ectx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) ectx.lineTo(p[i].x, p[i].y);
    ectx.closePath(); ectx.fill(); ectx.stroke();
    if (faint) return;
    for (let i = 0; i < p.length; i++) {
      ectx.beginPath(); ectx.arc(p[i].x, p[i].y, i === S.hover ? 8 : 6, 0, 6.2832);
      ectx.fillStyle = i === 0 ? '#5b8cff' : (i === S.hover ? '#fff' : '#2bbd7e');
      ectx.fill(); ectx.lineWidth = 1.5; ectx.strokeStyle = '#fff'; ectx.stroke();
    }
  }
  // limb colour groups so it's obvious which joint is which
  function limbColor(name) {
    if (/^arm_r|^hand_r/.test(name)) return '#5b8cff'; // right arm — blue
    if (/^arm_l|^hand_l/.test(name)) return '#36c5f0'; // left arm — cyan
    if (/^leg_r|^foot_r/.test(name)) return '#2bbd7e'; // right leg — green
    if (/^leg_l|^foot_l/.test(name)) return '#ff5a9e'; // left leg — pink
    return '#ffb400';                                  // spine/head — amber
  }
  function drawSkeleton() {
    const J = S.skel.joints, bones = Skeleton.bones(S.skel);
    ectx.lineCap = 'round'; ectx.lineWidth = 5;
    for (const b of bones) {
      ectx.strokeStyle = limbColor(J[b.child].name);
      ectx.beginPath(); ectx.moveTo(J[b.parent].x, J[b.parent].y);
      ectx.lineTo(J[b.child].x, J[b.child].y); ectx.stroke();
    }
    for (let i = 0; i < J.length; i++) {
      const r = i === S.hover ? 11 : 8;
      ectx.beginPath(); ectx.arc(J[i].x, J[i].y, r, 0, 6.2832);
      ectx.fillStyle = i === S.hover ? '#fff' : limbColor(J[i].name);
      ectx.fill(); ectx.lineWidth = 3; ectx.strokeStyle = '#fff'; ectx.stroke();
    }
  }

  function evtPos(e) {
    const r = editor.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    const cy = (e.touches ? e.touches[0].clientY : e.clientY);
    return { x: (cx - r.left) * (editor.width / r.width), y: (cy - r.top) * (editor.height / r.height) };
  }
  function nearest(pos, arr, r) {
    let best = -1, bd = r * r;
    for (let i = 0; i < arr.length; i++) {
      const d = Geo.dist2(pos.x, pos.y, arr[i].x, arr[i].y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* ---- coloring ---- */
  function pushUndo() {
    S.undo.push(S.wctx.getImageData(0, 0, S.imgW, S.imgH));
    if (S.undo.length > UNDO_MAX) S.undo.shift();
  }
  function colorAt(pos) {
    if (!Geo.pointInPoly(pos.x, pos.y, S.poly)) { toast('Tap inside your drawing'); return; }
    pushUndo();
    const img = S.wctx.getImageData(0, 0, S.imgW, S.imgH);
    const changed = Paint.fill(img.data, S.imgW, S.imgH, pos.x | 0, pos.y | 0, S.color, S.tol);
    if (changed) { S.wctx.putImageData(img, 0, 0); renderEditor(); Sound.pop(); }
    else S.undo.pop();
  }
  function magicColor() {
    pushUndo();
    const img = S.wctx.getImageData(0, 0, S.imgW, S.imgH);
    Paint.autoColor(img.data, S.imgW, S.imgH, S.poly, Paint.PALETTE, S.tol);
    S.wctx.putImageData(img, 0, 0); renderEditor(); Sound.cheer(); toast('🪄 Magic colors!');
  }
  function eraseAt(pos) {
    pushUndo();
    const img = S.wctx.getImageData(0, 0, S.imgW, S.imgH);
    if (Paint.fill(img.data, S.imgW, S.imgH, pos.x | 0, pos.y | 0, '#ffffff', S.tol)) {
      S.wctx.putImageData(img, 0, 0); renderEditor();
    } else S.undo.pop();
  }
  function undo() {
    if (!S.undo.length) { toast('Nothing to undo'); return; }
    S.wctx.putImageData(S.undo.pop(), 0, 0); renderEditor();
  }

  /* ---- pointer handling on editor ---- */
  function onDown(e) {
    e.preventDefault();
    const pos = evtPos(e);
    if (S.view === 'color') {
      if (S.tool === 'erase') eraseAt(pos); else colorAt(pos);
    } else if (S.view === 'adjust') {
      if (S.adjustMode === 'outline') {
        const hit = nearest(pos, S.poly, HIT_R);
        if (hit >= 0) S.drag = { kind: 'poly', i: hit };
        else { S.poly.push({ x: pos.x, y: pos.y }); S.drag = { kind: 'poly', i: S.poly.length - 1 }; }
        S.dist = null;
        renderEditor();
      } else {
        const hit = nearest(pos, S.skel.joints, HIT_R + 4);
        if (hit >= 0) {
          S.drag = { kind: 'joint', i: hit };
          toast(JOINT_LABEL[S.skel.joints[hit].name] || S.skel.joints[hit].name);
        }
      }
    }
  }
  function onMove(e) {
    if (!S.drag) return;
    e.preventDefault();
    const pos = evtPos(e);
    if (S.drag.kind === 'poly') {
      S.poly[S.drag.i].x = Geo.clamp(pos.x, 0, S.imgW);
      S.poly[S.drag.i].y = Geo.clamp(pos.y, 0, S.imgH);
      S.dist = null; // outline changed → centerline field is stale
    } else {
      // snap the joint to the limb centerline (magnet)
      const D = ensureDist();
      const mm = Math.min(S.imgW, S.imgH) * 0.045;
      const j = S.skel.joints[S.drag.i];
      const s = Skeleton.snapToCenter(
        Geo.clamp(pos.x, 0, S.imgW), Geo.clamp(pos.y, 0, S.imgH), D, S.imgW, S.imgH, mm);
      j.x = s.x; j.y = s.y;
      // mirror the move to the opposite limb across the body centerline
      if (S.mirror) {
        const pn = pairOf(j.name), pj = pn && S.skel.byName[pn];
        if (pj) {
          const axis = S.skel.byName.root.x;
          const m = Skeleton.snapToCenter(2 * axis - s.x, s.y, D, S.imgW, S.imgH, mm);
          pj.x = m.x; pj.y = m.y;
        }
      }
    }
    renderEditor();
  }
  function onUp() { S.drag = null; }

  editor.addEventListener('pointerdown', onDown);
  editor.addEventListener('pointermove', onMove);
  editor.addEventListener('pointerup', onUp);
  editor.addEventListener('pointercancel', onUp);
  editor.addEventListener('dblclick', (e) => {
    if (S.view === 'adjust' && S.adjustMode === 'outline') {
      const hit = nearest(evtPos(e), S.poly, HIT_R);
      if (hit >= 0 && S.poly.length > 3) { S.poly.splice(hit, 1); S.dist = null; renderEditor(); }
    }
  });

  /* ---------------- play loop ---------------- */
  function buildRig() { S.mesh = Mesh.build(S.poly); S.binding = Skinning.bind(S.mesh, S.skel); }

  function startPlay() {
    if (!S.renderer) S.renderer = Renderer.create(glCanvas);
    buildRig();
    S.renderer.resize(S.imgW, S.imgH);
    S.renderer.setStage(0.78, S.imgW * 0.11, S.imgH * 0.14);
    S.renderer.setMesh(S.mesh, S.work, S.imgW, S.imgH);
    Sound.unlock();
    if (S.soundOn) { Sound.whoosh(); Sound.startMusic(); }
    runLoop();
  }

  function runLoop() {
    const positions = new Float32Array(S.mesh.verts.length * 2);
    const localRot = new Float32Array(S.skel.joints.length);
    const bounds = Geo.polyBounds(S.poly);
    let last = performance.now(), clock = 0;
    const W = S.imgW, H = S.imgH;

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (S.playing) clock += dt * S.speed;

      const { rot, root } = Animations.sample(S.anim, clock, bounds.h);
      localRot.fill(0);
      for (const n in rot) { const j = S.skel.byName[n]; if (j) localRot[j.index] = rot[n]; }
      Skeleton.solveFK(S.skel, localRot, root);
      Skinning.deform(S.mesh, S.skel, S.binding, positions);
      S.renderer.draw(positions);

      // composite: scene → shadow → character
      sctx.clearRect(0, 0, W, H);
      Scenes.draw(S.scene, sctx, W, H, clock);
      const cx = W * 0.5, sy = H * 0.93 + (root.y || 0) * 0.4;
      const sw = bounds.w * 0.42 * (1 - Math.min(0.5, -(root.y || 0) / H));
      sctx.fillStyle = 'rgba(20,30,60,.18)';
      sctx.beginPath(); sctx.ellipse(cx, sy, Math.max(20, sw), 12, 0, 0, 6.2832); sctx.fill();
      sctx.drawImage(glCanvas, 0, 0);

      S.raf = requestAnimationFrame(frame);
    };
    S.raf = requestAnimationFrame(frame);
  }
  function stopLoop() { if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; }

  /* ---------------- recording ---------------- */
  let recording = false;
  async function toggleRecord(btn) {
    if (!Recorder.supported()) { toast('Recording not supported here'); return; }
    if (!recording) {
      try { Recorder.start(stage2d, 30); recording = true; btn.textContent = '⏹ Stop & save'; btn.classList.add('rec'); toast('● Recording…'); }
      catch (e) { toast('Could not start recording'); }
    } else {
      recording = false; btn.textContent = '⏺ Record'; btn.classList.remove('rec');
      showBusy('Saving your clip…');
      const blob = await Recorder.stop();
      hideBusy();
      if (blob) { const r = await Recorder.saveOrShare(blob, 'sketch-magic'); toast(r === 'shared' ? 'Shared! 🎉' : 'Saved! 🎉'); }
    }
  }

  // Capture ~2.4s of the live stage and encode an animated GIF.
  let gifBusy = false;
  async function captureGif() {
    if (gifBusy) return;
    if (!S.raf) { toast('Tap ▶ to play first'); return; }
    gifBusy = true;
    const wasPlaying = S.playing; S.playing = true;
    showBusy('Making your GIF… 🎁');
    const scale = Math.min(1, 320 / Math.max(S.imgW, S.imgH));
    const gw = Math.max(2, Math.round(S.imgW * scale));
    const gh = Math.max(2, Math.round(S.imgH * scale));
    const tmp = document.createElement('canvas');
    tmp.width = gw; tmp.height = gh;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    const frames = [];
    const FRAMES = 28, INTERVAL = 80;
    await new Promise((resolve) => {
      let c = 0;
      const grab = () => {
        tctx.drawImage(stage2d, 0, 0, gw, gh);
        frames.push(tctx.getImageData(0, 0, gw, gh).data);
        if (++c >= FRAMES) resolve(); else setTimeout(grab, INTERVAL);
      };
      setTimeout(grab, INTERVAL);
    });
    await new Promise((r) => setTimeout(r, 20)); // let spinner paint
    let blob = null;
    try {
      const bytes = Gif.encode(frames, { width: gw, height: gh, delay: Math.round(INTERVAL / 10), repeat: 0 });
      blob = new Blob([bytes], { type: 'image/gif' });
    } catch (e) { toast('GIF failed'); }
    S.playing = wasPlaying; gifBusy = false; hideBusy();
    if (blob) { const r = await Recorder.saveOrShare(blob, 'sketch-magic'); toast(r === 'shared' ? 'Shared! 🎉' : 'GIF saved! 🎉'); }
  }

  /* ---------------- controls per view ---------------- */
  function buildControls() {
    if (S.view === 'color') controlsColor();
    else if (S.view === 'adjust') controlsAdjust();
    else if (S.view === 'play') controlsPlay();
    else controls.innerHTML = '';
  }

  function controlsColor() {
    S.tool = S.tool || 'fill';
    const sw = Paint.PALETTE.map((c) =>
      `<div class="swatch ${c === S.color ? 'sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
    controls.innerHTML = `
      <div class="ctl-title">Tap a color, then tap your drawing 🎨</div>
      <div class="swatches">${sw}</div>
      <div class="spacer"></div>
      <div class="row">
        <button class="btn pink" id="magic">🪄 Magic color</button>
        <button class="btn small ${S.tool === 'erase' ? 'primary' : ''}" id="erase">🧽</button>
        <button class="btn small" id="undo">↩️</button>
      </div>
      <div class="spacer"></div>
      <div class="row">
        <button class="btn ghost small" id="adjust">✏️ Fix-up</button>
        <button class="btn primary" id="toplay">▶ Watch it move!</button>
      </div>`;
    controls.querySelectorAll('.swatch').forEach((s) => s.onclick = () => {
      S.color = s.dataset.c; S.tool = 'fill'; buildControls();
    });
    $('magic').onclick = magicColor;
    $('erase').onclick = () => { S.tool = S.tool === 'erase' ? 'fill' : 'erase'; buildControls(); toast(S.tool === 'erase' ? 'Eraser on' : 'Fill on'); };
    $('undo').onclick = undo;
    $('adjust').onclick = () => setView('adjust');
    $('toplay').onclick = () => setView('play');
  }

  // Rasterize the current polygon to a filled mask (so auto-rig matches an
  // outline that may have been hand-edited).
  function polyMask() {
    const w = S.imgW, h = S.imgH, m = new Uint8Array(w * h);
    const b = Geo.polyBounds(S.poly);
    const x0 = Math.max(0, b.minX | 0), x1 = Math.min(w - 1, Math.ceil(b.maxX));
    const y0 = Math.max(0, b.minY | 0), y1 = Math.min(h - 1, Math.ceil(b.maxY));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (Geo.pointInPoly(x + 0.5, y + 0.5, S.poly)) m[y * w + x] = 1;
    return m;
  }

  function ensureDist() {
    if (!S.dist) S.dist = Skeleton.distanceTransform(polyMask(), S.imgW, S.imgH);
    return S.dist;
  }

  function reDetect() {
    // run the improved cut-out on the original photo (not the painted copy)
    const off = document.createElement('canvas');
    off.width = S.imgW; off.height = S.imgH;
    const octx = off.getContext('2d');
    octx.drawImage(S.image, 0, 0, S.imgW, S.imgH);
    const data = octx.getImageData(0, 0, S.imgW, S.imgH).data;
    const cut = Segmentation.cutout(data, S.imgW, S.imgH, S.segTol);
    if (cut) {
      S.poly = cut.poly;
      S.mask = cut.mask;
      S.dist = null;
      S.skel = Skeleton.autoRig(cut.mask, S.imgW, S.imgH);
      renderEditor();
      toast(`Outline: ${cut.poly.length} points`);
    } else {
      toast('Couldn’t detect — adjust sensitivity or trace by hand');
    }
  }

  function controlsAdjust() {
    const outlineMode = S.adjustMode === 'outline';
    controls.innerHTML = `
      <div class="ctl-title">Fine-tune ✏️</div>
      <p class="ctl-hint">Outline: tap to add, drag to move, double-tap to remove. Skeleton: drag the coloured joints — they snap to the middle of each limb. 🔵 right arm · 🩵 left arm · 🟢 right leg · 🩷 left leg · 🟡 spine.</p>
      <div class="row">
        <button class="chip ${outlineMode ? 'sel' : ''}" data-m="outline">Outline</button>
        <button class="chip ${!outlineMode ? 'sel' : ''}" data-m="skeleton">Skeleton</button>
        <button class="btn small ghost" id="reset">Reset rig</button>
      </div>
      ${outlineMode ? `
      <div class="spacer"></div>
      <div class="ctl-title" style="font-size:13px">Auto cut-out sensitivity</div>
      <div class="row">
        <input type="range" id="sens" min="14" max="80" value="${S.segTol}" style="flex:1" />
        <button class="btn small primary" id="redetect">🔍 Detect</button>
      </div>` : `
      <div class="spacer"></div>
      <div class="row">
        <button class="chip ${S.mirror ? 'sel' : ''}" id="mirror">🪞 Mirror ${S.mirror ? 'on' : 'off'}</button>
        <span class="ctl-hint" style="align-self:center">Tap a joint to see its name</span>
      </div>`}
      <div class="spacer"></div>
      <button class="btn primary" id="done">Done ✓</button>`;
    controls.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
      S.adjustMode = b.dataset.m; renderEditor(); buildControls();
    });
    $('reset').onclick = () => {
      S.skel = Skeleton.autoRig(polyMask(), S.imgW, S.imgH);
      renderEditor();
      toast('Skeleton re-fitted');
    };
    if (outlineMode) {
      $('sens').oninput = (e) => { S.segTol = +e.target.value; };
      $('redetect').onclick = reDetect;
    } else {
      $('mirror').onclick = () => { S.mirror = !S.mirror; buildControls(); toast(S.mirror ? '🪞 Mirror on' : 'Mirror off'); };
    }
    $('done').onclick = () => setView('play');
  }

  function controlsPlay() {
    const anims = Animations.list.map((a) =>
      `<button class="chip big ${a.id === S.anim ? 'sel' : ''}" data-anim="${a.id}">${a.name}</button>`).join('');
    const scenes = Scenes.list.map((s) =>
      `<button class="chip ${s.id === S.scene ? 'sel' : ''}" data-scene="${s.id}">${s.emoji} ${s.name}</button>`).join('');
    controls.innerHTML = `
      <div class="ctl-title">Move 🕺</div>
      <div class="row scroll">${anims}</div>
      <div class="spacer"></div>
      <div class="ctl-title">Scene 🌈</div>
      <div class="row scroll">${scenes}</div>
      <div class="spacer"></div>
      <div class="row">
        <button class="btn pink" id="recolor" style="flex:2">🎨 Colour it!</button>
        <button class="btn" id="surprise">🎲 Surprise</button>
        <button class="btn small" id="play">${S.playing ? '⏸' : '▶'}</button>
        <button class="btn small" id="sound">${S.soundOn ? '🔊' : '🔇'}</button>
      </div>
      <div class="spacer"></div>
      <div class="ctl-title">Save & share 💾</div>
      <div class="row">
        <button class="btn rec" id="rec" style="flex:1">⏺ Video</button>
        <button class="btn primary" id="gif" style="flex:1">🎁 GIF</button>
      </div>
      <div class="spacer"></div>
      <div class="row">
        <button class="btn ghost small" id="adjust">✏️ Fix-up</button>
        <button class="btn ghost small" id="new">🔄 New drawing</button>
      </div>`;
    controls.querySelectorAll('[data-anim]').forEach((b) => b.onclick = () => {
      S.anim = b.dataset.anim; markSel(b, '[data-anim]'); Sound.pop();
    });
    controls.querySelectorAll('[data-scene]').forEach((b) => b.onclick = () => {
      S.scene = b.dataset.scene; markSel(b, '[data-scene]');
    });
    $('surprise').onclick = () => {
      const a = Animations.list[(Math.random() * Animations.list.length) | 0];
      const sc = Scenes.list[(Math.random() * Scenes.list.length) | 0];
      S.anim = a.id; S.scene = sc.id; S.playing = true;
      Sound.cheer(); buildControls(); toast('🎲 ' + a.name.replace(/^\S+\s/, '') + ' + ' + sc.name);
    };
    $('play').onclick = (e) => { S.playing = !S.playing; e.target.textContent = S.playing ? '⏸' : '▶'; };
    $('sound').onclick = (e) => {
      S.soundOn = !S.soundOn; Sound.setEnabled(S.soundOn);
      if (S.soundOn) Sound.startMusic();
      e.target.textContent = S.soundOn ? '🔊' : '🔇';
    };
    $('rec').onclick = (e) => toggleRecord(e.currentTarget);
    $('gif').onclick = captureGif;
    $('adjust').onclick = () => setView('adjust');
    $('recolor').onclick = () => setView('color');
    $('new').onclick = () => location.reload();
  }
  function markSel(btn, sel) {
    controls.querySelectorAll(sel).forEach((x) => x.classList.remove('sel'));
    btn.classList.add('sel');
  }

  /* ---------------- boot ---------------- */
  setView('snap');
})();
