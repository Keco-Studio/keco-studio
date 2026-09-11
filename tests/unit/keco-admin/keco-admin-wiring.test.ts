import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Keco Admin page wiring', () => {
  it('mounts the dashboard at the account-level route', () => {
    const page = read('src/app/(dashboard)/keco-admin/page.tsx');

    expect(page).toContain('KecoAdminDashboard');
    expect(page).toContain('<KecoAdminDashboard />');
  });

  it('uses the focused product shell', () => {
    const layout = read('src/components/layout/DashboardLayout.tsx');

    expect(layout).toContain("pathname === '/keco-admin'");
    expect(layout).toMatch(/showLeftNav[\s\S]+isKecoAdminPage/);
    expect(layout).toMatch(/showStudioSidebar[\s\S]+!isKecoAdminPage/);
    expect(layout).toMatch(/hideChatPanel[\s\S]+isKecoAdminPage/);
    expect(layout).toContain('<TopBar');
  });

  it('keeps the dense dashboard responsive and accessible', () => {
    const css = read(
      'src/components/keco-admin/KecoAdminDashboard.module.css',
    );

    expect(css).toMatch(/\.metricsGrid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,/);
    expect(css).toMatch(/@media \(max-width:\s*980px\)[\s\S]*repeat\(2,/);
    expect(css).toMatch(/@media \(max-width:\s*680px\)[\s\S]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/\.tableScroller\s*\{[\s\S]*overflow-x:\s*auto/);
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toMatch(/font-size:\s*(?:clamp|min|max)\(/);

    for (const match of css.matchAll(/border-radius:\s*(\d+)px/g)) {
      expect(Number(match[1])).toBeLessThanOrEqual(8);
    }
  });
});
