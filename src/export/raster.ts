import { toCanvas } from 'html-to-image';
import { toDataUrl } from '../media';
import type { Asset } from '../model';

export async function ready(root: HTMLElement) {
  await document.fonts.ready;
  await Promise.allSettled([...root.querySelectorAll('img')].map(image => image.decode()));
}
let bundledFonts: Promise<string> | undefined;
export async function embeddedFonts(root: HTMLElement): Promise<string> {
  if (!root.querySelector('.katex')) return '';
  bundledFonts ??= (async () => {
    // Supply bundled fonts explicitly. The library's default resolver inserts
    // a base element, which the extension's Content Security Policy forbids.
    const sheet = document.querySelector<HTMLLinkElement>('link[href="katex.min.css"]')?.sheet;
    if (!sheet?.href) throw new Error('Bundled math stylesheet unavailable');
    const faces = Array.from(sheet.cssRules).filter((rule): rule is CSSFontFaceRule => rule.type === CSSRule.FONT_FACE_RULE);
    const embedded = await Promise.all(faces.map(async face => {
      const source = /url\(["']?(fonts\/[\w.-]+\.woff2)["']?\)/.exec(face.style.getPropertyValue('src'))?.[1];
      if (!source) throw new Error('Bundled math font unavailable');
      const response = await fetch(new URL(source, sheet.href!));
      if (!response.ok) throw new Error('Bundled math font unavailable');
      const data = await toDataUrl(await response.blob());
      return `@font-face{font-family:${face.style.fontFamily};font-style:${face.style.fontStyle};
        font-weight:${face.style.fontWeight};src:url("${data}") format("woff2")}`;
    }));
    return embedded.join('\n');
  })().catch(error => { bundledFonts = undefined; throw error; });
  return bundledFonts;
}
export async function capture(root: HTMLElement, width: number, height: number, ratio: number, fontEmbedCSS = ''): Promise<Blob> {
  const canvas = await toCanvas(root, { pixelRatio: ratio, width, height, fontEmbedCSS,
    skipAutoScale: true, preferredFontFormat: 'woff2' });
  try {
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encoding failed'));
    }, 'image/png'));
  } finally { canvas.width = canvas.height = 1; }
}
export async function asPng(asset: Asset): Promise<Blob | undefined> {
  if (!asset.blob || !asset.url || !asset.width || !asset.height) return;
  if (asset.mime === 'image/png') return asset.blob;
  const image = new Image();
  image.src = asset.url;
  try {
    await image.decode();
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 2600 / Math.max(asset.width, asset.height));
    canvas.width = Math.max(1, Math.round(asset.width * ratio));
    canvas.height = Math.max(1, Math.round(asset.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    try { return await new Promise<Blob | undefined>(resolve => canvas.toBlob(blob => resolve(blob ?? undefined))); }
    finally { canvas.width = canvas.height = 1; }
  } catch { return; }
}
