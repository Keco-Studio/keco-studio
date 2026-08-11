import fs from 'node:fs';
import path from 'node:path';

const paidScript = fs.readFileSync(
  path.join(process.cwd(), 'scripts/accept-create-map-v3-paid.ts'),
  'utf8',
);
const browserScript = fs.readFileSync(
  path.join(process.cwd(), 'scripts/accept-create-map-v3-browser.ts'),
  'utf8',
);

describe('Create Map V3 acceptance tooling', () => {
  it('creates a dedicated V3 draft only behind explicit acceptance configuration', () => {
    expect(paidScript).toContain('KECO_ACCEPTANCE_CREATE_V3');
    expect(paidScript).toContain('KECO_ACCEPTANCE_PROJECT_ID');
    expect(paidScript).toContain("rpc('create_map_project_v3'");
  });

  it('accepts the authenticated project owner or an accepted editor', () => {
    expect(paidScript).toMatch(/select\(['"]id,project_id,name,current_revision_id,projects\(owner_id\)['"]\)/);
    expect(paidScript).toContain('map.projects.owner_id === auth.user.id');
    expect(paidScript).toContain("['admin', 'editor'].includes(String(membership?.role))");
  });

  it('can invoke a standalone Edge function with the authenticated user token', () => {
    expect(paidScript).toContain('KECO_ACCEPTANCE_EDGE_URL');
    expect(paidScript).toContain('auth.session.access_token');
    expect(paidScript).toMatch(/authorization:\s*`Bearer \$\{accessToken\}`/i);
  });

  it('resumes a blocked or failed authoritative asset through retry', () => {
    expect(paidScript).toContain("['planned', 'blocked', 'failed'].includes(asset.status)");
    expect(paidScript).toContain("asset.status === 'planned' ? 'submit' : 'retry'");
  });

  it('rejects failed and HTTP-error browser resources', () => {
    expect(browserScript).toContain("page.on('requestfailed'");
    expect(browserScript).toContain("page.on('response'");
    expect(browserScript).toContain('response.status() >= 400');
    expect(browserScript).toContain('responseFailures');
  });
});
