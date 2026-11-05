import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import JSZip from 'jszip';
const cases = [
  ['claude.ai', '<div class="font-user-message">QUESTION</div><div class="font-claude-response">ANSWER 中文</div>'],
  ['gemini.google.com', '<user-query>QUESTION</user-query><model-response>ANSWER 中文</model-response>'],
  ['chat.deepseek.com', '<div class="user-message">QUESTION</div><div class="ds-markdown">ANSWER 中文</div>'],
  ['grok.com', '<div data-testid="user-message">QUESTION</div><div data-testid="grok-response">ANSWER 中文</div>'],
  ['chat.qwen.ai', '<div class="chat-user-message">QUESTION</div><div class="chat-assistant-message">ANSWER 中文</div>'],
  ['www.kimi.com', '<div class="chat-content-item-user">QUESTION</div><div class="chat-content-item-assistant">ANSWER 中文</div>'],
  ['www.doubao.com', '<div data-testid="user_message">QUESTION</div><div data-testid="assistant_message">ANSWER 中文</div>'],
  ['copilot.microsoft.com', '<div data-content="user">QUESTION</div><div data-content="assistant">ANSWER 中文</div>'],
];
const profile = await mkdtemp(join(tmpdir(), 'ai-export-platform-'));
const dir = resolve('dist'), output = resolve('test-output');
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-extensions-except=' + dir, '--load-extension=' + dir], acceptDownloads: true });
const errors = [], results = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  for (const [host, html] of cases) {
    await context.route('https://' + host + '/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>Platform fixture</title><main>' + html + '</main>' }));
    const page = await context.newPage();
    await page.goto('https://' + host + '/chat/fixture');
    await page.locator('#chatgpt-rich-exporter .launcher').click();
    const panel = page.locator('#chatgpt-rich-exporter dialog');
    await panel.locator('.row').nth(1).waitFor();
    assert.equal(await panel.locator('.row').count(), 2, host);
    await panel.getByRole('button', { name: '清空', exact: true }).click();
    await panel.locator('.row input').nth(1).click();
    assert.equal(await panel.locator('.row input:checked').count(), 1);
    await panel.getByRole('combobox', { name: '导出格式' }).selectOption('md');
    const [preview] = await Promise.all([context.waitForEvent('page'), panel.locator('.primary').click()]);
    await preview.waitForFunction(() => !document.getElementById('export')?.disabled);
    const [download] = await Promise.all([preview.waitForEvent('download'), preview.locator('#export').click()]);
    const path = join(output, host + '.zip'); await download.saveAs(path);
    const zip = await JSZip.loadAsync(await readFile(path));
    const markdown = await Object.values(zip.files).find(file => file.name.endsWith('.md')).async('text');
    assert.ok(markdown.includes('ANSWER 中文'), host);
    assert.ok(!markdown.includes('QUESTION'), host);
    await preview.close(); await page.close();
    results.push({ host, state: 'passed' }); console.log('PASS ' + host);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'platform-results.json'), JSON.stringify({ mode: 'real-mv3-fixtures', browser: context.browser().version(), results, errors }, null, 2));
} finally { await context.close(); await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
