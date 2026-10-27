import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Browser code must never reference file:// URLs or absolute filesystem
 * paths (the demo-asset bug class). Node-side files (scripts/, tests/) are
 * allowed to use import.meta.url.
 */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

describe('browser source hygiene', () => {
  it('src/ contains no file:// URLs, /home/ paths, or process.cwd()', async () => {
    const files = await walk(srcDir);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content, `${file} references file://`).not.toMatch(/file:\/\//);
      expect(content, `${file} references /home/`).not.toMatch(/\/home\//);
      expect(content, `${file} references process.cwd()`).not.toMatch(/process\.cwd/);
    }
  });
});
