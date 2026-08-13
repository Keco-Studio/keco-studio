import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  readStudioNavigationPreference,
  writeStudioFilePreference,
  writeStudioProjectPreference,
} from '@/lib/studio/navigationPreference';

describe('Studio navigation preference', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
  });

  it('defaults a newly visited project to Recent until a file is opened', () => {
    writeStudioProjectPreference('user-1', 'project-1');
    expect(readStudioNavigationPreference('user-1')).toEqual({
      projectId: 'project-1',
      fileHref: null,
    });

    writeStudioFilePreference('user-1', 'project-1', '/project-1/doc/document-1');
    expect(readStudioNavigationPreference('user-1')?.fileHref).toBe(
      '/project-1/doc/document-1'
    );
  });

  it('clears the previous file when Studio switches to another project', () => {
    writeStudioFilePreference('user-1', 'project-1', '/project-1/table-1');
    writeStudioProjectPreference('user-1', 'project-2');
    expect(readStudioNavigationPreference('user-1')).toEqual({
      projectId: 'project-2',
      fileHref: null,
    });
  });
});
