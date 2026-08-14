import { describe, expect, it } from '@jest/globals';
import {
  buildDocumentSnapshot,
  buildTableSnapshot,
  enforceSnapshotTotalLimit,
} from './sourceSnapshots';

describe('Game Design System source snapshots', () => {
  it('stores actual Document content, identity, update time, and a stable hash', () => {
    const snapshot = buildDocumentSnapshot({
      id: 'doc-1',
      project_id: 'project-1',
      name: 'Combat GDD',
      content: 'Damage uses armor before health.\nChoices expose predicted outcomes.',
      updated_at: '2026-08-14T00:00:00Z',
    });
    expect(snapshot.excerpt).toContain('Damage uses armor before health.');
    expect(snapshot.resourceId).toBe('doc-1');
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(buildDocumentSnapshot({ ...snapshotSource(), content: 'changed' }).contentHash).not.toBe(snapshot.contentHash);
  });

  it('stores Table field labels and real row values instead of a table label only', () => {
    const snapshot = buildTableSnapshot({
      library: { id: 'table-1', project_id: 'project-1', name: 'Skills', updated_at: '2026-08-14T00:00:00Z' },
      fields: [
        { id: 'field-cost', label: 'Cost', order_index: 1 },
        { id: 'field-effect', label: 'Effect', order_index: 2 },
      ],
      assets: [{ id: 'asset-1', name: 'Shield Bash', row_index: 1 }],
      values: [
        { asset_id: 'asset-1', field_id: 'field-cost', value_json: 2 },
        { asset_id: 'asset-1', field_id: 'field-effect', value_json: 'Stun one target' },
      ],
    });
    expect(snapshot.excerpt).toContain('Cost');
    expect(snapshot.excerpt).toContain('Shield Bash');
    expect(snapshot.excerpt).toContain('Stun one target');
  });

  it('caps individual sources and rejects aggregate overflow', () => {
    const document = buildDocumentSnapshot({ ...snapshotSource(), content: 'x'.repeat(25_000) });
    expect(document.excerpt).toHaveLength(20_000);
    expect(document.truncated).toBe(true);
    expect(() => enforceSnapshotTotalLimit([
      { ...document, excerpt: 'x'.repeat(40_000) },
      { ...document, resourceId: 'doc-2', excerpt: 'y'.repeat(25_000) },
    ])).toThrow(/60,000/);
  });
});

function snapshotSource() {
  return {
    id: 'doc-2',
    project_id: 'project-1',
    name: 'Systems',
    content: 'base',
    updated_at: '2026-08-14T00:00:00Z',
  };
}
