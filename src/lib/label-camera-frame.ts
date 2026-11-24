import { drawLabelLine } from './label-image.ts';
import type { PixelBox } from './label-photo';
import type { LabelCandidate } from './label-search';

export type FramePass = {
  mode: 'scene' | 'guide' | 'context' | 'band' | 'line';
  angle?: number;
  center?: number;
  ink?: 'light' | 'dark' | 'raised';
};
export const liveReadPasses: FramePass[] = [
  { mode: 'scene' },
  { mode: 'guide' },
  { mode: 'context' },
  { mode: 'scene', angle: 3 },
  { mode: 'scene', angle: -3 },
  { mode: 'scene', angle: 4 },
  { mode: 'scene', angle: -4 },
  { mode: 'band', center: 0.23 },
  { mode: 'band', center: 0.77 },
  { mode: 'guide', ink: 'light' },
  { mode: 'guide', angle: 5 },
  { mode: 'guide', angle: -5 },
  { mode: 'scene', angle: 6 },
  { mode: 'scene', angle: -6 },
  { mode: 'guide', ink: 'dark' },
  { mode: 'context' },
  { mode: 'line', angle: -14 },
  { mode: 'line', angle: 14 },
];

export type CapturedLabelFrame = {
  image: HTMLCanvasElement;
  visible: PixelBox;
  target: PixelBox;
  picked?: boolean;
};

export type LabelExposure = CapturedLabelFrame & { score: number; at: number; signature?: Uint8Array; barcode?: boolean };

/** Compare the framing of separate exposures before reusing the positions of printed rows. */
export function sameLabelScene(a?: Uint8Array, b?: Uint8Array, tolerance = 8) {
  if (!a || !b || a.length !== b.length || !a.length) return false;
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta += Math.abs(a[i] - b[i]);
  return delta <= tolerance * a.length;
}

/** Save one sensor exposure and its on-screen geometry before releasing the camera. */
export function saveLabelFrame(video: HTMLVideoElement, guide: HTMLElement): CapturedLabelFrame | undefined {
  const view = video.getBoundingClientRect();
  const stage = guide.parentElement!.getBoundingClientRect();
  const w = video.videoWidth,
    h = video.videoHeight;
  if (!w || !h || !view.width || !view.height || !stage.width || !stage.height) return;
  const cover = Math.max(view.width / w, view.height / h);
  const sensorLeft = view.left + (view.width - w * cover) / 2;
  const sensorTop = view.top + (view.height - h * cover) / 2;
  const scale = Math.min(1, 1920 / Math.max(w, h), Math.sqrt(1_600_000 / (w * h)));
  const image = document.createElement('canvas');
  image.width = Math.max(1, Math.round(w * scale));
  image.height = Math.max(1, Math.round(h * scale));
  image.getContext('2d', { alpha: false })!.drawImage(video, 0, 0, image.width, image.height);
  function pixels(rect: DOMRect): PixelBox {
    return {
      x0: Math.max(0, (((rect.left - sensorLeft) / cover) * image.width) / w),
      y0: Math.max(0, (((rect.top - sensorTop) / cover) * image.height) / h),
      x1: Math.min(image.width, (((rect.right - sensorLeft) / cover) * image.width) / w),
      y1: Math.min(image.height, (((rect.bottom - sensorTop) / cover) * image.height) / h),
    };
  }
  return { image, visible: pixels(stage), target: pixels(guide.getBoundingClientRect()), picked: guide.hasAttribute('data-picked') };
}

// Thick moulded lettering can form one connected region instead of separate
// OCR boxes. Count opposite light/dark edges across neighbouring scan lines.
export function hasLabelStrokes(pixels: Uint8ClampedArray, width: number, height: number) {
  let rows = 0;
  for (let y = 2; y < height - 2; y += 2) {
    let previousSign = 0, edges = 0;
    for (let x = 3; x < width - 3; x += 2) {
      const at = (y * width + x) * 4 + 1;
      const change = pixels[at] - pixels[at - 8];
      if (Math.abs(change) < 18) continue;
      const sign = Math.sign(change);
      if (sign !== previousSign) edges++;
      previousSign = sign;
    }
    rows = edges >= 10 ? rows + 1 : 0;
    if (rows >= 3) return true;
  }
  return false;
}

export function captureLabelFrame(frame: CapturedLabelFrame, canvas: HTMLCanvasElement, pass: FramePass) {
  const { image, visible, target } = frame;
  const w = image.width,
    h = image.height;
  if (pass.mode === 'line') {
    const cx = (target.x0 + target.x1) / 2,
      cy = (target.y0 + target.y1) / 2;
    const dx = (target.x1 - target.x0) * 0.47,
      dy = dx * Math.tan(((pass.angle || 0) * Math.PI) / 180);
    drawLabelLine(
      canvas,
      image,
      w,
      h,
      { x: (cx - dx) / w, y: (cy - dy) / h },
      { x: (cx + dx) / w, y: (cy + dy) / h },
      0.19
    );
    return {};
  }
  let box = visible;
  if (pass.mode === 'guide') {
    const extraY = (target.y1 - target.y0) * 0.15;
    box = {
      x0: frame.picked ? 0 : visible.x0,
      x1: frame.picked ? w : visible.x1,
      y0: Math.max(visible.y0, target.y0 - extraY),
      y1: Math.min(visible.y1, target.y1 + extraY),
    };
  }
  if (pass.mode === 'band') {
    const height = visible.y1 - visible.y0;
    const center = visible.y0 + height * pass.center!;
    box = {
      ...visible,
      y0: Math.max(visible.y0, center - 0.19 * height),
      y1: Math.min(visible.y1, center + 0.19 * height),
    };
  }
  // A landscape sensor can cut both ends of a long name on a portrait display.
  // Read its whole line, but only accept writing centred in the visible image.
  if (pass.mode === 'context') box = { ...visible, x0: 0, x1: w };
  const width = box.x1 - box.x0,
    height = box.y1 - box.y0;
  if (width < 2 || height < 2) return;
  const ratio = Math.min((pass.mode === 'scene' || pass.mode === 'context') && !pass.angle ? 1 : 1.65, 1600 / width, 1600 / height, Math.sqrt(1_300_000 / (width * height)));
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas');
  ctx.save();
  if (pass.angle) {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-pass.angle * Math.PI) / 180);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }
  ctx.drawImage(image, box.x0, box.y0, width, height, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  const left = (visible.x0 - box.x0) * ratio,
    right = (visible.x1 - box.x0) * ratio;
  const angle = (pass.angle || 0) * Math.PI / 180;
  return {
    acceptLine: (row: PixelBox) => {
      const mid = (row.x0 + row.x1) / 2;
      if (frame.picked) {
        // Read privacy fields in the full scene, but only accept text in the chosen row.
        const cy = (row.y0 + row.y1) / 2;
        const sourceY = box.y0 + (canvas.height / 2 + (mid - canvas.width / 2) * Math.sin(angle)
          + (cy - canvas.height / 2) * Math.cos(angle)) / ratio;
        if (sourceY < target.y0 || sourceY > target.y1) return false;
      }
      return row.x0 > 2 && row.x1 < canvas.width - 2 && mid >= left && mid <= right;
    },
  };
}

// Remove slow lighting gradients on a moulded panel before asking the OCR
// worker to read light-on-dark or dark-on-light print. One bounded pass.
export function enhanceInk(canvas: HTMLCanvasElement, ink: 'dark' | 'light') {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const light = ink === 'light';
  const frame = ctx.getImageData(0, 0, w, h),
    pixels = frame.data;
  const stride = w + 1,
    sums = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      pixels[i] = (77 * pixels[i] + 150 * pixels[i + 1] + 29 * pixels[i + 2]) >> 8;
      row += pixels[i];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const radius = Math.max(8, Math.min(22, Math.round(w / 60)));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius),
      y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius),
        x1 = Math.min(w, x + radius + 1);
      const mean =
        (sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0]) /
        ((x1 - x0) * (y1 - y0));
      const i = 4 * (y * w + x),
        value = 128 + 0.6 * (pixels[i] - 128) + 2.8 * (pixels[i] - mean);
      pixels[i] = pixels[i + 1] = pixels[i + 2] = light ? 255 - value : value;
    }
  }
  ctx.putImageData(frame, 0, 0);
}

/** Compare two frames of the same scene before spending OCR time on a blurred one. */
export function focusScore(frame: HTMLCanvasElement, sample: HTMLCanvasElement) {
  const scale = Math.min(1, 320 / Math.max(frame.width, frame.height));
  const w = Math.max(4, Math.round(frame.width * scale)),
    h = Math.max(4, Math.round(frame.height * scale));
  sample.width = w;
  sample.height = h;
  const ctx = sample.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  // The green channel has strong spatial detail even on yellow or white labels.
  let detail = 0,
    contrast = 0;
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const i = 4 * (y * w + x) + 1;
      const dx = data[i - 4] - data[i],
        dy = data[i - w * 4] - data[i];
      detail += (dx + data[i + 4] - data[i]) ** 2 + (dy + data[i + w * 4] - data[i]) ** 2;
      contrast += dx * dx + dy * dy;
    }
  return detail / (contrast + 1);
}

export function createLiveConsensus() {
  let key = '',
    count = 0,
    confident = 0,
    empty = 0,
    lastSeen = 0,
    paired = false;
  return {
    observe(candidate: LabelCandidate | undefined, now: number) {
      if (!candidate) {
        if (++empty >= 2) key = '';
        return;
      }
      const next = candidate.brand + ' ' + candidate.kind + ' ' + candidate.code;
      if (next !== key || now - lastSeen > 8000) {
        count = 0;
        confident = 0;
        paired = false;
      }
      key = next;
      lastSeen = now;
      empty = 0;
      count++;
      if (candidate.certain) confident++;
      paired ||= !!candidate.requiresPairing;
      if (confident >= 2 || count >= 3) return paired ? { ...candidate, requiresPairing: true } : candidate;
    },
  };
}
