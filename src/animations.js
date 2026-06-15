/* Procedural motions. Each returns per-joint *relative* rotations (radians,
   added on top of the drawing's rest pose) plus a global root offset in px.
   Because they're perturbations around the rest pose, they read naturally no
   matter how the character was drawn — arms down, out, or leaning.
   Image space is y-down, so a positive angle rotates clockwise on screen.
   window.Animations. */
(function () {
  const PI = Math.PI;
  const list = [
    { id: 'idle',   name: '🧍 Idle' },
    { id: 'wave',   name: '👋 Wave' },
    { id: 'walk',   name: '🚶 Walk' },
    { id: 'jump',   name: '⭐ Jump' },
    { id: 'dance',  name: '🕺 Dance' },
    { id: 'wiggle', name: '🪼 Wiggle' },
  ];

  // t: seconds. scale: character height in px (for translation amplitudes).
  function sample(id, t, scale) {
    const rot = {};
    const root = { x: 0, y: 0 };
    let depth = null; // optional per-limb depth swing (front/back) for layering

    switch (id) {
      case 'idle': {
        const s = Math.sin(t * 1.8);
        rot.torso = 0.025 * s;
        rot.neck = 0.02 * s;
        rot.head = 0.03 * Math.sin(t * 1.8 + 0.6);
        rot.arm_r_up = 0.05 * s; rot.arm_l_up = -0.05 * s;
        rot.arm_r_lo = 0.07 * Math.sin(t * 1.8 + 0.4);
        rot.arm_l_lo = -0.07 * Math.sin(t * 1.8 + 0.4);
        root.y = 0.01 * scale * s;
        break;
      }
      case 'wave': {
        const f = Math.sin(t * 9);
        rot.arm_r_up = -0.35 + 0.08 * f;     // lift the arm a touch
        rot.arm_r_lo = -0.5 + 0.7 * f;        // big forearm wave
        rot.hand_r = 0.4 * f;
        rot.arm_l_up = 0.06 * Math.sin(t * 2);
        rot.torso = 0.02 * Math.sin(t * 2);
        rot.head = 0.05 * Math.sin(t * 2 + 1);
        depth = { arm_r: 0.9 };           // waving arm in front
        break;
      }
      case 'walk': {
        const w = t * 5.5;
        rot.leg_r_up = 0.45 * Math.sin(w);
        rot.leg_l_up = 0.45 * Math.sin(w + PI);
        rot.leg_r_lo = Math.max(0, -0.7 * Math.cos(w));
        rot.leg_l_lo = Math.max(0, -0.7 * Math.cos(w + PI));
        rot.arm_r_up = 0.35 * Math.sin(w + PI);
        rot.arm_l_up = 0.35 * Math.sin(w);
        rot.arm_r_lo = 0.15 + 0.1 * Math.sin(w + PI);
        rot.arm_l_lo = -0.15 + 0.1 * Math.sin(w);
        rot.torso = 0.04 * Math.sin(w * 2);
        rot.head = 0.03 * Math.sin(w * 2);
        root.y = -Math.abs(Math.sin(w)) * 0.025 * scale;
        // the forward-swinging arm/leg comes in front of the body
        depth = {
          leg_r: 0.5 * Math.sin(w), leg_l: 0.5 * Math.sin(w + PI),
          arm_r: 0.6 * Math.sin(w + PI), arm_l: 0.6 * Math.sin(w),
        };
        break;
      }
      case 'jump': {
        const p = (t % 1.3) / 1.3;
        const ph = Math.sin(p * PI);          // 0 (ground) → 1 (apex) → 0
        const ground = 1 - ph;
        rot.leg_r_lo = ground * 0.9; rot.leg_l_lo = ground * 0.9;
        rot.leg_r_up = -ground * 0.45; rot.leg_l_up = -ground * 0.45;
        rot.arm_r_up = -ph * 0.8; rot.arm_l_up = ph * 0.8;
        rot.arm_r_lo = -ph * 0.3; rot.arm_l_lo = ph * 0.3;
        rot.torso = -ph * 0.08;
        root.y = -ph * 0.32 * scale;
        depth = { arm_r: 0.6 * ph, arm_l: 0.6 * ph };
        break;
      }
      case 'dance': {
        const a = Math.sin(t * 3), b = Math.cos(t * 3), c = Math.sin(t * 1.5);
        rot.torso = 0.14 * a; rot.neck = 0.06 * a; rot.head = 0.1 * b;
        rot.arm_r_up = -0.2 - 0.5 * b; rot.arm_l_up = 0.2 + 0.5 * b;
        rot.arm_r_lo = -0.4 + 0.4 * a; rot.arm_l_lo = 0.4 - 0.4 * a;
        rot.hand_r = 0.3 * a; rot.hand_l = -0.3 * a;
        rot.leg_r_up = 0.12 * c; rot.leg_l_up = -0.12 * c;
        root.x = 0.04 * scale * a;
        root.y = -Math.abs(a) * 0.03 * scale;
        depth = { arm_r: 0.6 * b, arm_l: -0.6 * b };
        break;
      }
      case 'wiggle': {
        // travelling jelly wave down the body — phase-delayed per joint
        const k = t * 6;
        rot.torso = 0.12 * Math.sin(k);
        rot.neck = 0.12 * Math.sin(k - 0.6);
        rot.head = 0.12 * Math.sin(k - 1.2);
        rot.arm_r_up = 0.25 * Math.sin(k - 0.4);
        rot.arm_r_lo = 0.3 * Math.sin(k - 0.8);
        rot.arm_l_up = 0.25 * Math.sin(k - 0.4 + PI);
        rot.arm_l_lo = 0.3 * Math.sin(k - 0.8 + PI);
        rot.leg_r_up = 0.18 * Math.sin(k - 1.0);
        rot.leg_r_lo = 0.2 * Math.sin(k - 1.4);
        rot.leg_l_up = 0.18 * Math.sin(k - 1.0 + PI);
        rot.leg_l_lo = 0.2 * Math.sin(k - 1.4 + PI);
        root.x = 0.02 * scale * Math.sin(k);
        root.y = 0.02 * scale * Math.sin(k * 2);
        depth = {
          arm_r: 0.4 * Math.sin(k - 0.4), arm_l: 0.4 * Math.sin(k - 0.4 + PI),
          leg_r: 0.3 * Math.sin(k - 1.0), leg_l: 0.3 * Math.sin(k - 1.0 + PI),
        };
        break;
      }
    }
    return { rot, root, depth };
  }

  window.Animations = { list, sample };
})();
