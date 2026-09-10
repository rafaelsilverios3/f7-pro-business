import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('supabase/migrations');
const files = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const seen = new Set();
for (const file of files) {
  const number = file.slice(0, 4);
  if (seen.has(number)) throw new Error(`Duplicate migration number: ${number}`);
  seen.add(number);
  if (Number(number) < 42) continue;
  const sql = await readFile(path.join(directory, file), 'utf8');
  if (/disable row level security/i.test(sql)) throw new Error(`${file}: RLS cannot be disabled`);
  if (/grant\s+all\b[^;]*\bto\s+(anon|authenticated)/i.test(sql)) throw new Error(`${file}: broad browser grant`);
  if (/create table/i.test(sql) && !/enable row level security/i.test(sql)) throw new Error(`${file}: created table without RLS`);
  if (!/conceptual rollback|rollback conceitual/i.test(sql) && Number(number) >= 45) throw new Error(`${file}: missing conceptual rollback`);
}
console.log(`Validated ${files.length} ordered migration(s).`);
