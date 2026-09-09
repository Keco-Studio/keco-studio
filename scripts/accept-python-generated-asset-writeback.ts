import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { aggregateProjectGameAssets } from '../src/lib/services/gameAssetsService';
import { replaceEvidenceAtomically } from './lib/atomic-evidence';
import {
  createMcpRpcClient,
  MCP_PROTOCOL_VERSION,
  structuredToolResult,
  type McpRpcClient,
} from './lib/mcp-json-rpc';

type JsonRecord = Record<string, unknown>;
type CleanupTarget = { assetId: string; projectId: string; storagePath: string };

export type PythonRunner = (
  executable: string,
  args: readonly string[],
  options: { env: Readonly<Record<string, string>> },
) => Promise<void>;

export type AcceptanceAdmin = {
  readAsset(target: CleanupTarget): Promise<JsonRecord | null>;
  aggregateAssets(projectId: string): Promise<JsonRecord[]>;
  deleteAsset(target: CleanupTarget): Promise<void>;
  deleteObject(storagePath: string): Promise<void>;
};

type AcceptanceOptions = {
  mcpUrl: string;
  accessToken: string;
  projectId: string;
  supabaseUrl: string;
  serviceRoleKey: string;
};

type AcceptanceDependencies = {
  fetchImpl?: typeof fetch;
  pythonRunner?: PythonRunner;
  admin?: AcceptanceAdmin;
};

const FILE_NAME = 'python-campus.png';
const BUCKET = 'library-media-files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const execFileAsync = promisify(execFile);

export const pythonPixelArtSource = String.raw`import struct
import zlib
import binascii
import sys

width = 128
height = 128

def rgba(x, y):
    if y < 38:
        return (106, 190, 220, 255)
    if y < 44:
        return (229, 238, 207, 255)
    if 16 <= x < 112 and 48 <= y < 101:
        if x < 22 or x >= 106 or y < 54:
            return (79, 87, 91, 255)
        if 54 <= x < 74 and 70 <= y:
            return (52, 61, 67, 255)
        if ((x - 28) // 15) % 2 == 0 and ((y - 60) // 17) % 2 == 0:
            return (251, 204, 92, 255)
        return (205, 90, 68, 255)
    if 57 <= x < 71 and y >= 101:
        return (199, 190, 167, 255)
    if (x - 18) ** 2 + (y - 106) ** 2 < 100 or (x - 109) ** 2 + (y - 108) ** 2 < 121:
        return (39, 108, 75, 255)
    return (74, 148, 83, 255)

raw = bytearray()
for y in range(height):
    raw.append(0)
    for x in range(width):
        raw.extend(rgba(x, y))

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', binascii.crc32(kind + data) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
png += chunk(b'IEND', b'')
with open(sys.argv[1], 'wb') as output:
    output.write(png)
`;

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}.`);
  return value;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} was missing or invalid.`);
  }
  return value as JsonRecord;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} was missing or invalid.`);
  return value;
}

function uuid(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!UUID.test(result)) throw new Error(`${label} was not a UUID.`);
  return result;
}

function pngUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

export function inventoryGeneratedPng(bytes: Uint8Array, fileName: string) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (fileName !== FILE_NAME || bytes.length < 33 || bytes.length > 5 * 1024 * 1024 ||
      signature.some((value, index) => bytes[index] !== value) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR' ||
      pngUint32(bytes, 16) !== 128 || pngUint32(bytes, 20) !== 128 ||
      bytes[24] !== 8 || bytes[25] !== 6) {
    throw new Error('Python output was not the expected 128x128 RGBA PNG.');
  }
  return { fileName, fileType: 'image/png' as const, fileSize: bytes.length };
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z]/gi, '').toLowerCase();
  return [
    'url', 'uploadurl', 'signedurl', 'publicurl', 'previewurl', 'headers', 'header',
    'authorization', 'bearer', 'token', 'accesstoken', 'servicerolekey',
    'pythonsource', 'rawbytes', 'bytes', 'base64', 'localpath', 'temppath',
    'temporarypath', 'temporarydirectory',
  ].includes(normalized);
}

function redactString(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('<redacted>');
  return result
    .replace(/bearer\s+[^\s"']+/gi, 'Bearer <redacted>')
    .replace(/https?:\/\/[^\s"')]+/gi, '<redacted-url>')
    .replace(/(?:file:\/\/)?\/(?:tmp|home)\/[^\s"')]+/gi, '<redacted-path>')
    .replace(/data:image\/[^;]+;base64,[a-z0-9+/=]+/gi, '<redacted-bytes>');
}

function sanitized(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map(item => sanitized(item, secrets));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, item]) => [
    key,
    sensitiveKey(key) ? '<redacted>' : sanitized(item, secrets),
  ]));
}

export function redactEvidence(value: unknown, secrets: readonly string[] = []): string {
  return JSON.stringify(sanitized(value, secrets));
}

function safeError(error: unknown, phase: string, secrets: readonly string[]): JsonRecord {
  return sanitized({
    phase,
    code: error instanceof Error && error.name ? error.name : 'ACCEPTANCE_ERROR',
    message: error instanceof Error ? error.message : 'Unknown acceptance error.',
  }, secrets) as JsonRecord;
}

async function defaultPythonRunner(
  executable: string,
  args: readonly string[],
  options: { env: Readonly<Record<string, string>> },
): Promise<void> {
  await execFileAsync(executable, [...args], { env: options.env as NodeJS.ProcessEnv });
}

function createAcceptanceAdmin(supabaseUrl: string, serviceRoleKey: string): AcceptanceAdmin {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async readAsset(target) {
      const result = await supabase.from('project_game_assets').select('*')
        .eq('id', target.assetId).eq('project_id', target.projectId)
        .eq('storage_path', target.storagePath).maybeSingle();
      if (result.error) throw new Error('Authoritative project asset read-back failed.');
      return result.data as JsonRecord | null;
    },
    async aggregateAssets(projectId) {
      const result = await aggregateProjectGameAssets(supabase, projectId, {
        sign: async () => null,
      });
      return result.assets as unknown as JsonRecord[];
    },
    async deleteAsset(target) {
      const result = await supabase.from('project_game_assets').delete()
        .eq('id', target.assetId).eq('project_id', target.projectId)
        .eq('storage_path', target.storagePath).select('id');
      if (result.error || result.data?.length !== 1 || result.data[0]?.id !== target.assetId) {
        throw new Error('Exact acceptance registry row cleanup failed.');
      }
    },
    async deleteObject(storagePath) {
      const result = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (result.error) throw new Error('Exact acceptance storage object cleanup failed.');
    },
  };
}

async function callTool(client: McpRpcClient, name: string, args: JsonRecord): Promise<JsonRecord> {
  return structuredToolResult(await client.call('tools/call', { name, arguments: args }));
}

function projectIsWritable(listed: JsonRecord, projectId: string): boolean {
  if (!Array.isArray(listed.items)) return false;
  const project = listed.items.find(item =>
    item && typeof item === 'object' && (item as JsonRecord).projectId === projectId) as JsonRecord | undefined;
  if (!project) return false;
  const capabilities = project.capabilities as JsonRecord | undefined;
  return capabilities?.read === true && capabilities.create === true && capabilities.update === true &&
    project.role !== 'viewer';
}

function completedItem(result: JsonRecord, label: string): JsonRecord {
  if (result.failedCount !== 0 || result.completedCount !== 1 || !Array.isArray(result.items) ||
      result.items.length !== 1) {
    throw new Error(`${label} returned a partial or invalid result.`);
  }
  const item = record(result.items[0], `${label} item`);
  if (item.ok !== true || item.index !== 0) throw new Error(`${label} item failed.`);
  record(item.image, `${label} image`);
  record(item.asset, `${label} asset`);
  return item;
}

function assertAssetMetadata(
  value: JsonRecord,
  expected: { assetId: string; projectId: string; storagePath: string; fileSize: number; sha256: string },
  snakeCase: boolean,
): void {
  const field = (camel: string, snake: string) => value[snakeCase ? snake : camel];
  if (field('id', 'id') !== expected.assetId ||
      field('projectId', 'project_id') !== expected.projectId ||
      field('storagePath', 'storage_path') !== expected.storagePath ||
      field('name', 'name') !== FILE_NAME || field('category', 'category') !== 'map' ||
      field('status', 'status') !== 'ready' || field('mimeType', 'mime_type') !== 'image/png' ||
      field('sha256', 'sha256') !== expected.sha256 || field('width', 'width') !== 128 ||
      field('height', 'height') !== 128 || field('fileSize', 'file_size') !== expected.fileSize) {
    throw new Error('Project asset metadata did not match the generated PNG.');
  }
}

export async function runAcceptance(
  options: AcceptanceOptions,
  dependencies: AcceptanceDependencies = {},
): Promise<JsonRecord> {
  const errors: JsonRecord[] = [];
  const cleanup: JsonRecord = {
    registryRowDeleted: false,
    storageObjectDeleted: false,
    temporaryDirectoryRemoved: false,
  };
  const secrets = [options.accessToken, options.serviceRoleKey, pythonPixelArtSource];
  const evidence: JsonRecord = {
    checkedAt: new Date().toISOString(),
    passed: false,
    projectId: options.projectId,
    assetId: null,
    objectPath: null,
    sha256: null,
    dimensions: { width: 128, height: 128 },
    registration: { insertedCount: 0, sameAssetId: false, replayReused: false },
    readBack: { matched: false },
    aggregation: { matched: false, source: null, category: null },
    cleanup,
    errors,
  };
  let temporaryDirectory: string | undefined;
  let storagePath: string | undefined;
  let cleanupTarget: CleanupTarget | undefined;
  let acceptanceChecksPassed = false;
  let objectUploaded = false;
  let acceptanceAdmin = dependencies.admin;

  try {
    if (!options.accessToken || !options.supabaseUrl || !options.serviceRoleKey) {
      throw new Error('Acceptance credentials are required.');
    }
    if (!UUID.test(options.projectId)) throw new Error('The selected project ID must be a UUID.');
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'keco-python-asset-'));
    const outputPath = path.join(temporaryDirectory, FILE_NAME);
    await (dependencies.pythonRunner ?? defaultPythonRunner)('python3', ['-c', pythonPixelArtSource, outputPath], {
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    const bytes = new Uint8Array(await readFile(outputPath));
    const file = inventoryGeneratedPng(bytes, FILE_NAME);
    const digest = createHash('sha256').update(bytes).digest('hex');

    const request = dependencies.fetchImpl ?? fetch;
    const client = createMcpRpcClient({
      mcpUrl: options.mcpUrl,
      accessToken: options.accessToken,
      fetchImpl: request,
    });
    await client.call('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'keco-python-asset-writeback-acceptance', version: '1' },
    });
    const toolsResult = await client.call('tools/list');
    const toolNames = Array.isArray(toolsResult.tools)
      ? toolsResult.tools.map(tool => record(tool, 'Advertised tool').name)
      : [];
    for (const required of ['list_projects', 'prepare_image_uploads', 'complete_project_game_asset_uploads']) {
      if (!toolNames.includes(required)) throw new Error(`MCP did not advertise required tool ${required}.`);
    }
    const projects = await callTool(client, 'list_projects', { limit: 100 });
    if (!projectIsWritable(projects, options.projectId)) {
      throw new Error('The selected project is not writable by the MCP account.');
    }

    const prepared = await callTool(client, 'prepare_image_uploads', {
      projectId: options.projectId,
      files: [file],
    });
    if (prepared.failedCount !== 0 || prepared.preparedCount !== 1 || !Array.isArray(prepared.items) ||
        prepared.items.length !== 1) {
      throw new Error('Image preparation returned a partial or invalid result.');
    }
    const preparedItem = record(prepared.items[0], 'Prepared item');
    if (preparedItem.ok !== true || preparedItem.index !== 0) throw new Error('Image preparation failed.');
    const upload = record(preparedItem.upload, 'Signed upload target');
    const preparedImage = record(preparedItem.image, 'Prepared image');
    storagePath = stringValue(preparedImage.path, 'Prepared image path');
    const uploadUrl = stringValue(upload.url, 'Signed upload URL');
    const method = stringValue(upload.method, 'Signed upload method');
    const headers = record(upload.headers, 'Signed upload headers') as Record<string, string>;
    secrets.push(uploadUrl, ...Object.values(headers));
    objectUploaded = true;
    const uploadResponse = await request(uploadUrl, {
      method,
      headers,
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    if (!uploadResponse.ok) throw new Error(`Signed upload failed with HTTP ${uploadResponse.status}.`);

    const completionArguments = {
      projectId: options.projectId,
      items: [{ path: storagePath, category: 'map' }],
    };
    const first = completedItem(
      await callTool(client, 'complete_project_game_asset_uploads', completionArguments),
      'Initial registration',
    );
    const firstAsset = record(first.asset, 'Initial registered asset');
    if (first.reused !== false) throw new Error('Initial registration unexpectedly reused an asset.');
    const assetId = uuid(firstAsset.id, 'Initial registered asset ID');
    cleanupTarget = { assetId, projectId: options.projectId, storagePath };
    assertAssetMetadata(firstAsset, {
      assetId, projectId: options.projectId, storagePath, fileSize: file.fileSize, sha256: digest,
    }, false);

    const replay = completedItem(
      await callTool(client, 'complete_project_game_asset_uploads', completionArguments),
      'Registration replay',
    );
    const replayAsset = record(replay.asset, 'Replay registered asset');
    if (replay.reused !== true || replayAsset.id !== assetId) {
      throw new Error('Registration replay did not reuse the same asset ID.');
    }

    acceptanceAdmin ??= createAcceptanceAdmin(options.supabaseUrl, options.serviceRoleKey);
    const row = await acceptanceAdmin.readAsset(cleanupTarget);
    if (!row) throw new Error('Authoritative project asset read-back found no row.');
    assertAssetMetadata(row, {
      assetId, projectId: options.projectId, storagePath, fileSize: file.fileSize, sha256: digest,
    }, true);

    const assets = await acceptanceAdmin.aggregateAssets(options.projectId);
    const aggregated = assets.find(asset => {
      const sourceRef = asset.sourceRef as JsonRecord | undefined;
      return sourceRef?.kind === 'project_game_assets' && sourceRef.id === assetId;
    });
    if (!aggregated || aggregated.source !== 'manual' || aggregated.category !== 'map' ||
        aggregated.projectId !== options.projectId || aggregated.storagePath !== storagePath ||
        aggregated.sha256 !== digest || aggregated.width !== 128 || aggregated.height !== 128 ||
        aggregated.fileSize !== file.fileSize || aggregated.status !== 'ready') {
      throw new Error('Assets aggregation did not normalize the registered row as a manual map.');
    }

    evidence.assetId = assetId;
    evidence.objectPath = storagePath;
    evidence.sha256 = digest;
    evidence.registration = { insertedCount: 1, sameAssetId: true, replayReused: true };
    evidence.readBack = { matched: true };
    evidence.aggregation = { matched: true, source: 'manual', category: 'map' };
    acceptanceChecksPassed = true;
  } catch (error) {
    errors.push(safeError(error, 'acceptance', secrets));
  } finally {
    if (cleanupTarget) {
      try {
        acceptanceAdmin ??= createAcceptanceAdmin(options.supabaseUrl, options.serviceRoleKey);
        await acceptanceAdmin.deleteAsset(cleanupTarget);
        cleanup.registryRowDeleted = true;
      } catch (error) {
        errors.push(safeError(error, 'registry cleanup', secrets));
      }
    } else {
      cleanup.registryRowDeleted = true;
    }
    if (objectUploaded && storagePath) {
      try {
        acceptanceAdmin ??= createAcceptanceAdmin(options.supabaseUrl, options.serviceRoleKey);
        await acceptanceAdmin.deleteObject(storagePath);
        cleanup.storageObjectDeleted = true;
      } catch (error) {
        errors.push(safeError(error, 'storage cleanup', secrets));
      }
    } else {
      cleanup.storageObjectDeleted = true;
    }
    if (temporaryDirectory) {
      try {
        await rm(temporaryDirectory, { recursive: true });
        cleanup.temporaryDirectoryRemoved = true;
      } catch (error) {
        errors.push(safeError(error, 'temporary cleanup', secrets));
      }
    } else {
      cleanup.temporaryDirectoryRemoved = true;
    }
  }

  evidence.passed = acceptanceChecksPassed && errors.length === 0;
  return JSON.parse(redactEvidence(evidence, secrets)) as JsonRecord;
}

export function acceptanceOptions(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): AcceptanceOptions & { output: string } {
  return {
    mcpUrl: argument(args, '--mcp-url'),
    projectId: argument(args, '--project-id'),
    output: argument(args, '--output'),
    accessToken: environment.MCP_ACCESS_TOKEN ?? '',
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL ?? '',
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY ?? '',
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node --import tsx scripts/accept-python-generated-asset-writeback.ts --mcp-url <url> --project-id <uuid> --output <path>\n');
    return;
  }
  const options = acceptanceOptions(process.argv.slice(2));
  if (!options.accessToken) throw new Error('MCP_ACCESS_TOKEN is required.');
  if (!options.supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required.');
  if (!options.serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
  await replaceEvidenceAtomically(options.output, () => runAcceptance(options));
  const evidence = JSON.parse(await readFile(options.output, 'utf8')) as JsonRecord;
  process.stdout.write(JSON.stringify({
    passed: evidence.passed === true,
    projectId: evidence.projectId,
    assetId: evidence.assetId,
    errorCount: Array.isArray(evidence.errors) ? evidence.errors.length : 0,
  }) + '\n');
  if (evidence.passed !== true) process.exitCode = 1;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'accept-python-generated-asset-writeback.ts') {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Acceptance failed.'}\n`);
    process.exitCode = 1;
  });
}
