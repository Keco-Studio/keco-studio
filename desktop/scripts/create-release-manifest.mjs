import { readFileSync, writeFileSync } from 'node:fs';

const [version, outputPath] = process.argv.slice(2);
if (!version || !outputPath) throw new Error('Usage: create-release-manifest.mjs <version> <output-path>');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Release version must be SemVer without a leading v: ${version}`);
}

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
manifest.version = version;
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
