import type { LabelSelection } from '../lib/label-image';
import { LabelPreviewTimeout, scanLiveCamera } from './label-live-camera';
import { setupLabelLinePicker } from './label-line-picker';
import { barcodeGuidance, candidateText, type LabelCandidate } from '../lib/label-reference';
import type { CatalogMark } from '../lib/label-catalog-match';
import type { LabelLine, CatalogLink, LabelOffers } from '../lib/label-search';

type CapturedOffers = Map<string, CatalogLink[]>;

function setup(root: HTMLElement) {
  const controls = root.querySelector<HTMLElement>('[data-photo-controls]')!;
  const liveStart = root.querySelector<HTMLButtonElement>('[data-live-start]')!;
  const livePanel = root.querySelector<HTMLDialogElement>('#live-camera')!;
  const pageFeedback = root.querySelector<HTMLElement>('[data-page-feedback]')!;
  const cameraFeedback = livePanel.querySelector<HTMLElement>('[data-live-feedback]')!;
  const cameraActions = livePanel.querySelector<HTMLElement>('[data-live-actions]')!;
  const cameraZoom = livePanel.querySelector<HTMLButtonElement>('[data-live-zoom]')!;
  let preview = livePanel.querySelector('video')!;
  const guide = livePanel.querySelector<HTMLElement>('[data-live-guide]')!;
  const pickRow = livePanel.querySelector<HTMLButtonElement>('.pick-row')!;
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

  function aimAt(y: number) {
    if (!scanningLive) return;
    guide.style.top = Math.max(11, Math.min(89, y)) + '%';
    guide.dataset.picked = '';
    status.textContent = 'Riadok je zameraný. Podržte celý nápis v rámčeku.';
  }
  pickRow.addEventListener('click', event => {
    const box = pickRow.getBoundingClientRect();
    if (box.height) aimAt(event.detail ? 100 * (event.clientY - box.top) / box.height : parseFloat(guide.style.top) || 50);
  });
  pickRow.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    aimAt((parseFloat(guide.style.top) || 50) + (event.key === 'ArrowUp' ? -10 : 10));
  });

  function setCameraZoom(zoom: boolean) {
    livePanel.style.setProperty('--label-zoom', zoom ? '2' : '1');
    cameraZoom.setAttribute('aria-pressed', String(zoom));
  }
  cameraZoom.addEventListener('click', () => setCameraZoom(cameraZoom.getAttribute('aria-pressed') !== 'true'));
  livePanel.addEventListener('cancel', event => { event.preventDefault(); stop.click(); });

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

  function closeCamera() {
    if (!scanningLive) return;
    controls.hidden = false;
    if (livePanel.open) livePanel.close();
    pageFeedback.append(status, stop);
    scanningLive = false;
  }

  function reset() {
    active?.abort();
    active = undefined;
    clearTimeout(timer);
    closeCamera();
    stop.hidden = true;
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
    const response = await fetch('/api/smart-search?q=' + encodeURIComponent(candidateText(candidate)) + '&label=1' + (candidate.kind === 'printer' ? '&kind=printer' : ''), { signal });
    if (!response.ok) throw new Error('catalog');
    const data: LabelOffers = await response.json();
    if (data.warning) throw new Error('catalog');
    return data;
  }

  async function findOffers(candidate: LabelCandidate, signal: AbortSignal, automatic: boolean): Promise<CatalogLink[] | 'suffix'> {
    const [data, { drumNeedsSuffix, exactLabelOffers, hpOrderCode, preferCompatibleOffers }] = await Promise.all([
      catalogOffers(candidate, signal), import('../lib/label-search')
    ]);
    if (automatic && drumNeedsSuffix(candidate, data)) return 'suffix';
    const items = exactLabelOffers(candidate, data);
    const fullCode = hpOrderCode(candidate, items);
    if (candidate.requiresPairing && (!fullCode || exactLabelOffers({ ...candidate, kind: 'printer' }, data).length)) return [];
    if (!fullCode || signal.aborted) return items;
    const fullCandidate = { ...candidate, code: fullCode };
    const full = await catalogOffers(fullCandidate, signal).then(result => exactLabelOffers(fullCandidate, result)).catch(() => []);
    return preferCompatibleOffers([...new Map([...full, ...items].map(item => [item.url, item])).values()]);
  }

  async function showOffers(candidate: LabelCandidate, items: CatalogLink[], signal: AbortSignal) {
    const { printedTonerCodes, matchesPrintedToner } = await import('../lib/label-search');
    if (signal.aborted) return;
    const listed = printedTonerCodes(candidate.code).filter(ref => items.some(item => matchesPrintedToner([ref], item.title, item.oem || '')));
    const query = candidateText({ ...candidate, code: listed.length ? listed.join(' / ') : candidate.code });
    lastFile = undefined;
    field.value = query;
    if (candidate.kind === 'printer' && candidate.brand && items.length === 1) {
      status.textContent = 'Otváram náplne pre ' + items[0].title + '…';
      location.assign(items[0].url);
      return;
    }
    const drum = candidate.brand === 'Brother' && /^DR[-\d]/.test(candidate.code);
    status.textContent = candidate.kind === 'printer' ? (candidate.brand ? 'Vyberte presný názov tlačiarne.' : 'Zachytené označenie ' + candidate.code + '. Ktorú značku tlačiarne máte?')
      : (drum ? 'Nájdené optické valce pre ' : 'Nájdené náplne pre ') + query;
    renderOffers(items, candidate.kind === 'supply');
  }

  function renderOffers(items: CatalogLink[], supply: boolean) {
    for (const item of items) {
      const link = document.createElement('a');
      link.href = item.url;
      link.textContent = item.title;
      if (supply && typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0) {
        const amount = document.createElement('small');
        amount.textContent = price.format(item.price) + ' s DPH';
        link.append(amount);
      }
      results.append(link);
    }
  }

  async function suggest(lines: LabelLine[], blocked: Set<string>, signal: AbortSignal, recognized?: string) {
    const { matchCatalogLines, markDescription, confirmedOffers } = await import('./label-confirmation');
    const marks = await matchCatalogLines(lines, blocked, signal, recognized);
    if (signal.aborted || !marks.length) return false;
    function choices() {
      results.replaceChildren();
      cropToggle.hidden = !lastFile;
      status.textContent = marks.length === 1 ? 'Je toto označenie na vašom štítku?' : 'Ktoré označenie zodpovedá vášmu štítku?';
      for (const mark of marks) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = markDescription(mark);
        button.addEventListener('click', () => void confirmMark(mark));
        results.append(button);
      }
      focusResult();
    }
    async function confirmMark(mark: CatalogMark) {
      const task = begin('Hľadám potvrdené označenie…', 18000);
      const description = markDescription(mark);
      field.value = mark.kind === 'Tlačiareň' ? mark.name : mark.brand+' '+mark.name;
      try {
        let offers = await confirmedOffers(mark,task.signal);
        if (offers.length && !offers.some(item => item.type === 'compatible') && (mark.kind === 'Toner' || mark.kind === 'Atramentová náplň')) {
          // Reuse the full OEM/printer-list verification for higher capacity alternatives.
          const candidate = {brand:mark.brand,code:mark.name,kind:'supply' as const,certain:false};
          const related = await catalogOffers(candidate,task.signal).catch(() => undefined);
          offers = [...(related?.products || []).filter(item => item.type === 'compatible' && item.verifiedForLabel === candidateText(candidate)
            && /^\/produkt\/[a-z0-9-]+\/?$/i.test(item.url) && !offers.some(existing => existing.url === item.url)), ...offers];
        }
        if (task.signal.aborted) return;
        status.textContent = offers.length ? 'Potvrdené označenie: '+description : 'Táto ponuka už nie je v katalógu.';
        renderOffers(offers,mark.kind !== 'Tlačiareň');
      } catch {
        if (!task.signal.aborted) status.textContent = 'Katalóg sa nepodarilo načítať. Skúste vybrať označenie znova.';
      } finally {
        if (active === task) {
          reset();
          const back = document.createElement('button');
          back.type = 'button';
          back.textContent = 'Späť na výber označenia';
          back.addEventListener('click',choices);
          results.append(back);
          focusResult();
        }
      }
    }
    choices();
    return true;
  }

  async function lookup(candidate: LabelCandidate, automatic = false, alternatives?: LabelCandidate[], capturedOffers?: CapturedOffers, evidence?: LabelLine[]) {
    const query = candidateText(candidate);
    const task = begin('Hľadám ' + query + ' v katalógu…', 18_000);
    stop.textContent = 'Zrušiť hľadanie';
    field.value = query;
    try {
      const items = capturedOffers?.get(query) ?? await findOffers(candidate, task.signal, automatic);
      if (task.signal.aborted) return;
      if (items === 'suffix') {
        cropToggle.hidden = !lastFile;
        status.textContent = 'Vidím ' + query + '. Pri tomto valci rozhodujú aj posledné písmená. Zachyťte celý riadok s označením.';
      } else if (items.length) await showOffers(candidate, items, task.signal);
      else if (!evidence || !await suggest(evidence,privateCodes,task.signal)) {
        cropToggle.hidden = !lastFile;
        status.textContent = 'Presnú zhodu pre ' + query + ' sme nenašli. Porovnajte označenie so štítkom alebo skúste bližšiu fotku.';
      }
    } catch {
      if (!task.signal.aborted) status.textContent = 'Katalóg sa nepodarilo načítať. Skúste označenie vyhľadať znova.';
    } finally {
      if (active === task) {
        reset();
        if (alternatives) {
          const back = document.createElement('button');
          back.type = 'button';
          back.textContent = 'Vybrať inú značku';
          back.addEventListener('click', () => { results.replaceChildren(); choose(alternatives, false, capturedOffers); focusResult(); });
          results.append(back);
        }
        focusResult();
      }
    }
  }

  function focusResult() {
    status.focus({preventScroll:true});
    status.scrollIntoView({block:'start'});
  }

  async function startCamera(retryUntil?: number, selectedRow?: number, zoom = false) {
    if (scanningLive) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof livePanel.showModal !== 'function') {
      status.textContent = 'Tento prehliadač nesprístupnil fotoaparát. Otvorte stránku v Safari alebo Chrome, prípadne vyberte fotku z galérie.';
      return;
    }
    lastFile = undefined;
    field.value = '';
    const task = begin('Povoľte fotoaparát, aby sa zobrazil živý obraz.', 45_000, 'Fotoaparát sa neotvoril. Skúste znova alebo vyberte fotku z galérie.');
    scanningLive = true;
    controls.hidden = true;
    // A stopped WebKit player can retain its old capture pipeline on the next scan.
    const video = preview.cloneNode(false) as HTMLVideoElement;
    preview.replaceWith(video);
    preview = video;
    stop.textContent = 'Zastaviť skenovanie';
    delete guide.dataset.picked;
    guide.style.removeProperty('top');
    setCameraZoom(zoom);
    if (typeof selectedRow === 'number' && Number.isFinite(selectedRow)) aimAt(selectedRow);
    cameraFeedback.append(status);
    cameraActions.append(stop);
    livePanel.showModal();
    const display = (message: string) => { if (!task.signal.aborted) status.textContent = message; };
    const capturedOffers: CapturedOffers = new Map();
    try {
      await scanLiveCamera(video, guide, task, display, () => {
        closeCamera();
        clearTimeout(timer);
        stop.textContent = 'Zrušiť čítanie';
        display('Záber je zachytený. Telefón môžete odložiť. Čítam označenie…');
        focusResult();
        timer = setTimeout(() => {
          if (active !== task) return;
          reset();
          status.textContent = 'Čítanie záberu trvalo pridlho. Skúste nový záber alebo zadajte označenie ručne.';
        }, 28_000);
      }, async options => {
        if (options.length > 1) {
          display('Telefón môžete odložiť. Overujem obe označenia v katalógu…');
          const verified = await Promise.all(options.map(async candidate => {
            const key = candidateText(candidate);
            const saved = capturedOffers.get(key);
            if (saved) return saved.length > 0;
            const offers = await findOffers(candidate, task.signal, true).catch(() => { throw new Error('catalog'); });
            const items = Array.isArray(offers) ? offers : [];
            capturedOffers.set(key, items);
            return items.length > 0;
          }));
          if (task.signal.aborted || !verified.every(Boolean)) return false;
          choose(options, false, capturedOffers);
          focusResult();
          return true;
        }
        const [candidate] = options;
        display('Telefón môžete odložiť. Hľadám ' + candidateText(candidate) + ' v katalógu…');
        const items = await findOffers(candidate, task.signal, true).catch(() => { throw new Error('catalog'); });
        if (task.signal.aborted) return false;
        if (items === 'suffix') return 'suffix';
        if (!items.length) return false;
        await showOffers(candidate, items, task.signal);
        if (results.childElementCount) focusResult();
        return true;
      }, retryUntil, (lines, blocked, recognized) => suggest(lines,blocked,task.signal,recognized));
    } catch (error) {
      if (!task.signal.aborted) {
        if (error instanceof LabelPreviewTimeout) {
          // A browser can grant a live track yet keep its player stopped. Reopen
          // once in a fresh document with the same framing and original deadline.
          if (!retryUntil && error.retryUntil - Date.now() > 600 && !document.hidden) {
            display('Fotoaparát neposkytol obraz. Spúšťam ho ešte raz…');
            history.replaceState({
              ...history.state, tmResumeCamera: error.retryUntil,
              tmResumeRow: guide.hasAttribute('data-picked') ? parseFloat(guide.style.top) : undefined,
              tmResumeZoom: cameraZoom.getAttribute('aria-pressed') === 'true',
            }, '');
            location.reload();
          } else display('Z fotoaparátu neprichádza obraz. Skúste ho spustiť znova.');
        } else if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
          display('Prístup ku kamere je vypnutý. Povoľte ho pre tento web v nastaveniach prehliadača alebo vyberte fotku z galérie.');
        } else if (error instanceof DOMException && ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(error.name)) {
          display('Fotoaparát je nedostupný. Zatvorte inú aplikáciu používajúcu kameru alebo vyberte fotku z galérie.');
        } else if (error instanceof Error && error.message === 'catalog') {
          display('Katalóg sa nepodarilo načítať. Skúste to znova.');
        } else display('Skenovanie sa nepodarilo spustiť. Skúste znova alebo vyberte fotku z galérie.');
      }
    } finally { if (active === task) reset(); }
  }

  function choose(candidates: LabelCandidate[], barcode = false, capturedOffers?: CapturedOffers) {
    cropToggle.hidden = !lastFile;
    if (!candidates.length) {
      status.textContent = barcode ? barcodeGuidance : 'Označenie sa nepodarilo prečítať. Odfoťte iba riadok s modelom alebo ho zadajte ručne.';
      return;
    }
    if (candidates.length === 1) field.value = candidateText(candidates[0]);
    if (candidates.length === 1 && candidates[0].certain) {
      void lookup(candidates[0], true);
      return;
    }
    const mixedBrands = candidates.every(item => item.kind === 'supply') && new Set(candidates.map(item => item.brand)).size > 1;
    status.textContent = mixedBrands ? 'Na štítku sú kódy pre dve značky. Akú značku tlačiarne máte?' : 'Skontrolujte označenie na štítku a vyberte zhodu.';
    for (const candidate of candidates.slice(0, 5)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = candidateText(candidate);
      button.addEventListener('click', () => void lookup(candidate, false, mixedBrands ? candidates : undefined, capturedOffers));
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
      const [{ readLabel }, { labelBrands, hasSplitSupplyLabel, liveLabelOptions, selectedLabelCandidates, labelCandidates }] =
        await Promise.all([import('./label-reader'), import('../lib/label-search')]);
      if (task.signal.aborted) return;
      const { passes, barcode, confirmedPrinter, disputed, evidence } = await readLabel(file, task.signal, message => {
        if (!task.signal.aborted) status.textContent = message;
      }, area, privateCodes);
      if (task.signal.aborted) return;
      const lines = passes[0] || [];
      if (!area) previousBrands = labelBrands(lines);
      if (!area && hasSplitSupplyLabel(lines)) {
        const options = liveLabelOptions(lines, privateCodes);
        if (options.length) choose(options);
        else {
          cropToggle.hidden = false;
          status.textContent = 'Na štítku je viac kódov. Označte celý riadok na fotke alebo zadajte kód ručne.';
        }
        return;
      }
      const options = area && 'start' in area
        ? selectedLabelCandidates(passes, privateCodes, previousBrands)
        : labelCandidates(lines, privateCodes, previousBrands);
      if (options.length === 1 && confirmedPrinter === candidateText(options[0])) options[0].certain = true;
      if (disputed) for (const option of options) option.certain = false;
      const readings = evidence || passes.flat();
      if (area && options.length === 1 && options[0].kind === 'printer' && !options[0].certain) {
        choose(options);
      } else if (options.length === 1 && options[0].certain) {
        if (!area && await suggest(readings,privateCodes,task.signal,options[0].code)) return;
        if (task.signal.aborted) return;
        void lookup(options[0],true,undefined,undefined,readings);
      } else if (!await suggest(readings,privateCodes,task.signal)) {
        // Only a catalog-backed choice is useful on an uncertain or multi-code label.
        choose([], barcode);
      }
    } catch (error) {
      if (!task.signal.aborted) {
        cropToggle.hidden = !lastFile;
        status.textContent = error instanceof Error && /^(Vyberte fotku|Túto fotku)/.test(error.message)
          ? error.message : error instanceof Error && error.message === 'catalog' ? 'Katalóg sa nepodarilo načítať. Skúste to znova.' : 'Fotku sa nepodarilo prečítať. Skúste bližší záber alebo zadajte označenie ručne.';
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
  manual.addEventListener('submit', async event => {
    event.preventDefault();
    lastFile = undefined;
    const submitted = field.value;
    const task = begin('Overujem označenie…', 18_000);
    try {
      const { hasSplitSupplyLabel, liveLabelOptions, labelCandidates } = await import('../lib/label-search');
      if (task.signal.aborted || field.value !== submitted) return;
      const lines = [{ text: submitted, confidence: 100 }];
      const options = hasSplitSupplyLabel(lines) ? liveLabelOptions(lines, new Set()) : [];
      if (options.length === 2) {
        choose(options);
        focusResult();
        return;
      }
      const candidates = labelCandidates(lines);
      if (candidates.length === 1) {
        void lookup(candidates[0]);
        return;
      }
    } catch {
      if (task.signal.aborted || field.value !== submitted) return;
    } finally {
      if (active === task) reset();
    }
    // Keep the original GET form usable for free text or a failed module download.
    manual.submit();
  });
  window.addEventListener('pagehide', () => { reset(); hideCrop(); lastFile = undefined; privateCodes.clear(); });
  if ('Worker' in window && typeof WebAssembly === 'object' && 'decode' in HTMLImageElement.prototype) {
    controls.hidden = false;
    const { tmResumeCamera, tmResumeRow, tmResumeZoom, ...state } = history.state || {};
    const fromPilot = location.hash === '#skenovat' && document.referrer && new URL(document.referrer).origin === location.origin;
    const retryUntil = typeof tmResumeCamera === 'number' ? tmResumeCamera : undefined;
    if (retryUntil || fromPilot) {
      history.replaceState(state, '', location.pathname + location.search);
      if (!document.hidden && (!retryUntil || retryUntil > Date.now())) {
        void startCamera(retryUntil, retryUntil ? tmResumeRow : undefined, !!retryUntil && tmResumeZoom === true);
      }
      else if (retryUntil) status.textContent = 'Z fotoaparátu neprichádza obraz. Skúste ho spustiť znova.';
    }
  }
}
const root = document.querySelector<HTMLElement>('[data-label-search]');
if (root) setup(root);
