import { focusScore, hasLabelStrokes, sameLabelScene, saveLabelFrame, type CapturedLabelFrame, type LabelExposure } from '../lib/label-camera-frame';
import { barcodeGuidance } from '../lib/label-reference';
import type { locateLabelRows } from '../lib/label-photo';
import type { LabelMatch } from './label-live-analysis';
import type { createCameraProbe } from './label-camera-probe';
type CameraProbe = ReturnType<typeof createCameraProbe>;

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
  locateRows: (canvas: HTMLCanvasElement) => ReturnType<typeof locateLabelRows>,
  sample: CameraProbe['sample']
) {
  const retained: LabelExposure[] = [];
  const thumbnail = document.createElement('canvas');
  const focus = document.createElement('canvas');
  let previous: Uint8Array | undefined;
  let scene = 0;
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
          const score = Math.min(4, focusScore(thumbnail, focus)) + Math.min(2, rows.length);
          const pixels = ctx.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
          const lettering = rows.length > 0 || hasLabelStrokes(pixels, thumbnail.width, thumbnail.height);
          const signature = new Uint8Array(Math.ceil((pixels.length - 1) / 116));
          for (let i = 0; i < signature.length; i++) signature[i] = pixels[i * 116 + 1];
          const now = performance.now();
          if (previous && !sameLabelScene(previous, signature, 22)) {
            scene++;
            retained.splice(0).forEach(discard);
          }
          if (!sameLabelScene(previous, signature, 12) || !lettering) stableSince = now;
          previous = signature;
          const exposure = { ...frame, score, at: now, signature, barcode: rows.some(row => row.barcode) };
          const evidence = sample(exposure, key + '/' + scene, lettering);
          retained.push(exposure);
          // Keep the clearest independently captured images, preferring a newer one on ties.
          retained.sort((a, b) => b.score - a.score || b.at - a.at);
          if (retained.length > 3) discard(retained.pop()!);
          // Let the customer put the phone down as soon as there is a readable model.
          // Once we have steady lettering, keep the burst and finish reading it off camera.
          if (retained.length === 3 && evidence === 'seen') break;
          const captureAfter = evidence === 'searching' ? 1800 : 950;
          if (retained.length === 3 && lettering && now - stableSince >= 550 &&
              now - started >= captureAfter) break;
        }
      }
      await pause(signal, Math.min(135, Math.max(0, deadline - performance.now())));
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
  let probe: CameraProbe | undefined;
  let finished = false;
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
    const ready = import('./label-camera-probe').then(({ createCameraProbe }) => {
      if (!finished && !signal.aborted) probe = createCameraProbe(signal);
    }).catch(() => {});
    frames = await collectExposures(video, guide, signal, Math.min(granted + remaining - 250, performance.now() + 6000),
      canvas => locate?.(canvas) ?? [], (frame, key, lettering) => probe?.sample(frame, key, lettering) || 'unready');
    release();
    signal.throwIfAborted();
    captured();
    await ready;
    let options: Awaited<ReturnType<CameraProbe['confirm']>> = undefined;
    try { options = await probe?.confirm(frames); }
    catch { signal.throwIfAborted(); }
    finally { probe?.close(); }
    if (probe?.serialOnly && !options?.length) { report(barcodeGuidance); return; }
    if (probe?.unrelated && !options?.length) {
      report('Označenie sa nepodarilo bezpečne prečítať. Namierte na celý názov tlačiarne alebo na kód náplne.');
      return;
    }
    if (options?.length) {
      const found = await match(options);
      signal.throwIfAborted();
      if (found === true) return;
      if (found === 'suffix') report('Pri tomto valci rozhodujú aj posledné písmená. Zachyťte celý kód vrátane koncovky.');
      else report('Pre prečítané označenie sme v katalógu nenašli presnú ponuku. Skontrolujte označenie.');
      return;
    }
    const [{ createLabelReader }, { readExposures }] = await Promise.all([import('./label-reader'), import('./label-live-analysis')]);
    const reader = await createLabelReader(signal);
    try {
      const message = await readExposures(frames, reader, signal, match, probe?.privateCodes, probe?.split, probe?.fallbackBudget);
      if (message && !signal.aborted) report(message);
    } finally { reader.close(); }
  } catch (error) {
    if (error instanceof Error && error.message === 'camera-preview-timeout') throw new LabelPreviewTimeout(expiresAt || 0);
    throw error;
  } finally {
    finished = true;
    probe?.close();
    signal.removeEventListener('abort', release);
    release();
    frames.forEach(discard);
  }
}
