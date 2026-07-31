import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('document share UI wiring', () => {
  it('opens InviteCollaboratorModal from the document Share button', () => {
    const topBar = readFileSync(
      path.join(process.cwd(), 'src/components/layout/TopBar.tsx'),
      'utf8'
    );

    expect(topBar).toContain("from '@/components/collaboration/InviteCollaboratorModal'");
    expect(topBar).toContain('showInviteModal');
    expect(topBar).toContain('setShowInviteModal(true)');
    expect(topBar).toContain('<InviteCollaboratorModal');
    expect(topBar).toMatch(
      /isDocumentDetail[\s\S]*aria-label="Share"[\s\S]*setShowInviteModal\(true\)/
    );
    expect(topBar).not.toContain('Placeholder share behavior');
    expect(topBar).not.toContain("console.log('Share asset')");
  });
});
