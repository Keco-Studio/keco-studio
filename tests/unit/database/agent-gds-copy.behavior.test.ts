import { randomUUID } from 'node:crypto';
import { copyAgentGameDesignSystem } from '@/lib/agent/agent-gds-copy-service';
import { buildLegacyRuleSet, buildCompatibilityGameDesignDocument } from '@/lib/game-design-system/ruleSchema';
import { createGameDesignSystem, IdempotencyConflictError } from '@/lib/services/gameDesignSystemService';
import { RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture,
  type ProjectFixture } from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('agent Game Design System copy (live database)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => { fx = await buildProjectFixture(); }, 120_000);
  afterAll(async () => { if (fx) await teardownProjectFixture(fx); }, 60_000);

  it('copies complete current content atomically and replays one result per key', async () => {
    const rules = buildLegacyRuleSet({ genres: ['Strategy'], philosophies: ['Clarity'],
      body: 'Show the cost of each move.' });
    const document = buildCompatibilityGameDesignDocument(rules, { title: 'Source rules' });
    const snapshots = [{ kind: 'document' as const, projectId: fx.projectId,
      resourceId: randomUUID(), label: 'Private reference', contentHash: 'a'.repeat(64),
      byteCount: 10, truncated: false }];
    const source = await createGameDesignSystem(fx.svc, fx.owner.id, {
      title: 'Source rules', summary: 'Summary', genres: rules.genres,
      philosophies: rules.philosophies, document, rules, sourceSnapshots: snapshots,
      provenance: { description: 'Original lineage' },
    });
    const key = randomUUID();
    const [first, replay] = await Promise.all([
      copyAgentGameDesignSystem(fx.svc, source, fx.owner.id, key),
      copyAgentGameDesignSystem(fx.svc, source, fx.owner.id, key),
    ]);
    expect(replay.id).toBe(first.id);
    expect(replay.current_version_id).toBe(first.current_version_id);
    expect(first.title).toBe('Source rules (Copy)');
    expect(first.provenance).toEqual({ description: 'Original lineage', baseSystemId: source.id });
    const sourceVersion = await fx.svc.from('game_design_system_versions').select('*')
      .eq('id', source.current_version_id!).single();
    const copyVersion = await fx.svc.from('game_design_system_versions').select('*')
      .eq('id', first.current_version_id!).single();
    expect(sourceVersion.error).toBeNull();
    expect(copyVersion.error).toBeNull();
    expect(copyVersion.data).toMatchObject({
      parent_version_id: source.current_version_id,
      document: sourceVersion.data!.document,
      rules: sourceVersion.data!.rules,
      art_style: sourceVersion.data!.art_style,
      source_snapshots: sourceVersion.data!.source_snapshots,
    });

    const other = await createGameDesignSystem(fx.svc, fx.owner.id, {
      title: 'Other rules', genres: rules.genres, philosophies: rules.philosophies, rules,
    });
    await expect(copyAgentGameDesignSystem(fx.svc, other, fx.owner.id, key))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    const removed = await fx.svc.from('game_design_systems').delete().eq('id', first.id);
    expect(removed.error).toBeNull();
    await expect(copyAgentGameDesignSystem(fx.svc, source, fx.owner.id, key))
      .rejects.toThrow('use a new idempotency key');
  });
});
