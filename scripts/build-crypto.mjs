import { build } from '../bridge/node_modules/esbuild/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const uiPath = new URL('plugin/ui.html', root);
const result = await build({
  entryPoints: [fileURLToPath(new URL('plugin/crypto-entry.js', root))],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  write: false,
});
const license = await readFile(new URL('bridge/node_modules/@noble/hashes/LICENSE', root), 'utf8');
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const block = '<!-- FCW_CRYPTO_BEGIN -->\n<script>\n/* @noble/hashes 2.4.0 — MIT\n' +
  license.trim() + '\n*/\n' + script.trim() + '\n</script>\n<!-- FCW_CRYPTO_END -->';
const source = await readFile(uiPath, 'utf8');
const marker = /<!-- FCW_CRYPTO_BEGIN -->[\s\S]*?<!-- FCW_CRYPTO_END -->/;
const output = marker.test(source)
  ? source.replace(marker, () => block)
  : source.replace("<script>\n'use strict';", () => block + "\n<script>\n'use strict';");
if (output === source && !marker.test(source)) throw new Error('UI crypto insertion point not found');
if (process.argv.includes('--check')) {
  if (source !== output) throw new Error('Bundled UI crypto is stale; run npm run build:crypto');
} else if (source !== output) {
  await writeFile(uiPath, output);
}
console.log(process.argv.includes('--check') ? 'UI crypto bundle matches pinned source' : 'UI crypto bundle ready');
