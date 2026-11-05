import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { installChromeShim } from './chrome-shim.mjs';

const dir = resolve('dist');
const output = resolve(process.env.EXPORT_TEST_OUTPUT || 'test-output');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'rich-exporter-'));
const fixture = await readFile('test/fixtures/mixed.html', 'utf8');
const pngData = await readFile('test/fixtures/transparent.png');
const errors = [];
const debug = (...values) => { if (process.env.TEST_DEBUG === '1') console.log(...values); };
const requests = [];
const remote = [];
const rendererOnly = process.env.RENDERER_ONLY === '1';
const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const verify = (type, ...paths) => JSON.parse(execFileSync(python, [resolve('test/verify-artifacts.py'), type, ...paths], { encoding: 'utf8' }));
const results = [];
let stoppedWorker;
const chromiumPath = process.env.CHROMIUM_BIN || chromium.executablePath();
if (!existsSync(chromiumPath)) throw new Error('Chromium is not installed. Run npx playwright install chromium or set CHROMIUM_BIN to an extension-capable Chromium executable.');
const environment = { acceptDownloads: true, viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1.5 };
const browser = rendererOnly ? await chromium.launch({ executablePath: chromiumPath,
  args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-gpu'] }) : undefined;
const context = browser ? await browser.newContext(environment) : await chromium.launchPersistentContext(profile, {
  executablePath: chromiumPath,
  
  ignoreDefaultArgs: ['--disable-extensions'],
  headless: process.env.HEADED !== '1',
  args: ['--disable-extensions-except=' + dir, '--load-extension=' + dir],
  ...environment,
});
const shim = rendererOnly ? '<script src="/test-preview/chrome-shim.js"></script>' : '';
const extensionPolicy = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).content_security_policy.extension_pages;
const previewHtml = await readFile(join(dir, 'preview.html'), 'utf8');
context.setDefaultTimeout(35_000);
const observePage = page => {
  page.on('pageerror', err => { errors.push(err.message); debug('Page error', err); });
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Content Security Policy')) errors.push(message.text()); });
};
context.on('page', observePage);
context.pages().forEach(observePage);
await context.route('https://chatgpt.com/**', async route => {
  const url = new URL(route.request().url());
  requests.push(url.pathname);
  if (url.pathname.startsWith('/c/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
    body: rendererOnly ? fixture.replace('</body>', shim + '<script src="/test-preview/content.js"></script></body>') : fixture });
  if (rendererOnly && /^\/test-preview\/[\w./-]+$/.test(url.pathname)) {
    const path = url.pathname.slice('/test-preview/'.length);
    const mime = { js: 'text/javascript', css: 'text/css', html: 'text/html', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' }[path.split('.').at(-1)];
    if (path === 'chrome-shim.js') return route.fulfill({ status: 200, contentType: mime,
      body: '(' + installChromeShim.toString() + ')();' });
    if (path === 'preview.html') return route.fulfill({ status: 200, contentType: mime,
      headers: { 'content-security-policy': extensionPolicy },
      body: previewHtml.replace('<script src="preview.js"', shim + '<script src="preview.js"') });
    return route.fulfill({ status: 200, contentType: mime, path: join(dir, path) });
  }
  if (url.pathname === '/media/slow.png') {
    await new Promise(resolve => setTimeout(resolve, 8000));
    return route.fulfill({ status: 200, contentType: 'image/png', body: pngData }).catch(() => {});
  }
  if (/\/(?:original|transparency|second)\.png$/.test(url.pathname))
    return route.fulfill({ status: 200, contentType: 'image/png', body: pngData });
  return route.fulfill({ status: 404, body: 'Not found' });
});
await context.route('https://blocked.example/**', route => {
  remote.push(route.request().resourceType());
  return route.fulfill({ status: 403, body: 'blocked' });
});
const site = context.pages()[0] || await context.newPage();
const panel = site.locator('#chatgpt-rich-exporter dialog');
const button = name => panel.getByRole('button', { name, exact: true });
const settings = () => button('设置').click();
const format = () => panel.getByRole('combobox', { name: '导出格式' });
async function open() { await site.locator('#chatgpt-rich-exporter .launcher').click(); await panel.waitFor(); }
async function exportPreview(type, ready = true) {
  await format().selectOption(type);
  const [page] = await Promise.all([context.waitForEvent('page'), panel.locator('button.primary').click()]);
  await page.waitForLoadState();
  debug('Preview opened', page.url(), await page.locator('#status').textContent({ timeout: 1000 }));
  if (ready) await page.waitForFunction(() => !document.getElementById('export').disabled || document.getElementById('status').textContent.includes('失败'),
    null, { timeout: 90_000 });
  if (ready) assert.equal(await page.locator('#export').isEnabled(), true, await page.locator('#status').textContent());
  return page;
}
async function downloaded(page, name) {
  debug('Downloading', name, await page.locator('#status').textContent());
  const [item] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.locator('#export').click()]);
  await item.saveAs(join(output, name));
  assert.equal(await item.failure(), null);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('下载完成'));
  return await readFile(join(output, name));
}
async function section(name, run) { const start = Date.now(); await run(); results.push({ name, state: 'passed', milliseconds: Date.now() - start }); console.log('PASS ' + name); }

try {
  if (!rendererOnly) await section('Manifest V3 extension service worker and local package', async () => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'ChatGPT·Gemini·Claude·DeepSeek·Grok·Qwen·Kimi·豆包·Copilot Super Exporter');
    assert.equal(manifest.permissions.includes('<all_urls>'), false);
    assert.equal(await worker.evaluate(() => typeof chrome.downloads.download), 'function');
    debug('MV3 worker', worker.url());
  });
  await site.goto('https://chatgpt.com/c/fixture', { waitUntil: 'domcontentloaded' });
  await site.locator('#chatgpt-rich-exporter .launcher').waitFor();

  if (!rendererOnly) await section('toolbar listener and service-worker message entry opens selector', async () => {
    const worker = context.serviceWorkers()[0];
    assert.equal(await worker.evaluate(() => chrome.action.onClicked.hasListeners()), true);
    await worker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'toggle-selector' }); return; } catch { /* unrelated tab */ }
      }
      throw new Error('No ChatGPT content-script receiver found');
    });
    await panel.waitFor();
    await button('关闭').click();
  });

  await section('selection filters, Shift range, reopening and empty selection', async () => {
    await open();
    const checked = () => panel.locator('.row input:checked').count();
    assert.equal(await checked(), 4);
    assert.equal(await button('只选问题').count(), 0); assert.equal(await button('只选回答').count(), 0);
    assert.equal(await format().locator('option[value=docx]').textContent(), 'Word (.docx) bata');
    assert.equal(await format().locator('option[value=png]').textContent(), 'PNG bata');
    await button('清空').click(); await panel.locator('.row input').nth(0).click(); await panel.locator('.row input').nth(2).click(); assert.equal(await checked(), 2);
    assert.match(await panel.locator('.row input:checked').first().getAttribute('aria-label'), /内容 #1/);
    await button('反选').click(); assert.equal(await checked(), 2);
    assert.match(await panel.locator('.row input:checked').first().getAttribute('aria-label'), /内容 #2/);
    await button('清空').click(); assert.equal(await panel.locator('button.primary').isDisabled(), true);
    await panel.locator('.row input').nth(0).click();
    await panel.locator('.row input').nth(2).click({ modifiers: ['Shift'] });
    assert.equal(await checked(), 3);
    await button('关闭').click(); await open(); assert.equal(await checked(), 3);
    await panel.locator('.row').nth(1).getByRole('button', { name: '展开' }).click();
    await panel.locator('.row').nth(1).getByRole('button', { name: '收起' }).waitFor();
    await panel.locator('.row').nth(1).getByRole('button', { name: '定位' }).click();
  });

  await section('single user message and sandbox attachment metadata in a Markdown ZIP', async () => {
    await button('清空').click(); await panel.locator('.row input').nth(0).click();
    const md = await exportPreview('md');
    const zip = await JSZip.loadAsync(await downloaded(md, 'single-user.zip'));
    const text = await Object.values(zip.files).find(file => file.name.endsWith('.md')).async('text');
    assert.match(text, /QUESTION-ONE.*光学.*한글.*日本語/);
    assert.match(text, /sandbox:\/mnt\/data\/input\.pdf/);
    assert.doesNotMatch(text, /ANSWER-TWO|QUESTION-THREE/);
    assert.match(await md.locator('#report-title').textContent(), /Partial/);
    await md.close();
  });

  if (!rendererOnly) await section('cancelling a delayed preview handshake closes the late preview tab', async () => {
    await open();
    await button('清空').click(); await panel.locator('.row input').nth(0).click();
    await format().selectOption('md');
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => {
      globalThis.__richExporterOriginalTabsCreate = chrome.tabs.create;
      chrome.tabs.create = async (...args) => {
        const tab = await globalThis.__richExporterOriginalTabsCreate.apply(chrome.tabs, args);
        await new Promise(resolve => setTimeout(resolve, 500));
        return tab;
      };
    });
    try {
      const pendingPreview = context.waitForEvent('page');
      await panel.locator('button.primary').click();
      const latePreview = await pendingPreview;
      const closed = latePreview.waitForEvent('close');
      await button('取消').click();
      await closed;
      await panel.locator('.status').getByText('已取消导出。', { exact: true }).waitFor();
      assert.equal(await panel.isVisible(), true);
      assert.equal(context.pages().some(page => page.url().includes('/preview.html')), false);
    } finally {
      await worker.evaluate(() => {
        chrome.tabs.create = globalThis.__richExporterOriginalTabsCreate;
        delete globalThis.__richExporterOriginalTabsCreate;
      });
    }
    await button('关闭').click();
  });

  if (!rendererOnly) await section('terminate idle service worker before next export', async () => {
    stoppedWorker = context.serviceWorkers()[0];
    await stoppedWorker.evaluate(() => { globalThis.__richExporterRestartSentinel = 'before-stop'; });
    const internals = await context.newPage();
    await internals.goto('chrome://serviceworker-internals');
    await internals.getByText('Stop', { exact: true }).click();
    await internals.getByText('Running Status: STOPPED', { exact: false }).waitFor();
    await internals.close();

  });

  await section('disjoint Markdown export with complete code, formulas, tables and usable image files', async () => {
    await open(); await button('清空').click(); await panel.locator('.row input').nth(1).click(); await panel.locator('.row input').nth(3).click();
    const md = await exportPreview('md');
    if (stoppedWorker) assert.equal(await context.serviceWorkers()[0].evaluate(() => globalThis.__richExporterRestartSentinel), undefined, 'Export must run in a restarted service-worker JS context');
    const zip = await JSZip.loadAsync(await downloaded(md, 'mixed-markdown.zip'));
    const text = await Object.values(zip.files).find(file => file.name.endsWith('.md')).async('text');
    for (const expected of ['ANSWER-TWO', 'ANSWER-FOUR', '光学分析', '$x^2$', '\\begin{bmatrix}', 'Level five',
      'colspan="3"', 'rowspan="2"', 'TXT window last line', 'Unknown fallback readable text', 'Visible route', 'assets/image-',
      'Missing image', 'Blocked remote image', 'https://example.org/paper', 'source label only']) assert.ok(text.includes(expected), expected);
    assert.doesNotMatch(text, /QUESTION-ONE|QUESTION-THREE|DUPLICATE-RENDER|DO-NOT-EXPORT|Old route|Exclude toolbar/);
    assert.ok(text.indexOf('ANSWER-TWO') < text.indexOf('ANSWER-FOUR'));
    const media = Object.keys(zip.files).filter(name => /assets\/image-/.test(name));
    assert.ok(media.length >= 4, media.join(','));
    const original = await zip.file('assets/image-001.png').async('nodebuffer');
    assert.deepEqual(original, pngData);
    assert.ok(requests.filter(request => request === '/media/original.png').length >= 1);
    assert.equal(remote.filter(type => type === 'fetch').length, 0);
    await md.locator('#retry').click();
    await md.waitForFunction(() => !document.getElementById('export').disabled);
    assert.match(await md.locator('#report-title').textContent(), /Partial/);
    await md.close();
  });

  await section('Word document with editable paragraphs, lists, tables and OMML; image fallback for a matrix', async () => {
    await open(); await button('清空').click(); await panel.locator('.row input').nth(1).click();
    const word = await exportPreview('docx');
    const path = 'mixed.docx';
    const zip = await JSZip.loadAsync(await downloaded(word, path));
    const xml = await zip.file('word/document.xml').async('text');
    assert.match(xml, /<m:oMath>/);
    assert.match(xml, /<m:f>/);
    assert.match(xml, /<w:tbl>/);
    assert.match(xml, /<w:gridSpan w:val="3"/);
    assert.match(xml, /<w:vMerge/);
    assert.match(xml, /<w:numPr>/);
    assert.match(xml, /<w:ilvl w:val="4"/);
    assert.match(xml, /<w:drawing>/);
    assert.match(xml, /<w:hyperlink/);
    assert.match(xml, /光学分析/);
    assert.match(xml, /TXT window last line/);
    assert.doesNotMatch(xml, /QUESTION-ONE|ANSWER-FOUR|DO-NOT-EXPORT/);
    assert.match(await word.locator('#warnings').textContent(), /Word 公式以图片/);
    const readable = verify('docx', join(output, path));
    assert.equal(readable.tables, 2); assert.ok(readable.images >= 6); assert.ok(readable.text.includes('光学分析'));
    await word.close();
  });

  await section('PDF print preview, searchable multilingual text, links and multipage output', async () => {
    await open(); await button('全选').click(); await settings();
    await panel.locator('[data-setting=landscape]').check();
    await panel.locator('[data-setting=pageNumbers]').check();
    await panel.locator('[data-setting=toc]').check();
    const pdf = await exportPreview('pdf');
    assert.match(await pdf.locator('#export').textContent(), /打印/);
    assert.equal(await pdf.locator('.katex').count(), 6);
    const path = join(output, 'mixed.pdf');
    await pdf.pdf({ path, printBackground: true, preferCSSPageSize: true });
    const readable = verify('pdf', path);
    const rendered = readable.text;
    for (const expected of ['QUESTION-ONE', 'ANSWER-TWO', 'ANSWER-FOUR', '光学分析', 'TXT window last line', 'Unknown fallback readable text'])
      assert.ok(rendered.includes(expected), expected);
    assert.doesNotMatch(rendered, /DO-NOT-EXPORT/);
    assert.ok(readable.pages >= 2);
    assert.ok(Math.abs(readable.width - 841.89) < 1 && Math.abs(readable.height - 595.28) < 1);
    assert.match(rendered, /\b1\s*\/\s*\d+/);
    assert.ok(readable.links.includes('https://example.org/paper'));
    await pdf.screenshot({ path: join(output, 'preview.png'), fullPage: true });
    await pdf.close();
  });

  await section('PNG dark theme, high DPI, bounds and ordered multi-image ZIP', async () => {
    await open();
    await site.evaluate(() => {
      const answer = document.querySelector('[data-message-id="a2"]');
      const p = document.createElement('p'); p.textContent = 'TOP-BOUNDS ' + 'Optics line that wraps as needed. '.repeat(180);
      answer.prepend(p);
      const pre = document.createElement('pre'); pre.textContent = 'UNBROKEN_' + 'W'.repeat(1000) + '\n' +
        Array.from({ length: 150 }, (_, index) => 'line ' + index + ' = ray * pixel_pitch;').join('\n') + '\nTAIL-PNG';
      answer.append(pre);
      const tail = document.createElement('figure');
      tail.innerHTML = '<svg width="360" height="42" viewBox="0 0 360 42"><rect width="360" height="42" fill="#ff02bf"/></svg>';
      answer.append(tail);
    });
    await button('清空').click(); await panel.locator('.row input').nth(1).click();
    await panel.locator('[data-setting=theme]').selectOption('dark');
    await panel.locator('[data-setting=width]').fill('640');
    await panel.locator('[data-setting=width]').press('Tab');
    await panel.locator('[data-setting=scale]').selectOption('2');
    const png = await exportPreview('png');
    const zip = await JSZip.loadAsync(await downloaded(png, 'long-png.zip'));
    const parts = Object.values(zip.files).filter(item => item.name.endsWith('.png')).sort((a, b) => a.name.localeCompare(b.name));
    assert.ok(parts.length > 2);
    const paths = [];
    for (const [index, part] of parts.entries()) {
      const path = join(output, 'page-' + index + '.png'); paths.push(path);
      const raw = await part.async('nodebuffer');
      assert.equal(raw.readUInt32BE(16), 1280);
      assert.ok(raw.readUInt32BE(20) <= 4200 && raw.readUInt32BE(20) > 100);
      await import('node:fs/promises').then(fs => fs.writeFile(path, raw));
    }
    const readable = verify('png', ...paths);
    assert.ok(readable.frames.every(frame => frame.colors > 10));
    assert.deepEqual(readable.frames[0].corner, [32, 36, 38]);
    assert.ok(readable.tailMarker);
    await png.close();
  });

  await section('streaming guard, SPA state isolation, 220 messages and cancellation', async () => {
    await open();
    await site.evaluate(() => {
      const stop = document.createElement('button'); stop.dataset.testid = 'stop-button'; document.body.append(stop);
    });
    await panel.getByText(/回答正在生成/).first().waitFor();
    assert.equal(await panel.locator('button.primary').isDisabled(), true);
    await site.evaluate(() => {
      document.querySelector('[data-testid=stop-button]').remove();
      history.pushState({}, '', '/c/long');
      document.title = 'Long fixture';
      const main = document.querySelector('main'); main.replaceChildren();
      for (let i = 0; i < 220; i++) {
        const entry = document.createElement('div');
        entry.dataset.messageAuthorRole = i % 2 ? 'assistant' : 'user';
        entry.dataset.messageId = 'long-' + i; entry.textContent = 'LONG-MESSAGE-' + i;
        if (i % 5 === 0) { const p = document.createElement('p'); p.textContent = 'Mixed multilingual 光学 🙂 ' + i; entry.append(p); }
        if (i % 5 === 1) { const pre = document.createElement('pre'); const code = document.createElement('code'); code.className = 'language-python'; code.textContent = 'mixed_code_' + i + ' = 42'; pre.append(code); entry.append(pre); }
        if (i % 5 === 2) { const formula = document.createElement('span'); formula.dataset.tex = 'x_{' + i + '}^2'; entry.append(formula); }
        if (i % 5 === 3) { const table = document.createElement('table'); table.innerHTML = '<tr><th>Mixed band</th><th>Value</th></tr><tr><td>Visible</td><td>' + i + '</td></tr>'; entry.append(table); }
        if (i % 5 === 4) { const image = new Image(); image.alt = 'Mixed image ' + i; image.src = '/media/transparency.png'; entry.append(image); }
        main.append(entry);
      }
    });
    await panel.getByText(/已选 220 \/ 220/).waitFor();
    const md = await exportPreview('md');
    const zip = await JSZip.loadAsync(await downloaded(md, '220-messages.zip'));
    const text = await Object.values(zip.files).find(file => file.name.endsWith('.md')).async('text');
    assert.equal((text.match(/LONG-MESSAGE-/g) || []).length, 220);
    assert.match(text, /LONG-MESSAGE-219/);
    assert.ok(text.includes('mixed_code_216 = 42'));
    assert.ok(text.includes('$x_{217}^2$'));
    assert.ok(text.includes('Mixed band'));
    assert.ok(text.includes('光学'));
    assert.ok(Object.keys(zip.files).some(name => name.startsWith('assets/image-')));
    await md.close();
    await open();
    await site.evaluate(() => {
      const image = new Image(); image.alt = 'slow'; image.src = '/media/slow.png';
      document.querySelector('[data-message-id="long-219"]').append(image);
    });
    const cancelled = await exportPreview('md', false);
    await cancelled.locator('#cancel').click();
    await cancelled.getByText('已取消导出。').waitFor();
    assert.equal(await cancelled.locator('#export').isDisabled(), true);
    await cancelled.close();
  });
  await section('redesigned DOM without legacy author markers exports individual messages', async () => {
    await site.evaluate(() => {
      history.pushState({}, '', '/c/redesigned');
      const main = document.querySelector('main');
      main.setAttribute('data-chatgpt-conversation-selection-target', '');
      main.innerHTML = '<div data-turn-key="shared-pair"><section data-chatgpt-search-message-ids="shared"><div class="bg-user-message">NEW-QUESTION</div></section>' +
        '<section data-chatgpt-search-message-ids="shared"><div class="markdown"><p>NEW-ANSWER 中文正文</p><pre><code>complete_source()</code></pre></div></section></div>';
    });
    await open();
    await panel.getByText(/已选 2 \/ 2/).waitFor();
    await button('清空').click(); await panel.locator('.row input').nth(1).click();
    const md = await exportPreview('md');
    const zip = await JSZip.loadAsync(await downloaded(md, 'redesigned.zip'));
    const text = await Object.values(zip.files).find(file => file.name.endsWith('.md')).async('text');
    assert.ok(text.includes('NEW-ANSWER 中文正文'));
    assert.ok(text.includes('complete_source()'));
    assert.ok(!text.includes('NEW-QUESTION'));
    await md.close();
  });
  assert.deepEqual(errors, []);
  await import('node:fs/promises').then(fs => fs.writeFile(join(output, 'browser-results.json'), JSON.stringify({ mode: rendererOnly ? 'renderer-shim' : 'real-mv3', browser: context.browser()?.version(), results, errors }, null, 2)));
  console.log((rendererOnly ? 'Headless Shell with browser API shim: ' : 'Loaded MV3 extension: ') + output);
} catch (error) {
  await import('node:fs/promises').then(fs => fs.writeFile(join(output, 'browser-results.json'), JSON.stringify({ mode: rendererOnly ? 'renderer-shim' : 'real-mv3', results, errors, failure: String(error) }, null, 2)));
  for (const page of context.pages()) debug('Last page state', page.url(), await page.locator('#status,.status').first().textContent({ timeout: 1000 }).catch(() => 'unavailable'));
  throw error;
} finally {
  await context.close();
  await browser?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
