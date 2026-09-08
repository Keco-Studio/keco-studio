import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function readEnvFileValue(filePath: string, key: string): string | null {
  if (!existsSync(filePath)) return null;
  const match = readFileSync(filePath, 'utf8').match(
    new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, 'm')
  );
  if (!match?.[1]) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function resolveSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    readEnvFileValue(resolve(process.cwd(), '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL') ||
    readEnvFileValue(resolve(process.cwd(), '.env'), 'NEXT_PUBLIC_SUPABASE_URL') ||
    ''
  );
}

function isLocalSupabaseUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '::1'
    );
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const supabaseUrl = resolveSupabaseUrl();
  if (!isLocalSupabaseUrl(supabaseUrl)) {
    console.info(
      '[realtime-pool] Skipped: NEXT_PUBLIC_SUPABASE_URL is not local.'
    );
    return;
  }

  try {
    await configureLocalRealtimePool({ run: runDocker, wait });
    console.info('[realtime-pool] Local Realtime authorization pool is ready (db_pool=10).');
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Local Realtime pool setup failed';
    // Soft-fail so `npm run dev` still starts when Docker/Supabase is down.
    console.warn(`[realtime-pool] Skipped: ${message}`);
  }
}

main().catch((error: unknown) => {
  console.warn(
    `[realtime-pool] Skipped: ${
      error instanceof Error ? error.message : 'Local Realtime pool setup failed'
    }`
  );
});
