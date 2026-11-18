import type { LabelSelection } from '../lib/label-image';
import { setupLabelLinePicker } from './label-line-picker';
import { exactLabelOffers, hpOrderCode, labelBrands, labelCandidates, selectedLabelCandidates, type LabelCandidate, type LabelOffers } from '../lib/label-search';

function setup(root: HTMLElement) {
  const controls = root.querySelector<HTMLElement>('[data-photo-controls]')!;
  const status = root.querySelector<HTMLElement>('[role=status]')!;
  const results = root.querySelector<HTMLElement>('[data-matches]')!;
  const stop = root.querySelector<HTMLButtonElement>('[data-stop]')!;
  const manual = root.querySelector<HTMLFormElement>('form.manual')!;
  const field = manual.querySelector<HTMLInputElement>('input')!;
  const inputs = [...controls.querySelectorAll<HTMLInputElement>('input')];
  const price = new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' });
  const cropToggle = root.querySelector<HTMLButtonElement>('[data-crop-toggle]')!;
  const cropPanel = root.querySelector<HTMLElement>('#crop-photo')!;
  let lastFile: File | undefined;
  const privateCodes = new Set<string>();
  let previousBrands: string[] = [];
  const picker = setupLabelLinePicker(cropPanel, area => { if (lastFile) void scan(lastFile, area); });
  let active: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hideCrop() {
    cropToggle.hidden = cropPanel.hidden = true;
    cropToggle.setAttribute('aria-expanded', 'false');
    picker.clear();
  }

  cropToggle.addEventListener('click', () => {
    if (!lastFile) return;
    cropPanel.hidden = !cropPanel.hidden;
    cropToggle.setAttribute('aria-expanded', String(!cropPanel.hidden));
    if (cropPanel.hidden) picker.clear();
    else picker.open(lastFile);
  });

  function reset() {
    active?.abort();
    active = undefined;
    clearTimeout(timer);
    stop.hidden = true;
    for (const input of inputs) input.disabled = false;
  }

  function begin(label: string, timeout: number) {
    reset();
    results.replaceChildren();
    hideCrop();
    const current = new AbortController();
    active = current;
    status.textContent = label;
    for (const input of inputs) input.disabled = true;
    stop.hidden = false;
    timer = setTimeout(() => {
      reset();
      status.textContent = 'Čakanie trvalo príliš dlho. Skúste to znovu alebo zadajte označenie ručne.';
    }, timeout);
    return current;
  }

  async function catalogOffers(candidate: LabelCandidate, signal: AbortSignal) {
    const response = await fetch('/api/smart-search?q=' + encodeURIComponent(candidate.brand + ' ' + candidate.code) + '&label=1', { signal });
    if (!response.ok) throw new Error('catalog');
    const data: LabelOffers = await response.json();
    if (data.warning) throw new Error('catalog');
    return exactLabelOffers(candidate, data);
  }

  async function lookup(candidate: LabelCandidate) {
    const query = candidate.brand + ' ' + candidate.code;
    const task = begin('Hľadám ' + query + ' v katalógu…', 18_000);
    stop.textContent = 'Zrušiť hľadanie';
    field.value = query;
    try {
      let items = await catalogOffers(candidate, task.signal);
      const fullCode = hpOrderCode(candidate, items);
      if (fullCode && !task.signal.aborted) {
        // Keep the already verified short-code offers if the optional second lookup fails.
        const full = await catalogOffers({ ...candidate, code: fullCode }, task.signal).catch(() => []);
        items = [...new Map([...full, ...items].map(item => [item.url, item])).values()];
      }
      if (task.signal.aborted) return;
      if (!items.length) {
        cropToggle.hidden = !lastFile;
        status.textContent = 'Presnú zhodu pre ' + query + ' sme nenašli. Porovnajte označenie so štítkom alebo skúste bližšiu fotku.';
        return;
      }
      lastFile = undefined;
      if (candidate.kind === 'printer' && items.length === 1) {
        status.textContent = 'Otváram náplne pre ' + items[0].title + '…';
        location.assign(items[0].url);
        return;
      }
      status.textContent = candidate.kind === 'printer' ? 'Vyberte presný názov tlačiarne.' : 'Nájdené náplne pre ' + query;
      for (const item of items) {
        const link = document.createElement('a');
        link.href = item.url;
        link.textContent = item.title;
        if (candidate.kind === 'supply' && typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0) {
          const amount = document.createElement('small');
          amount.textContent = price.format(item.price) + ' s DPH';
          link.append(amount);
        }
        results.append(link);
      }
    } catch {
      if (!task.signal.aborted) status.textContent = 'Katalóg sa nepodarilo načítať. Skúste označenie vyhľadať znova.';
    } finally {
      if (active === task) reset();
    }
  }

  function choose(candidates: LabelCandidate[]) {
    cropToggle.hidden = !lastFile;
    if (!candidates.length) {
      status.textContent = 'Označenie sa nepodarilo prečítať. Odfoťte iba riadok s modelom alebo ho zadajte ručne.';
      return;
    }
    if (candidates.length === 1) field.value = candidates[0].brand + ' ' + candidates[0].code;
    if (candidates.length === 1 && candidates[0].certain) {
      void lookup(candidates[0]);
      return;
    }
    status.textContent = 'Skontrolujte označenie na štítku a vyberte zhodu.';
    for (const candidate of candidates.slice(0, 5)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = candidate.brand + ' ' + candidate.code;
      button.addEventListener('click', () => void lookup(candidate));
      results.append(button);
    }
  }

  async function scan(file: File, area?: LabelSelection) {
    if (!area) { privateCodes.clear(); previousBrands = []; }
    lastFile = file;
    const task = begin('Otváram fotku…', 65_000);
    stop.textContent = 'Zrušiť čítanie';
    field.value = '';
    try {
      const { readLabel } = await import('./label-reader');
      if (task.signal.aborted) return;
      const passes = await readLabel(file, task.signal, message => {
        if (!task.signal.aborted) status.textContent = message;
      }, area);
      if (task.signal.aborted) return;
      reset();
      const lines = passes[0] || [];
      if (!area) previousBrands = labelBrands(lines);
      choose(area && 'start' in area
        ? selectedLabelCandidates(passes, privateCodes, previousBrands)
        : labelCandidates(lines, privateCodes, previousBrands));
    } catch (error) {
      if (!task.signal.aborted) {
        cropToggle.hidden = !lastFile;
        status.textContent = error instanceof Error && /^(Vyberte fotku|Túto fotku)/.test(error.message)
          ? error.message : 'Fotku sa nepodarilo prečítať. Skúste bližší záber alebo zadajte označenie ručne.';
      }
    } finally {
      if (active === task) reset();
    }
  }

  stop.addEventListener('click', () => { reset(); status.textContent = 'Môžete vybrať inú fotku alebo zadať označenie.'; });
  for (const input of inputs) input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void scan(file);
  });
  manual.addEventListener('submit', event => {
    lastFile = undefined;
    const candidates = labelCandidates([{ text: field.value, confidence: 100 }]);
    if (candidates.length === 1) { event.preventDefault(); void lookup(candidates[0]); }
    else reset(); // An explicitly typed free-text query uses the usual catalogue search.
  });
  window.addEventListener('pagehide', () => { reset(); hideCrop(); lastFile = undefined; privateCodes.clear(); });
  if ('Worker' in window && typeof WebAssembly === 'object' && 'decode' in HTMLImageElement.prototype) controls.hidden = false;
}
const root = document.querySelector<HTMLElement>('[data-label-search]');
if (root) setup(root);
