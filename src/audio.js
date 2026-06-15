/* Synthesized sound — no audio files. Cheerful SFX + a gentle music loop
   built from oscillators. Must be started from a user gesture. window.Sound */
(function () {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let musicTimer = null;
  let enabled = true;
  let step = 0;

  // C major pentatonic, two octaves — always pleasant.
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(master);
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function blip(freq, t0, dur, type, gain, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const Sound = {};

  Sound.setEnabled = (on) => {
    enabled = on;
    if (!on) Sound.stopMusic();
  };
  Sound.isEnabled = () => enabled;

  Sound.unlock = () => { init(); resume(); };

  Sound.pop = () => {
    if (!enabled) return; init(); resume();
    const t = ctx.currentTime;
    blip(440 + Math.random() * 220, t, 0.12, 'triangle', 0.35);
    blip(880, t + 0.04, 0.1, 'sine', 0.2);
  };

  Sound.cheer = () => {
    if (!enabled) return; init(); resume();
    const t = ctx.currentTime;
    [0, 1, 2, 4].forEach((n, i) =>
      blip(SCALE[n], t + i * 0.08, 0.25, 'triangle', 0.3));
  };

  Sound.whoosh = () => {
    if (!enabled) return; init(); resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.33);
  };

  Sound.startMusic = () => {
    if (!enabled) return; init(); resume();
    if (musicTimer) return;
    musicGain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 1.5);
    const pattern = [0, 2, 4, 2, 3, 1, 4, 5];
    const tick = () => {
      const t = ctx.currentTime + 0.05;
      const n = pattern[step % pattern.length];
      blip(SCALE[n], t, 0.3, 'triangle', 0.5, musicGain);
      if (step % 2 === 0) blip(SCALE[n] / 2, t, 0.4, 'sine', 0.4, musicGain);
      step++;
    };
    tick();
    musicTimer = setInterval(tick, 320);
  };

  Sound.stopMusic = () => {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (musicGain && ctx) musicGain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.4);
  };

  window.Sound = Sound;
})();
