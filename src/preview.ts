import { warningLabel, t } from './i18n';
import { defaults, filename, walk, type Conversation, type ExportOptions, type Warning } from './model';
import type { FromContent, FromPreview, Header } from './protocol';
import { resolveAssets, type AssetCollection, type ReadMedia } from './export/assets';
import { download } from './export/download';
import { element, renderConversation } from './export/html';
import { markdown } from './export/markdown';
import { fitFormulas, png } from './export/png';
import { ready } from './export/raster';
import { exportReport } from './export/report';
import { word } from './export/word';

const byId = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const root = byId('document');
const action = byId<HTMLButtonElement>('export');
const retry = byId<HTMLButtonElement>('retry');
const cancel = byId<HTMLButtonElement>('cancel');
const details = byId<HTMLDetailsElement>('details');
const status = byId('status');
let options: ExportOptions = defaults;
let header: Header | undefined;
let conversation: Conversation | undefined;
let assets: AssetCollection | undefined;
let output: { blob: Blob; filename: string; warnings: Warning[] } | undefined;
let warnings: Warning[] = [];
let controller: AbortController | undefined;
let readMedia: ReadMedia = async () => undefined;
let finishedTransfer = false;
const label = (key: Parameters<typeof t>[1]) => t(options.language, key);

function printConfig() {
  document.documentElement.dataset.theme = options.theme;
  document.documentElement.lang = options.language;
  root.classList.toggle('page-breaks', options.messageBreaks);
  const marginBox = options.pageNumbers ? '@bottom-center{content:counter(page) " / " counter(pages);font:11px system-ui;color:#667278}' : '';
  byId('print-rules').textContent = `@page{size:${options.paper} ${options.landscape ? 'landscape' : 'portrait'};margin:14mm;${marginBox}}
    @media print{:root{--print-image-max:${options.landscape ? '155mm' : '218mm'}}}`;
}
function showReport(phase: 'prepared' | 'print-ready' | 'downloaded' | 'failed') {
  if (!conversation) return;
  const report = exportReport(conversation, assets?.map || new Map(), warnings, phase, output?.blob.size);
  details.hidden = false;
  if (report.state !== 'Complete') details.open = true;
  byId('report-title').textContent = label('warnings') + ' · ' + report.state;
  byId('counts').textContent = `${label('counts')} ${report.detected} / ${report.selected} / ${report.parsed} · ${label('content')} ${report.blocks} / ${report.formulas} / ${report.resolved}/${report.images} / ${report.unknown}` +
    (report.bytes ? ` · ${report.bytes.toLocaleString()} ${label('bytes')}` : '');
  byId('hint').textContent = label('coverage') + ' ' + (header?.format === 'pdf' ? label('printHelp') : label('previewNote')) +
    (!options.externalMedia && report.images > report.resolved ? ' ' + label('noRemote') : '');
  byId('warnings').replaceChildren(...report.warnings.map(item => element('li', [
    item.message ? '#' + item.message : '', warningLabel(options.language, item.code), item.detail,
  ].filter(Boolean).join(' · '))));
  const media = byId<HTMLDetailsElement>('media');
  media.hidden = !report.images;
  byId('media-title').textContent = options.language === 'zh' ? '媒体资源明细' : 'Media details';
  const statuses = options.language === 'zh' ?
    { 'original-candidate': '已获取候选高清资源', displayed: '页面显示资源', snapshot: '静态快照', missing: '不可用' } :
    { 'original-candidate': 'Higher-quality candidate retrieved', displayed: 'Displayed resource', snapshot: 'Static snapshot', missing: 'Unavailable' };
  const records: HTMLLIElement[] = [];
  for (const message of conversation.messages) for (const node of walk(message.blocks)) if (node.kind === 'image') {
    const asset = assets?.map.get(node);
    const urls = [...new Set([node.candidates[0], node.src, asset?.source].filter(url => url && !url.startsWith('data:')))];
    records.push(element('li', ['#' + message.index, node.label, statuses[asset?.status || 'missing'],
      asset?.width && asset.height ? asset.width + ' × ' + asset.height : undefined, asset?.mime,
      ...urls].filter(Boolean).join(' · ')));
  }
  byId('media-records').replaceChildren(...records);
  const partial = report.state === 'Partial';
  action.textContent = header?.format === 'pdf' ? label(partial ? 'continuePrint' : 'print') : label(partial ? 'proceed' : 'make');
  retry.hidden = !(report.images > report.resolved || phase === 'failed');
}
function printWidth() {
  const paperWidth = options.paper === 'A4' ? (options.landscape ? 297 : 210) : (options.landscape ? 279.4 : 215.9);
  return (paperWidth - 28) * 96 / 25.4 - 36;
}
window.addEventListener('beforeprint', () => fitFormulas(root, printWidth()));
window.addEventListener('afterprint', () => fitFormulas(root));

async function prepare(reuse = false) {
  if (!conversation || !header || controller) return;
  controller = new AbortController();
  const { signal } = controller;
  const localConversation = conversation;
  const format = header.format;
  action.disabled = true; retry.disabled = true; cancel.hidden = false;
  output = undefined;
  status.textContent = label('preparing');
  try {
    const resolved = await resolveAssets(localConversation, options, readMedia, signal, (done, total) => {
      status.textContent = `${label('assetProgress')} ${done}/${total}`;
    }, reuse ? assets : undefined);
    assets?.dispose();
    assets = resolved;
    warnings = [...resolved.warnings];
    const markupWarnings: Warning[] = [];
    renderConversation(localConversation, root, { assets: resolved.map, options,
      warn: (code, detail) => markupWarnings.push({ code, detail }) });
    await ready(root);
    fitFormulas(root, format === 'pdf' ? printWidth() : Infinity);
    signal.throwIfAborted();
    status.textContent = label('preparingFormat');
    const base = filename(localConversation.title);
    if (format === 'md') output = await markdown(localConversation, options, resolved.map, base, signal);
    if (format === 'docx') output = await word(localConversation, options, resolved.map, base, signal);
    if (format === 'png') output = await png(root, options, base, signal, (done, total) => {
      status.textContent = `${label('preparingFormat')} ${done}/${total}`;
    });
    warnings.push(...(format === 'png' || format === 'pdf' ? markupWarnings : []), ...(output?.warnings || []));
    signal.throwIfAborted();
    showReport(format === 'pdf' ? 'print-ready' : 'prepared');
    status.textContent = format === 'pdf' ? label('printReady') : label('preview');
    action.disabled = false;
  } catch (error) {
    status.textContent = signal.aborted ? label('cancelled') : label('failed') + ' · ' + (error instanceof Error ? error.message : '');
    showReport('failed');
    retry.hidden = false;
  } finally {
    cancel.hidden = true; retry.disabled = false; controller = undefined;
  }
}

retry.addEventListener('click', () => void prepare(true));
cancel.addEventListener('click', () => controller?.abort());
action.addEventListener('click', async () => {
  if (controller) return;
  if (header?.format === 'pdf') { window.print(); return; }
  if (!output) return;
  const pending = output;
  controller = new AbortController();
  const { signal } = controller;
  action.disabled = true; retry.disabled = true; cancel.hidden = false;
  try {
    await download(pending.blob, pending.filename, signal);
    showReport('downloaded');
    status.textContent = label('downloaded');
  } catch {
    status.textContent = signal.aborted ? label('cancelled') : label('failed');
    showReport('failed');
  } finally { controller = undefined; action.disabled = false; retry.disabled = false; cancel.hidden = true; }
});
window.addEventListener('pagehide', () => {
  controller?.abort();
  assets?.dispose();
});
const params = /^#(\d+)\/([a-f0-9-]{36})$/.exec(location.hash);
if (!params) {
  status.textContent = label('disconnected');
} else {
  const port = chrome.tabs.connect(Number(params[1]), { name: params[2] });
  let disconnected = false;
  const callbacks = new Map<string, (data?: string) => void>();
  function send(message: FromPreview) {
    if (!disconnected) port.postMessage(message);
  }
  readMedia = (url, signal) => new Promise((resolve, reject) => {
    if (disconnected) { resolve(undefined); return; }
    if (signal.aborted) { reject(signal.reason); return; }
    const id = crypto.randomUUID();
    function aborted() {
      callbacks.delete(id);
      try { send({ type: 'cancel-media', id }); } catch { /* disconnected */ }
      reject(signal.reason);
    }
    callbacks.set(id, async data => {
      signal.removeEventListener('abort', aborted);
      if (!data) { resolve(undefined); return; }
      try { resolve(await (await fetch(data, { signal })).blob()); } catch { resolve(undefined); }
    });
    signal.addEventListener('abort', aborted, { once: true });
    try { send({ type: 'read-media', url, id }); }
    catch { signal.removeEventListener('abort', aborted); callbacks.delete(id); resolve(undefined); }
  });
  port.onMessage.addListener((packet: FromContent) => {
    if (packet.type === 'media') { const callback = callbacks.get(packet.id); callbacks.delete(packet.id); callback?.(packet.data); return; }
    if (packet.type === 'header') {
      header = packet.header; options = header.options;
      conversation = { ...header.conversation, messages: [] };
      document.title = conversation.title + ' · ChatGPT·Gemini·Claude·DeepSeek·Grok·Qwen·Kimi·豆包·Copilot Super Exporter';
      byId('preview-title').textContent = label('preview');
      cancel.textContent = label('cancel'); retry.textContent = label('retry'); action.textContent = label('export');
      printConfig();
      status.textContent = label('preparing');
    }
    if (packet.type === 'message') conversation?.messages.push(packet.message);
    if (packet.type === 'ready' && conversation) { finishedTransfer = true; void prepare(); }
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    disconnected = true;
    for (const callback of callbacks.values()) callback();
    callbacks.clear();
    if (!finishedTransfer) status.textContent = label('disconnected');
  });
}
