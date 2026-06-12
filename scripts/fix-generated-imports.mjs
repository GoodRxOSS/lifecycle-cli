import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const generatedDir = new URL('../src/lib/generated/', import.meta.url);

for (const entry of await readdir(generatedDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;

  const file = join(generatedDir.pathname, entry.name);
  const source = await readFile(file, 'utf8');
  const updated = source.replaceAll(/(from\s+['"]\.\/[^'".]+)(['"])/g, '$1.js$2');

  if (updated !== source) {
    await writeFile(file, updated);
  }
}
