import { prependLocalUserWhenCollaborating } from '@/components/collaboration/collaborationAvatarDisplay';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('collaboration avatar display list', () => {
  const local = { userId: 'local', userName: 'Local' };
  const remote = { userId: 'remote', userName: 'Remote' };

  it('hides the list when there are no remote users', () => {
    expect(prependLocalUserWhenCollaborating([], local)).toEqual([]);
  });

  it('prepends the local user when someone else is present', () => {
    expect(prependLocalUserWhenCollaborating([remote], local)).toEqual([local, remote]);
  });

  it('uses the same solo-session rule in table and asset headers', () => {
    for (const relativePath of [
      'src/components/libraries/LibraryHeader.tsx',
      'src/components/asset/AssetHeader.tsx',
    ]) {
      const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
      expect(source).toContain('prependLocalUserWhenCollaborating');
    }
  });
});
