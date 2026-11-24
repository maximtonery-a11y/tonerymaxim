import { captureLabelFrame, createLiveConsensus, enhanceInk, liveReadPasses, type FramePass, type LabelExposure } from '../lib/label-camera-frame';
import { isolateLightPrint } from '../lib/label-photo';
import { barcodeGuidance, candidateText, hasSplitSupplyLabel, isShorterReading, liveLabelOptions, type LabelCandidate } from '../lib/label-search';
import type { createLabelReader } from './label-reader';

export type LabelMatch = (options: LabelCandidate[]) => Promise<boolean | 'suffix'>;
export async function readExposures(
  frames: LabelExposure[],
  reader: Awaited<ReturnType<typeof createLabelReader>>,
  signal: AbortSignal,
  match: LabelMatch,
  privateCodes = new Set<string>(),
  split = false
) {
  const canvas = document.createElement('canvas');
  const votes = new Map<string, { frames: Set<number>; consensus: ReturnType<typeof createLiveConsensus> }>();
  const tried = new Set<string>();
  const confirmed: LabelCandidate[] = [];
  const barcodeFrames = new Set<number>();
  let barcode = false,
    suffix = false,
    lastQuery = '';
  let readingMs = 0;
  // Use real, independent exposures to confirm a reading. An OCR retry on the
  // same pixels cannot vote twice. All passes here run with the camera OFF.
  const first = frames[0];
  // A landscape sensor in a portrait viewfinder can clip a long reference to a
  // different, valid-looking code. Read its full centred row before trying crops.
  const cropped = first.visible.x1 - first.visible.x0 < first.image.width * 0.82;
  let passes: FramePass[] = cropped
    ? [
        { mode: 'context' }, { mode: 'context', angle: -3 }, { mode: 'context', angle: 3 },
        ...liveReadPasses.filter(pass => pass.mode !== 'context'),
      ]
    : liveReadPasses;
  if (first.picked) {
    passes = [{ mode: 'context' }, { mode: 'guide' }, { mode: 'guide', angle: -3 },
      { mode: 'guide', angle: 3 }, { mode: 'guide', ink: 'light' }, { mode: 'guide', ink: 'dark' }];
  }
  passes = [passes[0], { mode: 'context', ink: 'raised' }, ...passes.slice(1)];
  try {
    for (const mode of passes) {
      for (const [index, frame] of frames.entries()) {
        signal.throwIfAborted();
        if (readingMs > 12_000) break;
        const started = performance.now();
        const region = captureLabelFrame(frame, canvas, mode);
        if (!region) continue;
        if (mode.ink === 'raised') isolateLightPrint(canvas);
        else if (mode.ink) enhanceInk(canvas, mode.ink);
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
        const partialPair = hasSplitSupplyLabel(result.lines);
        split ||= partialPair;
        const options = liveLabelOptions(result.lines, privateCodes);
        if (!options.length || (split && options.length === 1 && options[0].kind === 'supply')) {
          if (result.barcode && !split && !votes.size && (mode.mode === 'context' || mode.mode === 'scene')) {
            barcodeFrames.add(frame.at);
            if (barcodeFrames.size >= 2) return barcodeGuidance;
          }
          if (partialPair && !mode.ink && !mode.angle) break;
          // On a blank first exposure try another moment too. On the following pass
          // alternate which one is first, so moving away cannot erase an earlier label.
          if (index >= 1) break;
          continue;
        }
        const key = options.map(candidateText).join(' / ');
        if (tried.has(key) || options.some(option => isShorterReading(option, confirmed))) break;
        const vote = votes.get(key) || { frames: new Set<number>(), consensus: createLiveConsensus() };
        votes.set(key, vote);
        if (vote.frames.has(frame.at)) continue;
        vote.frames.add(frame.at);
        if (!vote.consensus.observe(options[0], frame.at)) continue;
        const found = await match(options);
        signal.throwIfAborted();
        if (found === true) return;
        confirmed.push(...options);
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
