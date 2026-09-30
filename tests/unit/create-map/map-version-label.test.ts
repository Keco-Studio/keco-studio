import { describe, expect, it } from '@jest/globals';
import { mapVersionLabelForRevision } from '@/features/create-map/model/mapVersionLabel';

describe('mapVersionLabelForRevision', () => {
  const versions = [
    { mapRevisionId: 'revision-7', mapVersionNumber: 2 },
    { mapRevisionId: 'revision-12', mapVersionNumber: 3 },
  ];

  it('renders the persisted Map number for the displayed current image', () => {
    expect(mapVersionLabelForRevision(versions, 'revision-12')).toBe('Map V3');
  });

  it('returns no label when the displayed image is not a persisted Map version', () => {
    expect(mapVersionLabelForRevision(versions, 'revision-3')).toBeNull();
    expect(mapVersionLabelForRevision(versions, null)).toBeNull();
  });
});
