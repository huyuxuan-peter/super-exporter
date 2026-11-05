import { conversationTitle, findTurns, selectors, streaming, type Turn } from './adapter';
import { extractTurn } from './extract';
import { t } from './i18n';
import { fetchImage, toDataUrl } from './media';
import { defaults, nextFrame, walk, type Conversation, type ExportOptions, type Format, type Message, type Warning } from './model';
import type { FromContent, FromPreview, Header } from './protocol';
import { selectGroup, selectRange, type Action } from './selection';
import { platformFor } from './platforms';
import css from './panel.css';

type Session = { picked: Set<string>; expanded: Set<string>; anchor?: string; initialized: boolean };
type Job = { header: Header; messages: Message[]; allowedMedia: Set<string> };
const sessions = new Map<string, Session>();
const jobs = new Map<string, Job>();
let options = { ...defaults };
const pageKey = () => location.origin + location.pathname + location.search;
let route = pageKey();
let entries: Turn[] = [];
let signature = '';
let busy: AbortController | undefined;
let format: Format = 'pdf';
let settingsOpen = false;
let captureRevision = 0;
let snapshotRoots: HTMLElement[] = [];
let pendingRefresh: number | undefined;

const host = document.createElement('div');
host.id = 'chatgpt-rich-exporter';
const shadow = host.attachShadow({ mode: 'open' });
const stylesheet = new CSSStyleSheet();
stylesheet.replaceSync(css);
shadow.adoptedStyleSheets = [stylesheet];
const launcher = button('Export', toggle);
launcher.className = 'launcher';
const dialog = document.createElement('dialog');
dialog.style.zIndex = '2147483647';
const panel = document.createElement('div');
panel.className = 'panel';
dialog.append(panel);
shadow.append(launcher, dialog);
document.documentElement.append(host);

function label(key: Parameters<typeof t>[1]) { return t(options.language, key); }
function button(text: string, action: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.addEventListener('click', action);
  return el;
}
function toggle() {
  if (dialog.open) close();
  else { dialog.show(); refresh(true); shadow.querySelector<HTMLButtonElement>('.close')?.focus(); }
}
function close() {
  busy?.abort();
  dialog.close();
  launcher.focus();
}
dialog.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); close(); }
});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'toggle-selector') { toggle(); reply(true); }
});
chrome.storage.local.get('exportOptions').then(stored => {
  options = { ...defaults, ...stored.exportOptions as Partial<ExportOptions> | undefined };
  launcher.textContent = label('export');
  if (dialog.open) render();
}).catch(() => { launcher.textContent = label('export'); });
function session(): Session {
  let state = sessions.get(route);
  if (!state) {
    if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
    state = { picked: new Set(), expanded: new Set(), initialized: false };
    sessions.set(route, state);
  }
  return state;
}
function refresh(force = false) {
  if (route !== pageKey()) {
    route = pageKey();
    statusText = '';
    busy?.abort();
    force = true;
  }
  if (!dialog.open) return;
  entries = findTurns();
  const current = session();
  if (!current.initialized && entries.length) {
    current.picked = selectGroup(entries, current.picked, 'all');
    current.initialized = true;
  }
  const next = JSON.stringify([conversationTitle(), streaming(), entries.map(item => [item.id, item.preview, item.role])]);
  if (force || next !== signature) {
    signature = next;
    render();
  }
}
function queueRefresh() {
  if (!dialog.open || pendingRefresh !== undefined) return;
  pendingRefresh = window.setTimeout(() => { pendingRefresh = undefined; refresh(); }, 170);
}
new MutationObserver(records => {
  if (snapshotRoots.length && records.some(record => snapshotRoots.some(root => root.contains(record.target) || !root.isConnected ||
    record.type === 'attributes' && record.target instanceof Element && record.target.contains(root))))
    captureRevision++;
  if (records.some(record => !host.contains(record.target))) queueRefresh();
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true,
  attributeFilter: ['data-role', 'data-is-streaming', 'data-content', 'data-message-id', 'data-message-author-role', 'data-message-role', 'data-turn', 'data-turn-id', 'inert', 'data-testid', 'hidden', 'aria-hidden', 'aria-label', 'style', 'class', 'src', 'open'] });
window.addEventListener('popstate', queueRefresh);
let observedRoute = location.href;
setInterval(() => {
  if (observedRoute !== location.href) { observedRoute = location.href; queueRefresh(); }
}, 400);

function settingControls(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'settings';
  section.hidden = !settingsOpen;
  function setting<K extends keyof ExportOptions>(key: K, name: Parameters<typeof t>[1],
    control: HTMLInputElement | HTMLSelectElement, read: () => ExportOptions[K]) {
    const row = document.createElement('label');
    control.dataset.setting = key;
    control.setAttribute('aria-label', label(name));
    row.append(control, document.createTextNode(label(name)));
    control.addEventListener('change', () => {
      options[key] = read();
      void chrome.storage.local.set({ exportOptions: options }).catch(() => {});
      if (key === 'language') { launcher.textContent = label('export'); render(); }
    });
    section.append(row);
  }
  function select<K extends keyof ExportOptions>(key: K, name: Parameters<typeof t>[1], values: [ExportOptions[K], string][]) {
    const control = document.createElement('select');
    for (const [value, caption] of values) control.append(new Option(caption, String(value)));
    control.value = String(options[key]);
    setting(key, name, control, () => values.find(([value]) => String(value) === control.value)![0]);
  }
  function check(key: 'landscape' | 'messageBreaks' | 'toc' | 'pageNumbers' | 'markdownZip' | 'frontMatter' | 'externalMedia' | 'sourceLink') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = options[key];
    setting(key, key, input, () => input.checked);
  }
  select('language', 'language', [['zh', '中文'], ['en', 'English']]);
  select('theme', 'theme', [['light', label('light')], ['dark', label('dark')]]);
  select('paper', 'paper', [['A4', 'A4'], ['Letter', 'Letter']]);
  select('scale', 'scale', [[1, '1×'], [2, '2×'], [3, '3×']]);
  const width = document.createElement('input');
  width.type = 'number'; width.min = '420'; width.max = '2000'; width.value = String(options.width);
  setting('width', 'width', width, () => {
    const value = Math.max(420, Math.min(2000, width.valueAsNumber || defaults.width));
    width.value = String(value);
    return value;
  });
  (['landscape', 'messageBreaks', 'toc', 'pageNumbers', 'markdownZip', 'frontMatter', 'sourceLink', 'externalMedia'] as const).forEach(check);
  return section;
}
let statusText = '';
function status(text: string) {
  statusText = text;
  const el = shadow.querySelector<HTMLElement>('.status');
  if (el) el.textContent = text;
}
function render() {
  const state = session();
  const previousTop = panel.querySelector('.list')?.scrollTop || 0;
  const focus = (shadow.activeElement as HTMLElement | null)?.dataset.messageFocus;
  const heading = document.createElement('div'); heading.className = 'heading';
  const title = document.createElement('h2'); title.id = 'conversation-title'; title.textContent = conversationTitle();
  dialog.setAttribute('aria-labelledby', title.id);
  const closer = button(label('close'), close); closer.className = 'close';
  heading.append(title, button(label('settings'), () => { settingsOpen = !settingsOpen; render(); }), closer);
  const info = document.createElement('p'); info.className = 'note';
  info.textContent = entries.length ? label('coverage') : label('empty');
  const bar = document.createElement('div'); bar.className = 'bar';
  const list = document.createElement('div'); list.className = 'list';
  const foot = document.createElement('div'); foot.className = 'foot';
  const counter = document.createElement('span'); counter.className = 'spacer note';
  const exportButton = button(label('export'), () => void startExport()); exportButton.className = 'primary';
  const cancel = button(label('cancel'), () => busy?.abort());
  const select = document.createElement('select');
  select.setAttribute('aria-label', options.language === 'zh' ? '导出格式' : 'Export format');
  for (const [type, key] of [['pdf', 'fmtPdf'], ['md', 'fmtMd'], ['docx', 'fmtDocx'], ['png', 'fmtPng']] as const)
    select.append(new Option(label(key), type));
  select.value = format;
  select.onchange = () => { format = select.value as Format; };
  const checks: HTMLInputElement[] = [];
  function syncChecks() {
    checks.forEach((input, index) => { input.checked = state.picked.has(entries[index].id); });
    const count = entries.filter(entry => state.picked.has(entry.id)).length;
    counter.textContent = options.language === 'zh' ? `已选 ${count} / ${entries.length} 条消息` : `${count} / ${entries.length} selected`;
    exportButton.disabled = !count || streaming() || !!busy;
    exportButton.title = streaming() ? label('streaming') : !count ? label('noSelection') : '';
    cancel.hidden = !busy;
  }
  for (const action of ['all', 'none', 'invert'] as Action[]) {
    const tool = button(label(action), () => {
      state.picked = selectGroup(entries, state.picked, action);
      state.anchor = undefined;
      syncChecks();
    });
    tool.disabled = !!busy;
    bar.append(tool);
  }
  const scan = button(label('scan'), () => void scanOlder());
  scan.disabled = !entries.length || !!busy || streaming();
  bar.append(scan);
  if (!entries.length) bar.append(button(options.language === 'zh' ? '保存识别诊断' : 'Save detection diagnostics', () => {
    const profile = platformFor(location.href);
    const rules = { authors: selectors.authors, turns: selectors.turn, redesigned: selectors.redesigned,
      ...(profile ? { platformUser: profile.user, platformAssistant: profile.assistant } : {}) };
    const counts = Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, document.querySelectorAll(rule).length]));
    const samples = [...document.querySelectorAll<HTMLElement>(Object.values(rules).join(','))].slice(0, 30).map(node => {
      const ancestors = [];
      for (let el: HTMLElement | null = node; el && ancestors.length < 12; el = el.parentElement) {
        const css = getComputedStyle(el);
        ancestors.push({ tag: el.tagName, attributes: el.getAttributeNames(), display: css.display,
          visibility: css.visibility, hidden: el.hidden, inert: el.inert, ariaHidden: el.getAttribute('aria-hidden'),
          role: el.getAttribute('role') });
      }
      return { ancestors };
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version,
      counts, samples }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'rich-exporter-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }));
  for (const [index, entry] of entries.entries()) {
    const row = document.createElement('div'); row.className = 'row';
    const check = document.createElement('input'); check.type = 'checkbox'; check.disabled = !!busy;
    const who = (options.language === 'zh' ? '内容' : 'Content') + ' #' + entry.index;
    check.setAttribute('aria-label', who);
    check.dataset.messageFocus = entry.id;
    check.addEventListener('click', event => {
      state.picked = selectRange(entries, state.picked, index, event.shiftKey ? state.anchor : undefined, check.checked);
      state.anchor = entry.id;
      syncChecks();
    });
    checks.push(check);
    const description = document.createElement('span');
    const role = document.createElement('span'); role.className = 'role'; role.textContent = who;
    const excerpt = document.createElement('span');
    const updateExcerpt = () => {
      excerpt.textContent = (state.expanded.has(entry.id) ? entry.preview : entry.preview.slice(0, 104)) ||
        (options.language === 'zh' ? '［非文字内容］' : '[Non-text content]');
      if (excerpt.textContent.length < entry.preview.length) excerpt.textContent += '…';
    };
    updateExcerpt();
    description.append(role, excerpt);
    const actions = document.createElement('span');
    if (entry.preview.length > 104) {
      const expand = button(label(state.expanded.has(entry.id) ? 'hide' : 'show'), () => {
        if (state.expanded.has(entry.id)) state.expanded.delete(entry.id); else state.expanded.add(entry.id);
        expand.textContent = label(state.expanded.has(entry.id) ? 'hide' : 'show');
        expand.setAttribute('aria-expanded', String(state.expanded.has(entry.id)));
        updateExcerpt();
      });
      expand.setAttribute('aria-expanded', String(state.expanded.has(entry.id)));
      actions.append(expand);
    }
    actions.append(button(label('locate'), () => {
      entry.source.scrollIntoView({ block: 'center' });
      entry.source.animate([{ outline: '3px solid #249e84' }, { outline: '3px solid transparent' }], { duration: 1350 });
    }));
    row.append(check, description, actions); list.append(row);
  }
  const feedback = document.createElement('p'); feedback.className = 'status'; feedback.setAttribute('aria-live', 'polite');
  feedback.textContent = streaming() && !busy ? label('streaming') : statusText;
  syncChecks();
  foot.append(counter, select, cancel, exportButton);
  panel.replaceChildren(heading, info, bar, settingControls(), list, feedback, foot);
  list.scrollTop = previousTop;
  if (focus) checks.find(input => input.dataset.messageFocus === focus)?.focus({ preventScroll: true });
}

function scrollContainer(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 5) return parent;
  }
  return (document.scrollingElement || document.documentElement) as HTMLElement;
}
async function scanOlder() {
  if (busy || !entries.length) return;
  const original = location.href;
  const anchor = entries.find(entry => entry.source.getBoundingClientRect().bottom > 0)?.source;
  const anchorY = anchor?.getBoundingClientRect().top;
  const scroller = scrollContainer(entries[0].source);
  const start = scroller.scrollTop;
  const controller = new AbortController();
  busy = controller; status(label('scanning')); render();
  try {
    let stable = 0;
    for (let step = 0; step < 40 && stable < 3; step++) {
      controller.signal.throwIfAborted();
      if (original !== location.href) throw new Error(label('changed'));
      const before = scroller.scrollHeight;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(300, scroller.clientHeight * .9));
      await new Promise(resolve => setTimeout(resolve, 350));
      stable = scroller.scrollTop === 0 && scroller.scrollHeight === before ? stable + 1 : 0;
    }
    controller.signal.throwIfAborted();
    status(label('scanDone'));
  } catch (error) { status(controller.signal.aborted ? label('cancelled') : String(error)); }
  finally {
    if (original === location.href) scroller.scrollTop = anchor?.isConnected && anchorY !== undefined ?
      scroller.scrollTop + anchor.getBoundingClientRect().top - anchorY : start;
    busy = undefined; refresh(true);
  }
}

async function startExport() {
  if (busy || streaming()) return;
  refresh();
  const chosen = entries.filter(entry => session().picked.has(entry.id));
  if (!chosen.length) { status(label('noSelection')); return; }
  const original = location.href;
  const controller = new AbortController();
  const selectedOptions = { ...options };
  const selectedFormat = format;
  const title = conversationTitle();
  const detected = entries.length;
  const warnings: Warning[] = [];
  const messages: Message[] = [];
  const budget = { used: 0 };
  snapshotRoots = chosen.flatMap(item => item.roots);
  const revision = captureRevision;
  busy = controller; status(label('capture')); render();
  const ensureStable = () => {
    controller.signal.throwIfAborted();
    if (location.href !== original || streaming() || captureRevision !== revision || snapshotRoots.some(root => !root.isConnected))
      throw new Error(label('changed'));
  };
  try {
    for (const item of chosen) {
      ensureStable();
      messages.push(extractTurn(item, original, warnings, budget));
      if (messages.length % 6 === 0 || messages.length === chosen.length) {
        status(`${label('capture')} ${messages.length}/${chosen.length}`);
        await nextFrame();
      }
    }
    ensureStable();
    const token = crypto.randomUUID();
    const sourceUrl = new URL(original);
    sourceUrl.hash = '';
    sourceUrl.search = '';
    const conversation: Omit<Conversation, 'messages'> = { title, url: sourceUrl.href, at: new Date().toISOString(), detected,
      requested: chosen.length, coverage: 'loaded-visible', warnings };
    const allowedMedia = new Set<string>();
    for (const message of messages) for (const node of walk(message.blocks)) if (node.kind === 'image') for (const url of node.candidates) {
      const parsed = new URL(url);
      if (parsed.origin === location.origin && (parsed.protocol === 'https:' || parsed.protocol === 'blob:')) allowedMedia.add(url);
    }
    jobs.set(token, { header: { conversation, options: selectedOptions, format: selectedFormat }, messages, allowedMedia });
    const invalidate = () => jobs.delete(token);
    controller.signal.addEventListener('abort', invalidate, { once: true });
    setTimeout(() => jobs.delete(token), 45_000);
    let result;
    try { result = await chrome.runtime.sendMessage({ type: 'open-preview', token }); }
    catch (error) { jobs.delete(token); throw error; }
    finally { controller.signal.removeEventListener('abort', invalidate); }
    if (controller.signal.aborted || location.href !== original) {
      jobs.delete(token);
      if (result?.ok && Number.isInteger(result.tabId))
        await chrome.runtime.sendMessage({ type: 'close-preview', token, tabId: result.tabId }).catch(() => {});
      controller.signal.throwIfAborted();
      throw new Error(label('changed'));
    }
    if (!result?.ok) { jobs.delete(token); throw new Error(label('failed')); }
    status(label('jobOpened'));
    dialog.close();
  } catch (error) {
    status(controller.signal.aborted ? label('cancelled') : error instanceof Error ? error.message : label('failed'));
  } finally { snapshotRoots = []; busy = undefined; refresh(true); }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.sender?.url?.split('#')[0] !== chrome.runtime.getURL('preview.html')) return;
  const job = jobs.get(port.name);
  if (!job) { port.disconnect(); return; }
  jobs.delete(port.name);
  const post = (value: FromContent) => { try { port.postMessage(value); } catch { /* preview closed */ } };
  const active = new Map<string, AbortController>();
  port.onDisconnect.addListener(() => { for (const controller of active.values()) controller.abort(); });
  port.onMessage.addListener(async (request: FromPreview) => {
    if (request.type === 'cancel-media') { active.get(request.id)?.abort(); return; }
    if (request.type !== 'read-media' || active.size >= 6 || !job.allowedMedia.has(request.url)) {
      post({ type: 'media', id: request.id }); return;
    }
    const controller = new AbortController();
    active.set(request.id, controller);
    try {
      const blob = await fetchImage(request.url, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]), 'same-origin');
      post({ type: 'media', id: request.id, data: await toDataUrl(blob) });
    } catch { post({ type: 'media', id: request.id }); }
    finally { active.delete(request.id); }
  });
  void (async () => {
    post({ type: 'header', header: job.header });
    for (const [index, message] of job.messages.entries()) {
      post({ type: 'message', message });
      if ((index + 1) % 8 === 0) await nextFrame();
    }
    post({ type: 'ready' });
  })();
});
