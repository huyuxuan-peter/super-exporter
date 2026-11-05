import type { Role } from './model';
import { platformFor, platformNodes } from './platforms';

export type Turn = { id: string; role: Role; index: number; source: HTMLElement; roots: HTMLElement[]; preview: string; roleInferred?: boolean };
export const selectors = {
  authors: '[data-message-author-role], [data-message-role]',
  turn: 'article[data-testid^="conversation-turn"], [data-turn-id], [data-testid^="conversation-turn"]',
  streaming: '[data-testid="stop-button"], [data-testid="stop-generating"], button[aria-label="Stop generating"], button[aria-label="停止生成"]',
  writing: '[data-testid*="writing-block"], [data-testid*="writing_block"], [data-writing-block]',
  citations: '[data-testid*="citation"], [data-testid*="source-card"], [data-testid*="web-result"], [data-citation], [data-source-card]',
  files: '[data-testid*="attachment"], [data-testid*="file-card"], [data-testid*="file-download"], [data-file-id], a[download], a[href^="sandbox:"]',
  widgets: '[data-testid*="widget"], [data-testid*="carousel"], [data-testid*="chart"], [data-testid*="product-card"], [data-testid*="map-card"], [data-widget], [role="slider"], [role="combobox"], [role="switch"], [role="radiogroup"], [role="tablist"]',
  chrome: '[data-message-attribution], [data-message-actions], [data-message-content-controls], [data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"], [data-testid="voice-play-turn-action-button"], [data-testid="regenerate-turn-action-button"], [data-testid="conversation-turn-actions"], [data-testid="code-block-copy-button"], [data-testid*="branch-switch"], [data-testid*="line-number"], [data-line-number=""], .line-numbers-rows, .line-number, .sr-only',
  roleTurns: '[data-turn="user"], [data-turn="assistant"]',
  redesigned: '[data-chatgpt-conversation-selection-target] [data-turn-key], [data-chatgpt-conversation-selection-target] [data-chatgpt-search-message-ids]',
  excluded: 'nav, aside, [role="navigation"], [role="dialog"], dialog, #prompt-textarea, [data-testid="composer"]',
};
export function hidden(el: Element): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert') ||
    /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) return true;
  const style = (el as HTMLElement).style;
  return style?.display === 'none' || style?.visibility === 'hidden' || style?.contentVisibility === 'hidden';
}
function visibleTurn(el: HTMLElement): boolean {
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    if (hidden(p) || p.matches(selectors.excluded + ',details:not([open])')) return false;
    const css = getComputedStyle(p);
    if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.contentVisibility === 'hidden') return false;
  }
  return true;
}
const splitRoles = new WeakMap<HTMLElement, Role>();
function roleOf(node: HTMLElement): Role | undefined {
  if (splitRoles.has(node)) return splitRoles.get(node);
  const role = node.dataset.messageAuthorRole ?? node.dataset.messageRole ?? node.dataset.turn;
  if (role === 'user' || role === 'assistant') return role;
  const author = node.querySelector<HTMLElement>(selectors.authors + ',' + selectors.roleTurns);
  const nestedRole = author?.dataset.messageAuthorRole ?? author?.dataset.messageRole ?? author?.dataset.turn;
  if (nestedRole === 'user' || nestedRole === 'assistant') return nestedRole;
  if (!node.matches(selectors.turn + ',' + selectors.redesigned)) return;
  const label = node.querySelector('[data-message-attribution],h4,h5,h6')?.textContent?.trim() || '';
  if (/^(you said|you|你说|您说|用户)\s*[:：]?$/i.test(label)) return 'user';
  if (/^(chatgpt said|chatgpt|assistant|助手|chatgpt 说)\s*[:：]?$/i.test(label)) return 'assistant';
  if (node.matches('.bg-user-message') || node.querySelector('.bg-user-message')) return 'user';
  if (node.querySelector('.markdown,.prose,[data-testid="copy-turn-action-button"]')) return 'assistant';
}
function previewOf(roots: HTMLElement[]): string {
  let text = '';
  // Previews follow the same visibility rules as extraction. Hidden alternate
  // answers and collapsed widget states must not appear in the selector.
  const visibility = new WeakMap<Element, boolean>();
  function visibleContent(el: Element): boolean {
    const cached = visibility.get(el);
    if (cached !== undefined) return cached;
    const css = getComputedStyle(el);
    const own = !hidden(el) && !el.matches(selectors.chrome) &&
      css.display !== 'none' && css.visibility !== 'hidden' && css.visibility !== 'collapse' && css.contentVisibility !== 'hidden';
    const closedDetails = el.parentElement instanceof HTMLDetailsElement && !el.parentElement.open && el.tagName !== 'SUMMARY';
    const result = own && !closedDetails && (!el.parentElement || visibleContent(el.parentElement));
    visibility.set(el, result);
    return result;
  }
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        return el && visibleContent(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let node = walker.nextNode(); node && text.length < 850; node = walker.nextNode()) {
      const part = node.textContent?.slice(0, 850 - text.length);
      if (part?.trim()) text += ' ' + part;
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}
let nextLocalTurnId = 0;
const localTurnIds = new WeakMap<HTMLElement, { role: Role; id: string }>();
function localTurnId(source: HTMLElement, role: Role): string {
  const previous = localTurnIds.get(source);
  if (previous?.role === role) return previous.id;
  const id = `local:${++nextLocalTurnId}:${role}`;
  localTurnIds.set(source, { role, id });
  return id;
}
export function findTurns(doc = document, includePreview = true): Turn[] {
  const platform = platformFor(doc.URL);
  if (platform && platform.id !== 'chatgpt') return platformNodes(doc, platform)
    .filter(item => visibleTurn(item.source)).map(({ source, role }, index) => ({
      id: source.dataset.messageId || source.id || localTurnId(source, role), role, index: index + 1,
      source, roots: [source], preview: includePreview ? previewOf([source]) : '', roleInferred: true,
    }));
  let discovered = [...doc.querySelectorAll<HTMLElement>(selectors.authors + ',' + selectors.roleTurns + ',' + selectors.turn + ',' + selectors.redesigned)];
  // The redesigned timeline can put BOTH authors under one turn key. A turn
  // key identifies a question/answer group, not necessarily a single message.
  for (const pair of doc.querySelectorAll<HTMLElement>('[data-chatgpt-conversation-selection-target] [data-turn-key]')) {
    const users = [...pair.querySelectorAll<HTMLElement>('.bg-user-message')].filter(el => !el.parentElement?.closest('.bg-user-message'));
    const answers = [...pair.querySelectorAll<HTMLElement>('.markdown,.prose')].filter(el =>
      !el.closest('.bg-user-message') && !el.parentElement?.closest('.markdown,.prose'));
    if (!users.length || !answers.length || !visibleTurn(pair)) continue;
    const regions = new Set<HTMLElement>();
    for (const [seeds, opposite, role] of [[users, answers, 'user'], [answers, users, 'assistant']] as const) {
      for (const seed of seeds) {
        let region = seed;
        while (region.parentElement && region.parentElement !== pair &&
          !opposite.some(other => region.parentElement!.contains(other))) region = region.parentElement;
        splitRoles.set(region, role);
        regions.add(region);
      }
    }
    discovered = discovered.filter(el => el !== pair && !pair.contains(el));
    discovered.push(...regions);
  }
  discovered.sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const candidates = discovered
    .filter(el => {
      if (!roleOf(el) || !visibleTurn(el) || el.parentElement?.closest(selectors.authors)) return false;
      // A turn wrapper can contain a more precise author element for its body.
      return splitRoles.has(el) || el.matches(selectors.authors) || !Array.from(el.querySelectorAll<HTMLElement>(selectors.authors + ',' + selectors.roleTurns))
        .some(author => roleOf(author) && visibleTurn(author));
    }).filter((el, _index, all) => !all.some(other => other !== el && other.contains(el)));
  const order = (a: HTMLElement, b: HTMLElement) => a === b ? 0 :
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  const turns: Turn[] = [];
  const seen = new Set<string>();
  for (const source of candidates) {
    const role = roleOf(source)!;
    const shell = source.closest<HTMLElement>(selectors.turn);
    const sharedShell = shell && candidates.filter(candidate => shell.contains(candidate)).length > 1;
    const stable = source.dataset.messageId || source.dataset.turnKey || source.dataset.chatgptSearchMessageIds || source.id ||
      (!sharedShell && (shell?.dataset.turnId || shell?.id));
    const id = stable ? stable + (splitRoles.has(source) ? ':' + role : '') : localTurnId(source, role);
    if (seen.has(id)) continue;
    seen.add(id);
    let roots = [source];
    if (shell && shell !== source) {
      const outside = [...shell.querySelectorAll<HTMLElement>([selectors.files, selectors.writing, selectors.widgets, selectors.citations, 'img,picture,svg,canvas,video,audio,pre,table,[role="grid"]'].join(','))]
        .filter(el => !el.contains(source) && !source.contains(el) && !candidates.some(other => other !== source && other.contains(el)) && !el.closest(selectors.authors) && !el.closest(selectors.chrome + ',button,[role="button"]') && visibleTurn(el));
      roots = [source, ...outside.filter(el => !outside.some(other => other !== el && other.contains(el)))];
      roots.sort(order);
    }
    const roleInferred = !source.matches(selectors.authors + ',' + selectors.roleTurns);
    turns.push({ id, role, index: turns.length + 1, source, roots, preview: includePreview ? previewOf(roots) : '', roleInferred });
  }
  return turns;
}
export const streaming = (doc = document) => [...doc.querySelectorAll<HTMLElement>(selectors.streaming + ',' + (platformFor(doc.URL)?.stop || selectors.streaming))].some(visibleTurn);
export function conversationTitle(doc = document): string {
  const current = doc.querySelector<HTMLElement>('nav a[aria-current="page"], nav a[data-active="true"]');
  const title = doc.title.replace(/\s*[-–|]\s*ChatGPT\s*$/i, '').trim();
  if (title && !/^ChatGPT(?:\s*:.*)?$/i.test(title)) return title;
  return current?.textContent?.trim() ||
    findTurns(doc).find(turn => turn.role === 'user')?.preview.slice(0, 100) ||
    'ChatGPT';
}
