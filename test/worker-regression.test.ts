import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const token = '12345678-1234-1234-1234-123456789abc';
const preview = `chrome-extension://test-extension/preview.html#7/${token}`;
const source = { tab: { id: 7 }, frameId: 0, url: 'https://chatgpt.com/c/source' } as chrome.runtime.MessageSender;
let listener: RuntimeListener;
const tabs = { get: vi.fn(), remove: vi.fn(), create: vi.fn(), sendMessage: vi.fn() };

beforeEach(async () => {
  vi.resetModules();
  for (const mock of Object.values(tabs)) mock.mockReset();
  tabs.remove.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    action: { onClicked: { addListener: vi.fn() }, setBadgeText: vi.fn(), setTitle: vi.fn() },
    runtime: { getURL: (path: string) => 'chrome-extension://test-extension/' + path,
      onMessage: { addListener: (callback: RuntimeListener) => { listener = callback; } } },
    tabs,
  });
  await import('../src/worker');
});
afterEach(() => vi.unstubAllGlobals());

async function close(sender = source, value = { type: 'close-preview', token, tabId: 41 }) {
  const reply = vi.fn();
  expect(listener(value, sender, reply)).toBe(true);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
  return reply.mock.calls[0][0];
}

describe('cancelled preview tab ownership', () => {
  it('closes only the matching loaded or pending preview owned by the sender tab', async () => {
    for (const target of [{ url: preview }, { url: 'about:blank', pendingUrl: preview }]) {
      tabs.get.mockResolvedValue(target);
      expect(await close()).toEqual({ ok: true });
      expect(tabs.get).toHaveBeenLastCalledWith(41);
      expect(tabs.remove).toHaveBeenLastCalledWith(41);
    }
    expect(tabs.remove).toHaveBeenCalledTimes(2);
  });

  it('preserves unrelated tabs, other conversation owners, and mismatched tokens', async () => {
    for (const url of ['https://example.org/', preview.replace('#7/', '#8/'),
      preview.replace(token, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), preview + '/extra']) {
      tabs.get.mockResolvedValue({ url });
      expect(await close()).toEqual({ ok: false });
    }
    expect(tabs.remove).not.toHaveBeenCalled();
  });

  it('rejects non-ChatGPT origins, non-HTTPS sources, and child frames before looking up a tab', () => {
    for (const sender of [
      { ...source, url: 'https://chatgpt.com.evil.example/c/source' },
      { ...source, url: 'http://chatgpt.com/c/source' },
      { ...source, url: 'https://example.org/chatgpt.com/' },
      { ...source, frameId: 1 },
      { ...source, tab: undefined },
    ]) {
      const reply = vi.fn();
      expect(listener({ type: 'close-preview', token, tabId: 41 }, sender, reply)).toBeUndefined();
      expect(reply).not.toHaveBeenCalled();
    }
    expect(tabs.get).not.toHaveBeenCalled();
    expect(tabs.remove).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens and tab identifiers, and handles already-closed tabs safely', async () => {
    for (const value of [{ type: 'close-preview', token: 'bad-token', tabId: 41 },
      { type: 'close-preview', token, tabId: 41.5 }, { type: 'close-preview', token, tabId: '41' }]) {
      expect(listener(value, source, vi.fn())).toBeUndefined();
    }
    expect(tabs.get).not.toHaveBeenCalled();
    tabs.get.mockRejectedValue(new Error('No tab with id: 41'));
    expect(await close({ ...source, url: 'https://chat.openai.com/c/source' })).toEqual({ ok: false });
    expect(tabs.remove).not.toHaveBeenCalled();
  });
});
