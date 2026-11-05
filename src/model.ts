export type Role = 'user' | 'assistant';
export type Format = 'md' | 'pdf' | 'docx' | 'png';
export type Language = 'zh' | 'en';
export type Tag = 'p' | 'div' | 'span' | 'strong' | 'em' | 'u' | 's' | 'sup' | 'sub' | 'small' |
  'mark' | 'kbd' | 'code' | 'br' | 'hr' | 'blockquote' | 'ul' | 'ol' | 'li' | 'figure' |
  'figcaption' | 'table' | 'caption' | 'thead' | 'tbody' | 'tfoot' | 'tr' | 'td' | 'th' |
  'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'time' | 'dl' | 'dt' | 'dd';
export type Flow = { kind: 'element'; tag: Tag; children: Content[];
  attrs?: { colspan?: number; rowspan?: number; start?: number; value?: number; dir?: 'rtl' | 'ltr' | 'auto'; title?: string; datetime?: string } };
export type MathNode = { kind: 'math'; tex?: string; mathml?: string; visual?: string; display: boolean; fallback: string };
export type ImageNode = { kind: 'image'; label: string; src?: string; candidates: string[];
  snapshot?: string; width?: number; height?: number; graphic?: 'canvas' | 'svg' | 'video' };
export type Card = { kind: 'card'; type: 'citation' | 'file' | 'widget' | 'unknown'; label: string; children: Content[]; url?: string; ref?: string };
export type InlineNode = { kind: 'text'; text: string; preserve?: boolean } | { kind: 'link'; href: string; children: Content[] } | MathNode;
export type ContentBlock = Flow | { kind: 'code'; code: string; language?: string } | ImageNode | Card;
export type Content = InlineNode | ContentBlock;
export type Warning = { code: string; detail?: string; message?: number };
export type Message = { id: string; index: number; role: Role; blocks: Content[]; timestamp?: string; status: 'parsed' | 'partial' };
export type Conversation = { title: string; url: string; at: string; detected: number; requested: number;
  messages: Message[]; warnings: Warning[]; coverage: 'loaded-visible' };
export type Asset = { status: 'original-candidate' | 'displayed' | 'snapshot' | 'missing'; source?: string; mime?: string;
  blob?: Blob; width?: number; height?: number; url?: string };
export type ExportOptions = { language: Language; theme: 'light' | 'dark'; width: number; scale: 1 | 2 | 3;
  paper: 'A4' | 'Letter'; landscape: boolean; messageBreaks: boolean; toc: boolean; pageNumbers: boolean;
  markdownZip: boolean; frontMatter: boolean; externalMedia: boolean; sourceLink: boolean };
export const defaults: ExportOptions = { language: 'zh', theme: 'light', width: 960, scale: 2, paper: 'A4',
  landscape: false, messageBreaks: false, toc: false, pageNumbers: false, markdownZip: true, frontMatter: false,
  externalMedia: false, sourceLink: true };
export type ExportReport = { state: 'Complete' | 'Partial' | 'Failed'; phase: 'prepared' | 'downloaded' | 'print-ready' | 'failed';
  detected: number; selected: number; parsed: number; blocks: number; formulas: number; images: number; resolved: number;
  unknown: number; bytes?: number; warnings: Warning[] };
export function* walk(nodes: readonly Content[]): Generator<Content> {
  for (const node of nodes) {
    yield node;
    if ('children' in node) yield* walk(node.children);
  }
}
export function safeUrl(raw: string | null | undefined, base: string, media = false): string | undefined {
  if (!raw?.trim() || raw.trim() === '#') return;
  if (media && /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(raw)) return raw;
  try {
    const url = new URL(raw, base);
    if (url.username || url.password) return;
    if ((media ? ['https:', 'http:', 'blob:'] : ['https:', 'http:', 'mailto:']).includes(url.protocol)) return url.href;
  } catch { /* invalid URL */ }
}
export function filename(value: string): string {
  const name = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? '_' + name : [...name].slice(0, 90).join('') || 'ChatGPT';
}
export const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));
