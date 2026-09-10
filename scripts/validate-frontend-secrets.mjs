import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(target));
    else if (/\.(js|jsx|ts|tsx|html|css)$/.test(entry.name)) output.push(target);
  }
  return output;
}
const forbidden = [/SUPABASE_SERVICE_ROLE_KEY/, /WHATSAPP_ACCESS_TOKEN/, /WHATSAPP_APP_SECRET/, /AI_API_KEY/, /WEB_SEARCH_API_KEY/, /api\.openai\.com/i, /api\.search\.brave\.com/i, /graph\.facebook\.com/i];
for (const file of [...await files(path.resolve('src')), ...await files(path.resolve('public'))]) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(content)) throw new Error(`${path.relative(process.cwd(), file)} contains forbidden frontend material: ${pattern}`);
}
console.log('Frontend secret boundary validated.');
