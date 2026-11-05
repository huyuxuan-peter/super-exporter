export async function download(blob: Blob, filename: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  let listener: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    await new Promise<void>((resolve, reject) => {
      const finish = (state?: string) => {
        if (state === 'complete') resolve();
        if (state === 'interrupted') reject(new Error('Chrome download interrupted'));
      };
      listener = delta => { if (delta.id === id) finish(delta.state?.current); };
      onAbort = () => {
        void chrome.downloads.cancel(id).catch(() => {});
        reject(signal.reason);
      };
      chrome.downloads.onChanged.addListener(listener);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      chrome.downloads.search({ id }).then(items => {
        if (!items[0]) reject(new Error('Chrome download unavailable'));
        else finish(items[0].state);
      }, reject);
    });
  } finally {
    if (listener) chrome.downloads.onChanged.removeListener(listener);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    URL.revokeObjectURL(url);
  }
}
