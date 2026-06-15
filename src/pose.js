/* AI pose estimation (MoveNet via TensorFlow.js). Loaded lazily from a CDN.
   Maps the 17 COCO keypoints to our 16-joint skeleton and only returns joints
   it is confident about — and null entirely if the core torso isn't found or
   the model can't load (offline). The caller falls back to medial-axis /
   silhouette rigging. window.Pose.

   For a fully-offline deployment, vendor these two scripts + the MoveNet model
   locally and point TFJS_URL / POSE_URL at them. */
(function () {
  const Pose = {};
  const TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const POSE_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js';

  let detector = null, failed = false, loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('load ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureDetector() {
    if (detector) return Promise.resolve(detector);
    if (failed) return Promise.resolve(null);
    if (loading) return loading;
    loading = (async () => {
      try {
        if (!window.tf) await loadScript(TFJS_URL);
        if (!window.poseDetection) await loadScript(POSE_URL);
        detector = await window.poseDetection.createDetector(
          window.poseDetection.SupportedModels.MoveNet,
          { modelType: 'SinglePose.Lightning' });
        return detector;
      } catch (e) {
        failed = true;
        return null;
      }
    })();
    return loading;
  }

  const timeout = (ms) => new Promise((r) => setTimeout(() => r('__timeout__'), ms));

  // canvas: the drawing rendered opaque (white bg). Returns a partial
  // name→{x,y} map in canvas pixel coords, or null.
  Pose.estimate = async function (canvas, ms) {
    const det = await Promise.race([ensureDetector(), timeout(ms || 8000)]);
    if (!det || det === '__timeout__') return null;
    let poses;
    try {
      poses = await Promise.race([
        det.estimatePoses(canvas, { maxPoses: 1, flipHorizontal: false }),
        timeout(ms || 8000),
      ]);
    } catch (e) { return null; }
    if (!poses || poses === '__timeout__' || !poses.length) return null;

    const kp = poses[0].keypoints;
    const get = (i, min) => {
      const k = kp[i];
      return k && k.score >= (min == null ? 0.3 : min) ? { x: k.x, y: k.y } : null;
    };
    const mid = (a, b) => (a && b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;

    const lsh = get(5), rsh = get(6), lhip = get(11), rhip = get(12);
    if (!(lsh && rsh && lhip && rhip)) return null; // untrustworthy detection

    const pos = {};
    const set = (n, p) => { if (p) pos[n] = p; };
    set('head', get(0, 0.2));
    set('neck', mid(lsh, rsh));
    set('arm_r_up', rsh); set('arm_r_lo', get(8)); set('hand_r', get(10));
    set('arm_l_up', lsh); set('arm_l_lo', get(7)); set('hand_l', get(9));
    set('leg_r_up', rhip); set('leg_r_lo', get(14)); set('foot_r', get(16));
    set('leg_l_up', lhip); set('leg_l_lo', get(13)); set('foot_l', get(15));
    const root = mid(lhip, rhip);
    set('root', root);
    set('torso', mid(mid(lsh, rsh), root));
    return pos;
  };

  Pose.preload = () => { ensureDetector(); };

  window.Pose = Pose;
})();
