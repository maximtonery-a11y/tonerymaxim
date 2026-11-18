export type LabelPoint = { x: number; y: number };
export type LabelSelection = LabelPoint | { start: LabelPoint; end: LabelPoint };

// A tight strip follows the printed baseline, including on a sloping control panel.
export function drawLabelLine(canvas: HTMLCanvasElement, image: CanvasImageSource, width: number, height: number,
  start: LabelPoint, end: LabelPoint, heightRatio: number) {
  const dx = (end.x - start.x) * width, dy = (end.y - start.y) * height;
  const length = Math.hypot(dx, dy);
  if (length < 3) throw new Error('short selection');
  const scale = Math.min(6, 670 / (1.18 * length));
  const stripWidth = Math.max(1, Math.round(1.18 * length * scale));
  const stripHeight = Math.max(1, Math.round(heightRatio * length * scale));
  const border = 8;
  canvas.width = stripWidth + 2 * border;
  canvas.height = stripHeight + 2 * border;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(border, border, stripWidth, stripHeight);
  ctx.clip();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.rotate(-Math.atan2(dy, dx));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, -(start.x + end.x) * width / 2, -(start.y + end.y) * height / 2);
  ctx.restore();

  const strip = ctx.getImageData(border, border, stripWidth, stripHeight);
  const pixels = strip.data, histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = (77 * pixels[i] + 150 * pixels[i + 1] + 29 * pixels[i + 2]) >> 8;
    pixels[i] = gray;
    histogram[gray]++;
  }
  function quantile(fraction: number) {
    const target = Math.ceil(stripWidth * stripHeight * fraction);
    let count = 0;
    for (let level = 0; level < 256; level++) {
      count += histogram[level];
      if (count >= target) return level;
    }
    return 255;
  }
  const low = quantile(.01), high = quantile(.99);
  const inverted = quantile(.5) < low + (high - low) * .51;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = high > low ? Math.min(255, Math.max(0, (pixels[i] - low) * 255 / (high - low))) : 255;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = inverted ? 255 - gray : gray;
  }
  ctx.putImageData(strip, border, border);
}
