import type { LabelSelection } from '../lib/label-image';
import { scanLiveCamera } from './label-live-camera';
import { setupLabelLinePicker } from './label-line-picker';
import { exactLabelOffers, hpOrderCode, labelBrands, labelCandidates, selectedLabelCandidates, type LabelCandidate, type LabelOffers } from '../lib/label-search';

function setup(root: HTMLElement) {
  const controls = root.querySelector<HTMLElement>('[data-photo-controls]')!;
  const liveStart = root.querySelector<HTMLButtonElement>('[data-live-start]')!;
  const livePanel = root.querySelector<HTMLElement>('#live-camera')!;
  const video = livePanel.querySelector('video')!;
  const guide = livePanel.querySelector<HTMLElement>('[data-live-guide]')!;
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
  let scanningLive = false;
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
    livePanel.hidden = true;
    if (scanningLive) controls.hidden = false;
    scanningLive = false;
    for (const input of inputs) input.disabled = false;
  }

  function begin(label: string, timeout: number, onTimeout = 'Čakanie trvalo príliš dlho. Skúste to znovu alebo zadajte označenie ručne.') {
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
      status.textContent = onTimeout;
    }, timeout);
    return current;
  }

  async function catalogOffers(candidate: LabelCandidate, signal: AbortSignal) {
    const response = await fetch('/api/smart-search?q=' + encodeURIComponent(candidate.brand + ' ' + candidate.code) + '&label=1', { signal });
    if (!response.ok) throw new Error('catalog');
    const data: LabelOffers = await response.json();
    if (data.warning) throw new Error('catalog');
    return data;
  }

  async function findOffers(candidate: LabelCandidate, signal: AbortSignal) {
    const data = await catalogOffers(candidate, signal);
    const items = exactLabelOffers(candidate, data);
    const fullCode = hpOrderCode(candidate, items);
    if (candidate.requiresPairing && (!fullCode || exactLabelOffers({ ...candidate, kind: 'printer' }, data).length)) return [];
    if (!fullCode || signal.aborted) return items;
    const fullCandidate = { ...candidate, code: fullCode };
    const full = await catalogOffers(fullCandidate, signal).then(result => exactLabelOffers(fullCandidate, result)).catch(() => []);
    return [...new Map([...full, ...items].map(item => [item.url, item])).values()];
  }

  function showOffers(candidate: LabelCandidate, items: Awaited<ReturnType<typeof findOffers>>) {
    const query = candidate.brand + ' ' + candidate.code;
    lastFile = undefined;
    field.value = query;
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
  }

  async function lookup(candidate: LabelCandidate) {
    const query = candidate.brand + ' ' + candidate.code;
    const task = begin('Hľadám ' + query + ' v katalógu…', 18_000);
    stop.textContent = 'Zrušiť hľadanie';
    field.value = query;
    try {
      const items = await findOffers(candidate, task.signal);
      if (task.signal.aborted) return;
      if (items.length) showOffers(candidate, items);
      else {
        cropToggle.hidden = !lastFile;
        status.textContent = 'Presnú zhodu pre ' + query + ' sme nenašli. Porovnajte označenie so štítkom alebo skúste bližšiu fotku.';
      }
    } catch {
      if (!task.signal.aborted) status.textContent = 'Katalóg sa nepodarilo načítať. Skúste označenie vyhľadať znova.';
    } finally { if (active === task) reset(); }
  }

  async function startCamera() {
    if (scanningLive) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Tento prehliadač nesprístupnil fotoaparát. Otvorte stránku v Safari alebo Chrome, prípadne vyberte fotku z galérie.';
      return;
    }
    lastFile = undefined;
    field.value = '';
    const task = begin('Povoľte fotoaparát, aby sa zobrazil živý obraz.', 75_000,
      'Skenovanie sa skončilo. Priblížte fotoaparát k označeniu a skúste znova.');
    scanningLive = true;
    controls.hidden = true;
    livePanel.hidden = false;
    if (livePanel.getBoundingClientRect().bottom > window.innerHeight) livePanel.scrollIntoView({ block: 'start' });
    stop.textContent = 'Zastaviť skenovanie';
    const display = (message: string) => { if (!task.signal.aborted) status.textContent = message; };
    try {
      await scanLiveCamera(video, guide, task, display, async candidate => {
        display('Hľadám ' + candidate.brand + ' ' + candidate.code + '…');
        const items = await findOffers(candidate, task.signal).catch(() => { throw new Error('catalog'); });
        if (task.signal.aborted || !items.length) return false;
        reset(); // Switch off the camera before displaying prices or navigating.
        showOffers(candidate, items);
        if (results.childElementCount) {
          status.focus({ preventScroll: true });
          status.scrollIntoView({ block: 'start' });
        }
        return true;
      });
    } catch (error) {
      if (!task.signal.aborted) {
        if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
          display('Prístup ku kamere je vypnutý. Povoľte ho pre tento web v nastaveniach prehliadača alebo vyberte fotku z galérie.');
        } else if (error instanceof DOMException && ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(error.name)) {
          display('Fotoaparát je nedostupný. Zatvorte inú aplikáciu používajúcu kameru alebo vyberte fotku z galérie.');
        } else if (error instanceof Error && error.message === 'catalog') {
          display('Katalóg sa nepodarilo načítať. Skúste to znova.');
        } else display('Skenovanie sa nepodarilo spustiť. Skúste znova alebo vyberte fotku z galérie.');
      }
    } finally { if (active === task) reset(); }
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

  liveStart.addEventListener('click', () => void startCamera());
  stop.addEventListener('click', () => {
    const wasLive = scanningLive;
    reset();
    status.textContent = wasLive ? 'Fotoaparát je vypnutý.' : 'Môžete vybrať inú fotku alebo zadať označenie.';
    if (wasLive) liveStart.focus({ preventScroll: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && scanningLive) { reset(); status.textContent = 'Fotoaparát je vypnutý.'; }
  });
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
  if ('Worker' in window && typeof WebAssembly === 'object' && 'decode' in HTMLImageElement.prototype) {
    controls.hidden = false;
    if (location.hash === '#skenovat' && document.referrer && new URL(document.referrer).origin === location.origin) {
      history.replaceState(history.state, '', location.pathname + location.search);
      if (!document.hidden) void startCamera();
    }
  }
}
const root = document.querySelector<HTMLElement>('[data-label-search]');
if (root) setup(root);
