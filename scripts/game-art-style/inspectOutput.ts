import { readFile } from 'node:fs/promises';
import { inspectVisualOutput } from '@/lib/game-art-style/outputInspector';

export { inspectVisualOutput };

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: tsx scripts/game-art-style/inspectOutput.ts <image>');
  process.stdout.write(`${JSON.stringify(await inspectVisualOutput(await readFile(path)))}\n`);
}

if (process.argv[1]?.endsWith('inspectOutput.ts')) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Image inspection failed.'}\n`);
    process.exitCode = 1;
  });
}
