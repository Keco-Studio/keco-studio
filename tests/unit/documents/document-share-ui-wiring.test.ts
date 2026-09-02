import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('document share UI wiring', () => {
  it('opens InviteCollaboratorModal from the document Share button', () => {
    const topBar = readFileSync(
      path.join(process.cwd(), 'src/components/layout/TopBar.tsx'),
      'utf8'
    );

    const shareButton = readFileSync(
      path.join(process.cwd(), 'src/components/shared/ShareButton.tsx'),
      'utf8'
    );

    expect(topBar).toContain("from '@/components/collaboration/InviteCollaboratorModal'");
    expect(topBar).toContain("from '@/components/shared/ShareButton'");
    expect(topBar).toContain('showInviteModal');
    expect(topBar).toContain('setShowInviteModal(true)');
    expect(topBar).toContain('<InviteCollaboratorModal');
    expect(topBar).toMatch(
      /isDocumentDetail[\s\S]*<ShareButton[\s\S]*setShowInviteModal\(true\)/
    );
    expect(shareButton).toContain('aria-label="Share"');
    expect(topBar).not.toContain('Placeholder share behavior');
    expect(topBar).not.toContain("console.log('Share asset')");
  });
});
