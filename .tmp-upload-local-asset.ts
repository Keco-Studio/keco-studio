import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createMcpRpcClient, MCP_PROTOCOL_VERSION, structuredToolResult } from './scripts/lib/mcp-json-rpc';

const projectId = '1248450a-6590-42ec-b7ce-85223108dc33';
const fileName = 'python-campus.png';
const filePath = '/tmp/python-campus.png';
const apiUrl = process.env.API_URL!;
const anonKey = process.env.ANON_KEY!;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY!;
const ownerEmail = process.env.OWNER_EMAIL!;

async function main() {
const admin = createClient(apiUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: ownerEmail });
if (linkError || !link.properties?.hashed_token) throw new Error('local magic-link generation failed');
const { data: signedIn, error: signInError } = await auth.auth.verifyOtp({
  type: 'magiclink',
  token_hash: link.properties.hashed_token,
});
if (signInError || !signedIn.session?.access_token) throw new Error('local sign-in failed');

const client = createMcpRpcClient({
  mcpUrl: `${apiUrl}/functions/v1/mcp`,
  accessToken: signedIn.session.access_token,
});
await client.call('initialize', {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'local-project-asset-upload', version: '1' },
});
const listed = structuredToolResult(await client.call('tools/call', {
  name: 'list_projects', arguments: { limit: 100 },
}));
if (!Array.isArray(listed.items) || !listed.items.some((item: any) => item.projectId === projectId)) {
  throw new Error('local project 1111 is not visible to its owner');
}

const bytes = new Uint8Array(await readFile(filePath));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const prepared = structuredToolResult(await client.call('tools/call', {
  name: 'prepare_image_uploads',
  arguments: { projectId, files: [{ fileName, fileType: 'image/png', fileSize: bytes.length }] },
}));
const preparedItem = Array.isArray(prepared.items) ? prepared.items[0] as any : null;
if (prepared.preparedCount !== 1 || prepared.failedCount !== 0 || preparedItem?.ok !== true) {
  throw new Error('local image preparation failed');
}
const upload = preparedItem.upload;
const uploadResponse = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes });
if (!uploadResponse.ok) throw new Error(`local signed PUT failed: ${uploadResponse.status}`);

const completionArguments = {
  projectId,
  items: [{ path: preparedItem.image.path, category: 'map' }],
};
let completed: Record<string, unknown>;
try {
  completed = structuredToolResult(await client.call('tools/call', {
    name: 'complete_project_game_asset_uploads', arguments: completionArguments,
  }));
} catch {
  completed = structuredToolResult(await client.call('tools/call', {
    name: 'complete_project_game_asset_uploads', arguments: completionArguments,
  }));
}
const completedItem = Array.isArray(completed.items) ? completed.items[0] as any : null;
if (completed.completedCount !== 1 || completed.failedCount !== 0 || completedItem?.ok !== true) {
  throw new Error(`local asset completion failed: ${JSON.stringify(completed)}`);
}
const asset = completedItem.asset;
const { data: row, error: rowError } = await admin.from('project_game_assets').select('*')
  .eq('id', asset.id).eq('project_id', projectId).eq('storage_path', preparedItem.image.path).single();
if (rowError || !row || row.sha256 !== sha256 || row.status !== 'ready') {
  throw new Error('authoritative local asset read-back failed');
}
console.log(JSON.stringify({
  projectId,
  projectName: '1111',
  assetId: row.id,
  fileName: row.name,
  category: row.category,
  status: row.status,
  sha256: row.sha256,
  width: row.width,
  height: row.height,
  fileSize: row.file_size,
  objectPath: row.storage_path,
}));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'local asset upload failed');
  process.exitCode = 1;
});
