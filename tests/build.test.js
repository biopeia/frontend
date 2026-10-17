import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('every relative JavaScript import in the built app resolves to a built asset', async () => {
  execFileSync(process.execPath, ['scripts/build.js'], {cwd: root, stdio: 'pipe'});
  const assets = join(root, 'dist', 'assets');
  const filenames = await readdir(assets);
  const assetSet = new Set(filenames);

  for (const filename of filenames.filter(name => name.endsWith('.js'))) {
    const source = await readFile(join(assets, filename), 'utf8');
    const imports = source.matchAll(/(?:\bimport\s+(?:[^'";]+?\s+from\s+)?|\bexport\s+[^'";]+?\s+from\s+)['"](\.\/[^'"]+)['"]/g);
    for (const [, specifier] of imports) {
      const importedFilename = new URL(specifier, `http://localhost/assets/${filename}`).pathname.split('/').at(-1);
      assert.ok(assetSet.has(importedFilename), `${filename} imports missing built asset ${specifier}`);
    }
  }
});
