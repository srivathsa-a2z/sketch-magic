/* Record the live stage canvas to a video clip and save / share it.
   Uses MediaRecorder + canvas.captureStream (no dependencies). window.Recorder */
(function () {
  const Recorder = {};

  Recorder.supported = () =>
    typeof MediaRecorder !== 'undefined' &&
    !!HTMLCanvasElement.prototype.captureStream;

  function pickMime() {
    const cands = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const m of cands) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  let rec = null, chunks = [], mime = '';

  Recorder.start = function (canvas, fps) {
    if (!Recorder.supported()) throw new Error('Recording not supported on this device');
    const stream = canvas.captureStream(fps || 30);
    mime = pickMime();
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start();
  };

  Recorder.stop = function () {
    return new Promise((resolve) => {
      if (!rec) return resolve(null);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        rec = null;
        resolve(blob);
      };
      rec.stop();
    });
  };

  Recorder.isRecording = () => !!rec && rec.state === 'recording';

  // Try the native share sheet (mobile); fall back to a download.
  Recorder.saveOrShare = async function (blob, filename) {
    const ext = blob.type.indexOf('gif') >= 0 ? 'gif'
      : blob.type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    const name = (filename || 'my-animation') + '.' + ext;
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'My animated drawing!' }); return 'shared'; }
      catch (e) { /* user cancelled — fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  };

  window.Recorder = Recorder;
})();
