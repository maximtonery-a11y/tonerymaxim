import {
  captureLabelFrame,
  createLiveConsensus,
  enhanceInk,
  focusScore,
  liveReadPasses,
  saveLabelFrame,
  type CapturedLabelFrame,
  type FramePass,
} from '../lib/label-camera-frame';
import { locateLabelRows } from '../lib/label-photo';
import {
  barcodeGuidance,
  candidateText,
  hasSplitSupplyLabel,
  liveLabelOptions,
  type LabelCandidate,
} from '../lib/label-search';
import type { createLabelReader } from './label-reader';

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

type Exposure = CapturedLabelFrame & { score: number; at: number };
const discard = (frame: CapturedLabelFrame) => {
  frame.image.width = frame.image.height = 1;
};

// Sampling runs independently of OCR, its first download, and shop/network latency.
async function collectExposures(
  video: HTMLVideoElement,
  guide: HTMLElement,
  signal: AbortSignal,
  deadline: number
) {
  const retained: Exposure[] = [];
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
        const key = [video.videoWidth, video.videoHeight, view.width, view.height].join('/');
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
          const rows = locateLabelRows(thumbnail);
          const score = Math.min(4, focusScore(thumbnail, focus)) + Math.min(2, rows.length);
          const pixels = ctx.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
          let change = 0,
            samples = 0;
          if (previous?.length === pixels.length) {
            for (let i = 1; i < pixels.length; i += 116) {
              change += Math.abs(pixels[i] - previous[i]);
              samples++;
            }
          }
          const now = performance.now();
          if (!samples || change / samples > 12 || !rows.length) stableSince = now;
          previous = pixels;
          retained.push({ ...frame, score, at: now });
          // Keep the clearest independently captured images, preferring a newer one on ties.
          retained.sort((a, b) => b.score - a.score || b.at - a.at);
          if (retained.length > 3) discard(retained.pop()!);
          if (retained.length === 3 && rows.length && now - started >= 1800 && now - stableSince >= 750) break;
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

type Match = (options: LabelCandidate[]) => Promise<boolean | 'suffix'>;
async function readExposures(
  frames: Exposure[],
  reader: Awaited<ReturnType<typeof createLabelReader>>,
  signal: AbortSignal,
  match: Match
) {
  const canvas = document.createElement('canvas');
  const privateCodes = new Set<string>();
  const votes = new Map<string, { frames: Set<number>; consensus: ReturnType<typeof createLiveConsensus> }>();
  const tried = new Set<string>();
  let barcode = false,
    split = false,
    suffix = false,
    lastQuery = '';
  let readingMs = 0;
  // Use real, independent exposures to confirm a reading. An OCR retry on the
  // same pixels cannot vote twice. All passes here run with the camera OFF.
  const first = frames[0];
  // A landscape sensor in a portrait viewfinder can clip a long reference to a
  // different, valid-looking code. Read its full centred row before trying crops.
  const cropped = first.visible.x1 - first.visible.x0 < first.image.width * 0.82;
  const passes: FramePass[] = cropped
    ? [
        { mode: 'context' }, { mode: 'context', angle: -3 }, { mode: 'context', angle: 3 },
        ...liveReadPasses.filter(pass => pass.mode !== 'context'),
      ]
    : liveReadPasses;
  try {
    for (const mode of passes) {
      for (const [index, frame] of frames.entries()) {
        signal.throwIfAborted();
        if (readingMs > 12_000) break;
        const started = performance.now();
        const region = captureLabelFrame(frame, canvas, mode);
        if (!region) continue;
        if (mode.ink) enhanceInk(canvas, mode.ink);
        const result = await reader.recognize(
          canvas,
          undefined,
          mode.mode === 'line',
          mode.mode !== 'line',
          region.acceptLine,
          privateCodes,
          Boolean(mode.angle)
        );
        readingMs += performance.now() - started;
        signal.throwIfAborted();
        barcode ||= result.barcode;
        split ||= hasSplitSupplyLabel(result.lines);
        const options = liveLabelOptions(result.lines, privateCodes);
        if (!options.length || (split && options.length === 1)) {
          // On a blank first exposure try another moment too. On the following pass
          // alternate which one is first, so moving away cannot erase an earlier label.
          if (index >= 1) break;
          continue;
        }
        const key = options.map(candidateText).join(' / ');
        if (tried.has(key)) break;
        const vote = votes.get(key) || { frames: new Set<number>(), consensus: createLiveConsensus() };
        votes.set(key, vote);
        if (vote.frames.has(frame.at)) continue;
        vote.frames.add(frame.at);
        if (!vote.consensus.observe(options[0], frame.at)) continue;
        const found = await match(options);
        signal.throwIfAborted();
        if (found === true) return;
        tried.add(key);
        suffix ||= found === 'suffix';
        lastQuery = key;
      }
      if (readingMs > 12_000 || (barcode && !votes.size && mode.mode === 'guide')) break;
      frames.push(frames.shift()!);
    }
    if (suffix)
      return 'Pri tomto valci rozhodujú aj posledné písmená. Skúste znovu zachytiť celý kód vrátane koncovky.';
    if (split)
      return 'Na štítku je viac označení. Skúste zachytiť celý riadok na oboch stranách lomky alebo zadajte kód.';
    if (lastQuery) return 'Pre ' + lastQuery + ' sme v katalógu nenašli presnú ponuku. Skontrolujte označenie.';
    if (barcode) return barcodeGuidance;
    return 'Označenie sa nepodarilo bezpečne prečítať. Skúste nasnímať bližšie samotný nápis alebo ho zadajte ručne.';
  } finally {
    canvas.width = canvas.height = 1;
  }
}

export async function scanLiveCamera(
  video: HTMLVideoElement,
  guide: HTMLElement,
  task: AbortController,
  report: (message: string) => void,
  captured: () => void,
  match: Match,
  retryUntil?: number
) {
  const { signal } = task;
  let expiresAt = retryUntil;
  let stream: MediaStream | undefined;
  let cutoff: ReturnType<typeof setTimeout> | undefined;
  let frames: Exposure[] = [];
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
    report('Namierte na celý názov tlačiarne alebo kód náplne.');
    await playPreview(video, signal, remaining);
    signal.throwIfAborted();
    const ready = import('./label-reader').then(({ createLabelReader }) => createLabelReader(signal));
    // Observe an early download failure without tying device release to the worker.
    void ready.catch(() => {});
    frames = await collectExposures(video, guide, signal, Math.min(granted + remaining - 250, performance.now() + 6000));
    release();
    signal.throwIfAborted();
    captured();
    const reader = await ready;
    try {
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
