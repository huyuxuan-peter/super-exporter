import JSZip from 'jszip';
import { t } from '../i18n';
import { walk, type Asset, type Content, type Conversation, type ExportOptions, type Flow, type ImageNode, type MathNode, type Warning } from '../model';
import { toDataUrl } from '../media';
import { imageExtension } from './assets';
import { element, renderHtml, safeMathml, type RenderContext } from './html';

// Text may itself contain Markdown or an HTML entity. Escape it before adding
// the syntax that represents the AST, otherwise a literal "- item" becomes a
// list and "&copy;" silently changes into a copyright symbol.
const escapeText = (text: string) => text.replace(/[\\`*_{}\[\]()#+.!|>~$<>&]/g, '\\$&')
  .replace(/^([ \t]*)([-=])/gm, '$1\\$2');
const labelText = (text: string) => escapeText(text.replace(/\s+/g, ' '));
const destination = (url: string) => '<' + url.replace(/[<>\s]/g, char => encodeURIComponent(char)) + '>';
const longest = (text: string, char: string) => (text.match(new RegExp(char + '+', 'g')) || []).reduce((max, run) => Math.max(max, run.length), 0);
function inlineCode(value: string): string {
  const fence = '`'.repeat(longest(value, '`') + 1);
  const space = /^[ `]|[ `]$/.test(value) && /[^ ]/.test(value) ? ' ' : '';
  return fence + space + value.replaceAll('\n', ' ') + space + fence;
}
function codeBlock(code: string, language = ''): string {
  const marker = '`'.repeat(Math.max(3, longest(code, '`') + 1));
  return '\n\n' + marker + language.replace(/[^a-zA-Z0-9+.#_-]/g, '') + '\n' + code + (code.endsWith('\n') ? '' : '\n') + marker + '\n\n';
}
function textOf(nodes: Content[]) {
  return [...walk(nodes)].flatMap(node => node.kind === 'text' ? [node.text] : []).join('');
}
function formula(node: MathNode, ctx: RenderContext): string {
  if (node.tex) return node.display ? '\n\n$$\n' + node.tex + '\n$$\n\n' : '$' + node.tex + '$';
  ctx.warn('math-markdown-fallback');
  return node.mathml ? safeMathml(node.mathml) : escapeText(node.fallback || '[Formula]');
}
function html(nodes: Content[], ctx: RenderContext): string {
  const container = element('div');
  renderHtml(nodes, container, ctx);
  // Keep HTML table blocks together in CommonMark even when a code cell contains newlines.
  return container.innerHTML.replace(/\r?\n/g, '&#10;');
}
function table(node: Flow, ctx: RenderContext): string {
  // Only descend through this table's row groups. Walking every descendant also
  // collects rows from nested tables and duplicates their content in the parent.
  const rowsOf = (children: Content[]): Flow[] => children.flatMap(item => {
    if (item.kind !== 'element') return [];
    if (item.tag === 'tr') return [item];
    return ['thead', 'tbody', 'tfoot'].includes(item.tag) ? rowsOf(item.children) : [];
  });
  const rows = rowsOf(node.children);
  const cells = rows.map(row => row.children.filter((cell): cell is Flow => cell.kind === 'element' && ['td', 'th'].includes(cell.tag)));
  const header = cells[0];
  if (!header?.length || !header.every(cell => cell.tag === 'th') || node.children.some(child => child.kind === 'element' && ['caption', 'tfoot'].includes(child.tag)) ||
    cells.some((row, index) => row.length !== header.length || row.some(cell => cell.attrs?.colspan || cell.attrs?.rowspan ||
      (index > 0 && cell.tag === 'th') || [...walk(cell.children)].some(child => child.kind === 'code' || child.kind === 'element' &&
        !['strong', 'em', 'u', 's', 'sup', 'sub', 'code', 'br', 'span', 'p', 'kbd'].includes(child.tag) ||
        child.kind === 'math' && child.display))))
    return '\n\n' + html([node], ctx) + '\n\n';
  const lines = cells.map(row => '| ' + row.map(cell => render(cell.children, ctx).trim().replace(/\n+/g, '<br>').replace(/(?<!\\)\|/g, '\\|')).join(' | ') + ' |');
  lines.splice(1, 0, '| ' + header.map(() => '---').join(' | ') + ' |');
  return '\n\n' + lines.join('\n') + '\n\n';
}
function list(node: Flow, ctx: RenderContext): string {
  let number = node.attrs?.start ?? 1;
  const lines: string[] = [];
  for (const item of node.children) {
    if (item.kind !== 'element' || item.tag !== 'li') {
      if (item.kind !== 'text' || item.text.trim()) lines.push(render([item], ctx).trim());
      continue;
    }
    number = item.attrs?.value ?? number;
    const marker = node.tag === 'ol' ? number++ + '. ' : '- ';
    const body = render(item.children, ctx).trim().split('\n');
    lines.push(marker + body[0], ...body.slice(1).map(line => line ? ' '.repeat(marker.length) + line : ''));
  }
  return '\n\n' + lines.join('\n') + '\n\n';
}
function render(nodes: readonly Content[], ctx: RenderContext): string {
  return nodes.map(node => {
    switch (node.kind) {
      case 'text': return node.preserve ? escapeText(node.text).replace(/\r\n?|\n/g, '  \n') : escapeText(node.text);
      case 'code': return codeBlock(node.code, node.language);
      case 'math': return formula(node, ctx);
      case 'image': {
        const url = ctx.imageUrl?.(node);
        return url ? '![' + labelText(node.label) + '](' + destination(url) + ')' : escapeText('[' + t(ctx.options.language, 'missed') + ' · ' + node.label + ']');
      }
      case 'link': return '[' + (render(node.children, ctx).trim() || labelText(node.href)) + '](' + destination(node.href) + ')';
      case 'card': {
        const body = render(node.children, ctx).trim();
        const label = labelText(node.label);
        const linked = node.url && [...walk(node.children)].some(child => child.kind === 'link' && child.href === node.url);
        const link = node.url && !linked ? '[' + (textOf(node.children).trim() === node.label ? '↗' : label) + '](' + destination(node.url) + ')' : '';
        const ref = node.ref ? ' (' + inlineCode(node.ref) + ')' : '';
        return [body || (!link ? label : ''), link].filter(Boolean).join(' ') + ref;
      }
      case 'element': {
        if (node.tag === 'table') return table(node, ctx);
        if (node.tag === 'ol' || node.tag === 'ul') return list(node, ctx);
        if (node.tag === 'code' || node.tag === 'kbd') return inlineCode(textOf(node.children));
        const body = render(node.children, ctx);
        if (/^h[1-6]$/.test(node.tag)) return '\n\n' + '#'.repeat(Number(node.tag[1])) + ' ' + body.trim() + '\n\n';
        switch (node.tag) {
          case 'p': case 'div': case 'figure': case 'figcaption': return '\n\n' + body.trim() + '\n\n';
          case 'strong': return body.trim() ? body.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$1**$2**$3') : body;
          case 'em': return body.trim() ? body.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$1*$2*$3') : body;
          case 's': return body.trim() ? '~~' + body.trim() + '~~' : body;
          case 'u': case 'sup': case 'sub': case 'mark': case 'small': return '<' + node.tag + '>' + body + '</' + node.tag + '>';
          case 'blockquote': return '\n\n' + body.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
          case 'hr': return '\n\n---\n\n';
          case 'br': return '  \n';
          case 'dl': return '\n\n' + html([node], ctx) + '\n\n';
          default: return body;
        }
      }
    }
  }).join('');
}

export async function markdown(conversation: Conversation, options: ExportOptions, assets: ReadonlyMap<ImageNode, Asset>,
  base: string, signal: AbortSignal) {
  const warnings: Warning[] = [];
  const paths = new Map<ImageNode, string>();
  const dedupe = new Map<Blob, string>();
  const zip = new JSZip();
  for (const [node, asset] of assets) {
    signal.throwIfAborted();
    if (!asset.blob) continue;
    let path = dedupe.get(asset.blob);
    if (!path) {
      if (options.markdownZip) {
        path = 'assets/image-' + String(dedupe.size + 1).padStart(3, '0') + '.' + imageExtension(asset.mime);
        zip.file(path, await asset.blob.arrayBuffer());
      } else {
        path = asset.source && /^https?:/.test(asset.source) ? asset.source : await toDataUrl(asset.blob);
      }
      dedupe.set(asset.blob, path);
    }
    paths.set(node, path);
  }
  if (!options.markdownZip && paths.size) warnings.push({ code: 'image-external-reference' });
  const metadata = options.frontMatter ? '---\ntitle: ' + JSON.stringify(conversation.title) + '\nexported_at: ' + JSON.stringify(conversation.at) +
    (options.sourceLink ? '\nsource: ' + JSON.stringify(conversation.url) : '') + '\n---\n\n' : '';
  const source = options.sourceLink ? '\n[' + t(options.language, 'original') + '](' + destination(conversation.url) + ')\n' : '';
  let output = metadata + '# ' + labelText(conversation.title) + '\n' + source + '\n';
  output += conversation.messages.map(message => {
    const ctx: RenderContext = { assets, options, markdown: true, imageUrl: node => paths.get(node),
      warn: (code, detail) => warnings.push({ code, detail, message: message.index }) };
    const role = t(options.language, message.role) + ' #' + message.index;
    return '## ' + escapeText(role) + (message.timestamp ? ' · ' + labelText(message.timestamp) : '') + '\n\n' + render(message.blocks, ctx).trim();
  }).join('\n\n');
  signal.throwIfAborted();
  if (options.markdownZip) {
    zip.file(base + '.md', output + '\n');
    const data = await zip.generateAsync({ type: 'blob' }, () => signal.throwIfAborted());
    return { blob: data, filename: base + '-markdown.zip', warnings };
  }
  return { blob: new Blob([output + '\n'], { type: 'text/markdown;charset=utf-8' }), filename: base + '.md', warnings };
}
