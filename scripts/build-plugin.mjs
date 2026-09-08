// Bundle plugin/src/entry.js into plugin/code.js. The generated file is
// committed: ordinary installation needs no build step.
import { build } from '../bridge/node_modules/esbuild/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const outputPath = process.env.FCW_PLUGIN_OUT
  ? new URL(`file://${process.env.FCW_PLUGIN_OUT}`)
  : new URL('plugin/code.js', root);
const label = process.env.FCW_PLUGIN_OUT || 'plugin/code.js';
const banner = '// GENERATED FILE: build with `npm run build:plugin` in bridge/; do not edit directly.\n';
const result = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: [fileURLToPath(new URL('plugin/src/entry.js', root))],
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  target: 'es2020',
  minify: false,
  write: false,
});
const source = banner + result.outputFiles[0].text;
if (process.argv.includes('--check')) {
  const existing = await readFile(outputPath, 'utf8');
  if (existing !== source) throw new Error('plugin/code.js is stale; run npm run build:plugin');
  console.log('plugin/code.js matches plugin/src');
} else {
  await writeFile(outputPath, source);
  console.log(`built ${label} from plugin/src`);
}
