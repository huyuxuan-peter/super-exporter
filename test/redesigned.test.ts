import { describe, it, expect } from 'vitest';
import { findTurns } from '../src/adapter';
import { extractTurn } from '../src/extract';
import type { Warning } from '../src/model';

describe('redesigned conversation without legacy role attributes', () => {
  it('splits a question and multi-block answer sharing a single turn key', () => {
    document.body.innerHTML = `<main data-chatgpt-conversation-selection-target><div data-turn-key="pair">
      <section data-chatgpt-search-message-ids="shared"><time>Yesterday</time><div class="bg-user-message">QUESTION ONLY</div></section>
      <section data-chatgpt-search-message-ids="shared"><div class="markdown">ANSWER ONLY</div><div class="markdown"><pre>answer_code()</pre></div><img src="/answer.png"></section>
    </div></main>`;
    const turns = findTurns();
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant']);
    expect(turns[0].id).not.toBe(turns[1].id);
    expect(turns[0].preview).not.toContain('ANSWER');
    expect(turns[1].preview).not.toContain('QUESTION');
    const question = JSON.stringify(extractTurn(turns[0], 'https://chatgpt.com/c/test', []));
    const answer = JSON.stringify(extractTurn(turns[1], 'https://chatgpt.com/c/test', []));
    expect(question).not.toMatch(/ANSWER|answer_code|answer.png/);
    expect(answer).toContain('answer_code');
    expect(answer).toContain('answer.png');
  });
  it('discovers user bubbles and assistant markdown, in order, without double counting nested search IDs', () => {
    document.body.innerHTML = `<main data-chatgpt-conversation-selection-target>
      <div data-turn-key="u"><div data-chatgpt-search-message-ids="u"><div class="bg-user-message">Question</div></div></div>
      <div data-turn-key="a"><div data-chatgpt-search-message-ids="a"><div class="markdown"><p>Answer</p></div></div></div>
    </main>`;
    const turns = findTurns();
    expect(turns.map(t => [t.id, t.role])).toEqual([['u', 'user'], ['a', 'assistant']]);
    const warnings: Warning[] = [];
    expect(JSON.stringify(extractTurn(turns[1], 'https://chatgpt.com/c/test', warnings))).toContain('Answer');
    expect(warnings.some(w => w.code === 'role-inferred')).toBe(true);
  });
  it('recognizes attribution-only legacy articles, excludes old hidden conversations and sidebars', () => {
    document.body.innerHTML = `<nav><article data-testid="conversation-turn-nav"><h5>You said:</h5>Wrong</article></nav>
      <section hidden data-chatgpt-conversation-selection-target><div data-turn-key="old"><div class="markdown">Old</div></div></section>
      <main><article data-testid="conversation-turn-1"><h5>You said:</h5><p>Question</p></article>
      <article data-testid="conversation-turn-2"><h5>ChatGPT said:</h5><p>Answer</p></article></main>`;
    expect(findTurns().map(t => t.role)).toEqual(['user', 'assistant']);
  });
  it('does not invent roles from alternating positions in unknown empty turn placeholders', () => {
    document.body.innerHTML = '<main data-chatgpt-conversation-selection-target><div data-turn-key="unknown"></div></main>';
    expect(findTurns()).toEqual([]);
  });
});
