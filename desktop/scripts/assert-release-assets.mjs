import { readFileSync, readdirSync } from 'node:fs';

const [version, source, namesFile] = process.argv.slice(2);
if (!version || !source) throw new Error('Usage: assert-release-assets.mjs <version> <directory> | <version> --names-file <path>');
const expected = [`Keco-Studio-Setup-${version}-windows-x64.exe`, `Keco-Studio-${version}-macos-arm64.dmg`, `Keco-Studio-${version}-macos-x64.dmg`].sort();
let actual;
try {
  actual = source === '--names-file'
    ? readFileSync(namesFile ?? '', 'utf8').split(/\r?\n/).filter(Boolean).sort()
    : readdirSync(source).filter((name) => !name.startsWith('.')).sort();
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  actual = [];
}
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Release assets do not match. Expected ${expected.join(', ')}; found ${actual.join(', ') || 'none'}`);
