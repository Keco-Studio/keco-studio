import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { replaceEvidenceAtomically } from './lib/atomic-evidence';
import {
  createMcpRpcClient,
  MCP_PROTOCOL_VERSION,
  structuredToolResult,
  type McpRpcClient,
} from './lib/mcp-json-rpc';

type JsonRecord = Record<string, unknown>;
type InputFile = {
  path: string;
  fileName: string;
  fileType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';
  fileSize: number;
  bytes: Uint8Array;
};
type VerifiedImage = {
  url: string;
  path: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadedAt: string;
};

const MIME_BY_EXTENSION: Record<string, InputFile['fileType']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function firstRow(value: unknown): JsonRecord {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('MCP response omitted a row.');
  }
  return row as JsonRecord;
}

function data(value: JsonRecord): JsonRecord {
  return value.data && typeof value.data === 'object'
    ? value.data as JsonRecord
    : value;
}

async function callTool(
  client: McpRpcClient,
  name: string,
  args: JsonRecord,
): Promise<JsonRecord> {
  return structuredToolResult(await client.call('tools/call', {
    name,
    arguments: args,
  }));
}

function fileTypeFor(fileName: string): InputFile['fileType'] {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const fileType = MIME_BY_EXTENSION[extension];
  if (!fileType) throw new Error(`Unsupported image extension for ${fileName}.`);
  return fileType;
}

async function inventory(filePaths: readonly string[]): Promise<InputFile[]> {
  if (filePaths.length !== 2) throw new Error('Provide exactly two image files.');
  const names = new Set<string>();
  const files: InputFile[] = [];
  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    if (!fileName || names.has(fileName)) {
      throw new Error(`Duplicate or invalid image file name: ${fileName}.`);
    }
    names.add(fileName);
    const bytes = new Uint8Array(await readFile(filePath));
    if (bytes.byteLength < 1 || bytes.byteLength > 5 * 1024 * 1024) {
      throw new Error(`Image ${fileName} must be between 1 byte and 5 MiB.`);
    }
    files.push({
      path: filePath,
      fileName,
      fileType: fileTypeFor(fileName),
      fileSize: bytes.byteLength,
      bytes,
    });
  }
  return files;
}

function safeError(error: unknown): JsonRecord {
  const rawMessage = error instanceof Error ? error.message : 'Unknown acceptance error';
  const message = rawMessage
    .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')
    .replace(/(?:file:\/\/|[A-Za-z]:[\\/]|\/home\/|\/tmp\/)[^\s)]+/gi, '<redacted-path>');
  return {
    code: error instanceof Error && error.name ? error.name : 'UNKNOWN_ERROR',
    message,
  };
}

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error(`${label} is not a stable UUID.`);
  }
  return value;
}

function imageFromItem(item: JsonRecord): VerifiedImage {
  const image = item.image;
  if (!image || typeof image !== 'object' || Array.isArray(image)) {
    throw new Error('Completion omitted the verified image object.');
  }
  const value = image as JsonRecord;
  for (const key of ['url', 'path', 'fileName', 'fileType', 'uploadedAt']) {
    if (typeof value[key] !== 'string' || !value[key]) {
      throw new Error(`Completion image omitted ${key}.`);
    }
  }
  if (!Number.isInteger(value.fileSize) || Number(value.fileSize) < 1) {
    throw new Error('Completion image omitted a valid fileSize.');
  }
  return value as unknown as VerifiedImage;
}

async function putExactBytes(
  upload: JsonRecord,
  file: InputFile,
): Promise<void> {
  const url = upload.url;
  const method = upload.method;
  const headers = upload.headers;
  if (typeof url !== 'string' || typeof method !== 'string' ||
      !headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error(`Upload target for ${file.fileName} is incomplete.`);
  }
  const response = await fetch(url, {
    method,
    headers: headers as Record<string, string>,
    body: file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer,
  });
  if (!response.ok) throw new Error(`Signed upload returned HTTP ${response.status}.`);
}

async function readAllRows(
  client: McpRpcClient,
  projectId: string,
  tableId: string,
): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await callTool(client, 'query_table_rows', {
      projectId,
      tableId,
      limit: 1,
      fields: ['Name', 'Image'],
      ...(cursor ? { cursor } : {}),
    });
    const items = page.items;
    if (!Array.isArray(items)) throw new Error('Table read-back omitted items.');
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Table read-back contained an invalid row.');
      }
      rows.push(item as JsonRecord);
    }
    cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
    if (page.hasMore === true && !cursor) throw new Error('Table read-back omitted nextCursor.');
  } while (cursor);
  return rows;
}

function fieldValue(row: JsonRecord, label: string): unknown {
  const values = row.values;
  if (!Array.isArray(values)) throw new Error('Table row omitted field values.');
  const match = values.find((value) =>
    value && typeof value === 'object' && (value as JsonRecord).label === label);
  return match && typeof match === 'object' ? (match as JsonRecord).value : undefined;
}

async function runAcceptance(options: {
  mcpUrl: string;
  accessToken: string;
  projectId: string;
  files: readonly string[];
}): Promise<JsonRecord> {
  const errors: JsonRecord[] = [];
  let tableId: string | undefined;
  let tableName: string | undefined;
  let client: McpRpcClient | undefined;
  const evidence: JsonRecord = {
    checkedAt: new Date().toISOString(),
    projectId: options.projectId,
    tableId: null,
    rows: [],
    errors,
  };
  try {
    const files = await inventory(options.files);
    client = createMcpRpcClient({ mcpUrl: options.mcpUrl, accessToken: options.accessToken });
    await client.call('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'keco-local-image-writeback-acceptance', version: '1' },
    });

    tableName = `Acceptance image writeback ${Date.now()}`;
    const created = data(await callTool(client, 'create_table', {
      projectId: options.projectId,
      name: tableName,
      fields: [
        { label: 'Name', dataType: 'string', required: true },
        { label: 'Image', dataType: 'image' },
      ],
    }));
    tableId = assertUuid(firstRow(created).table_id, 'Created table ID');
    evidence.tableId = tableId;

    const initialRows = await readAllRows(client, options.projectId, tableId);
    for (const row of initialRows) {
      const rowId = typeof row.id === 'string' ? row.id : undefined;
      if (rowId && fieldValue(row, 'Name') == null) {
        await callTool(client, 'delete_table_row', {
          projectId: options.projectId,
          tableId,
          rowId,
        });
      }
    }

    const prepared = await callTool(client, 'prepare_image_uploads', {
      projectId: options.projectId,
      files: files.map(({ fileName, fileType, fileSize }) => ({ fileName, fileType, fileSize })),
    });
    const preparedItems = Array.isArray(prepared.items) ? prepared.items as JsonRecord[] : [];
    if (preparedItems.length !== files.length || prepared.failedCount !== 0) {
      throw new Error('Image preparation returned a partial or incomplete result.');
    }
    const paths: string[] = [];
    for (const [index, item] of preparedItems.entries()) {
      if (item.ok !== true || !item.upload || typeof item.upload !== 'object' ||
          !item.image || typeof item.image !== 'object') {
        throw new Error(`Image preparation failed for item ${index}.`);
      }
      await putExactBytes(item.upload as JsonRecord, files[index]);
      const image = item.image as JsonRecord;
      paths.push(typeof image.path === 'string' ? image.path : '');
    }
    if (paths.some((value) => !value)) throw new Error('Preparation omitted an image path.');

    const completed = await callTool(client, 'complete_image_uploads', {
      projectId: options.projectId,
      paths,
    });
    const completedItems = Array.isArray(completed.items) ? completed.items as JsonRecord[] : [];
    if (completedItems.length !== files.length || completed.failedCount !== 0) {
      throw new Error('Image completion returned a partial or incomplete result.');
    }
    const images = completedItems.map((item, index) => {
      if (item.ok !== true || item.path !== paths[index]) {
        throw new Error(`Image completion failed for item ${index}.`);
      }
      return imageFromItem(item);
    });

    await callTool(client, 'upsert_table_rows', {
      projectId: options.projectId,
      tableId,
      matchField: 'Name',
      rows: images.map((image) => ({
        values: { Name: image.fileName, Image: image },
      })),
    });

    const rows = await readAllRows(client, options.projectId, tableId);
    const expectedNames = new Set(files.map((file) => file.fileName));
    if (rows.length !== files.length) {
      throw new Error(`Read-back returned ${rows.length} rows; expected ${files.length}.`);
    }
    const readBack = rows.map((row) => {
      const name = fieldValue(row, 'Name');
      const image = fieldValue(row, 'Image');
      if (typeof name !== 'string' || !expectedNames.has(name) ||
          !image || typeof image !== 'object' || Array.isArray(image)) {
        throw new Error('Read-back row did not contain the expected image object.');
      }
      const expected = images.find((value) => value.fileName === name);
      const actual = image as JsonRecord;
      if (!expected || actual.path !== expected.path || actual.url !== expected.url ||
          actual.fileName !== expected.fileName || actual.fileSize !== expected.fileSize ||
          actual.fileType !== expected.fileType) {
        throw new Error(`Read-back image metadata mismatch for ${name}.`);
      }
      return {
        rowId: assertUuid(row.id, `Read-back row ${name}`),
        fileName: name,
        image: {
          fileName: actual.fileName,
          fileSize: actual.fileSize,
          fileType: actual.fileType,
          path: actual.path,
          url: actual.url,
        },
      };
    });
    evidence.rows = readBack;
    evidence.passed = true;
  } catch (error) {
    errors.push(safeError(error));
    evidence.passed = false;
  } finally {
    if (tableId && client) {
      try {
        await callTool(client, 'delete_table', {
          projectId: options.projectId,
          tableId,
          confirmName: tableName,
          clearReferences: true,
        });
        evidence.cleanup = { tableDeleted: true };
      } catch (error) {
        errors.push({ phase: 'cleanup', ...safeError(error) });
        evidence.cleanup = { tableDeleted: false };
      }
    }
  }
  return evidence;
}

function optionsFromArgs(args: string[], environment: NodeJS.ProcessEnv = process.env) {
  const filesIndex = args.indexOf('--files');
  const fileArguments: string[] = [];
  for (let index = filesIndex + 1; index < args.length && !args[index].startsWith('--'); index += 1) {
    fileArguments.push(args[index]);
  }
  if (filesIndex < 0 || fileArguments.length !== 2) {
    throw new Error('Missing --files <file> <file>.');
  }
  return {
    mcpUrl: argument(args, '--mcp-url'),
    accessToken: environment.MCP_ACCESS_TOKEN ?? '',
    projectId: argument(args, '--project-id'),
    files: fileArguments,
    output: argument(args, '--output'),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: tsx scripts/accept-local-image-writeback.ts --mcp-url <url> --project-id <uuid> --files <image> <image> --output <path>\n');
    return;
  }
  const options = optionsFromArgs(args);
  if (!options.accessToken) throw new Error('MCP_ACCESS_TOKEN is required.');
  await replaceEvidenceAtomically(options.output, () => runAcceptance(options));
  const evidence = JSON.parse(await readFile(options.output, 'utf8')) as JsonRecord;
  process.stdout.write(JSON.stringify({
    passed: evidence.passed === true,
    projectId: evidence.projectId,
    tableId: evidence.tableId,
    rowCount: Array.isArray(evidence.rows) ? evidence.rows.length : 0,
    errorCount: Array.isArray(evidence.errors) ? evidence.errors.length : 0,
  }) + '\n');
  if (evidence.passed !== true) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Acceptance failed'}\n`);
    process.exitCode = 1;
  });
}

export { inventory, runAcceptance };
