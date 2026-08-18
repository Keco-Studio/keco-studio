import { describe, expect, it } from '@jest/globals';
import { redactGameDesignSystemDetailSources } from './sourceVisibility';
import type { GameDesignSystemDetail } from '@/lib/services/gameDesignSystemService';

const snapshots = [
  {
    kind: 'document' as const,
    projectId: 'project-a',
    resourceId: 'document-a',
    label: 'Private GDD',
    contentHash: 'a'.repeat(64),
    excerpt: 'Project A secret combat rule',
    byteCount: 28,
    truncated: false,
  },
  {
    kind: 'table' as const,
    projectId: 'project-b',
    resourceId: 'table-b',
    label: 'Shared Skills',
    contentHash: 'b'.repeat(64),
    excerpt: 'Readable shared table data',
    byteCount: 26,
    truncated: false,
  },
  {
    kind: 'legacy_markdown' as const,
    label: 'Legacy source',
    contentHash: 'c'.repeat(64),
    excerpt: 'Owner-only legacy source',
    byteCount: 24,
    truncated: false,
  },
];

const detail = {
  id: 'system-1',
  owner_id: 'owner-1',
  current_version_id: 'version-1',
  versions: [{
    id: 'version-1',
    source_snapshots: snapshots,
    artStyle: null,
    artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' },
    art_style: { schemaVersion: 999, private: 'raw unsupported JSON' },
  }],
  current_version: {
    id: 'version-1',
    source_snapshots: snapshots,
    artStyle: null,
    artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' },
    art_style: { schemaVersion: 999, private: 'raw unsupported JSON' },
  },
} as unknown as GameDesignSystemDetail;

describe('Game Design System source visibility', () => {
  it('keeps excerpts only for source projects the viewer can still read', () => {
    const visible = redactGameDesignSystemDetailSources(detail, {
      viewerUserId: 'collaborator-1',
      readableProjectIds: new Set(['project-b']),
    });
    expect(visible.versions[0].source_snapshots.map((snapshot) => snapshot.excerpt)).toEqual([
      undefined,
      'Readable shared table data',
      undefined,
    ]);
    expect(visible.current_version?.source_snapshots[0].contentHash).toBe('a'.repeat(64));
    expect(visible.current_version?.artStyleReadError).toEqual({ code: 'UNSUPPORTED_SNAPSHOT' });
    expect(visible.current_version).not.toHaveProperty('art_style');
    expect(visible.versions[0]).not.toHaveProperty('art_style');
  });

  it('allows the owner to see unscoped legacy source but still checks project sources', () => {
    const visible = redactGameDesignSystemDetailSources(detail, {
      viewerUserId: 'owner-1',
      readableProjectIds: new Set(['project-a']),
    });
    expect(visible.versions[0].source_snapshots.map((snapshot) => snapshot.excerpt)).toEqual([
      'Project A secret combat rule',
      undefined,
      'Owner-only legacy source',
    ]);
  });
});
