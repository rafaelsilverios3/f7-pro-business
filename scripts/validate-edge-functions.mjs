import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve('supabase/functions');
const entries = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => path.join(root, entry.name, 'index.ts'));

for (const entry of entries) {
  await build({ entryPoints: [entry], bundle: true, write: false, platform: 'neutral', format: 'esm', external: ['https://*'], logLevel: 'silent' });
}
console.log(`Validated ${entries.length} Edge Function bundle(s).`);
