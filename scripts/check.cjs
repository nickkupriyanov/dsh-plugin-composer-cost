#!/usr/bin/env node
/**
 * Package-contract checks for this plugin. Runs in CI and locally.
 *
 * The browser artifact is hand-written, so nothing type-checks it before the
 * Harness tries to materialize it: a wrong factory id or an import of a Harness
 * Client package fails at runtime in the web client, not at build time. These
 * checks are the build step this package otherwise does not have.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${label}${detail === undefined ? '' : `\n      ${detail}`}`);
}

const pkg = JSON.parse(read('package.json'));

check('package name is a bare package id', /^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), `got "${pkg.name}"`);
check('dsh.bundle.patch is declared', typeof pkg.dsh?.bundle?.patch === 'string');
check('dsh.client.platform is web', pkg.dsh?.client?.platform === 'web');
check('license is declared', typeof pkg.license === 'string');

for (const [key, target] of Object.entries(pkg.exports ?? {})) {
  if (key.includes('*') || typeof target !== 'string') continue;
  check(`exports["${key}"] resolves`, fs.existsSync(path.join(root, target)), target);
}
check('icon resolves', fs.existsSync(path.join(root, pkg.icon)), pkg.icon);

const patch = read(pkg.dsh.bundle.patch);
check('bundle patch inserts this package', patch.includes(pkg.name), patch.trim());

const client = read(pkg.exports['./client']);
const idMatch = client.match(/id:\s*['"]([^'"]+)['"]/);
check('client bundle registers a factory id', idMatch !== null);
check(
  'factory id equals the package name',
  idMatch?.[1] === pkg.name,
  `factory "${idMatch?.[1]}" vs package "${pkg.name}" - they must match or the web client cannot load the bundle`,
);
check('client bundle has no stale @local reference', !client.includes('@local/'));

const PLATFORM_MODULES = new Set(['react', 'react-dom', 'react/jsx-runtime']);
const required = [...client.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
const foreign = [...new Set(required)].filter((specifier) => !PLATFORM_MODULES.has(specifier));
check(
  'client bundle requires only platform modules',
  foreign.length === 0,
  `unexpected: ${foreign.join(', ')} - importing a Harness Client package here breaks without notice`,
);

for (const file of ['locale/en.json', 'locale/zh.json']) {
  let parsed = null;
  try {
    parsed = JSON.parse(read(file));
  } catch (error) {
    parsed = null;
  }
  check(`${file} parses`, parsed !== null);
  check(`${file} carries meta.title`, typeof parsed?.meta?.title === 'string');
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
