import { describe, expect, it } from '@jest/globals';
import { isGddGenerationRequestV2, reviewSchema } from './contracts';

describe('GDD v2 job contract', () => {
  it('recognizes queued v2 generation requests', () => {
    expect(isGddGenerationRequestV2({ contractVersion: 2, mode: 'professional', projectId: 'project-1', versionId: 'version-1' })).toBe(true);
    expect(isGddGenerationRequestV2({ contractVersion: 1, mode: 'quick', projectId: 'project-1', versionId: 'version-1' })).toBe(false);
    expect(isGddGenerationRequestV2({ contractVersion: 2, mode: 'invalid', projectId: 'project-1', versionId: 'version-1' })).toBe(false);
  });

  it('validates the review metadata returned by the direct Markdown path', () => {
    expect(reviewSchema.parse({
      version: 2,
      summary: 'Completed.',
      status: 'pass',
      repairRound: 0,
      issues: [],
    })).toEqual(expect.objectContaining({ version: 2, status: 'pass' }));
  });
});
