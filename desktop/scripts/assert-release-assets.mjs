import { readdirSync } from 'node:fs';
const [version, directory] = process.argv.slice(2);
if (!version || !directory) throw new Error('Usage: assert-release-assets.mjs <version> <directory>');
const expected = [`Keco-Studio-Setup-${version}-windows-x64.exe`, `Keco-Studio-${version}-macos-arm64.dmg`, `Keco-Studio-${version}-macos-x64.dmg`].sort();
const actual = readdirSync(directory).filter((name) => !name.startsWith('.')).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Release assets do not match. Expected ${expected.join(', ')}; found ${actual.join(', ') || 'none'}`);
