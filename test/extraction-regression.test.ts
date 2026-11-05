import { describe, expect, it } from 'vitest';
import { findTurns, streaming } from '../src/adapter';
import { extractTurn } from '../src/extract';
import { walk, type Warning } from '../src/model';

const base = 'https://chatgpt.com/c/regression';
function extract(html: string) {
  document.body.innerHTML = html;
  const warnings: Warning[] = [];
  const turns = findTurns();
  return { turns, warnings, messages: turns.map(turn => extractTurn(turn, base, warnings)) };
}

describe('extraction visibility and complete roots', () => {
  it('keeps CSS-hidden alternate states out of both previews and exports', () => {
    const { turns, messages } = extract('<div data-message-author-role="assistant" id="answer">' +
      '<p>Visible answer</p><div style="display:none"><p>Hidden variant</p></div>' +
      '<span style="visibility:hidden">Hidden label</span>' +
      '<details><summary>Sources</summary><p>Collapsed private state</p></details></div>');
    expect(turns[0].preview).toBe('Visible answer Sources');
    expect(JSON.stringify(messages[0].blocks)).not.toMatch(/Hidden variant|Hidden label|Collapsed private state/);
  });

  it('ignores hidden stale stop controls but detects the visible generator', () => {
    document.body.innerHTML = '<div hidden><button data-testid="stop-button"></button></div>' +
      '<button data-testid="stop-generating" style="display:none"></button>';
    expect(streaming()).toBe(false);
    const active = document.createElement('button'); active.dataset.testid = 'stop-button'; document.body.append(active);
    expect(streaming()).toBe(true);
  });

  it('captures sibling source cards, pictures and SVG once while excluding action icons', () => {
    const { turns, messages } = extract('<article data-testid="conversation-turn-1">' +
      '<div data-message-author-role="assistant" id="a"><p>Answer</p></div>' +
      '<div data-source-card><a href="https://example.org/paper">Paper title</a></div>' +
      '<picture><source srcset="/original.png 2x"><img src="/thumb.png" alt="diagram"></picture>' +
      '<svg aria-label="Chart"><title>Chart</title><rect width="20" height="10"/></svg>' +
      '<div data-message-actions><button><svg aria-label="Copy icon"></svg>Copy</button></div></article>');
    expect(turns).toHaveLength(1);
    const nodes = [...walk(messages[0].blocks)];
    expect(nodes.filter(node => node.kind === 'image')).toHaveLength(2);
    expect(nodes.filter(node => node.kind === 'card' && node.type === 'citation')).toHaveLength(1);
    expect(nodes.find(node => node.kind === 'image' && !node.graphic)).toMatchObject({ candidates: [base.replace('/c/regression', '/original.png'), base.replace('/c/regression', '/thumb.png')] });
    expect(JSON.stringify(nodes)).not.toContain('Copy icon');
    expect(JSON.stringify(nodes)).not.toContain('Copy');
  });

  it('retains code lines that use data-line-number as line metadata', () => {
    const { messages } = extract('<div data-message-role="assistant"><pre><code class="language-python">' +
      '<span data-line-number="1"><span class="line-number">1</span>def f():</span>' +
      '<span data-line-number="2"><span class="line-number">2</span>    return 42</span></code></pre></div>');
    expect([...walk(messages[0].blocks)].filter(node => node.kind === 'code')).toEqual([
      { kind: 'code', language: 'python', code: 'def f():\n    return 42' },
    ]);
  });

  it('preserves a semantic message root and right-to-left container direction', () => {
    const { messages } = extract('<pre data-message-author-role="user" id="pre"><code>line 1\n  line 2</code></pre>' +
      '<div data-message-author-role="assistant" id="rtl" dir="rtl"><p>مرحبا بالعالم</p></div>');
    expect(messages[0].blocks).toEqual([{ kind: 'code', language: undefined, code: 'line 1\n  line 2' }]);
    expect(messages[1].blocks[0]).toMatchObject({ kind: 'element', tag: 'div', attrs: { dir: 'rtl' } });
  });

  it('carries stylesheet-driven SVG colours and typography into standalone snapshots', () => {
    const { messages } = extract('<div data-message-role="assistant"><style>' +
      '.graph-line { fill: rgb(12, 34, 56); stroke: rgb(90, 80, 70); stroke-width: 3px; }' +
      '.graph-label { font-size: 23px; font-weight: 700; }' +
      '</style><svg aria-label="The chart"><path class="graph-line" d="M0 0L10 10"/>' +
      '<text class="graph-label" x="1" y="10">Axis</text></svg></div>');
    const image = [...walk(messages[0].blocks)].find(node => node.kind === 'image');
    expect(image?.kind).toBe('image');
    if (image?.kind !== 'image') throw new Error('Missing SVG');
    const svg = new DOMParser().parseFromString(image.snapshot!, 'image/svg+xml');
    expect(svg.querySelector('path')?.getAttribute('fill')).toBe('rgb(12, 34, 56)');
    expect(svg.querySelector('path')?.getAttribute('stroke')).toBe('rgb(90, 80, 70)');
    expect(svg.querySelector('path')?.getAttribute('stroke-width')).toBe('3px');
    expect(svg.querySelector('text')?.getAttribute('font-size')).toBe('23px');
    expect(svg.querySelector('text')?.getAttribute('font-weight')).toBe('700');
  });


  it('keeps local message identities stable when older anonymous turns are loaded', () => {
    const { turns } = extract('<main><div data-message-role="user">Selected question</div>' +
      '<div data-message-role="assistant">Selected answer</div></main>');
    const earlier = document.createElement('div'); earlier.dataset.messageRole = 'user'; earlier.textContent = 'Older question';
    document.querySelector('main')!.prepend(earlier);
    const loaded = findTurns();
    expect(loaded[1].id).toBe(turns[0].id);
    expect(loaded[2].id).toBe(turns[1].id);
    expect(loaded[0].id).not.toBe(turns[0].id);
    // Replacing a node without a site ID cannot safely prove message identity.
    const replacement = turns[0].source.cloneNode(true); turns[0].source.replaceWith(replacement);
    expect(findTurns()[1].id).not.toBe(turns[0].id);
  });

});
