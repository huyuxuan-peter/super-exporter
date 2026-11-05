import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformFor, platformNodes, platforms } from '../src/platforms';
import { findTurns, streaming } from '../src/adapter';
afterEach(() => vi.restoreAllMocks());
export const samples = [
  ['claude.ai', '<div class="font-user-message">Q</div><div class="font-claude-response">A</div>'],
  ['gemini.google.com', '<user-query>Q</user-query><model-response>A</model-response>'],
  ['chat.deepseek.com', '<div class="user-message">Q</div><div class="ds-markdown">A</div>'],
  ['grok.com', '<div data-testid="user-message">Q</div><div data-testid="grok-response">A</div>'],
  ['chat.qwen.ai', '<div class="chat-user-message">Q</div><div class="chat-assistant-message">A</div>'],
  ['www.kimi.com', '<div class="chat-content-item-user">Q</div><div class="chat-content-item-assistant">A</div>'],
  ['www.doubao.com', '<div data-testid="user_message">Q</div><div data-testid="assistant_message">A</div>'],
  ['copilot.microsoft.com', '<div data-content="user">Q</div><div data-content="assistant">A</div>'],
];
describe('platform adapters', () => {
  for (const [host, html] of samples) it(host + ' separates authors and ignores sidebar/editor copies', () => {
    vi.spyOn(document, 'URL', 'get').mockReturnValue('https://' + host + '/chat/test');
    document.body.innerHTML = '<nav>' + html + '</nav><main>' + html + '</main><form>' + html + '</form>';
    expect(findTurns().map(t => [t.role, t.preview])).toEqual([['user', 'Q'], ['assistant', 'A']]);
  });
  it('never grants the platform allowlist to suffix attacks, HTTP or unrelated domains', () => {
    for (const p of platforms) for (const host of p.hosts) {
      expect(platformFor('https://' + host + '/chat')?.id).toBe(p.id);
      expect(platformFor('https://' + host + '.evil.example/chat')).toBeUndefined();
      expect(platformFor('http://' + host + '/chat')).toBeUndefined();
    }
  });
  it('deduplicates nested native signatures and protects active Claude generation', () => {
    vi.spyOn(document, 'URL', 'get').mockReturnValue('https://claude.ai/chat/test');
    document.body.innerHTML = '<div class="font-claude-response"><div data-is-streaming="true">A</div></div>';
    expect(platformNodes(document, platformFor(document.URL)!)).toHaveLength(1);
    expect(streaming()).toBe(true);
    document.querySelector('[data-is-streaming]')!.setAttribute('data-is-streaming', 'false');
    expect(streaming()).toBe(false);
  });
});
