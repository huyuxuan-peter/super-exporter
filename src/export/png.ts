import JSZip from 'jszip';
import { nextFrame, type ExportOptions, type Warning } from '../model';
import { element } from './html';
import { capture, embeddedFonts, ready } from './raster';

type Bounds = { top: number; bottom: number; strong?: boolean };
export function planSlices(height: number, max: number, protectedBounds: Bounds[]): { start: number; end: number; cut: boolean }[] {
  const ranges: { start: number; end: number; cut: boolean }[] = [];
  const sorted = [...protectedBounds].sort((a, b) => a.top - b.top);
  let scan = 0;
  for (let start = 0; start < height;) {
    const ideal = Math.min(height, start + max);
    let end = ideal;
    while (sorted[scan] && sorted[scan].bottom <= start) scan++;
    if (ideal < height) {
      const relevant: Bounds[] = [];
      for (let i = scan; sorted[i] && sorted[i].top < ideal; i++) if (sorted[i].bottom > start) relevant.push(sorted[i]);
      for (;;) {
        const next = relevant.reduce((edge, bounds) => bounds.top < end && bounds.bottom > end ?
          Math.min(edge, Math.floor(bounds.top)) : edge, end);
        if (next === end || next - start < Math.min(150, max * .18)) break;
        end = next;
      }
    }
    const cut = end < height && sorted.some(bounds => bounds.strong && bounds.top < end && bounds.bottom > end);
    ranges.push({ start, end, cut });
    start = end;
  }
  return ranges;
}

export function fitFormulas(root: HTMLElement, maxBodyWidth = Infinity) {
  for (const formula of root.querySelectorAll<HTMLElement>('.formula')) {
    const math = formula.querySelector<HTMLElement>('.katex, math');
    if (!math) continue;
    math.style.removeProperty('zoom');
    const room = Math.min(maxBodyWidth, formula.closest<HTMLElement>('td,th,p,li,.message-body')?.clientWidth || Infinity);
    const contents = Array.from(math.querySelectorAll<HTMLElement>('.katex-html > .base'));
    const width = contents.length ? Math.max(...contents.map(base => base.getBoundingClientRect().width)) :
      Math.max(math.scrollWidth, math.getBoundingClientRect().width);
    if (width > room && room > 0) math.style.zoom = String(room * .96 / width);
  }
}

function layoutBounds(root: HTMLElement, heightLimit: number): Bounds[] {
  const offset = root.getBoundingClientRect().top;
  const bounds: Bounds[] = [];
  function add(rect: DOMRect, strong = false) {
    if (rect.height > 0) bounds.push({ top: Math.floor(rect.top - offset), bottom: Math.ceil(rect.bottom - offset), strong });
  }
  for (const item of root.children) {
    const rect = item.getBoundingClientRect();
    if (rect.height < heightLimit * .7) add(rect);
  }
  for (const item of root.querySelectorAll('img, .formula, tr, h1, h2, h3, h4, h5, h6, p, li')) {
    const rect = item.getBoundingClientRect();
    const strong = item.matches('img, .formula, tr');
    if (strong || rect.height < heightLimit * .48) add(rect, strong);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('.formula, .katex-mathml') || !node.textContent?.trim() ?
      NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) add(rect);
  }
  return bounds;
}
async function compactImage(source: HTMLImageElement): Promise<string | undefined> {
  try {
    const scale = Math.min(1, 2100 / Math.max(source.naturalWidth, source.naturalHeight));
    if (!source.naturalWidth || !source.naturalHeight) return;
    const canvas = element('canvas');
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const painter = canvas.getContext('2d');
    if (!painter) return;
    painter.drawImage(source, 0, 0, canvas.width, canvas.height);
    try { return canvas.toDataURL('image/webp', .91); }
    finally { canvas.width = canvas.height = 1; }
  } catch { return; }
}

export async function png(root: HTMLElement, options: ExportOptions, base: string, signal: AbortSignal,
  progress: (done: number, total: number) => void) {
  const width = Math.round(Math.max(420, Math.min(2000, options.width)));
  const ratio = options.scale;
  const maxHeight = Math.min(2100, Math.floor(16_000_000 / (width * ratio * ratio)));
  const stage = element('div'); stage.className = 'png-stage';
  const layout = root.cloneNode(true) as HTMLElement;
  layout.removeAttribute('id');
  layout.style.cssText = `width:${width}px;max-width:none;margin:0;border-radius:0`;
  stage.append(layout); document.body.append(stage);
  const warnings: Warning[] = [];
  try {
    await ready(layout);
    fitFormulas(layout);
    signal.throwIfAborted();
    const layoutRect = layout.getBoundingClientRect();
    const height = Math.ceil(layoutRect.height);
    const parts = planSlices(height, maxHeight, layoutBounds(layout, maxHeight));
    const sourceElements = Array.from(layout.children, child => ({ child: child as HTMLElement, bounds: child.getBoundingClientRect() }));
    const fontCSS = await embeddedFonts(layout);
    const zip = new JSZip();
    const compacted = new Map<HTMLImageElement, string | undefined>();
    for (const [i, part] of parts.entries()) {
      signal.throwIfAborted();
      progress(i, parts.length);
      if (part.cut) warnings.push({ code: 'png-split-graphic', detail: String(i + 1) });
      const frame = layout.cloneNode(false) as HTMLElement;
      const partHeight = part.end - part.start;
      frame.style.cssText += `;position:relative;overflow:hidden;height:${partHeight}px;padding:0;border:0`;
      for (const { child, bounds } of sourceElements) {
        const top = bounds.top - layoutRect.top;
        if (top >= part.end || top + bounds.height <= part.start) continue;
        const replica = child.cloneNode(true) as HTMLElement;
        replica.removeAttribute('id');
        replica.style.cssText += `;position:absolute;margin:0;top:${top - part.start}px;left:${bounds.left - layoutRect.left}px;width:${bounds.width}px`;
        const copies = [...replica.querySelectorAll('img')];
        for (const [idx, image] of [...child.querySelectorAll('img')].entries()) {
          const box = image.getBoundingClientRect();
          if (box.bottom - layoutRect.top < part.start || box.top - layoutRect.top >= part.end) {
            const blank = element('span');
            blank.style.cssText = `display:inline-block;vertical-align:middle;width:${box.width}px;height:${box.height}px`;
            copies[idx].replaceWith(blank);
          } else if (image.naturalWidth * image.naturalHeight > 2_000_000) {
            if (!compacted.has(image)) compacted.set(image, await compactImage(image));
            const compact = compacted.get(image);
            if (compact) {
              copies[idx].src = compact;
              copies[idx].style.width = box.width + 'px'; copies[idx].style.height = box.height + 'px';
            }
          }
        }
        frame.append(replica);
      }
      stage.append(frame);
      let blob: Blob;
      try {
        await ready(frame);
        blob = await capture(frame, width, partHeight, ratio, fontCSS);
      } finally { frame.remove(); }
      signal.throwIfAborted();
      if (parts.length === 1) { progress(1, 1); return { blob, filename: base + '.png', warnings }; }
      zip.file(base + '-' + String(i + 1).padStart(3, '0') + '.png', await blob.arrayBuffer());
      await nextFrame();
    }
    progress(parts.length, parts.length);
    const blob = await zip.generateAsync({ type: 'blob' }, () => signal.throwIfAborted());
    return { blob, filename: base + '-png.zip', warnings };
  } finally { stage.remove(); }
}
