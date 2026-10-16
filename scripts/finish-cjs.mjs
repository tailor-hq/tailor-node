// Renames the CommonJS build to .cjs and rewrites its relative requires to
// match. The package is "type": "module", so Node would read a .js file in
// dist/cjs as ESM and throw on its first `exports.` line.
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CJS_DIR = fileURLToPath(new URL('../dist/cjs', import.meta.url));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );

for (const file of walk(CJS_DIR)) {
  if (!file.endsWith('.js')) continue;
  const source = readFileSync(file, 'utf8').replace(
    /require\("(\.{1,2}\/[^"]+)\.js"\)/g,
    'require("$1.cjs")'
  );
  writeFileSync(file, source);
  renameSync(file, file.replace(/\.js$/, '.cjs'));
}
