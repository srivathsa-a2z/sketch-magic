/* Procedural animated scene backgrounds drawn on a 2D canvas behind the
   character. No image assets — all generated. window.Scenes. */
(function () {
  const list = [
    { id: 'none',  name: 'None',  emoji: '⬜' },
    { id: 'park',  name: 'Park',  emoji: '🌳' },
    { id: 'space', name: 'Space', emoji: '🚀' },
    { id: 'sea',   name: 'Sea',   emoji: '🐠' },
    { id: 'city',  name: 'City',  emoji: '🏙️' },
    { id: 'rainbow', name: 'Magic', emoji: '🌈' },
  ];

  // Stable pseudo-random scatter so stars/bubbles don't jump each frame.
  let cache = null;
  function rng(seed) {
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }
  function ensure(w, h) {
    if (cache && cache.w === w && cache.h === h) return cache;
    const r = rng(987654321);
    const stars = Array.from({ length: 70 }, () => ({
      x: r() * w, y: r() * h * 0.8, s: 0.6 + r() * 1.8, p: r() * 6.28,
    }));
    const bubbles = Array.from({ length: 26 }, () => ({
      x: r() * w, y0: r() * h, s: 4 + r() * 14, sp: 12 + r() * 26,
    }));
    const clouds = Array.from({ length: 5 }, () => ({
      x: r() * w, y: 30 + r() * h * 0.35, s: 0.7 + r() * 0.9, sp: 6 + r() * 10,
    }));
    cache = { w, h, stars, bubbles, clouds };
    return cache;
  }

  function grad(ctx, w, h, c0, c1) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  function cloud(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    for (const [dx, dy, r] of [[0, 0, 26], [24, 6, 20], [-24, 6, 20], [0, 12, 24]]) {
      ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 6.2832); ctx.fill();
    }
  }

  function draw(id, ctx, w, h, t) {
    const C = ensure(w, h);
    switch (id) {
      case 'park': {
        grad(ctx, w, h, '#aee6ff', '#e8fbff');
        ctx.fillStyle = '#ffe14d';
        ctx.beginPath(); ctx.arc(w * 0.82, h * 0.2, 38 + Math.sin(t * 2) * 2, 0, 6.2832); ctx.fill();
        for (const c of C.clouds) cloud(ctx, (c.x + t * c.sp) % (w + 120) - 60, c.y, c.s);
        ctx.fillStyle = '#7bd389';
        ctx.beginPath(); ctx.ellipse(w * 0.3, h * 1.02, w * 0.6, h * 0.22, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#63c06f';
        ctx.beginPath(); ctx.ellipse(w * 0.85, h * 1.05, w * 0.5, h * 0.2, 0, 0, 6.2832); ctx.fill();
        break;
      }
      case 'space': {
        grad(ctx, w, h, '#0b1030', '#241848');
        for (const s of C.stars) {
          const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + s.p));
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, 6.2832); ctx.fill();
        }
        ctx.fillStyle = '#ff8a3d';
        ctx.beginPath(); ctx.arc(w * 0.78, h * 0.22, 30, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,120,.6)'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.ellipse(w * 0.78, h * 0.22, 48, 16, 0.5, 0, 6.2832); ctx.stroke();
        break;
      }
      case 'sea': {
        grad(ctx, w, h, '#2bbbe6', '#0a4f8f');
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(w * 0.2 * i + (t * 20 % 80), 0);
          ctx.lineTo(w * 0.2 * i + 80 + (t * 20 % 80), h);
          ctx.lineTo(w * 0.2 * i + 140 + (t * 20 % 80), h);
          ctx.lineTo(w * 0.2 * i + 40 + (t * 20 % 80), 0);
          ctx.closePath(); ctx.fill();
        }
        for (const b of C.bubbles) {
          const y = (b.y0 - t * b.sp % h + h) % h;
          ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(b.x, y, b.s * 0.4, 0, 6.2832); ctx.stroke();
        }
        break;
      }
      case 'city': {
        grad(ctx, w, h, '#ffd28a', '#ffb3c8');
        ctx.fillStyle = '#fff3a0';
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.7, 46, 0, 6.2832); ctx.fill();
        const r = rng(42);
        ctx.fillStyle = 'rgba(60,50,90,.85)';
        for (let x = 0; x < w; x += 46) {
          const bh = h * (0.25 + r() * 0.35);
          ctx.fillRect(x, h - bh, 40, bh);
        }
        break;
      }
      case 'rainbow': {
        grad(ctx, w, h, '#fff0f9', '#e9f0ff');
        const cols = ['#ff5a5f', '#ff8a3d', '#ffe14d', '#3ad17a', '#36c5f0', '#b06cff'];
        ctx.lineWidth = 14;
        for (let i = 0; i < cols.length; i++) {
          ctx.strokeStyle = cols[i];
          ctx.beginPath();
          ctx.arc(w * 0.5, h * 1.15, w * 0.5 - i * 16, Math.PI, 6.2832);
          ctx.stroke();
        }
        const r = rng(7);
        for (let i = 0; i < 24; i++) {
          const x = r() * w, y = r() * h * 0.6;
          const a = 0.3 + 0.7 * Math.abs(Math.sin(t * 3 + i));
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 6.2832); ctx.fill();
        }
        break;
      }
      default:
        ctx.clearRect(0, 0, w, h);
    }
  }

  window.Scenes = { list, draw };
})();
