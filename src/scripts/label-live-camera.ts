import { liveLabelCandidate, type LabelCandidate } from '../lib/label-search';

function pause(signal: AbortSignal, delay: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
    function cancel() { clearTimeout(timer); reject(new DOMException('Zrušené', 'AbortError')); }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

// Match the guide to the visible part of an object-fit: cover preview, even when
// the portrait phone displays a landscape sensor or rotates during a scan.
async function captureGuide(video: HTMLVideoElement, guide: HTMLElement, canvas: HTMLCanvasElement) {
  const view = video.getBoundingClientRect(), box = guide.getBoundingClientRect();
  if (!view.width || !view.height || !box.width || !box.height) return;
  const scale = Math.max(view.width / video.videoWidth, view.height / video.videoHeight);
  const x = (box.left - view.left + (video.videoWidth * scale - view.width) / 2) / scale;
  const y = (box.top - view.top + (video.videoHeight * scale - view.height) / 2) / scale;
  // Include surrounding text (brand or S/N prefix) outside the guide when visible.
  const marginX = Math.min(box.width * .1, box.left - view.left) / scale;
  const marginY = Math.min(box.height * .4, box.top - view.top) / scale;
  const width = box.width / scale + 2 * marginX, height = box.height / scale + 2 * marginY;
  const ratio = Math.min(1.6, 1080 / width, 470 / height);
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(video, x - marginX, y - marginY, width, height, 0, 0, canvas.width, canvas.height);
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (png) return new Uint8Array(await png.arrayBuffer());
}

export async function scanLiveCamera(video: HTMLVideoElement, guide: HTMLElement, task: AbortController,
  report: (message: string) => void, match: (candidate: LabelCandidate) => Promise<boolean>) {
  const { signal } = task;
  const canvas = document.createElement('canvas');
  const privateCodes = new Set<string>();
  const noOffers = new Set<string>();
  let stream: MediaStream | undefined;
  function release() {
    stream?.getTracks().forEach(track => track.stop());
    if (stream && video.srcObject === stream) { video.pause(); video.srcObject = null; }
    canvas.width = canvas.height = 1;
  }
  function interrupted() {
    if (signal.aborted) return;
    report('Fotoaparát sa odpojil. Môžete ho spustiť znova.');
    task.abort();
  }
  signal.addEventListener('abort', release, { once: true });
  try {
    // Ask from the real start action; never ask for audio or a camera on page load.
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 },
    } });
    // A permission prompt may resolve after cancel, backgrounding, or a new scan.
    signal.throwIfAborted();
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') throw new DOMException('Kamera', 'NotReadableError');
    track.addEventListener('ended', interrupted, { once: true, signal });
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    signal.throwIfAborted();
    report('Pripravujem čítanie. Namierte na kód kazety alebo názov tlačiarne.');
    const { createLabelReader } = await import('./label-reader');
    const reader = await createLabelReader(signal);
    try {
      report('Podržte označenie v rámčeku.');
      const started = performance.now();
      let previous = '', lastTime = -1, hinted = false;
      while (!signal.aborted) {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight && video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          const frame = await captureGuide(video, guide, canvas);
          signal.throwIfAborted();
          const candidate = frame && liveLabelCandidate(await reader.recognize(frame), privateCodes);
          signal.throwIfAborted();
          const key = candidate ? candidate.kind + ':' + candidate.brand + ':' + candidate.code : '';
          if (candidate && key === previous && !noOffers.has(key)) {
            if (await match(candidate)) return;
            noOffers.add(key);
            report('Pre toto označenie nemáme presnú ponuku. Namierte na iný kód alebo názov.');
            hinted = true;
          }
          previous = key;
        }
        if (!hinted && performance.now() - started > 4500) {
          report('Priblížte sa tak, aby bolo vidieť celý kód vrátane posledného písmena.');
          hinted = true;
        }
        await pause(signal, 350);
      }
    } finally { reader.close(); }
  } finally {
    signal.removeEventListener('abort', release);
    release();
  }
}
