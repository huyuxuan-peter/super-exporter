import { hidden, selectors, type Turn } from './adapter';
import { safeUrl, type Content, type Flow, type MathNode, type Message, type Tag, type Warning } from './model';

const aliases: Record<string, Tag> = { b: 'strong', i: 'em', del: 's', strike: 's', section: 'div', article: 'div', main: 'div', samp: 'code', ins: 'u', abbr: 'span' };
const tags = new Set('p div span strong em u s sup sub small mark kbd code br hr blockquote ul ol li figure figcaption table caption thead tbody tfoot tr td th h1 h2 h3 h4 h5 h6 time dl dt dd'.split(' '));
const mathSelector = '.katex-display, .katex, mjx-container, .MathJax, math, [data-latex], [data-tex]';
const MAX_SNAPSHOT_PIXELS = 4_000_000;
const MAX_SNAPSHOTS = 14_000_000;
const svgPresentation = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'color',
  'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline',
  'visibility', 'display', 'paint-order', 'vector-effect'] as const;
export type SnapshotBudget = { used: number };
type Context = { base: string; warn: (code: string, detail?: string) => void; budget: SnapshotBudget };

function math(el: Element, ctx: Context): MathNode {
  const inner = el.matches('math') ? el : el.querySelector('math');
  const tex = el.getAttribute('data-latex') || el.getAttribute('data-tex') ||
    el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]')?.textContent?.trim();
  const display = el.matches('.katex-display,[display="block"],[display="true"],[data-display="true"]') ||
    inner?.getAttribute('display') === 'block' || !!el.closest('.katex-display');
  const visual = el.querySelector('.katex-html, mjx-math')?.outerHTML;
  const fallback = (inner?.querySelector('semantics > :first-child')?.textContent || el.getAttribute('aria-label') ||
    el.querySelector('.katex-html, mjx-math')?.textContent || el.textContent || '').trim();
  if (!tex && !inner) ctx.warn('math-source-missing');
  return { kind: 'math', tex: tex || undefined, mathml: inner?.outerHTML, display, visual, fallback };
}

function pngSnapshot(source: CanvasImageSource, width: number, height: number, ctx: Context): string | undefined {
  if (!width || !height || ctx.budget.used >= MAX_SNAPSHOTS) return;
  const scale = Math.min(1, Math.sqrt(MAX_SNAPSHOT_PIXELS / (width * height)), 4096 / Math.max(width, height));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const painter = canvas.getContext('2d');
    if (!painter) return;
    painter.drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/png');
    if (data.startsWith('data:image/png;') && data.length + ctx.budget.used <= MAX_SNAPSHOTS) {
      ctx.budget.used += data.length;
      return data;
    }
  } catch { /* origin-restricted canvas, fall back to a media URL or placeholder */ }
}

function inlineSVG(el: Element, ctx: Context): Content {
  const label = el.getAttribute('aria-label') || el.querySelector('title')?.textContent || 'SVG';
  const clone = el.cloneNode(true) as Element;
  clone.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', 'http://www.w3.org/2000/svg');
  // SVG charts commonly inherit their colours and text styles from ChatGPT's
  // stylesheets. Standalone SVG files do not carry that stylesheet with them.
  const sources = [el, ...el.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  for (let index = 0; index < Math.min(sources.length, 3000); index++) {
    const css = getComputedStyle(sources[index]);
    for (const property of svgPresentation) {
      const value = css.getPropertyValue(property).trim();
      // Copy presentation values only. Preserve local paint-server references
      // without introducing a new network reference through computed CSS.
      const localPaint = /^url\(["']?#([\w.:-]+)["']?\)$/.exec(value);
      if (localPaint) copies[index].setAttribute(property, `url(#${localPaint[1]})`);
      else if (value && !/url\s*\(|var\s*\(/i.test(value)) copies[index].setAttribute(property, value);
    }
  }
  if (sources.length > 3000) ctx.warn('svg-style-partial', label);
  const bounds = el.getBoundingClientRect();
  if (bounds.width > 0 && bounds.height > 0) {
    clone.setAttribute('width', String(Math.ceil(bounds.width)));
    clone.setAttribute('height', String(Math.ceil(bounds.height)));
  }
  const markup = new XMLSerializer().serializeToString(clone);
  let snapshot: string | undefined;
  if (markup.length + ctx.budget.used <= MAX_SNAPSHOTS) {
    snapshot = markup;
    ctx.budget.used += markup.length;
  }
  return { kind: 'image', graphic: 'svg', label, snapshot, candidates: [],
    width: Math.ceil(bounds.width) || undefined, height: Math.ceil(bounds.height) || undefined };
}

function picture(el: HTMLImageElement, ctx: Context): Content {
  const parent = el.closest('picture');
  const link = el.closest('a[href]');
  const original = el.getAttribute('data-original-src') || el.getAttribute('data-full-src') ||
    (link && /\.(png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/i.test(link.getAttribute('href') || '') ? link.getAttribute('href') : undefined);
  let src = safeUrl(el.currentSrc || el.getAttribute('src'), ctx.base, true);
  if (src?.startsWith('data:')) {
    if (src.length + ctx.budget.used > MAX_SNAPSHOTS) src = undefined;
    else ctx.budget.used += src.length;
  }
  const responsive = [el.getAttribute('srcset'), ...Array.from(parent?.querySelectorAll('source[srcset]') || [], s => s.getAttribute('srcset'))]
    .flatMap(set => !set || set.includes('data:') ? [] : set.split(',').map(entry => {
      const [raw, size] = entry.trim().split(/\s+/);
      return { raw, score: size?.endsWith('x') ? parseFloat(size) * 1000 : parseFloat(size) || 0 };
    })).sort((a, b) => b.score - a.score).map(entry => entry.raw);
  const candidates = [...new Set([original, ...responsive, src, el.getAttribute('src')].flatMap(raw => raw?.startsWith('data:') && raw !== src ? [] : safeUrl(raw, ctx.base, true) || []))].slice(0, 6);
  const width = el.naturalWidth || undefined;
  const height = el.naturalHeight || undefined;
  const live = src?.startsWith('data:') || src?.startsWith('blob:') || src?.startsWith(new URL(ctx.base).origin + '/');
  const snapshot = width && height && (!live || !src) ? pngSnapshot(el, width, height, ctx) : undefined;
  return { kind: 'image', src, candidates, width, height, snapshot,
    label: el.alt || el.title || el.getAttribute('aria-label') || el.closest('figure')?.querySelector('figcaption')?.textContent || 'Image' };
}

function flow(tag: Tag, el: Element, children: Content[]): Flow {
  const attrs: NonNullable<Flow['attrs']> = {};
  for (const prop of ['colspan', 'rowspan', 'start', 'value'] as const) {
    const raw = el.getAttribute(prop);
    if (raw && /^-?\d{1,7}$/.test(raw)) {
      const value = Number(raw);
      if (prop === 'colspan' || prop === 'rowspan') {
        if (value > 0) attrs[prop] = Math.min(value, 1000);
        if (prop === 'rowspan' && value === 0) attrs.rowspan = el.parentElement?.parentElement ? el.parentElement.parentElement.children.length -
          Array.from(el.parentElement.parentElement.children).indexOf(el.parentElement) : 1;
      } else attrs[prop] = value;
    }
  }
  const dir = el.getAttribute('dir');
  if (dir === 'rtl' || dir === 'ltr' || dir === 'auto') attrs.dir = dir;
  for (const key of ['title', 'datetime'] as const) {
    const value = el.getAttribute(key);
    if (value) attrs[key] = value;
  }
  return { kind: 'element', tag, children, attrs: Object.keys(attrs).length ? attrs : undefined };
}

function code(el: Element, ctx: Context, visibleLanguage?: string): Content {
  const source = el.querySelector('code') || el;
  const detected = [...source.classList, ...el.classList].find(s => /^(lang|language)-/.test(s));
  const language = source.getAttribute('data-language') || el.getAttribute('data-language') ||
    detected?.replace(/^(lang|language)-/, '') || visibleLanguage;
  const declared = source.getAttribute('data-code') ?? el.getAttribute('data-code');
  const value = declared ?? Array.from(source.childNodes, function getText(node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof Element) || hidden(node) || node.matches(selectors.chrome + ',button,[aria-label="Line numbers"]')) return '';
    if (node.tagName === 'BR') return '\n';
    const content = Array.from(node.childNodes, getText).join('');
    return node.matches('div,[data-code-line],[data-line-number]') && node.nextSibling && !content.endsWith('\n') ? content + '\n' : content;
  }).join('');
  if (declared === null && el.closest('[data-virtualized="true"], [data-testid*="virtualized"]')) ctx.warn('virtualized-code');
  return { kind: 'code', language, code: value };
}

function card(el: Element, ctx: Context, type: 'citation' | 'file' | 'widget' | 'unknown', nodes: Content[]): Content {
  const anchor = el.matches('a[href]') ? el : el.querySelector('a[href]');
  const raw = anchor?.getAttribute('href') || el.getAttribute('data-url') || el.getAttribute('data-href');
  const url = safeUrl(raw, ctx.base);
  const ref = raw?.startsWith('sandbox:') ? raw : undefined;
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-filename') ||
    (el instanceof HTMLAnchorElement ? el.getAttribute('download') || el.textContent?.trim() : undefined) ||
    (type === 'unknown' ? el.localName : type === 'citation' ? 'Citation' : type === 'file' ? 'Attachment' : 'Interactive content');
  if (type === 'citation' && !url) ctx.warn('citation-target-missing');
  if (type === 'file') ctx.warn('attachment-metadata-only', label);
  if (type === 'unknown') ctx.warn('unknown-component', el.localName);
  if (type === 'widget') ctx.warn('interactive-snapshot', el.localName);
  return { kind: 'card', type, label, children: nodes, url, ref };
}

function control(el: Element, ctx: Context): Content[] {
  const name = el.getAttribute('aria-label') || el.getAttribute('title') ||
    (el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.labels?.[0]?.textContent?.trim() : '') || '';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'hidden' || el.type === 'password') return [];
    if (el.type === 'checkbox' || el.type === 'radio') return [{ kind: 'text', text: `[${el.checked ? 'x' : ' '}] ${name}` }];
    if (el.type === 'file') return [card(el, ctx, 'file', Array.from(el.files || [], file => ({ kind: 'text', text: file.name + ' ' })))];
    ctx.warn('interactive-snapshot', el.type);
    return [{ kind: 'text', text: '[' + (name ? name + ': ' : '') + el.value + '] ' }];
  }
  if (el instanceof HTMLSelectElement) {
    ctx.warn('interactive-snapshot', 'select');
    return [{ kind: 'text', text: '[' + (name ? name + ': ' : '') + Array.from(el.selectedOptions, option => option.text).join(', ') + '] ' }];
  }
  if (el instanceof HTMLTextAreaElement) return [{ kind: 'code', language: 'text', code: el.value }];
  return [card(el, ctx, 'widget', nodes(el.childNodes, ctx))];
}
function nodes(list: NodeListOf<ChildNode> | readonly ChildNode[], ctx: Context): Content[] {
  return Array.from(list).flatMap(node => parse(node, ctx));
}
function parse(node: ChildNode, ctx: Context): Content[] {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.textContent) return [];
    const whiteSpace = node.parentElement ? getComputedStyle(node.parentElement).whiteSpace : '';
    const preserve = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(whiteSpace);
    return [{ kind: 'text', text: preserve ? node.textContent : node.textContent.replace(/[\t\n\f\r ]+/g, ' '), preserve: preserve || undefined }];
  }
  if (!(node instanceof Element) || hidden(node) || node.matches(selectors.chrome)) return [];
  const el = node;
  const name = el.localName;
  if (/^(system|developer|analysis|reasoning)$/.test(el.getAttribute('data-message-author-role') || el.getAttribute('data-message-role') || ''))
    return [];
  const css = getComputedStyle(el);
  if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.contentVisibility === 'hidden') return [];
  if (el.matches(mathSelector)) return [math(el, ctx)];
  if (el.matches('pre')) return [code(el, ctx)];
  if (name === 'div' && el.querySelector(':scope > [data-message-content-controls]')) {
    const pre = el.querySelector(':scope > pre');
    const other = [...el.children].filter(child => child !== pre && !child.matches(selectors.chrome));
    const visibleLanguage = other[0]?.textContent?.trim();
    if (pre && (!other.length || other.length === 1 && visibleLanguage && /^[\w+.#-]{1,32}$/.test(visibleLanguage)))
      return [code(pre, ctx, visibleLanguage || undefined)];
  }
  if (el instanceof HTMLImageElement) return [picture(el, ctx)];
  if (name === 'svg') return [inlineSVG(el, ctx)];
  if (el instanceof HTMLCanvasElement) {
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || 'Canvas';
    ctx.warn('graphic-snapshot', label);
    return [{ kind: 'image', graphic: 'canvas', candidates: [], label, snapshot: pngSnapshot(el, el.width, el.height, ctx), width: el.width, height: el.height }];
  }
  if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
    const isVideo = el instanceof HTMLVideoElement;
    const poster = isVideo ? safeUrl(el.poster, ctx.base, true) : undefined;
    const label = el.getAttribute('aria-label') || (isVideo ? 'Video' : 'Audio');
    const url = safeUrl(el.currentSrc || el.getAttribute('src') || el.querySelector('source[src]')?.getAttribute('src'), ctx.base);
    const image: Content[] = poster || isVideo && el.videoWidth ? [{
      kind: 'image', graphic: 'video', label, candidates: poster ? [poster] : [], src: poster,
      snapshot: isVideo ? pngSnapshot(el, el.videoWidth, el.videoHeight, ctx) : undefined,
    }] : [];
    ctx.warn('interactive-snapshot', label);
    return [{ kind: 'card', type: 'widget', label, url, children: image }];
  }
  if (el.matches(selectors.writing)) {
    const children = nodes(el.childNodes, ctx);
    return [flow('div', el, children)];
  }
  if (el.matches(selectors.citations + ',' + selectors.files)) {
    return [card(el, ctx, el.matches(selectors.files) ? 'file' : 'citation', nodes(el.childNodes, ctx))];
  }
  if (el instanceof HTMLDetailsElement) {
    const summary = Array.from(el.children).find(child => child.tagName === 'SUMMARY');
    if (!el.open) ctx.warn('collapsed-content', summary?.textContent?.trim());
    return [card(el, ctx, 'widget', el.open ? nodes(el.childNodes, ctx) : summary ? nodes(summary.childNodes, ctx) : [])];
  }
  if (el.matches('input,textarea,select,button')) return control(el, ctx);
  if (el.matches('iframe,object,embed')) return [card(el, ctx, 'unknown', [])];
  if (el.matches(selectors.widgets + ',[role="grid"]')) {
    const value = el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow') || el.getAttribute('aria-checked');
    const children = nodes(el.childNodes, ctx);
    if (value) children.push({ kind: 'text', text: ` [${value}]` });
    if (el.matches('[aria-rowcount]') && Number(el.getAttribute('aria-rowcount')) > el.querySelectorAll('[role="row"]').length)
      ctx.warn('virtualized-table');
    return [card(el, ctx, 'widget', children)];
  }
  if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
    return [flow('div', el, nodes(el.childNodes, ctx))];
  if (name === 'a') {
    const href = safeUrl(el.getAttribute('href'), ctx.base);
    const children = nodes(el.childNodes, ctx);
    if (!href && el.getAttribute('href') && !el.getAttribute('href')?.startsWith('#')) ctx.warn('unsafe-link');
    return href ? [{ kind: 'link', href, children }] : children;
  }
  const children = nodes(el.childNodes, ctx);
  if (name === 'picture' || name === 'summary' || name === 'source') return children;
  const tag = aliases[name] || (tags.has(name) ? name as Tag : undefined);
  if (!tag) return [card(el, ctx, 'unknown', children)];
  if (tag === 'table' && Number(el.getAttribute('aria-rowcount')) > el.querySelectorAll('tr').length) ctx.warn('virtualized-table');
  return [flow(tag, el, children)];
}

export function extractTurn(turn: Turn, base: string, warnings: Warning[], budget: SnapshotBudget = { used: 0 }): Message {
  const begin = warnings.length;
  const ctx: Context = { base, budget, warn: (code, detail) => warnings.push({ code, detail, message: turn.index }) };
  if (turn.roleInferred) ctx.warn('role-inferred');
  const blocks = turn.roots.flatMap(root => {
    // Author elements are usually layout wrappers; preserve their inherited
    // direction without flattening a semantic root (e.g. pre, heading, table).
    if (root !== turn.source || !root.matches('div,section,article,main,li')) return parse(root, ctx);
    const children = nodes(root.childNodes, ctx);
    return root.hasAttribute('dir') ? [flow('div', root, children)] : children;
  });
  if (!blocks.length || !blocks.some(node => node.kind !== 'text' || node.text.trim())) ctx.warn('empty-message');
  const timestamp = turn.source.querySelector('time')?.getAttribute('datetime') || turn.source.getAttribute('data-timestamp') || undefined;
  return { id: turn.id, index: turn.index, role: turn.role, blocks, timestamp, status: begin === warnings.length ? 'parsed' : 'partial' };
}
