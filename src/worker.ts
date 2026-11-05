import type { PreviewRequest } from './protocol';
import { platformFor } from './platforms';

chrome.action.onClicked.addListener(async tab => {
  if (tab.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-selector' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'ChatGPT·Gemini·Claude·DeepSeek·Grok·Qwen·Kimi·豆包·Copilot Super Exporter' });
  } catch {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
    await chrome.action.setTitle({ tabId: tab.id, title: 'Open or refresh a supported AI conversation to export messages.' }).catch(() => {});
  }
});
chrome.runtime.onMessage.addListener((value: PreviewRequest, sender, reply) => {
  if (!['open-preview', 'close-preview'].includes(value?.type) || !/^[a-f0-9-]{36}$/.test(value.token) || sender.tab?.id === undefined ||
    !sender.url || !platformFor(sender.url) || sender.frameId !== 0) return;
  const url = chrome.runtime.getURL('preview.html') + '#' + sender.tab.id + '/' + value.token;
  if (value.type === 'close-preview') {
    if (!Number.isInteger(value.tabId)) return;
    chrome.tabs.get(value.tabId).then(async tab => {
      if (tab.url !== url && tab.pendingUrl !== url) { reply({ ok: false }); return; }
      await chrome.tabs.remove(value.tabId);
      reply({ ok: true });
    }).catch(() => reply({ ok: false }));
  } else {
    chrome.tabs.create({ url }).then(tab => reply({ ok: true, tabId: tab.id }), () => reply({ ok: false }));
  }
  return true;
});
