import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join, normalize, relative, sep} from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('every relative JavaScript import in the built app resolves to a built asset', async () => {
  const assets = join(root, 'dist', 'assets');
  await mkdir(assets, {recursive: true});
  await writeFile(join(assets, 'stale-from-previous-build.js'), '');
  execFileSync(process.execPath, ['scripts/build.js'], {cwd: root, stdio: 'pipe'});
  const filenames = await readdir(assets);
  const assetSet = new Set(filenames);
  assert.equal(assetSet.has('stale-from-previous-build.js'), false, 'build must remove stale assets');

  for (const filename of filenames.filter(name => name.endsWith('.js'))) {
    const source = await readFile(join(assets, filename), 'utf8');
    const imports = source.matchAll(/\bimport\s*(?:\(\s*|(?:[^'";]+?\s+from\s*))['"](\.{1,2}\/[^'"]+)['"]|\bexport\s+[^'";]+?\s+from\s*['"](\.{1,2}\/[^'"]+)['"]/g);
    for (const match of imports) {
      const specifier = match[1] ?? match[2];
      const resolved = normalize(join(dirname(filename), specifier));
      const escaped = relative('.', resolved).split(sep).includes('..');
      assert.ok(!escaped && assetSet.has(resolved), `${filename} imports missing built asset ${specifier}`);
    }
  }
});
