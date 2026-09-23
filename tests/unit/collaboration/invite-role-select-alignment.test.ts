import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Invite role select alignment', () => {
  it('keeps the Select root and selector at the same height so the arrow centers in the field', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/components/collaboration/InviteCollaboratorModal.module.css'),
      'utf8',
    );

    expect(css).toMatch(/\.modal\s+:global\(\.ant-select-lg\)\s*\{[^}]*height:\s*2rem\s*!important/s);
    expect(css).toMatch(/\.modal\s+:global\(\.ant-select-lg\s+\.ant-select-selector\)\s*\{[^}]*height:\s*2rem\s*!important/s);
  });
});
