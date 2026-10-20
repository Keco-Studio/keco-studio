import { z } from 'zod';
import { mapToolError } from '@/lib/agent/tools/map-tool-support';

describe('map Tool public errors', () => {
  it('returns only fixed public map messages and local validation messages', () => {
    expect(mapToolError({ code: 'MAP_REVISION_STALE', message: 'private SQL detail' }).error)
      .toBe('The map revision or save version is stale.');
    expect(mapToolError(new Error('Collision cell is outside the map.')).error)
      .toBe('Collision cell is outside the map.');
    expect(mapToolError(new Error('Invalid map references: internal parser path')).error)
      .toBe('Invalid map references.');
    expect(mapToolError(new z.ZodError([])).error).toBe('Invalid map parameters.');
  });

  it('masks unknown database and provider failures', () => {
    expect(mapToolError({ code: 'XX999', message: 'internal table name' }).error)
      .toBe('Map operation failed.');
    expect(mapToolError(new Error('provider secret response')).error)
      .toBe('Map operation failed.');
  });
});
