import { existsSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRuntimeWithRetry } from './playwright-mcp-runtime.mjs';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lockPath = path.join(rootDir, 'supabase/functions/mcp/deno.lock');
const backupPath = `${lockPath}.playwright-backup`;
const projectId = path.basename(rootDir);
const readyPort = Number(process.env.PLAYWRIGHT_MCP_READY_PORT ?? '54319');
const supabaseOrigin = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
).origin;
const mcpUrl = `${supabaseOrigin}/functions/v1/mcp`;

function stopEdgeRuntime() {
  const listed = spawnSync(
    'docker',
    [
      'ps',
      '-q',
      '--filter',
      `label=com.supabase.cli.project=${projectId}`,
      '--filter',
      'name=supabase_edge_runtime_',
    ],
    { encoding: 'utf8' }
  );
  if (listed.status !== 0) throw new Error('Unable to inspect the local Edge runtime');
  const containerIds = listed.stdout.trim().split(/\s+/).filter(Boolean);
  if (containerIds.length === 0) return;
  const stopped = spawnSync('docker', ['stop', ...containerIds], { stdio: 'ignore' });
  if (stopped.status !== 0) throw new Error('Unable to stop the local Edge runtime');
}

function restoreLockfile() {
  if (existsSync(backupPath) && !existsSync(lockPath)) {
    renameSync(backupPath, lockPath);
  }
}

stopEdgeRuntime();
if (existsSync(backupPath)) {
  if (existsSync(lockPath)) {
    throw new Error('A stale MCP Playwright lockfile backup already exists');
  }
  restoreLockfile();
}
if (!existsSync(lockPath)) throw new Error('MCP deno.lock is missing');

renameSync(lockPath, backupPath);
const envFileArgs = existsSync(path.join(rootDir, '.env.local'))
  ? ['--env-file', '.env.local']
  : [];
const spawnRuntime = () => spawn(
  'supabase',
  ['functions', 'serve', 'mcp', ...envFileArgs],
  {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  },
);

const readyServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ready');
});
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  readyServer.close();
  try {
    stopEdgeRuntime();
  } finally {
    restoreLockfile();
  }
}

async function probeReady() {
  const response = await fetch(mcpUrl);
  return response.status !== 502 && response.status !== 503;
}

let child = null;
function handleRuntimeExit(event) {
  cleanup();
  if (event.type === 'error') {
    console.error(event.error);
    process.exitCode = 1;
    return;
  }
  if (event.signal && !['SIGINT', 'SIGTERM'].includes(event.signal)) {
    process.kill(process.pid, event.signal);
  }
  process.exitCode = event.code ?? (event.signal ? 1 : 0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child?.kill(signal);
    cleanup();
    process.exit(0);
  });
}

try {
  const runtime = await startRuntimeWithRetry({
    spawnRuntime,
    stopRuntime: stopEdgeRuntime,
    probeReady,
    onAttempt: (attemptChild) => {
      child = attemptChild;
    },
  });
  child = runtime.child;
  void runtime.exitPromise.then(handleRuntimeExit);
  readyServer.listen(readyPort, '127.0.0.1');
} catch (error) {
  child?.kill('SIGTERM');
  cleanup();
  throw error;
}
