import DOMPurify from 'dompurify';
import katex from 'katex';
import { t } from '../i18n';
import type { Asset, Content, Conversation, ExportOptions, ImageNode, MathNode, Warning } from '../model';

export type RenderContext = { assets: ReadonlyMap<ImageNode, Asset>; options: ExportOptions; warn: (code: string, detail?: string) => void;
  imageUrl?: (node: ImageNode) => string | undefined; markdown?: boolean };
export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
export function formulaMarkup(node: MathNode, output: 'htmlAndMathml' | 'mathml' = 'htmlAndMathml'): string | undefined {
  if (!node.tex) return;
  try { return katex.renderToString(node.tex, { displayMode: node.display, output, trust: false, strict: 'ignore', maxExpand: 1500, maxSize: 25 }); }
  catch { return; }
}
export function formulaElement(node: MathNode, ctx: RenderContext): HTMLElement {
  const wrapper = element(node.display ? 'div' : 'span');
  wrapper.className = node.display ? 'formula display' : 'formula';
  if (ctx.markdown) {
    const math = formulaMarkup(node, 'mathml') || node.mathml;
    if (math) wrapper.innerHTML = safeMathml(math);
    else {
      ctx.warn('math-markdown-fallback');
      wrapper.textContent = node.tex || node.fallback || '[Formula]';
    }
    return wrapper;
  }
  const rendered = formulaMarkup(node);
  if (rendered) wrapper.innerHTML = rendered;
  else {
    ctx.warn('math-render-fallback');
    if (node.visual?.includes('katex-html')) {
      const visual = DOMPurify.sanitize(node.visual, { USE_PROFILES: { html: true }, ALLOWED_TAGS: ['span'],
        ALLOWED_ATTR: ['class', 'style'], FORBID_TAGS: ['style'] });
      const template = element('template'); template.innerHTML = visual;
      for (const item of template.content.querySelectorAll<HTMLElement>('[style]')) {
        const allowed = ['height', 'width', 'min-width', 'top', 'left', 'vertical-align', 'margin-left', 'margin-right', 'border-bottom-width'];
        const style = allowed.map(key => [key, item.style.getPropertyValue(key)]).filter(([, value]) => /^-?[\d.]+(px|em|ex|%)?$/.test(value));
        item.removeAttribute('style');
        for (const [key, value] of style) item.style.setProperty(key, value);
      }
      wrapper.append(template.content);
    }
    if (!wrapper.textContent?.trim() && node.mathml) wrapper.innerHTML = safeMathml(node.mathml);
    if (!wrapper.textContent?.trim()) wrapper.textContent = node.tex || node.fallback || '[Formula]';
  }
  return wrapper;
}
export function safeMathml(raw: string): string {
  return DOMPurify.sanitize(raw, { USE_PROFILES: { mathMl: true }, FORBID_TAGS: ['annotation-xml', 'style'], FORBID_ATTR: ['href', 'xlink:href', 'style'] });
}

export function renderHtml(nodes: readonly Content[], parent: Node, ctx: RenderContext): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      if (node.preserve) {
        const text = element('span', node.text);
        text.style.whiteSpace = 'pre-wrap';
        parent.appendChild(text);
      } else parent.appendChild(document.createTextNode(node.text));
      continue;
    }
    if (node.kind === 'math') { parent.appendChild(formulaElement(node, ctx)); continue; }
    if (node.kind === 'code') {
      const pre = element('pre');
      const code = element('code', node.code);
      if (node.language) { pre.dataset.language = node.language; code.className = 'language-' + node.language.replace(/[^\w+.#-]/g, ''); }
      pre.append(code); parent.appendChild(pre); continue;
    }
    if (node.kind === 'image') {
      const asset = ctx.assets.get(node);
      const url = ctx.imageUrl ? ctx.imageUrl(node) : asset?.url;
      if (!url) {
        const box = element('span', '[' + t(ctx.options.language, 'missed') + ' · ' + node.label + ']');
        box.className = 'asset-missing'; parent.appendChild(box); continue;
      }
      const img = element('img');
      img.alt = node.label; img.src = url;
      if (!ctx.markdown) {
        img.width = asset?.width || node.width || 0; img.height = asset?.height || node.height || 0;
        if (!img.width) img.removeAttribute('width');
        if (!img.height) img.removeAttribute('height');
      }
      parent.appendChild(img); continue;
    }
    if (node.kind === 'link') {
      const link = element('a'); link.href = node.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      renderHtml(node.children, link, ctx);
      if (!link.textContent?.trim() && !link.firstChild) link.textContent = node.href;
      parent.appendChild(link); continue;
    }
    if (node.kind === 'card') {
      const card = element('span'); card.className = 'card card-' + node.type;
      const childrenHaveLabel = node.children.some(child => child.kind === 'text' && child.text.trim() === node.label);
      if (!childrenHaveLabel && !node.children.length && !node.url) card.append(element('span', node.label));
      renderHtml(node.children, card, ctx);
      if (node.url && ![...card.querySelectorAll('a')].some(link => link.href === node.url)) {
        const link = element('a', childrenHaveLabel ? '↗' : node.label);
        link.href = node.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        card.append(document.createTextNode(' '), link);
      }
      if (node.ref) card.append(document.createTextNode(' (' + node.ref + ')'));
      parent.appendChild(card); continue;
    }
    const el = element(node.tag);
    for (const [key, value] of Object.entries(node.attrs || {})) el.setAttribute(key, String(value));
    renderHtml(node.children, el, ctx);
    if (el instanceof HTMLTableElement && !ctx.markdown) {
      const columns = Array.from(el.rows, row => Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0))
        .reduce((max, count) => Math.max(max, count), 1);
      el.style.setProperty('--columns', String(columns));
    }
    parent.appendChild(el);
  }
}

export function renderConversation(conversation: Conversation, root: HTMLElement, ctx: RenderContext) {
  const { options } = ctx;
  root.replaceChildren();
  const header = element('header'); header.className = 'document-header';
  header.append(element('h1', conversation.title));
  const meta = element('p', t(options.language, 'generated') + ' · ' + new Date(conversation.at).toLocaleString(options.language));
  meta.className = 'meta';
  if (options.sourceLink) {
    const anchor = element('a', t(options.language, 'original'));
    anchor.href = conversation.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
    meta.append(document.createTextNode(' · '), anchor);
  }
  header.append(meta); root.append(header);
  if (options.toc) {
    const nav = element('nav'); nav.className = 'document-toc';
    nav.append(element('h2', t(options.language, 'toc')));
    const list = element('ol');
    for (const message of conversation.messages) {
      const item = element('li'); const link = element('a', t(options.language, message.role) + ' #' + message.index);
      link.href = '#msg-' + message.index; item.append(link); list.append(item);
    }
    nav.append(list); root.append(nav);
  }
  for (const message of conversation.messages) {
    const article = element('article'); article.id = 'msg-' + message.index;
    article.className = 'message ' + message.role;
    const heading = element('h2', t(options.language, message.role) + ' #' + message.index);
    heading.className = 'message-role';
    if (message.timestamp) heading.append(element('small', ' · ' + message.timestamp));
    const body = element('div'); body.className = 'message-body'; body.dir = 'auto';
    renderHtml(message.blocks, body, ctx);
    article.append(heading, body); root.append(article);
  }
}
