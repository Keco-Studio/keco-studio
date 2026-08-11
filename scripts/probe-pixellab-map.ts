import { createHash } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import dotenv from 'dotenv';

setDefaultResultOrder('ipv4first');
dotenv.config({ path: '.env.local', override: false, quiet: true });

const MCP_URL = 'https://api.pixellab.ai/mcp';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

const REQUIRED_V3 = [
  { semantic: 'direct_map_image', operation: 'create_image_pro', pollOperation: 'get_image' },
] as const;

type JsonRecord = Record<string, unknown>;

type ProviderTool = {
  name: string;
  inputSchema?: JsonRecord;
};

type CapabilityEvidence = {
  semantic: string;
  operation: string;
  pollOperation: string;
  schemaFingerprint: string;
  pollSchemaFingerprint: string;
};

type AssetEvidenceRow = {
  kind: 'map_image';
  status: string;
  provider_operation: string | null;
  generation_id: string | null;
  plan_fingerprint: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  has_transparency: boolean | null;
  metadata: JsonRecord | null;
  generation_params: JsonRecord | null;
};

type V3RevisionEvidence = {
  plan: { map?: { width?: unknown; height?: unknown } };
  rows: AssetEvidenceRow[];
};

class ProbeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ProbeError';
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function schemaFingerprint(schema: JsonRecord): string {
  return createHash('sha256').update(stableJson(schema)).digest('hex');
}

function parseMcpPayload(text: string): JsonRecord {
  const dataLines = text.split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .filter((line) => line !== '[DONE]');
  const raw = dataLines.at(-1) ?? text;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as JsonRecord;
  } catch {
    throw new ProbeError('pixellab_invalid_response');
  }
}

async function discoverCapabilities(token: string): Promise<CapabilityEvidence[]> {
  let response: Response;
  try {
    response = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
  } catch {
    throw new ProbeError('pixellab_upstream');
  }
  if (!response.ok) {
    throw new ProbeError(response.status === 429 ? 'pixellab_rate_limited' : 'pixellab_upstream');
  }
  const payload = parseMcpPayload(await response.text());
  const result = payload.result as { tools?: unknown } | undefined;
  if (!Array.isArray(result?.tools)) throw new ProbeError('pixellab_invalid_response');
  const tools = result.tools.filter((value): value is ProviderTool =>
    Boolean(value && typeof value === 'object' && typeof (value as ProviderTool).name === 'string')
  );
  const evidenceFor = (expected: { semantic: string; operation: string; pollOperation: string }) => {
    const tool = tools.find((candidate) => candidate.name === expected.operation);
    const pollTool = tools.find((candidate) => candidate.name === expected.pollOperation);
    if (!tool) throw new ProbeError(`pixellab_capability_missing:${expected.semantic}`);
    if (!pollTool) throw new ProbeError(`pixellab_poll_capability_missing:${expected.semantic}`);
    return {
      semantic: expected.semantic,
      operation: tool.name,
      pollOperation: expected.pollOperation,
      schemaFingerprint: schemaFingerprint(tool.inputSchema ?? {}),
      pollSchemaFingerprint: schemaFingerprint(pollTool.inputSchema ?? {}),
    };
  };
  return REQUIRED_V3.map(evidenceFor);
}

function configuredSupabaseUrl(): string | null {
  const value = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProbeError('keco_url_invalid');
  }
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new ProbeError('keco_url_invalid');
  }
  return url.toString().replace(/\/$/, '');
}

function assertDurableMetadataSafe(value: unknown): void {
  const visit = (entry: unknown, key = ''): void => {
    if (/authorization|credential|password|token|secret|signed.?url|temporary.?url|provider.?(?:body|response)|base64/i.test(key)) {
      throw new ProbeError('durable_metadata_sensitive');
    }
    if (typeof entry === 'string' && (
      /https?:\/\/|bearer\s+|data:image\//i.test(entry)
      || /^[A-Za-z0-9+/]{256,}={0,2}$/.test(entry)
    )) {
      throw new ProbeError('durable_metadata_sensitive');
    }
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, key));
      return;
    }
    if (entry && typeof entry === 'object') {
      Object.entries(entry as JsonRecord).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(value);
}

async function readReadyAssets(
  supabaseUrl: string,
  serviceRoleKey: string,
  revisionId: string,
): Promise<V3RevisionEvidence> {
  const revisionUrl = new URL(`${supabaseUrl}/rest/v1/map_revisions`);
  revisionUrl.searchParams.set('select', 'id,schema_version,plan');
  revisionUrl.searchParams.set('id', `eq.${revisionId}`);
  revisionUrl.searchParams.set('schema_version', 'eq.3');
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
  let revisionResponse: Response;
  try {
    revisionResponse = await fetch(revisionUrl, { headers });
  } catch {
    throw new ProbeError('keco_read_failed');
  }
  if (!revisionResponse.ok) throw new ProbeError('keco_read_failed');
  const revisions = await revisionResponse.json().catch(() => null);
  if (!Array.isArray(revisions) || revisions.length !== 1) throw new ProbeError('keco_v3_revision_not_found');
  const revision = revisions[0] as { plan?: unknown };
  if (!revision.plan || typeof revision.plan !== 'object' || Array.isArray(revision.plan)) {
    throw new ProbeError('keco_v3_revision_invalid');
  }

  const assetsUrl = new URL(`${supabaseUrl}/rest/v1/map_assets`);
  assetsUrl.searchParams.set(
    'select',
    'kind,status,provider_operation,generation_id,plan_fingerprint,sha256,width,height,has_transparency,metadata,generation_params',
  );
  assetsUrl.searchParams.set('map_revision_id', `eq.${revisionId}`);
  assetsUrl.searchParams.set('status', 'eq.ready');
  let assetsResponse: Response;
  try {
    assetsResponse = await fetch(assetsUrl, { headers });
  } catch {
    throw new ProbeError('keco_read_failed');
  }
  if (!assetsResponse.ok) throw new ProbeError('keco_read_failed');
  const assets = await assetsResponse.json().catch(() => null);
  if (!Array.isArray(assets)) throw new ProbeError('keco_invalid_response');
  return { plan: revision.plan as V3RevisionEvidence['plan'], rows: assets as AssetEvidenceRow[] };
}

function generationEvidence(evidence: V3RevisionEvidence, capabilities: CapabilityEvidence[]) {
  const { rows, plan } = evidence;
  if (rows.length !== 1) throw new ProbeError('ready_map_image_count_invalid');
  const row = rows[0];
  const width = Number(plan.map?.width);
  const height = Number(plan.map?.height);
  const capability = capabilities.find((entry) => entry.semantic === 'direct_map_image');
  if (!capability) throw new ProbeError('pixellab_capability_missing:direct_map_image');
  assertDurableMetadataSafe(row.metadata);
  assertDurableMetadataSafe(row.generation_params);
  if (
    row.kind !== 'map_image' || row.status !== 'ready'
    || row.provider_operation !== 'create_image_pro'
    || row.provider_operation !== capability?.operation
    || !UUID.test(row.generation_id ?? '')
    || !SHA256.test(row.plan_fingerprint ?? '')
    || !SHA256.test(row.sha256 ?? '')
    || !Number.isInteger(width) || !Number.isInteger(height)
    || row.width !== width || row.height !== height
    || row.has_transparency !== false
  ) {
    throw new ProbeError('ready_map_image_invalid');
  }
  if (row.metadata?.schemaFingerprint !== capability.schemaFingerprint) {
    throw new ProbeError('schema_fingerprint_mismatch:map_image');
  }
  if (row.metadata?.pollOperation !== capability.pollOperation
    || row.metadata?.pollSchemaFingerprint !== capability.pollSchemaFingerprint) {
    throw new ProbeError('poll_schema_fingerprint_mismatch:map_image');
  }
  return [{
    label: 'map_image-1',
    semantic: 'direct_map_image',
    operation: row.provider_operation,
    outputDimensions: { width: row.width, height: row.height },
    transparency: row.has_transparency,
    sha256Prefix: (row.sha256 as string).slice(0, 12),
  }];
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const token = process.env.PIXELLAB_API_TOKEN ?? '';
  if (!token) throw new ProbeError('pixellab_not_configured');
  const capabilities = await discoverCapabilities(token);
  const verifyGeneration = process.env.PIXELLAB_PROBE_GENERATE === '1'
    || process.env.PIXELLAB_PROBE_VERIFY_GENERATION === '1';
  if (!verifyGeneration) {
    print({ configured: true, capabilities, generationEvidence: { status: 'not_requested' } });
    return;
  }

  const supabaseUrl = configuredSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const revisionId = process.env.PIXELLAB_PROBE_REVISION_ID ?? '';
  const missing = [
    ...(!supabaseUrl ? ['SUPABASE_URL_OR_NEXT_PUBLIC_SUPABASE_URL'] : []),
    ...(!serviceRoleKey ? ['SUPABASE_SERVICE_ROLE_KEY'] : []),
    ...(!UUID.test(revisionId) ? ['PIXELLAB_PROBE_REVISION_ID'] : []),
  ];
  if (missing.length > 0) {
    print({
      configured: true,
      capabilities,
      generationEvidence: { status: 'blocked', blocker: 'keco_generation_evidence_not_configured', missing },
    });
    process.exitCode = 2;
    return;
  }

  const evidence = await readReadyAssets(supabaseUrl as string, serviceRoleKey, revisionId);
  print({ configured: true, capabilities, generationEvidence: {
    status: 'verified',
    revisionId,
    artifacts: generationEvidence(evidence, capabilities),
    durableMetadataSensitiveValues: false,
  } });
}

void main().catch((error) => {
  print({
    configured: Boolean(process.env.PIXELLAB_API_TOKEN),
    error: error instanceof ProbeError ? error.code : 'pixellab_probe_failed',
  });
  process.exitCode = 1;
});
