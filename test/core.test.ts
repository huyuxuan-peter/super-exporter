import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findTurns, streaming } from '../src/adapter';
import { extractTurn } from '../src/extract';
import { defaults, safeUrl, filename, walk, type Conversation, type Warning } from '../src/model';
import { selectGroup, selectRange } from '../src/selection';
import { markdown } from '../src/export/markdown';
import { planSlices } from '../src/export/png';
import { exportReport } from '../src/export/report';
import { svgBlob } from '../src/export/assets';
import { toOfficeMath } from '../src/export/word-math';

function fixture() {
  const html = new DOMParser().parseFromString(readFileSync('test/fixtures/mixed.html', 'utf8'), 'text/html');
  document.title = html.title;
  document.body.replaceChildren(...html.body.childNodes);
  return findTurns();
}
const base = 'https://chatgpt.com/c/fixture';

describe('message selection', () => {
  const entries = [{ id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' }, { id: 'u2', role: 'user' }, { id: 'a2', role: 'assistant' }] as const;
  it('selects role filters, all, none and invert in DOM order', () => {
    expect([...selectGroup(entries, new Set(), 'all')]).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect([...selectGroup(entries, new Set(), 'questions')]).toEqual(['u1', 'u2']);
    expect([...selectGroup(entries, new Set(), 'answers')]).toEqual(['a1', 'a2']);
    expect([...selectGroup(entries, new Set(['u1']), 'none')]).toEqual([]);
    expect([...selectGroup(entries, new Set(['a1', 'a2']), 'invert')]).toEqual(['u1', 'u2']);
  });
  it('toggles one checkbox and selects or clears an inclusive shift range', () => {
    expect([...selectRange(entries, new Set(), 1, undefined, true)]).toEqual(['a1']);
    expect([...selectRange(entries, new Set(['a2']), 0, 'a2', true)].sort()).toEqual(['a1', 'a2', 'u1', 'u2']);
    expect([...selectRange(entries, new Set(['u1', 'a1', 'u2', 'a2']), 2, 'a1', false)]).toEqual(['u1', 'a2']);
  });
});

describe('DOM extraction and portable output', () => {
  it('reads visible canonical turns, ignores nested author wrappers and distinguishes active streaming', () => {
    expect(fixture().map(turn => [turn.id, turn.role])).toEqual([['u1', 'user'], ['a2', 'assistant'], ['u3', 'user'], ['a4', 'assistant']]);
    expect(streaming()).toBe(false);
    const stop = document.createElement('button'); stop.dataset.testid = 'stop-button'; document.body.append(stop);
    expect(streaming()).toBe(true);
  });
  it('finds the desktop transcript beside an unrelated main and ignores hidden or sidebar turns', () => {
    document.body.innerHTML = '<main hidden><div data-message-role="user">hidden</div></main>' +
      '<nav><div data-message-role="assistant">sidebar</div></nav>' +
      '<section role="main"><article data-testid="conversation-turn-1" data-turn="user">' +
      '<div data-message-author-role="user" data-message-id="real-user">visible question</div></article>' +
      '<article data-testid="conversation-turn-2" data-turn="assistant" id="real-answer"><p>visible answer</p></article></section>';
    expect(findTurns().map(turn => [turn.id, turn.preview])).toEqual([
      ['real-user', 'visible question'], ['real-answer', 'visible answer'],
    ]);
  });
  it('reads the mobile turn structure and folds the visible language into a single code block', () => {
    document.body.innerHTML = '<main><ol><li data-message-role="user" id="mobile-user">Question</li>' +
      '<li data-message-role="assistant" id="mobile-answer"><h4 data-message-attribution>ChatGPT said</h4>' +
      '<section><div><span data-message-content-controls><button aria-label="Copy code"></button></span>' +
      '<div><span>python</span></div><pre><code>print(1)</code></pre></div>' +
      '<div style="display:none">private fallback</div></section><div data-message-actions><button>Copy response</button></div></li></ol></main>';
    const turns = findTurns();
    expect(turns.map(turn => turn.id)).toEqual(['mobile-user', 'mobile-answer']);
    const extracted = [...walk(extractTurn(turns[1], base, []).blocks)];
    expect(extracted.filter(node => node.kind === 'code')).toEqual([{ kind: 'code', code: 'print(1)', language: 'python' }]);
    expect(JSON.stringify(extracted)).not.toMatch(/ChatGPT said|Copy response|private fallback/);
  });
  it('parses math once, complete code sources, captions, spans, state, citations and attachment metadata', () => {
    const [user, answer] = fixture();
    answer.source.querySelector('canvas')?.remove(); // Real canvas is exercised in Chromium.
    const warnings: Warning[] = [];
    const message = extractTurn(answer, base, warnings);
    const nodes = [...walk(message.blocks)];
    const formulas = nodes.filter(node => node.kind === 'math');
    expect(formulas.map(node => node.tex)).toEqual(['x^2', '\\frac{a}{b}', '\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}',
      '\\begin{cases}x,&x\\geq0\\\\-x,&x<0\\end{cases}', '\\begin{aligned}x&=y+z\\\\y&=z\\end{aligned}', '\\sqrt{5}']);
    expect(formulas.map(node => node.display)).toEqual([false, true, true, true, true, false]);
    expect(nodes.filter(node => node.kind === 'code').map(node => node.language)).toEqual(['python', 'cpp', 'json', 'html', 'mermaid', 'text']);
    expect(nodes.find(node => node.kind === 'code')).toMatchObject({ code: expect.stringContaining('    return x + 1\n```\nprint') });
    expect(nodes).toContainEqual(expect.objectContaining({ kind: 'element', attrs: { colspan: 3 } }));
    expect(nodes).toContainEqual(expect.objectContaining({ kind: 'element', attrs: { rowspan: 2 } }));
    expect(nodes).toContainEqual(expect.objectContaining({ kind: 'image', candidates: ['https://chatgpt.com/media/original.png', 'https://chatgpt.com/media/transparency.png'] }));
    const actualText = nodes.filter(node => node.kind === 'text').map(node => node.text).join('');
    expect(actualText).toContain('Visible route'); expect(actualText).toContain('Gain: 32');
    expect(actualText).not.toMatch(/DUPLICATE-RENDER|DO-NOT-EXPORT|Old route/);
    expect(warnings.map(item => item.code)).toEqual(expect.arrayContaining(['citation-target-missing', 'unknown-component', 'collapsed-content', 'interactive-snapshot']));
    const userNodes = [...walk(extractTurn(user, base, []).blocks)];
    expect(userNodes).toContainEqual(expect.objectContaining({ kind: 'card', type: 'file', label: 'input.pdf', ref: 'sandbox:/mnt/data/input.pdf' }));
  });
  it('preserves disjoint message order and real Markdown content without widening scope', async () => {
    const turns = fixture();
    turns[1].source.querySelector('canvas')?.remove();
    const warnings: Warning[] = [];
    const conversation: Conversation = { title: '光学', url: base, at: '2026-11-04T00:00:00Z',
      requested: 2, detected: 4, coverage: 'loaded-visible', warnings,
      messages: [turns[1], turns[3]].map(turn => extractTurn(turn, base, warnings)) };
    const out = await markdown(conversation, { ...defaults, markdownZip: false, frontMatter: true, language: 'en' }, new Map(), 'result', new AbortController().signal);
    const data = await new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(out.blob);
    });
    expect(data).toContain('title: "光学"');
    expect(data).toContain('$x^2$');
    expect(data).toContain('````python\ndef f(x):');
    expect(data).toContain('| Band | Value |');
    expect(data).toContain('colspan="3"'); expect(data).toContain('rowspan="2"');
    expect(data).toContain('TXT window last line'); expect(data).toContain('Unknown fallback readable text');
    expect(data).toContain('https://example.org/paper');
    expect(data).not.toMatch(/QUESTION-ONE|QUESTION-THREE|DUPLICATE-RENDER|DO-NOT-EXPORT/);
    expect(data.indexOf('ANSWER-TWO')).toBeLessThan(data.indexOf('ANSWER-FOUR'));
    expect(exportReport(conversation, new Map(), out.warnings, 'prepared').state).toBe('Partial');
  });
  it('keeps supported editable equations and rejects misleading flattened matrices', () => {
    expect(toOfficeMath({ kind: 'math', tex: '\\sqrt[3]{x}+\\frac{1}{2}', display: false, fallback: '' })).toBeTruthy();
    expect(toOfficeMath({ kind: 'math', tex: '\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}', display: true, fallback: '' })).toBeUndefined();
  });
  it('blocks active link schemes and removes SVG external payloads', async () => {
    expect(safeUrl('javascript:alert(1)', base)).toBeUndefined();
    expect(safeUrl('https://user:pass@example.org/a', base)).toBeUndefined();
    expect(safeUrl('/source', base)).toBe('https://chatgpt.com/source');
    expect(filename('..')).toBe('ChatGPT'); expect(filename('CON')).toBe('_CON');
    const blob = svgBlob('<svg xmlns="http://www.w3.org/2000/svg"><script>code</script><style>foo</style><image href="https://bad.example/"/><rect onload="bad()" width="10" height="10"/></svg>');
    const value = await new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
    });
    expect(value).toContain('<rect'); expect(value).not.toMatch(/bad\.example|script|onload|<style/);
  });
});
describe('PNG pagination', () => {
  it('keeps nearby graphics whole and covers every pixel', () => {
    expect(planSlices(2500, 1000, [{ top: 900, bottom: 1120, strong: true }])).toEqual([
      { start: 0, end: 900, cut: false }, { start: 900, end: 1900, cut: false }, { start: 1900, end: 2500, cut: false },
    ]);
  });
  it('marks unavoidable splits of oversized graphic elements without losing the end', () => {
    const slices = planSlices(2251, 1000, [{ top: 0, bottom: 2100, strong: true }]);
    expect(slices.filter(item => item.cut)).toHaveLength(2);
    expect(slices.at(-1)?.end).toBe(2251);
  });
});
