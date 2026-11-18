import type { LabelPoint, LabelSelection } from '../lib/label-image';

const instruction = 'Ťuknite na začiatok a potom na koniec názvu modelu alebo kódu kazety.';
const center = { x: .5, y: .5 };
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function setupLabelLinePicker(panel: HTMLElement, read: (area: LabelSelection) => void) {
  const photo = panel.querySelector<HTMLImageElement>('[data-crop-image]')!;
  const pick = panel.querySelector<HTMLButtonElement>('.crop-image')!;
  const viewport = panel.querySelector<HTMLElement>('[data-crop-viewport]')!;
  const hint = panel.querySelector<HTMLElement>('#crop-hint')!;
  const mark = panel.querySelector<HTMLElement>('[data-crop-mark]')!;
  const cursor = panel.querySelector<HTMLElement>('[data-crop-cursor]')!;
  const zoom = panel.querySelector<HTMLButtonElement>('[data-crop-zoom]')!;
  const around = panel.querySelector<HTMLButtonElement>('[data-read-around]')!;
  const restart = panel.querySelector<HTMLButtonElement>('[data-crop-restart]')!;
  let start: LabelPoint | undefined;
  let position = center;
  let url = '';

  function place(marker: HTMLElement, point: LabelPoint) {
    marker.style.left = point.x * 100 + '%';
    marker.style.top = point.y * 100 + '%';
    marker.hidden = false;
  }
  function clearPoints() {
    start = undefined;
    position = center;
    mark.hidden = cursor.hidden = around.hidden = restart.hidden = true;
    hint.textContent = instruction;
  }
  function setZoom(on: boolean) {
    const width = on ? photo.getBoundingClientRect().width : 0;
    viewport.classList.toggle('zoom', on);
    photo.style.width = on ? Math.round(width * 3) + 'px' : '';
    zoom.setAttribute('aria-pressed', String(on));
    zoom.textContent = on ? 'Zmenšiť fotku' : 'Zväčšiť fotku';
    if (on) {
      const focus = start || position;
      viewport.scrollLeft = photo.clientWidth * focus.x - viewport.clientWidth / 2;
      viewport.scrollTop = photo.clientHeight * focus.y - viewport.clientHeight / 2;
    }
  }
  zoom.addEventListener('click', () => {
    if (photo.naturalWidth) setZoom(!viewport.classList.contains('zoom'));
  });
  restart.addEventListener('click', () => { clearPoints(); pick.focus(); });
  around.addEventListener('click', () => { if (start) read(start); });
  pick.addEventListener('keydown', event => {
    const delta = event.shiftKey ? .01 : .04;
    const directions: Record<string, number[]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    const movement = directions[event.key];
    if (!movement) return;
    event.preventDefault();
    position = { x: clamp(position.x + movement[0]), y: clamp(position.y + movement[1]) };
    place(cursor, position);
    cursor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  pick.addEventListener('click', event => {
    const bounds = photo.getBoundingClientRect();
    if (!photo.naturalWidth || !bounds.width || !bounds.height) return;
    if (event.detail) {
      position = { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
      cursor.hidden = true;
    }
    if (!start) {
      start = position;
      place(mark, start);
      hint.textContent = 'Teraz ťuknite na posledné písmeno alebo číslicu toho istého riadka.';
      around.hidden = restart.hidden = false;
      return;
    }
    if (Math.hypot((position.x - start.x) * bounds.width, (position.y - start.y) * bounds.height) < 4) {
      hint.textContent = 'Vyberte ešte koniec riadka. Ak je kód drobný, fotku si môžete zväčšiť.';
      return;
    }
    read({ start, end: position });
  });

  function clear() {
    clearPoints();
    setZoom(false);
    photo.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    url = '';
  }
  return {
    clear,
    open(file: File) {
      clear();
      url = URL.createObjectURL(file);
      photo.src = url;
    },
  };
}
