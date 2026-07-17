import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { configureLocalRealtimePool } from './lib/localRealtimePool';

const execFileAsync = promisify(execFile);

async function runDocker(arguments_: readonly string[]): Promise<string> {
  const result = await execFileAsync('docker', [...arguments_], {
    encoding: 'utf8',
  });
  return result.stdout;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== '--check') || arguments_.length > 1) {
    throw new Error('Usage: npm run supabase:realtime-pool[:check]');
  }

  const checkOnly = arguments_[0] === '--check';
  await configureLocalRealtimePool({ run: runDocker, wait, checkOnly });

  if (checkOnly) {
    console.info('Local Realtime pool setting and live state are valid.');
  } else {
    console.info('Local Realtime pool is configured at 10 connections.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local Realtime pool setup failed');
  process.exitCode = 1;
});
