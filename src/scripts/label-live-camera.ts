import { focusScore, hasLabelStrokes, saveLabelFrame, type CapturedLabelFrame, type LabelExposure } from '../lib/label-camera-frame';
import type { locateLabelRows } from '../lib/label-photo';
import type { LabelMatch } from './label-live-analysis';

function pause(signal: AbortSignal, delay: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, delay);
    function cancel() {
      clearTimeout(timer);
      reject(new DOMException('Zrušené', 'AbortError'));
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export class LabelPreviewTimeout extends Error {
  retryUntil: number;
  constructor(retryUntil: number) {
    super('camera-preview-timeout');
    this.retryUntil = retryUntil;
  }
}

async function playPreview(video: HTMLVideoElement, signal: AbortSignal, remaining: number) {
  const waiting = new AbortController();
  const cancel = () => waiting.abort();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await Promise.race([
      video.play(),
      pause(waiting.signal, Math.min(5000, remaining)).then(() => {
        throw new Error('camera-preview-timeout');
      }),
    ]);
  } finally {
    cancel();
    signal.removeEventListener('abort', cancel);
  }
}

function requestContinuousFocus(track: MediaStreamTrack) {
  try {
    const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
    if (caps?.focusMode?.includes('continuous')) {
      void track
        .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
        .catch(() => {});
    }
  } catch {
    /* Keep the device's own focus mode. */
  }
}

const discard = (frame: CapturedLabelFrame) => {
  frame.image.width = frame.image.height = 1;
};

// Sampling runs independently of OCR, its first download, and shop/network latency.
async function collectExposures(
  video: HTMLVideoElement,
  guide: HTMLElement,
  signal: AbortSignal,
  deadline: number,
  locateRows: (canvas: HTMLCanvasElement) => number
) {
  const retained: LabelExposure[] = [];
  const thumbnail = document.createElement('canvas');
  const focus = document.createElement('canvas');
  let previous: Uint8ClampedArray | undefined;
  let stableSince = 0,
    lastTime = -1,
    geometry = '';
  const started = performance.now();
  try {
    while (performance.now() < deadline) {
      signal.throwIfAborted();
      if (video.readyState >= 2 && video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        const view = video.getBoundingClientRect();
        const key = [video.videoWidth, video.videoHeight, view.width, view.height, guide.style.top].join('/');
        if (key !== geometry) {
          retained.splice(0).forEach(discard);
          previous = undefined;
          stableSince = 0;
          geometry = key;
        }
        const frame = saveLabelFrame(video, guide);
        if (frame) {
          const { target } = frame;
          const width = target.x1 - target.x0,
            height = target.y1 - target.y0;
          thumbnail.width = 288;
          thumbnail.height = Math.max(24, Math.min(240, Math.round((288 * height) / width)));
          const ctx = thumbnail.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(
            frame.image,
            target.x0,
            target.y0,
            width,
            height,
            0,
            0,
            thumbnail.width,
            thumbnail.height
          );
          const rows = locateRows(thumbnail);
          const score = Math.min(4, focusScore(thumbnail, focus)) + Math.min(2, rows);
          const pixels = ctx.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
          const lettering = rows > 0 || hasLabelStrokes(pixels, thumbnail.width, thumbnail.height);
          let change = 0,
            samples = 0;
          if (previous?.length === pixels.length) {
            for (let i = 1; i < pixels.length; i += 116) {
              change += Math.abs(pixels[i] - previous[i]);
              samples++;
            }
          }
          const now = performance.now();
          if (!samples || change / samples > 12 || !lettering) stableSince = now;
          previous = pixels;
          retained.push({ ...frame, score, at: now });
          // Keep the clearest independently captured images, preferring a newer one on ties.
          retained.sort((a, b) => b.score - a.score || b.at - a.at);
          if (retained.length > 3) discard(retained.pop()!);
          const steadyInterval = rows ? 750 : 1250;
          if (retained.length === 3 && lettering && now - started >= 1800 && now - stableSince >= steadyInterval) break;
        }
      }
      await pause(signal, Math.min(360, Math.max(0, deadline - performance.now())));
    }
    if (!retained.length) throw new Error('camera-preview-timeout');
    return retained;
  } catch (error) {
    retained.forEach(discard);
    throw error;
  } finally {
    thumbnail.width = thumbnail.height = focus.width = focus.height = 1;
  }
}

export async function scanLiveCamera(
  video: HTMLVideoElement,
  guide: HTMLElement,
  task: AbortController,
  report: (message: string) => void,
  captured: () => void,
  match: LabelMatch,
  retryUntil?: number
) {
  const { signal } = task;
  let expiresAt = retryUntil;
  let stream: MediaStream | undefined;
  let cutoff: ReturnType<typeof setTimeout> | undefined;
  let frames: LabelExposure[] = [];
  function release() {
    clearTimeout(cutoff);
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
  }
  function interrupted() {
    if (!signal.aborted) {
      report('Fotoaparát sa odpojil. Môžete ho spustiť znova.');
      task.abort();
    }
  }
  signal.addEventListener('abort', release, { once: true });
  try {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const constraints = {
      facingMode: { ideal: 'environment' },
      width: { ideal: portrait ? 1080 : 1920 },
      height: { ideal: portrait ? 1920 : 1080 },
      frameRate: { ideal: 24 },
      resizeMode: { ideal: 'none' },
    };
    // Loading the row detector never delays a captured frame or a permission gesture.
    let locate: typeof locateLabelRows | undefined;
    void import('../lib/label-photo').then(module => { locate = module.locateLabelRows; }).catch(() => {});
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
    signal.throwIfAborted();
    // The optical capture budget starts when permission is granted, even if playback is slow.
    const granted = performance.now();
    expiresAt ??= Date.now() + 8000;
    const remaining = Math.min(8000, expiresAt - Date.now());
    if (remaining <= 0) throw new Error('camera-preview-timeout');
    cutoff = setTimeout(release, remaining);
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') throw new DOMException('Kamera', 'NotReadableError');
    track.addEventListener('ended', interrupted, { once: true, signal });
    requestContinuousFocus(track);
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    report('Namierte na celý názov alebo kód. Pri drobnom písme ťuknite na riadok s označením.');
    await playPreview(video, signal, remaining);
    signal.throwIfAborted();
    const ready = import('./label-reader').then(({ createLabelReader }) => createLabelReader(signal));
    const analysis = import('./label-live-analysis');
    void analysis.catch(() => {});
    // Observe an early download failure without tying device release to the worker.
    void ready.catch(() => {});
    frames = await collectExposures(video, guide, signal, Math.min(granted + remaining - 250, performance.now() + 6000), canvas => locate?.(canvas).length ?? 0);
    release();
    signal.throwIfAborted();
    captured();
    const reader = await ready;
    try {
      const { readExposures } = await analysis;
      const message = await readExposures(frames, reader, signal, match);
      if (message && !signal.aborted) report(message);
    } finally {
      reader.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'camera-preview-timeout') throw new LabelPreviewTimeout(expiresAt || 0);
    throw error;
  } finally {
    signal.removeEventListener('abort', release);
    release();
    frames.forEach(discard);
  }
}
