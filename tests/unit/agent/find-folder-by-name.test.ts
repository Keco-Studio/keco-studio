import { resolveFolderMatch } from '../../../src/lib/agent/data-access';

describe('resolveFolderMatch', () => {
  const rows = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Worldview' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Characters' },
  ];

  it('returns exact name match', () => {
    expect(resolveFolderMatch(rows, 'Worldview')).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Worldview',
    });
  });

  it('matches case-insensitively with trimming', () => {
    expect(resolveFolderMatch(rows, '  characters ')).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Characters',
    });
  });

  it('resolves a folder by its UUID', () => {
    expect(resolveFolderMatch(rows, '22222222-2222-4222-8222-222222222222')).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Characters',
    });
  });

  it('returns null when no folder matches', () => {
    expect(resolveFolderMatch(rows, 'Missing')).toBeNull();
  });
});
