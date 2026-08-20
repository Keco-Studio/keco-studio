import {
  classifyGeneratedResources,
  hashNormalizedMarkdown,
  normalizeGddLogicalKey,
  sha256CanonicalJson,
  type ExistingGeneratedResource,
  type NextGeneratedResource,
} from './resourceEvolution';

describe('GDD resource evolution', () => {
  it('normalizes stable keys and rejects invalid keys', () => {
    expect(normalizeGddLogicalKey('  Chapter   One ')).toBe('chapter one');
    expect(() => normalizeGddLogicalKey('   ')).toThrow('logical key');
    expect(() => normalizeGddLogicalKey('a'.repeat(161))).toThrow('logical key');
  });

  it('classifies created, updated, reused, and preserved resources', () => {
    const existing: ExistingGeneratedResource[] = [
      { kind: 'table', logicalKey: 'skills', resourceId: 'table-1', contentHash: 'a'.repeat(64) },
      { kind: 'table', logicalKey: 'items', resourceId: 'table-2', contentHash: 'b'.repeat(64) },
      { kind: 'dialogue_document', logicalKey: 'intro', resourceId: 'doc-1', contentHash: 'c'.repeat(64) },
    ];
    const next: NextGeneratedResource[] = [
      { kind: 'table', logicalKey: 'skills', resourceId: 'new-random-id', contentHash: 'd'.repeat(64) },
      { kind: 'dialogue_document', logicalKey: 'intro', resourceId: 'new-random-id', contentHash: 'c'.repeat(64) },
      { kind: 'table', logicalKey: 'quests', resourceId: 'table-3', contentHash: 'e'.repeat(64) },
    ];

    expect(classifyGeneratedResources(existing, next)).toEqual({
      created: [expect.objectContaining({ logicalKey: 'quests' })],
      updated: [expect.objectContaining({ logicalKey: 'skills', resourceId: 'table-1' })],
      reused: [expect.objectContaining({ logicalKey: 'intro', resourceId: 'doc-1' })],
      preserved: [expect.objectContaining({ logicalKey: 'items', resourceId: 'table-2' })],
    });
  });

  it('rejects duplicate normalized kind and key pairs', () => {
    expect(() => classifyGeneratedResources([], [
      { kind: 'table', logicalKey: 'skills', resourceId: 'a', contentHash: 'a'.repeat(64) },
      { kind: 'table', logicalKey: ' Skills ', resourceId: 'b', contentHash: 'b'.repeat(64) },
    ])).toThrow('Duplicate generated resource key');
  });

  it('canonicalizes object keys while preserving array order', () => {
    expect(sha256CanonicalJson({ b: 2, a: { y: 2, x: 1 } }))
      .toBe(sha256CanonicalJson({ a: { x: 1, y: 2 }, b: 2 }));
    expect(sha256CanonicalJson({ values: ['a', 'b'] }))
      .not.toBe(sha256CanonicalJson({ values: ['b', 'a'] }));
  });

  it('normalizes Markdown line endings and trailing whitespace', () => {
    expect(hashNormalizedMarkdown('# GDD  \r\n\r\nBody\t\r\n'))
      .toBe(hashNormalizedMarkdown('# GDD\n\nBody'));
  });
});
