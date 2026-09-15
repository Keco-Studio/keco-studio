import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DESKTOP_MODE_STORAGE_KEY, isDesktopModeSearch } from '@/lib/desktopMode';

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('desktop mode', () => {
  it('recognizes only desktop=1', () => {
    expect(isDesktopModeSearch('?desktop=1')).toBe(true);
    expect(isDesktopModeSearch('?desktop=0')).toBe(false);
    expect(isDesktopModeSearch('?other=1')).toBe(false);
  });

  it('mounts the marker in the root layout and suppresses Google OAuth in the auth form', () => {
    expect(read('src/app/layout.tsx')).toContain('<DesktopModeMarker />');
    expect(read('src/components/authform/AuthForm.tsx')).toContain(DESKTOP_MODE_STORAGE_KEY);
    expect(read('src/components/authform/AuthForm.tsx')).toMatch(/!isDesktopMode[\s\S]*Log in using Google/);
  });

  it('derives the auth guard from the current URL before relying on the persisted marker', () => {
    expect(read('src/components/authform/AuthForm.tsx')).toMatch(
      /isDesktopModeSearch\(window\.location\.search\)[\s\S]{0,160}isDesktopModeSession\(window\.sessionStorage\)/
    );
  });
});
