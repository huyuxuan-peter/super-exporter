export type Platform = { id: string; name: string; hosts: string[]; user: string; assistant: string; stop: string };
const genericUser = '[data-message-author-role="user"],[data-message-role="user"],[data-role="user"],[data-role="human"]';
const genericAssistant = '[data-message-author-role="assistant"],[data-message-role="assistant"],[data-role="assistant"],[data-role="model"]';
const stop = 'button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="Stop response"],button[aria-label="停止回答"]';
export const platforms: Platform[] = [
  { id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'], user: genericUser, assistant: genericAssistant, stop },
  { id: 'claude', name: 'Claude', hosts: ['claude.ai'], user: '[data-testid="user-message"],.font-user-message,.human-turn', assistant: '.font-claude-response,[data-is-streaming]', stop: stop + ',[data-is-streaming="true"]' },
  { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'], user: 'user-query', assistant: 'model-response', stop: stop + ',button[aria-label="Stop"]' },
  { id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'], user: '.user-message,[data-testid="user-message"]', assistant: '.ds-markdown,[data-testid="assistant-message"]', stop },
  { id: 'grok', name: 'Grok', hosts: ['grok.com'], user: '[data-testid="user-message"],.user-message', assistant: '[data-testid="grok-response"],.grok-response,[data-testid="assistant-message"]', stop },
  { id: 'qwen', name: '通义千问', hosts: ['chat.qwen.ai','www.qianwen.com','qianwen.com','tongyi.aliyun.com'], user: '.chat-user-message,.qwen-chat-message-user', assistant: '.chat-assistant-message,.qwen-chat-message-assistant', stop },
  { id: 'kimi', name: 'Kimi', hosts: ['www.kimi.com','kimi.com','kimi.moonshot.cn'], user: '.chat-content-item-user', assistant: '.chat-content-item-assistant', stop },
  { id: 'doubao', name: '豆包', hosts: ['www.doubao.com','doubao.com'], user: '[data-testid="user-message"],[data-testid="user_message"]', assistant: '[data-testid="assistant-message"],[data-testid="assistant_message"]', stop },
  { id: 'copilot', name: 'Copilot', hosts: ['copilot.microsoft.com'], user: '[data-content="user"],.user-turn', assistant: '[data-content="assistant"],.bot-turn,[data-testid="response-message"]', stop },
];
export function platformFor(raw: string): Platform | undefined {
  try { const url = new URL(raw); return url.protocol === 'https:' ? platforms.find(p => p.hosts.includes(url.hostname)) : undefined; }
  catch { return; }
}
export function platformNodes(doc: Document, platform: Platform): { source: HTMLElement; role: 'user' | 'assistant' }[] {
  const user = platform.user + ',' + genericUser;
  const assistant = platform.assistant + ',' + genericAssistant;
  return [...doc.querySelectorAll<HTMLElement>(user + ',' + assistant)].filter(node =>
    !node.closest('nav,aside,dialog,[role="navigation"],[role="dialog"],[contenteditable="true"],form,#chatgpt-rich-exporter') &&
    !node.parentElement?.closest(user + ',' + assistant))
    .flatMap(source => {
      // Conflicting signatures are not resolved by alternating positions.
      const isUser = source.matches(user), isAssistant = source.matches(assistant);
      return isUser === isAssistant ? [] : [{ source, role: isUser ? 'user' as const : 'assistant' as const }];
    });
}
