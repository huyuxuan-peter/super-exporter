import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { defaults, type Content, type Conversation } from '../src/model';
import { markdown } from '../src/export/markdown';
import { exportReport } from '../src/export/report';
import { word } from '../src/export/word';
import { svgBlob } from '../src/export/assets';

const signal = () => new AbortController().signal;
function conversation(blocks: Content[]): Conversation {
  return { title: 'Export regression', url: 'https://chatgpt.com/c/regression', at: '2026-11-05T00:00:00Z',
    requested: 1, detected: 1, coverage: 'loaded-visible', warnings: [],
    messages: [{ id: 'a1', index: 1, role: 'assistant', status: 'parsed', blocks }] };
}
function read(blob: Blob, binary = false): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    if (binary) reader.readAsArrayBuffer(blob); else reader.readAsText(blob);
  });
}

describe('export integrity regressions', () => {
  it('keeps embedded SVG raster images and local paint references, and reports removed visible content', async () => {
    let reduced = false;
    const clean = svgBlob('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"/></defs>' +
      '<image href="data:image/png;base64,iVBORw0KGgo="/><rect style="fill:url(#paint);stroke:red"/></svg>', () => { reduced = true; });
    const markup = await read(clean);
    expect(markup).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(markup).toContain('fill:url(#paint)');
    expect(reduced).toBe(false);
    const unsafe = svgBlob('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Visible</div></foreignObject>' +
      '<rect style="fill:url(https://example.org/image.svg)"/></svg>', () => { reduced = true; });
    expect(reduced).toBe(true);
    expect(await read(unsafe)).not.toMatch(/foreignObject|example\.org/);
  });

  it('keeps literal Markdown punctuation and HTML entity text literal', async () => {
    const input = conversation([{ kind: 'text', preserve: true, text: '- literal list\n---\nA &copy; B\n===' }]);
    const result = await markdown(input, { ...defaults, markdownZip: false }, new Map(), 'test', signal());
    const text = await read(result.blob);
    expect(text).toContain('\\- literal list');
    expect(text).toContain('\\---');
    expect(text).toContain('A \\&copy; B');
    expect(text).toContain('\\===');
  });

  it('never labels empty, partially parsed, or unknown content Complete without warnings', () => {
    const empty = conversation([]);
    const emptyReport = exportReport(empty, new Map(), [], 'downloaded', 100);
    expect(emptyReport.state).toBe('Partial');
    expect(emptyReport.parsed).toBe(0);
    expect(emptyReport.warnings).toContainEqual({ code: 'empty-message', message: 1 });
    const partial = conversation([{ kind: 'text', text: 'Visible part' }]);
    partial.messages[0].status = 'partial';
    expect(exportReport(partial, new Map(), [], 'prepared').state).toBe('Partial');
    expect(exportReport(partial, new Map(), [], 'prepared').warnings).toContainEqual({ code: 'message-partial', message: 1 });
    const unknown = conversation([{ kind: 'card', type: 'unknown', label: 'custom-widget', children: [{ kind: 'text', text: 'Fallback' }] }]);
    const unknownReport = exportReport(unknown, new Map(), [], 'downloaded');
    expect(unknownReport.state).toBe('Partial');
    expect(unknownReport.unknown).toBe(1);
    expect(unknownReport.warnings).toContainEqual({ code: 'unknown-component', detail: 'custom-widget', message: 1 });
  });

  it('writes the correct Word heading levels and attaches numbering to wrapped list text', async () => {
    const input = conversation([
      ...[1, 2, 6].map(level => ({ kind: 'element' as const, tag: ('h' + level) as 'h1' | 'h2' | 'h6', children: [{ kind: 'text' as const, text: 'Heading ' + level }] })),
      { kind: 'element', tag: 'ol', children: [{ kind: 'element', tag: 'li', children: [{ kind: 'element', tag: 'div', children: [
        { kind: 'element', tag: 'p', children: [{ kind: 'text', text: 'Wrapped numbered text' }] },
      ] }] }] },
    ]);
    const result = await word(input, defaults, new Map(), 'test', signal());
    const zip = await JSZip.loadAsync(await read(result.blob, true) as ArrayBuffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    const paragraphs = Array.from(parsed.getElementsByTagName('w:p'));
    for (const level of [1, 2, 6]) {
      const paragraph = paragraphs.find(node => node.textContent === 'Heading ' + level)!;
      expect(paragraph.getElementsByTagName('w:pStyle')[0].getAttribute('w:val')).toBe('Heading' + level);
    }
    const item = paragraphs.find(node => node.textContent === 'Wrapped numbered text')!;
    expect(item.getElementsByTagName('w:numPr')).toHaveLength(1);
    expect(paragraphs.filter(node => node.getElementsByTagName('w:numPr').length)).toHaveLength(1);
  });
});
