import { captureLabelFrame, createLiveConsensus, sameLabelScene, type LabelExposure } from '../lib/label-camera-frame';
import { candidateText, hasSplitSupplyLabel, labelBrands, liveLabelOptions, type LabelCandidate } from '../lib/label-search';
import { createSceneReader, type SceneResult } from './label-scene-reader';

type Reading = { at: number; signature?: Uint8Array; options: LabelCandidate[]; boxes: SceneResult['boxes']; serialOnly: boolean; unrelated: boolean };

export function createCameraProbe(signal: AbortSignal) {
  const reader = createSceneReader(signal);
  const canvas = document.createElement('canvas');
  const privateCodes = new Set<string>();
  const readings: Reading[] = [];
  let geometry = '', pending: Promise<void> | undefined, unavailable = false, split = false;
  async function read(frame: LabelExposure, key: string, boxes?: SceneResult['boxes']) {
    const region = captureLabelFrame(frame, canvas, { mode: 'context' });
    if (!region) return;
    const result = await reader.read(canvas, privateCodes, region.acceptLine, boxes);
    if (key !== geometry || signal.aborted) return;
    split ||= hasSplitSupplyLabel(result.lines);
    const options = liveLabelOptions(result.lines, privateCodes);
    const serialOnly = !!frame.barcode && !options.length && result.lines.some(row =>
      /\b(?=[A-Z0-9]{12,}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/i.test(row.text));
    // A desk or LCD can have readable text of its own. Keep the slower fallback
    // for faint, empty, branded or code-like readings, including short HP numbers.
    const unrelated = !frame.barcode && !options.length && result.lines.length > 0 && !labelBrands(result.lines).length
      && result.lines.every(({ text, confidence }) => confidence >= 65 &&
        !/\d[ .-]?\d[ .-]?\d|[A-Z]{2}[- ]?\d|\d{2}[AX]|DCP|MFC|LASER|TONER|DRUM|CARTRIDGE|MODEL|PIXMA/i.test(text));
    readings.push({ at: frame.at, signature: frame.signature, options, boxes: result.boxes, serialOnly, unrelated });
  }
  function sample(frame: LabelExposure, key: string, lettering: boolean) {
    if (geometry !== key) { readings.length = 0; geometry = key; split = false; }
    if (readings.some(item => item.options.length)) return 'seen';
    // A low-contrast cartridge can be legible to the neural detector even when
    // the inexpensive stroke test misses it. Sample the first good exposure too.
    if (!unavailable && !pending && (lettering || !readings.length) && readings.length < 3) {
      pending = read(frame, key).catch(() => { unavailable = true; }).finally(() => { pending = undefined; });
    }
    return unavailable || !readings.length ? 'unready' : 'searching';
  }
  async function confirm(frames: LabelExposure[]) {
    await pending;
    signal.throwIfAborted();
    if (unavailable) return;
    const votes = new Map<string, ReturnType<typeof createLiveConsensus>>();
    const seen = new Set<number>();
    function observe(item: Reading) {
      if (seen.has(item.at) || !item.options.length) return;
      seen.add(item.at);
      if (split && item.options.length === 1 && item.options[0].kind === 'supply') return;
      const key = item.options.map(candidateText).join('/');
      const vote = votes.get(key) || createLiveConsensus();
      votes.set(key, vote);
      return vote.observe(item.options[0], item.at) ? item.options : undefined;
    }
    for (const item of readings) {
      const options = observe(item);
      if (options) return options;
    }
    // Re-read the same printed rows on genuinely different exposures. If the phone moved,
    // locate the text again on the next frame instead of reusing a previous reading.
    for (const frame of frames) {
      if (readings.some(item => item.at === frame.at)) continue;
      const previous = readings.at(-1);
      const reuse = previous?.options.length && sameLabelScene(previous.signature, frame.signature);
      await read(frame, geometry, reuse ? previous.boxes : undefined);
      signal.throwIfAborted();
      const item = readings.at(-1);
      if (item) {
        const options = observe(item);
        if (options) return options;
      }
    }
  }
  return {
    sample, confirm, privateCodes,
    get split() { return split; },
    get serialOnly() { return !split && readings.every(r => !r.options.length) && readings.filter(r => r.serialOnly).length >= 2; },
    get unrelated() { return !split && readings.length >= 2 && readings.every(r => r.unrelated); },
    get fallbackBudget() {
      return !split && readings.length >= 2 && readings.every(r => !r.options.length) && readings.some(r => r.unrelated)
        ? 4000 : 12000;
    },
    close() { reader.close(); canvas.width = canvas.height = 1; },
  };
}
