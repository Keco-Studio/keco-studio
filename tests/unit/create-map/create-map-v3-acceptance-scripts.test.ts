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
const probeScript = fs.readFileSync(
  path.join(process.cwd(), 'scripts/probe-pixellab-map.ts'),
  'utf8',
);

describe('Create Map V3 acceptance tooling', () => {
  it('creates a dedicated V3 draft only behind explicit acceptance configuration', () => {
    expect(paidScript).toContain('KECO_ACCEPTANCE_CREATE_V3');
    expect(paidScript).toContain("KECO_ACCEPTANCE_CREATE_V3 === 'true'");
    expect(paidScript).toContain('KECO_ACCEPTANCE_PROJECT_ID');
    expect(paidScript).toContain("rpc('create_map_project_v3'");
  });

  it('accepts the authenticated project owner or an accepted editor', () => {
    expect(paidScript).toMatch(/select\(['"]id,project_id,name,current_revision_id,projects\(owner_id\)['"]\)/);
    expect(paidScript).toContain('map.projects.owner_id === auth.user.id');
    expect(paidScript).toContain("['admin', 'editor'].includes(String(membership?.role))");
  });

  it('uses the authenticated Keco Map API instead of direct provider operations', () => {
    expect(paidScript).toContain('KECO_ACCEPTANCE_APP_URL');
    expect(paidScript).toContain('auth.session.access_token');
    expect(paidScript).toMatch(/authorization:\s*`Bearer \$\{accessToken\}`/i);
    expect(paidScript).toContain("'/api/mcp/create-map'");
    expect(paidScript).not.toContain('invokePixelLab(');
  });

  it('prepares, confirms, starts, and polls through the two-step paid contract', () => {
    const prepare = paidScript.indexOf("action: 'prepare_map_generation'");
    const start = paidScript.indexOf("action: 'start_map_generation'");
    const poll = paidScript.indexOf("action: 'get_map_generation'");
    expect(prepare).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(prepare);
    expect(poll).toBeGreaterThan(start);
    expect(paidScript).toContain('prepared.feeNotice');
    expect(paidScript).toContain('prepared.confirmationToken');
    expect(paidScript).toContain('confirmPaidGeneration: true');
    expect(paidScript).toContain("KECO_ACCEPTANCE_CONFIRM_PAID === 'true'");
    expect(paidScript).toMatch(/\['ready', 'failed', 'blocked'\]/);
  });

  it('does not print credentials, fee tokens, user email, or map names', () => {
    expect(paidScript).not.toContain("log('authenticated', { email:");
    expect(paidScript).not.toContain('mapName: map.name');
    expect(paidScript).not.toMatch(/log\([^\n]*confirmationToken/);
  });

  it('rejects failed and HTTP-error browser resources', () => {
    expect(browserScript).toContain("page.on('requestfailed'");
    expect(browserScript).toContain("page.on('response'");
    expect(browserScript).toContain('response.status() >= 400');
    expect(browserScript).toContain('responseFailures');
  });

  it('probes only the V3 direct image capability', () => {
    expect(probeScript).toContain("semantic: 'direct_map_image'");
    expect(probeScript).not.toContain('V2_INFORMATIONAL');
    expect(probeScript).not.toContain('v2Informational');
  });
});
