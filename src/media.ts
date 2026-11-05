export const MEDIA_MAX = 24 * 1024 * 1024;
export const imageMime = /^image\/(?:png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i;
export async function fetchImage(url: string, signal: AbortSignal, credentials: 'omit' | 'same-origin'): Promise<Blob> {
  const response = await fetch(url, { credentials, redirect: 'error', referrerPolicy: 'no-referrer', signal });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!imageMime.test(mime) || Number(response.headers.get('content-length')) > MEDIA_MAX) throw new Error('Unsupported media');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty media');
  const buffers: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MEDIA_MAX) throw new Error('Media size limit');
      buffers.push(new Uint8Array(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!length) throw new Error('Empty media');
  return new Blob(buffers, { type: mime });
}
export function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
