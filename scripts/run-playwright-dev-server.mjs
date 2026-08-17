import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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
const mockGameDesignSystem = JSON.stringify({
  document: {
    designIntent: 'Make every tactical choice legible and consequential.',
    playerFantasy: 'Lead a small squad through uncertain encounters.',
    coreLoop: 'Scout, commit resources, resolve the encounter, and adapt the squad.',
    decisionStructure: 'Compare visible costs, risks, and future positioning.',
    systemBoundaries: 'Never conceal action costs from the player.',
    progressionEconomy: 'Expand tactical options without replacing player judgment.',
    contentModel: 'Define skills, encounters, enemies, and rewards as reusable data.',
    difficultyBalance: 'Increase difficulty through richer situations rather than opaque inflation.',
    experiencePresentation: 'Preview consequences and explain state changes.',
  },
  rules: {
    schemaVersion: 1,
    genres: ['Strategy'],
    philosophies: ['Readable Systems'],
    suitableFor: 'Single-player tactical games',
    rules: [{
      id: 'readable-state',
      kind: 'principle',
      title: 'Readable state',
      statement: 'Show decision inputs before commitment.',
      appliesWhen: 'Presenting a player choice.',
      severity: 'required',
    }],
    tableGuidance: [],
  },
});

async function readRequestBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Mock LLM request exceeded 1 MB.');
  }
  return body;
}

const mockLlmServer = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const payload = JSON.parse(await readRequestBody(request));
    const isGameDesignSystemRequest = payload.messages?.some(
      (message) => typeof message.content === 'string'
        && message.content.includes('You create reusable Game Design Systems for Keco Studio.'),
    );
    if (!isGameDesignSystemRequest) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'The Playwright LLM only handles Game Design System requests.' }));
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: mockGameDesignSystem }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid mock LLM request.' }));
  }
});

let child;

mockLlmServer.listen(0, '127.0.0.1', () => {
  const address = mockLlmServer.address();
  if (!address || typeof address === 'string') {
    restoreTrackedTypeFiles();
    process.exitCode = 1;
    return;
  }
  const noProxy = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
  child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
    cwd: rootDir,
    env: {
      ...process.env,
      GAME_DESIGN_SYSTEM_LLM_API_KEY: 'playwright-game-design-system-key',
      GAME_DESIGN_SYSTEM_LLM_API_URL: `http://127.0.0.1:${address.port}`,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
    },
    stdio: 'inherit',
  });

  child.once('error', (error) => {
    restoreTrackedTypeFiles();
    mockLlmServer.close();
    console.error(error);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    restoreTrackedTypeFiles();
    mockLlmServer.close();
    process.exitCode = stopping ? 0 : (code ?? (signal ? 1 : 0));
  });
});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    child?.kill(signal);
    if (!child) mockLlmServer.close();
  });
}

mockLlmServer.once('error', (error) => {
  restoreTrackedTypeFiles();
  console.error(error);
  process.exitCode = 1;
});

process.on('exit', restoreTrackedTypeFiles);
