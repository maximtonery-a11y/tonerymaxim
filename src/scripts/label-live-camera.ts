import { captureLabelFrame, createLiveConsensus, enhanceInk, focusScore, liveReadPasses } from '../lib/label-camera-frame';
import { barcodeGuidance, liveLabelCandidate, type LabelCandidate } from '../lib/label-search';

function pause(signal: AbortSignal, delay: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
    function cancel() { clearTimeout(timer); reject(new DOMException('Zrušené', 'AbortError')); }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

async function playPreview(video: HTMLVideoElement, signal: AbortSignal) {
  const waiting = new AbortController();
  const cancel = () => waiting.abort();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await Promise.race([
      video.play(),
      pause(waiting.signal, 6000).then(() => { throw new Error('camera-preview-timeout'); }),
    ]);
  } finally { cancel(); signal.removeEventListener('abort', cancel); }
}

function requestContinuousFocus(track: MediaStreamTrack) {
  try {
    const capabilities = track.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
    if (capabilities?.focusMode?.includes('continuous')) {
      const focus = { focusMode: 'continuous' } as MediaTrackConstraintSet;
      void track.applyConstraints({ advanced: [focus] }).catch(() => {});
    }
  } catch { /* The default camera focus remains available. */ }
}

export async function scanLiveCamera(video: HTMLVideoElement, guide: HTMLElement, task: AbortController,
  report: (message: string) => void, match: (candidate: LabelCandidate) => Promise<boolean | 'suffix'>) {
  const { signal } = task;
  const first = document.createElement('canvas');
  const second = document.createElement('canvas');
  const sample = document.createElement('canvas');
  const privateCodes = new Set<string>();
  const noOffers = new Set<string>();
  let stream: MediaStream | undefined;
  function release() {
    stream?.getTracks().forEach(track => track.stop());
    if (stream && video.srcObject === stream) { video.pause(); video.srcObject = null; }
    for (const canvas of [first, second, sample]) canvas.width = canvas.height = 1;
  }
  function interrupted() {
    if (signal.aborted) return;
    report('Fotoaparát sa odpojil. Môžete ho spustiť znova.');
    task.abort();
  }
  signal.addEventListener('abort', release, { once: true });
  try {
    // Ask from the real start action; never ask for audio or a camera on page load.
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const videoConstraints = {
      facingMode: { ideal: 'environment' }, width: { ideal: portrait ? 1080 : 1920 }, height: { ideal: portrait ? 1920 : 1080 },
      frameRate: { ideal: 24 }, resizeMode: { ideal: 'none' },
    };
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
    // A permission prompt may resolve after cancel, backgrounding, or a new scan.
    signal.throwIfAborted();
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') throw new DOMException('Kamera', 'NotReadableError');
    track.addEventListener('ended', interrupted, { once: true, signal });
    requestContinuousFocus(track);
    report('Fotoaparát je povolený. Spúšťam živý obraz…');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await playPreview(video, signal);
    signal.throwIfAborted();
    report('Pripravujem čítanie. Namierte na kód kazety alebo názov tlačiarne.');
    const { createLabelReader } = await import('./label-reader');
    const reader = await createLabelReader(signal);
    try {
      report('Podržte celý názov v strede rámčeka.');
      const started = performance.now();
      let votes = createLiveConsensus(), pass = 0, lastTime = -1, hinted = false, displayed = '', geometry = '';
      const show = (message: string) => { if (displayed !== message) { report(message); displayed = message; } };
      const viewKey = () => {
        const view = video.getBoundingClientRect();
        return [video.videoWidth, video.videoHeight, view.width, view.height].join('/');
      };
      while (!signal.aborted) {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight && video.currentTime !== lastTime) {
          const current = viewKey();
          if (current !== geometry) { geometry = current; pass = 0; votes = createLiveConsensus(); }
          const mode = liveReadPasses[pass];
          const capture = captureLabelFrame(video, guide, first, mode);
          if (capture) {
            lastTime = video.currentTime;
            let frame = first, region = capture.acceptLine;
            // Autofocus often moves between sharp and blurred during the initial approach.
            // Only one of these adjacent frames goes through OCR.
            const initialScore = focusScore(first, sample);
            await pause(signal, 90);
            if (video.currentTime !== lastTime && geometry === viewKey()) {
              const next = captureLabelFrame(video, guide, second, mode);
              if (next && focusScore(second, sample) >= initialScore) { frame = second; region = next.acceptLine; }
              lastTime = video.currentTime;
            }
            if (mode.ink) enhanceInk(frame, mode.ink);
            const reading = await reader.recognize(frame, undefined, mode.mode === 'line', mode.mode !== 'line', region, privateCodes);
            signal.throwIfAborted();
            if (geometry !== viewKey()) continue;
            const candidate = liveLabelCandidate(reading.lines, privateCodes);
            const key = candidate && [candidate.kind, candidate.brand, candidate.code].join(':');
            if (!candidate && reading.barcode) { show(barcodeGuidance); hinted = true; }
            const accepted = votes.observe(key && noOffers.has(key) ? undefined : candidate, performance.now());
            if (accepted && key) {
              const result = await match(accepted);
              if (result === true) return;
              noOffers.add(key);
              show(result === 'suffix'
                ? 'Vidím ' + accepted.code + '. Namierte aj na posledné písmená označenia farebného valca.'
                : 'Pre toto označenie nemáme presnú ponuku. Namierte na iný kód alebo názov.');
              hinted = true;
            } else if (candidate && key && !noOffers.has(key)) {
              show('Čítam ' + candidate.brand + ' ' + candidate.code + '… Podržte označenie v zábere.');
            }
            // Confirm a promising region on a fresh camera frame. Alternating back
            // to a region that cuts the suffix would discard the useful observation.
            if (!candidate || (key && noOffers.has(key))) pass = (pass + 1) % liveReadPasses.length;
          }
        }
        if (!hinted && performance.now() - started > 5000) {
          show('Priblížte sa alebo ťuknite na 2×. V zábere nechajte aj posledné písmeno označenia.');
          hinted = true;
        }
        await pause(signal, 190);
      }
    } finally { reader.close(); }
  } finally {
    signal.removeEventListener('abort', release);
    release();
  }
}
