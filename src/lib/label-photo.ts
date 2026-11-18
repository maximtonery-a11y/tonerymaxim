export type PixelBox = { x0: number; y0: number; x1: number; y1: number };

// Locate a printed row by the vertical strokes shared by adjacent scanlines.
// Work on a small copy irrespective of the phone's camera resolution.
export function locateLabelRow(source: HTMLCanvasElement): { box: PixelBox; barcode: boolean } | undefined {
  const sample = document.createElement('canvas');
  const scale = Math.min(1, 540 / source.width, 600 / source.height);
  const w = (sample.width = Math.max(1, Math.round(source.width * scale)));
  const h = (sample.height = Math.max(1, Math.round(source.height * scale)));
  if (w < 35 || h < 14) return;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(source, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  sample.width = sample.height = 1;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++)
    gray[i] = (77 * rgba[i * 4] + 150 * rgba[i * 4 + 1] + 29 * rgba[i * 4 + 2]) >> 8;
  // Row prefix sums let us measure the height of a group of letters cheaply.
  const edges = new Uint16Array((w + 1) * h),
    stride = w + 1;
  for (let y = 1; y < h - 1; y++) {
    const offset = y * stride;
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x,
        dx = Math.abs(gray[i + 1] - gray[i - 1]);
      edges[offset + x + 1] = edges[offset + x] + Number(dx > 16 && dx > 1.1 * Math.abs(gray[i + w] - gray[i - w]));
    }
    edges[offset + w] = edges[offset + w - 1];
  }
  const maxGap = Math.max(9, w * 0.036);
  let best: PixelBox | undefined,
    bestScore = 0;
  for (let y = 3; y < h - 3; y += 2) {
    let left = 0,
      right = 0,
      count = 0;
    for (let x = 1; x < w; x++) {
      const at = y * stride + x;
      const edge =
        edges[at + 1] -
          edges[at] +
          edges[at + 1 - stride] -
          edges[at - stride] +
          edges[at + 1 + stride] -
          edges[at + stride] >=
        2;
      if (count && (x - right > maxGap || x === w - 1)) {
        const width = right + 1 - left;
        if (count >= 14 && width >= w * 0.14) {
          const density = (row: number) => edges[row * stride + right + 1] - edges[row * stride + left];
          const limit = Math.max(7, density(y) * 0.23);
          let top = y,
            bottom = y;
          while (top > 1 && y - top < h * 0.08 && density(top - 1) >= limit) top--;
          while (bottom < h - 1 && bottom - y < h * 0.08 && density(bottom + 1) >= limit) bottom++;
          const height = bottom - top;
          if (height >= 5 && width > 3.3 * height) {
            const center = 1 - 0.95 * Math.abs((top + bottom) / (2 * h) - 0.5);
            const score = width ** 0.4 * Math.min(count, 65) ** 0.65 * Math.min(height, 38) ** 0.7 * center ** 3;
            if (score > bestScore) {
              bestScore = score;
              best = { x0: left, x1: right + 1, y0: top, y1: bottom + 1 };
            }
          }
        }
        count = 0;
      }
      if (edge) {
        if (!count) left = x;
        right = x;
        count++;
      }
    }
  }
  if (!best) return;
  const { x0, x1, y0, y1 } = best;
  const row = (fraction: number) => (y0 + Math.floor((y1 - y0 - 1) * fraction)) * w;
  const top = row(0.19),
    middle = row(0.5),
    bottom = row(0.81);
  let lo = 255,
    hi = 0;
  for (let x = x0; x < x1; x++) {
    lo = Math.min(lo, gray[middle + x]);
    hi = Math.max(hi, gray[middle + x]);
  }
  const cut = (lo + hi) / 2;
  let transitions = 0;
  for (let x = x0; x < x1; x++) {
    const bar = gray[middle + x] < cut;
    if (x > x0 && bar !== gray[middle + x - 1] < cut) transitions++;
  }
  function alignment(row: number) {
    const drift = Math.min(8, Math.ceil((y1 - y0) * 0.12));
    let best = 0;
    for (let shift = -drift; shift <= drift; shift++) {
      let equal = 0;
      for (let x = x0 + drift; x < x1 - drift; x++)
        equal += Number(gray[middle + x] < cut === gray[row + x + shift] < cut);
      best = Math.max(best, equal / Math.max(1, x1 - x0 - 2 * drift));
    }
    return best;
  }
  const barcode = hi - lo >= 55 && transitions >= 36 && Math.min(alignment(top), alignment(bottom)) >= 0.87;
  return {
    box: {
      x0: (x0 * source.width) / w,
      x1: (x1 * source.width) / w,
      y0: (y0 * source.height) / h,
      y1: (y1 * source.height) / h,
    },
    barcode,
  };
}

export function printStrip(
  source: HTMLCanvasElement,
  box: PixelBox,
  height: number,
  stretch: number,
  padX: number,
  padY: number
) {
  const glyphHeight = Math.max(1, box.y1 - box.y0);
  const left = Math.max(0, box.x0 - padX * glyphHeight),
    top = Math.max(0, box.y0 - padY * glyphHeight);
  const width = Math.min(source.width, box.x1 + padX * glyphHeight) - left,
    cutHeight = Math.min(source.height, box.y1 + padY * glyphHeight) - top;
  const scale = Math.min(height / glyphHeight, 1150 / (Math.max(1, width) * stretch));
  const w = Math.max(1, Math.round(width * scale * stretch)),
    h = Math.max(1, Math.round(cutHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w + 16;
  canvas.height = h + 16;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, left, top, width, cutHeight, 8, 8, w, h);
  const data = ctx.getImageData(8, 8, w, h),
    pixels = data.data,
    hist = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (77 * pixels[i] + 150 * pixels[i + 1] + 29 * pixels[i + 2]) >> 8;
    hist[pixels[i]]++;
  }
  const percentile = (p: number) => {
    let n = 0;
    for (let i = 0; i < 256; i++) {
      n += hist[i];
      if (n >= w * h * p) return i;
    }
    return 255;
  };
  const low = percentile(0.035),
    high = percentile(0.965),
    invert = percentile(0.5) < (low + high) / 2;
  for (let i = 0; i < pixels.length; i += 4) {
    const tone = Math.min(255, Math.max(0, ((pixels[i] - low) * 255) / Math.max(1, high - low)));
    pixels[i] = pixels[i + 1] = pixels[i + 2] = invert ? 255 - tone : tone;
  }
  ctx.putImageData(data, 8, 8);
  return canvas;
}

/** Distinguish a closed upper loop (9) from two loops (8) on wide moulded lettering. */
export function readLoopDigit(source: HTMLCanvasElement, box: PixelBox): string | undefined {
  const strip = printStrip(source, box, 40, 1, 0.1, 0.1);
  const w = strip.width,
    h = strip.height;
  const pixels = strip.getContext('2d')!.getImageData(0, 0, w, h).data;
  strip.width = strip.height = 1;
  function holes(cut: number) {
    const seen = new Uint8Array(w * h),
      queue = new Int32Array(w * h);
    const centers: number[] = [];
    for (let i = 0; i < seen.length; i++) {
      if (seen[i] || pixels[4 * i] < cut) continue;
      let head = 0,
        tail = 1,
        sumY = 0,
        exterior = false;
      queue[0] = i;
      seen[i] = 1;
      while (head < tail) {
        const at = queue[head++],
          x = at % w,
          y = Math.floor(at / w);
        sumY += y;
        if (!x || x === w - 1 || !y || y === h - 1) exterior = true;
        function visit(pos: number) {
          if (!seen[pos] && pixels[pos * 4] >= cut) {
            seen[pos] = 1;
            queue[tail++] = pos;
          }
        }
        if (x) visit(at - 1);
        if (x < w - 1) visit(at + 1);
        if (y) visit(at - w);
        if (y < h - 1) visit(at + w);
      }
      if (!exterior && tail >= 0.02 * (w - 16) * (h - 16)) centers.push((sumY / tail - 8) / (h - 16));
    }
    if (centers.length === 1 && centers[0] < 0.43 && centers[0] > 0.13) return '9';
    if (centers.length === 2 && centers.some(y => y < 0.46) && centers.some(y => y > 0.55)) return '8';
  }
  const dark = holes(96);
  return dark && dark === holes(155) ? dark : undefined;
}
