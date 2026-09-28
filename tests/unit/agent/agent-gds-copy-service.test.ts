import type { SupabaseClient } from '@supabase/supabase-js';
import { copyAgentGameDesignSystem } from '@/lib/agent/agent-gds-copy-service';
import { buildCompatibilityGameDesignDocument, buildLegacyRuleSet } from '@/lib/game-design-system/ruleSchema';
import { IdempotencyConflictError, type GameDesignSystem } from '@/lib/services/gameDesignSystemService';

const sourceId = '10000000-0000-4000-8000-000000000001';
const versionId = '10000000-0000-4000-8000-000000000002';
const actorId = '10000000-0000-4000-8000-000000000003';
const key = '10000000-0000-4000-8000-000000000004';
const rules = buildLegacyRuleSet({ genres: ['Strategy'], philosophies: [], body: 'Clear choices.' });
const document = buildCompatibilityGameDesignDocument(rules, { title: 'Original' });
const source = { id: sourceId, title: 'Original', summary: 'Summary', owner_id: actorId,
  source: 'user', current_version_id: versionId, updated_at: '2026-09-28T00:00:00Z',
  provenance: { description: 'Private lineage' } } as GameDesignSystem;
const version = { id: versionId, system_id: sourceId, document, rules, art_style: null,
  source_snapshots: [{ kind: 'document', projectId: sourceId, resourceId: versionId,
    label: 'Reference', contentHash: 'a'.repeat(64), byteCount: 8, truncated: false }],
} as Record<string, unknown>;

const maybeSingle = jest.fn();
const eq = jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) }));
const from = jest.fn(() => ({ select: jest.fn(() => ({ eq })) }));

beforeEach(() => {
  jest.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: version, error: null });
});

it('sends the pinned source version and rendered copy through one keyed RPC', async () => {
  const copy = { ...source, id: '10000000-0000-4000-8000-000000000099', title: 'Original (Copy)' };
  const rpc = jest.fn().mockResolvedValue({ data: copy, error: null });
  const service = { rpc, from } as unknown as SupabaseClient;

  expect(await copyAgentGameDesignSystem(service, source, actorId, key)).toEqual(copy);
  expect(from).toHaveBeenCalledWith('game_design_system_versions');
  expect(eq).toHaveBeenCalledWith('id', versionId);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('copy_agent_game_design_system', expect.objectContaining({
    p_actor_id: actorId, p_idempotency_key: key, p_source_system_id: sourceId,
    p_expected_version_id: versionId, p_expected_updated_at: source.updated_at,
    p_document: document,
    p_rendered_markdown: expect.stringContaining('Original (Copy)'),
  }));
});

it('maps conflicting request keys and refuses sources without a current version', async () => {
  const service = { from, rpc: jest.fn().mockResolvedValue({ data: null,
    error: { message: 'IDEMPOTENCY_CONFLICT' } }) } as unknown as SupabaseClient;
  await expect(copyAgentGameDesignSystem(service, source, actorId, key))
    .rejects.toBeInstanceOf(IdempotencyConflictError);

  maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(copyAgentGameDesignSystem(service, source, actorId, key))
    .rejects.toThrow('Source system has no readable version.');
  expect(service.rpc).toHaveBeenCalledTimes(1);
});
