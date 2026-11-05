import { AlignmentType, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageNumber,
  PageOrientation, Paragraph, Table, TableCell, TableOfContents, TableRow, TextRun, WidthType, Tab,
  type ILevelsOptions, type IRunOptions, type ParagraphChild } from 'docx';
import { t } from '../i18n';
import { walk, type Asset, type Content, type Conversation, type ExportOptions, type Flow, type ImageNode, type MathNode, type Warning } from '../model';
import { element, formulaElement } from './html';
import { asPng, capture, embeddedFonts, ready } from './raster';
import { toOfficeMath } from './word-math';

const textFont = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei', cs: 'Arial' };
const codeFont = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: 'Microsoft YaHei', cs: 'Arial' };
const headingLevels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5, HeadingLevel.HEADING_6] as const;
const blockTags = new Set(['p', 'div', 'ul', 'ol', 'blockquote', 'figure', 'figcaption', 'table', 'hr', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
type Block = Paragraph | Table;
type FormatRun = Partial<IRunOptions>;
type ListMarker = { reference: string; level: number };
const xmlText = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd');
function runs(text: string, style: FormatRun): TextRun[] {
  return xmlText(text).split(/\r\n|\r|\n/).map((line, index) => {
    const children = line.split(/(\t)/).filter(Boolean).map(chunk => chunk === '\t' ? new Tab() : chunk);
    return new TextRun({ font: textFont, ...style, break: index > 0 ? 1 : undefined, children });
  });
}
function graphic(data: ArrayBuffer, width: number, height: number, label: string, type: 'png' | 'jpg'): ImageRun {
  const scale = Math.min(1, 600 / width, 760 / height);
  return new ImageRun({ type, data, transformation: { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) },
    altText: { name: xmlText(label), title: xmlText(label), description: xmlText(label) } });
}

export async function word(conversation: Conversation, options: ExportOptions, assets: ReadonlyMap<ImageNode, Asset>,
  base: string, signal: AbortSignal) {
  const warnings: Warning[] = [];
  const numbering: { reference: string; levels: ILevelsOptions[] }[] = [];
  let messageIndex = 0;
  let fonts: string | undefined;
  const imageData = new Map<Blob, { data: ArrayBuffer; type: 'jpg' | 'png' }>();
  const warn = (code: string, detail?: string) => warnings.push({ code, detail, message: messageIndex });
  function markerFor(tag: 'ul' | 'ol', level: number, start: number): ListMarker {
    const reference = 'list-' + numbering.length;
    const depth = Math.min(8, level);
    numbering.push({ reference, levels: Array.from({ length: depth + 1 }, (_, n) => ({
      level: n, format: tag === 'ol' ? LevelFormat.DECIMAL : LevelFormat.BULLET,
      text: tag === 'ol' ? '%' + (n + 1) + '.' : ['•', '◦', '▪'][n % 3],
      alignment: AlignmentType.LEFT, start, style: { paragraph: { indent: { left: 390 + n * 360, hanging: 255 } } },
    })) });
    return { reference, level: depth };
  }
  async function formula(node: MathNode): Promise<ParagraphChild[]> {
    const native = toOfficeMath(node);
    if (native) return [native];
    const stage = element('div');
    stage.className = 'png-stage';
    const frame = element('div');
    frame.style.cssText = 'display:inline-block;white-space:nowrap;padding:4px;background:#fff;color:#14181b';
    const math = formulaElement(node, { assets, options, warn: () => {} });
    frame.append(math); stage.append(frame); document.body.append(stage);
    try {
      await ready(frame);
      signal.throwIfAborted();
      const width = Math.ceil(frame.getBoundingClientRect().width);
      const height = Math.ceil(frame.getBoundingClientRect().height);
      if (width < 2 || height < 2 || width > 2800 || height > 1600 || !math.querySelector('math,.katex-html')) throw new Error('Formula visual unavailable');
      fonts ??= await embeddedFonts(frame);
      const blob = await capture(frame, width, height, 2, fonts);
      warn('math-word-image');
      return [graphic(await blob.arrayBuffer(), width, height, 'Formula', 'png'),
        ...(node.tex ? runs(' [' + node.tex + ']', { size: 17, color: '565D63' }) : [])];
    } catch {
      signal.throwIfAborted();
      warn('math-word-text');
      return runs(node.tex || node.fallback || '[Formula]', { font: codeFont });
    } finally { stage.remove(); }
  }
  async function picture(node: ImageNode): Promise<ParagraphChild[]> {
    const asset = assets.get(node);
    if (asset?.blob && asset.width && asset.height) {
      let entry = imageData.get(asset.blob);
      if (!entry) {
        const jpg = asset.mime === 'image/jpeg';
        const blob = jpg ? asset.blob : await asPng(asset);
        if (blob) {
          entry = { data: await blob.arrayBuffer(), type: jpg ? 'jpg' : 'png' };
          imageData.set(asset.blob, entry);
        }
      }
      if (entry) return [graphic(entry.data, asset.width, asset.height, node.label, entry.type)];
      warn('image-word-missing', node.label);
    }
    return runs('[' + t(options.language, 'missed') + ' · ' + node.label + ']', { italics: true });
  }
  async function inline(nodes: readonly Content[], style: FormatRun = {}): Promise<ParagraphChild[]> {
    const result: ParagraphChild[] = [];
    for (const node of nodes) {
      signal.throwIfAborted();
      if (node.kind === 'text') { result.push(...runs(node.text, style)); continue; }
      if (node.kind === 'image') { result.push(...await picture(node)); continue; }
      if (node.kind === 'math') { result.push(...await formula(node)); continue; }
      if (node.kind === 'code') { result.push(...runs(node.code, { ...style, font: codeFont })); continue; }
      if (node.kind === 'link') {
        const children = await inline(node.children, { ...style, style: 'Hyperlink' });
        result.push(new ExternalHyperlink({ link: node.href, children: children.length ? children : runs(node.href, { style: 'Hyperlink' }) }));
        continue;
      }
      if (node.kind === 'card') {
        if (node.children.length) result.push(...await inline(node.children, style));
        const linked = node.url && [...walk(node.children)].some(child => child.kind === 'link' && child.href === node.url);
        if (node.url && !linked) result.push(new ExternalHyperlink({ link: node.url, children: runs((node.children.length ? ' ' : '') + node.label, { style: 'Hyperlink' }) }));
        else if (!node.children.length) result.push(...runs(node.label, { italics: true }));
        if (node.ref) result.push(...runs(' (' + node.ref + ')', { font: codeFont }));
        continue;
      }
      if (node.tag === 'br') { result.push(new TextRun({ break: 1 })); continue; }
      const change: Partial<Record<Flow['tag'], FormatRun>> = {
        strong: { bold: true }, em: { italics: true }, u: { underline: {} }, s: { strike: true }, sup: { superScript: true },
        sub: { subScript: true }, code: { font: codeFont }, kbd: { font: codeFont }, mark: { highlight: 'yellow' }, small: { size: 18 },
      };
      result.push(...await inline(node.children, { ...style, ...change[node.tag], ...(node.attrs?.dir === 'rtl' ? { rightToLeft: true } : {}) }));
    }
    return result;
  }
  function rowsOf(table: Flow): Flow[] {
    return table.children.flatMap(node => {
      if (node.kind !== 'element') return [];
      if (node.tag === 'tr') return [node];
      return ['thead', 'tbody', 'tfoot'].includes(node.tag) ? rowsOf(node) : [];
    });
  }
  async function wordTable(node: Flow): Promise<Table | undefined> {
    const rows: TableRow[] = [];
    const rowNodes = rowsOf(node);
    for (const [rowIndex, row] of rowNodes.entries()) {
      const cells: TableCell[] = [];
      const contents = row.children.filter((cell): cell is Flow => cell.kind === 'element' && ['th', 'td'].includes(cell.tag));
      for (const cell of contents) {
        const body = await blocks(cell.children);
        cells.push(new TableCell({ children: body.length ? body : [new Paragraph('')],
          columnSpan: cell.attrs?.colspan, rowSpan: cell.attrs?.rowspan ? Math.min(cell.attrs.rowspan, rowNodes.length - rowIndex) : undefined,
          shading: cell.tag === 'th' ? { fill: 'E5EEEF' } : undefined,
          margins: { top: 80, bottom: 80, left: 115, right: 115 } }));
      }
      rows.push(new TableRow({ children: cells, tableHeader: contents.length > 0 && contents.every(cell => cell.tag === 'th') }));
    }
    if (!rows.length) return;
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  }
  async function blocks(nodes: readonly Content[], depth = 0, quote = false, marker?: ListMarker): Promise<Block[]> {
    const out: Block[] = [];
    let pending: Content[] = [];
    let numbered = false;
    function numberingForFirstParagraph() {
      if (out.length || numbered || !marker) return;
      numbered = true;
      return marker;
    }
    async function flush() {
      if (!pending.length) return;
      if (pending.some(item => item.kind !== 'text' || item.text.trim())) {
        out.push(new Paragraph({ numbering: numberingForFirstParagraph(), children: await inline(pending, quote ? { italics: true } : {}),
          indent: quote ? { left: 320 } : undefined, spacing: { after: 105 } }));
      }
      pending = [];
    }
    for (const node of nodes) {
      signal.throwIfAborted();
      if (node.kind === 'card' && node.children.some(item => item.kind === 'element' && blockTags.has(item.tag) || item.kind === 'code')) {
        await flush();
        const visible = await blocks(node.children, depth, quote);
        out.push(...visible);
        if (node.url || node.ref) out.push(new Paragraph({ children: await inline([{ ...node, children: [] }]) }));
      } else if (node.kind === 'code') {
        await flush();
        if (node.language) out.push(new Paragraph({ children: runs(node.language, { font: codeFont, size: 17, color: '4F5D64' }),
          keepNext: true, spacing: { after: 35 } }));
        for (const line of node.code.split(/\r\n|\n|\r/))
          out.push(new Paragraph({ children: runs(line || ' ', { font: codeFont, size: 19 }),
            shading: { fill: 'F1F4F5' }, spacing: { after: 0, before: 0 } }));
      } else if (node.kind === 'math' && node.display) {
        await flush();
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: await formula(node), spacing: { after: 110 } }));
      } else if (node.kind === 'element' && blockTags.has(node.tag)) {
        await flush();
        if (node.tag === 'ul' || node.tag === 'ol') {
          let marker = markerFor(node.tag, depth, node.attrs?.start ?? 1);
          for (const item of node.children) {
            if (item.kind !== 'element' || item.tag !== 'li') continue;
            if (item.attrs?.value !== undefined) marker = markerFor(node.tag, depth, item.attrs.value);
            out.push(...await blocks(item.children, depth + 1, quote, marker));
          }
        } else if (node.tag === 'table') {
          const caption = node.children.find(child => child.kind === 'element' && child.tag === 'caption');
          if (caption?.kind === 'element') out.push(new Paragraph({ children: await inline(caption.children, { bold: true }), keepNext: true }));
          const table = await wordTable(node);
          if (table) out.push(table);
        } else if (node.tag === 'blockquote') out.push(...await blocks(node.children, depth, true));
        else if (node.tag === 'hr') out.push(new Paragraph({ border: { bottom: { style: 'single', color: 'B7C3C6', size: 6 } } }));
        else if (/^h[1-6]$/.test(node.tag))
          out.push(new Paragraph({ heading: headingLevels[Math.min(5, Number(node.tag[1]) - 1)], children: await inline(node.children) }));
        else if (node.tag === 'p' && !node.children.some(child => child.kind === 'math' && child.display))
          out.push(new Paragraph({ numbering: numberingForFirstParagraph(), children: await inline(node.children, quote ? { italics: true } : {}),
            bidirectional: node.attrs?.dir === 'rtl', indent: quote ? { left: 320 } : undefined, spacing: { after: 105 } }));
        else {
          // A list item's first paragraph often lives inside a neutral wrapper.
          // Carry its marker through that wrapper instead of inserting an empty
          // numbered paragraph before otherwise unnumbered text.
          const nested = await blocks(node.children, depth, quote, !out.length && !numbered ? marker : undefined);
          if (marker && !out.length && nested.length) numbered = true;
          out.push(...nested);
        }
      } else pending.push(node);
    }
    await flush();
    if (marker && !numbered) out.unshift(new Paragraph({ numbering: marker, children: [new TextRun(' ')] }));
    return out;
  }
  const body: (Block | TableOfContents)[] = [new Paragraph({ text: xmlText(conversation.title), heading: HeadingLevel.TITLE })];
  const meta: ParagraphChild[] = runs(t(options.language, 'generated') + ' · ' + conversation.at, { size: 18, color: '4F5D64' });
  if (options.sourceLink) meta.push(new ExternalHyperlink({ link: conversation.url,
    children: runs(' · ' + t(options.language, 'original'), { style: 'Hyperlink' }) }));
  body.push(new Paragraph({ children: meta }));
  if (options.toc) body.push(new TableOfContents(t(options.language, 'toc'), { hyperlink: true, headingStyleRange: '1-6' }));
  for (const [i, message] of conversation.messages.entries()) {
    messageIndex = message.index;
    const title = t(options.language, message.role) + ' #' + message.index + (message.timestamp ? ' · ' + message.timestamp : '');
    body.push(new Paragraph({ text: xmlText(title), heading: HeadingLevel.HEADING_1, keepNext: true,
      pageBreakBefore: options.messageBreaks && i > 0 }));
    body.push(...await blocks(message.blocks));
  }
  const paper = options.paper === 'A4' ? { width: 11906, height: 16838 } : { width: 12240, height: 15840 };
  const doc = new Document({ title: xmlText(conversation.title), creator: 'ChatGPT·Gemini·Claude·DeepSeek·Grok·Qwen·Kimi·豆包·Copilot Super Exporter', features: { updateFields: options.toc },
    styles: { default: { document: { run: { font: textFont, size: 22 } } } }, numbering: { config: numbering },
    sections: [{ properties: { page: { size: { ...paper, orientation: options.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT } } },
      headers: { default: new Header({ children: [new Paragraph({ children: runs(conversation.title, { size: 16, color: '565D63' }) })] }) },
      footers: options.pageNumbers ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) } : undefined,
      children: body }],
  });
  signal.throwIfAborted();
  const blob = await Packer.toBlob(doc);
  signal.throwIfAborted();
  return { blob, filename: base + '.docx', warnings };
}
