import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * What a customer receives from npm, checked here because none of it is
 * visible from inside the repo. The build is a prerequisite: lage runs this
 * package's build before its tests.
 */
const PACKAGE_ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
const built = existsSync(join(PACKAGE_ROOT, 'dist'));
const describeBuilt = built ? describe : describe.skip;

describe('what ships to npm', () => {
  it('is public: no "private" field, which would make npm refuse to publish', () => {
    expect(pkg.private).toBeUndefined();
    expect(pkg.name).toBe('@tailor-ai/node');
  });

  it('stamps the version it was built as', async () => {
    const { VERSION } = await import('./version.js');
    expect(VERSION).toBe(pkg.version);
  });

  it('ships the README, the LICENSE and the changelog, not just dist', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'README.md', 'LICENSE', 'CHANGELOG.md']));
    for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
      expect(existsSync(join(PACKAGE_ROOT, file))).toBe(true);
    }
  });

  it('runs on Node 18 or later, which has fetch built in', () => {
    expect(pkg.engines.node).toBe('>=18');
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('can be loaded with both import and require', () => {
    const entry = pkg.exports['.'];
    expect(entry.types).toBe('./dist/types/index.d.ts');
    expect(entry.import).toBe('./dist/esm/index.js');
    expect(entry.require).toBe('./dist/cjs/index.cjs');
  });
});

describeBuilt('the built package', () => {
  it('loads through require and exposes init', () => {
    const require = createRequire(join(PACKAGE_ROOT, 'package.json'));
    const sdk = require('./dist/cjs/index.cjs');
    expect(typeof sdk.init).toBe('function');
    expect(typeof sdk.TestResult).toBe('function');
  });

  it('keeps docblocks in the type declarations, where they reach the customer’s editor', () => {
    const declarations = readFileSync(join(PACKAGE_ROOT, 'dist/types/client.d.ts'), 'utf8');
    expect(declarations).toContain('Which variant of a test this visitor gets');
  });
});
