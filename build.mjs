import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
const files = ['manifest.json', 'preview.html', 'preview.css', 'LICENSE', 'LICENSING.md'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await Promise.all(files.map(file => cp(file, 'dist/' + file)));
await build({
  entryPoints: ['src/content.ts', 'src/worker.ts', 'src/preview.ts'],
  outdir: 'dist', bundle: true, format: 'iife', platform: 'browser',
  target: 'chrome131', minify: true, legalComments: 'eof',
  loader: { '.css': 'text' },
});
await cp('node_modules/katex/dist/katex.min.css', 'dist/katex.min.css');
await cp('node_modules/katex/dist/fonts', 'dist/fonts', { recursive: true });
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue;
  const files = await import('node:fs/promises').then(fs => fs.readdir(path));
  const licenses = files.filter(file => /^(license|licence|copying|notice|ofl)([.-]|$)/i.test(file));
  const bodies = await Promise.all(licenses.map(file => readFile(path + '/' + file, 'utf8')));
  notices.push(path.replace(/^node_modules\//, '') + '@' + info.version + ' (' + (info.license ?? 'see license') + ')\n' + bodies.join('\n'));
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n' + '='.repeat(60) + '\n\n'));
