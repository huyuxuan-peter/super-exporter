import DOMPurify from 'dompurify';
import { fetchImage, imageMime, MEDIA_MAX } from '../media';
import { walk, type Asset, type Conversation, type ExportOptions, type ImageNode, type Warning } from '../model';

export type ReadMedia = (url: string, signal: AbortSignal) => Promise<Blob | undefined>;
export const imageExtension = (mime?: string) => ({
  'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
}[mime || ''] || mime?.split('/')[1] || 'png');

const sanitizedSvg = new WeakSet<Blob>();
export function svgBlob(raw: string, onSanitized?: () => void): Blob {
  const svg = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_DATA_URI_TAGS: ['image'],
    FORBID_TAGS: ['style', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set', 'a'] });
  // DOMPurify parses a fragment through an artificial HTML body, which it also
  // lists as removed for an SVG-only profile. That wrapper is not lost content.
  let reduced = DOMPurify.removed.some(item => 'element' in item ? item.element instanceof Element && !['script', 'body'].includes(item.element.localName.toLowerCase()) :
    !!item.attribute && !/^on/i.test(item.attribute.name));
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Invalid SVG');
  for (const el of [root, ...root.querySelectorAll('*')]) for (const attr of Array.from(el.attributes)) {
    // Raster data URLs are self-contained and cannot execute SVG/HTML scripts.
    // Keep them for charts with embedded photos, but never retain network URLs.
    const embeddedRaster = el.localName === 'image' && /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(attr.value);
    const urls = [...attr.value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)];
    const unsafeCssUrl = /url\s*\(/i.test(attr.value) && (!urls.length || urls.some(match => !/^#[\w.:-]+$/.test(match[2].trim())));
    if (attr.localName === 'href' && !/^#[\w.:-]+$/.test(attr.value) && !embeddedRaster || unsafeCssUrl ||
      attr.name === 'style' && /[@\\]|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i.test(attr.value)) {
      el.removeAttributeNode(attr); reduced = true;
    }
  }
  const blob = new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
  if (reduced) { sanitizedSvg.add(blob); onSanitized?.(); }
  return blob;
}

async function decode(blob: Blob, source: string | undefined, status: Asset['status'], signal: AbortSignal): Promise<Asset> {
  if (!imageMime.test(blob.type) || !blob.size || blob.size > MEDIA_MAX) throw new Error('Unsupported image');
  if (blob.type === 'image/svg+xml') {
    const reduced = sanitizedSvg.has(blob);
    blob = svgBlob(await blob.text());
    if (reduced) sanitizedSvg.add(blob);
  }
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
    return { blob, url, source, status, width: image.naturalWidth, height: image.naturalHeight, mime: blob.type };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export type AssetCollection = { map: Map<ImageNode, Asset>; warnings: Warning[]; dispose: () => void };
export async function resolveAssets(conversation: Conversation, options: ExportOptions, readMedia: ReadMedia,
  signal: AbortSignal, progress: (done: number, total: number) => void, cache?: AssetCollection): Promise<AssetCollection> {
  const map = new Map<ImageNode, Asset>();
  const warnings: Warning[] = [];
  const promiseCache = new Map<string, Promise<Asset>>();
  const owned = new Set<string>();
  const dispose = () => { for (const url of owned) URL.revokeObjectURL(url); owned.clear(); };
  const tasks = conversation.messages.flatMap(message => [...walk(message.blocks)].filter((node): node is ImageNode => node.kind === 'image')
    .map(image => ({ image, index: message.index })));
  const origin = new URL(conversation.url).origin;
  let cursor = 0;
  let done = 0;
  const maxBytes = 180 * 1024 * 1024;
  let loadedBytes = 0;
  function track(asset: Asset) {
    if (asset.url && asset.blob) {
      loadedBytes += asset.blob.size;
      if (loadedBytes > maxBytes) {
        loadedBytes -= asset.blob.size;
        URL.revokeObjectURL(asset.url);
        throw new Error('Aggregate image budget exceeded');
      }
      owned.add(asset.url);
    }
    return asset;
  }
  function candidate(raw: string, status: Asset['status']) {
    const key = status + '\0' + raw;
    let request = promiseCache.get(key);
    if (!request) {
      request = (async () => {
        signal.throwIfAborted();
        const url = new URL(raw);
        const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(12_500)]);
        const blob = url.protocol === 'data:' ? await fetchImage(raw, fetchSignal, 'omit') :
          url.origin === origin ? await readMedia(raw, fetchSignal) :
          options.externalMedia && url.protocol === 'https:' ? await fetchImage(raw, fetchSignal, 'omit') : undefined;
        if (!blob) throw new Error('Unavailable');
        return track(await decode(blob, raw, status, signal));
      })();
      promiseCache.set(key, request);
    }
    return request;
  }
  async function find(node: ImageNode) {
    const previous = cache?.map.get(node);
    if (previous?.status === 'original-candidate' && previous.blob)
      return track(await decode(previous.blob, previous.source, previous.status, signal));
    for (const url of node.candidates) {
      try {
        const quality = url !== node.src && url === node.candidates[0] ? 'original-candidate' : 'displayed';
        return await candidate(url, quality);
      } catch { signal.throwIfAborted(); }
    }
    if (node.snapshot) {
      try {
        const blob = node.graphic === 'svg' ? svgBlob(node.snapshot) : await fetchImage(node.snapshot, signal, 'omit');
        return track(await decode(blob, node.src, 'snapshot', signal));
      } catch { signal.throwIfAborted(); }
    }
    return { status: 'missing', source: node.src } satisfies Asset;
  }
  progress(0, tasks.length);
  async function run() {
    while (cursor < tasks.length) {
      signal.throwIfAborted();
      const { image } = tasks[cursor++];
      const asset = await find(image);
      map.set(image, asset);
      progress(++done, tasks.length);
    }
  }
  const result = await Promise.allSettled(Array.from({ length: Math.min(4, tasks.length) }, run));
  const failed = result.find(item => item.status === 'rejected');
  if (failed) { dispose(); throw failed.reason; }
  const ordered = new Map<ImageNode, Asset>();
  for (const { image, index } of tasks) {
    const asset = map.get(image)!;
    ordered.set(image, asset);
    const missing = asset.status === 'missing';
    const reduced = !image.graphic && !image.src?.startsWith('data:') && asset.status !== 'original-candidate';
    if (missing || reduced) warnings.push({ code: missing ? 'image-missing' : 'image-derivative', detail: image.label, message: index });
    if (!missing && asset.mime === 'image/gif') warnings.push({ code: 'image-static', detail: image.label, message: index });
    if (asset.blob && sanitizedSvg.has(asset.blob)) warnings.push({ code: 'svg-sanitized', detail: image.label, message: index });
  }
  return { map: ordered, warnings, dispose };
}
