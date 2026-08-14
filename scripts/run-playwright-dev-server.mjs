import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const trackedTypeFiles = ['next-env.d.ts', 'tsconfig.json'];
const originals = new Map(
  trackedTypeFiles.map((file) => [file, readFileSync(join(rootDir, file))]),
);
let restored = false;

function restoreTrackedTypeFiles() {
  if (restored) return;
  restored = true;
  for (const [file, contents] of originals) {
    writeFileSync(join(rootDir, file), contents);
  }
}

const port = process.argv[2] ?? process.env.PLAYWRIGHT_PORT ?? '3000';
const nextBin = join(rootDir, 'node_modules/next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
  cwd: rootDir,
  env: process.env,
  stdio: 'inherit',
});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  });
}

child.once('error', (error) => {
  restoreTrackedTypeFiles();
  console.error(error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  restoreTrackedTypeFiles();
  process.exitCode = stopping ? 0 : (code ?? (signal ? 1 : 0));
});

process.on('exit', restoreTrackedTypeFiles);
