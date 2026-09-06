import { describe, expect, it, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  readRecentVisits,
  writeRecentVisit,
} from '@/lib/recentVisits/storage';
import {
  readBillingPrefs,
  writeBillingPrefs,
  readNotificationPrefs,
  writeNotificationPrefs,
} from '@/lib/adminPrefs/storage';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('recent visits storage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      configurable: true,
    });
  });

  it('dedupes by kind+id and keeps newest first', () => {
    writeRecentVisit('user-1', {
      kind: 'table',
      id: 'lib-a',
      projectId: 'proj-1',
      name: 'Seedcrop',
      href: '/proj-1/lib-a',
      visitedAt: '2026-08-01T10:00:00.000Z',
    });
    writeRecentVisit('user-1', {
      kind: 'document',
      id: 'doc-1',
      projectId: 'proj-1',
      name: 'World bible',
      href: '/proj-1/doc/doc-1',
      visitedAt: '2026-08-01T11:00:00.000Z',
    });
    writeRecentVisit('user-1', {
      kind: 'table',
      id: 'lib-a',
      projectId: 'proj-1',
      name: 'Seedcrop',
      href: '/proj-1/lib-a',
      visitedAt: '2026-08-01T12:00:00.000Z',
    });

    const visits = readRecentVisits('user-1', 'proj-1');
    expect(visits).toHaveLength(2);
    expect(visits[0]?.id).toBe('lib-a');
    expect(visits[0]?.kind).toBe('table');
    expect(visits[0]?.visitedAt).toBe('2026-08-01T12:00:00.000Z');
    expect(visits[1]?.id).toBe('doc-1');
    expect(visits[1]?.kind).toBe('document');
  });
});

describe('admin prefs storage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      configurable: true,
    });
  });

  it('persists billing and notification prefs', () => {
    writeBillingPrefs('user-1', 'proj-1', {
      paymentEnabled: false,
      methodLabel: 'Visa',
      billingAddress: 'Shanghai',
    });
    writeNotificationPrefs('user-1', {
      emailAlerts: false,
      inAppAlerts: true,
      collaboratorInvites: true,
      libraryUpdates: true,
    });

    expect(readBillingPrefs('user-1', 'proj-1').paymentEnabled).toBe(false);
    expect(readBillingPrefs('user-1', 'proj-1').methodLabel).toBe('Visa');
    expect(readNotificationPrefs('user-1').emailAlerts).toBe(false);
    expect(readNotificationPrefs('user-1').libraryUpdates).toBe(true);
  });
});

describe('Recent / Admin sidebar wiring', () => {
  it('renders Recent and Admin under the project selector', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    const quickNav = read('src/components/layout/components/SidebarProjectQuickNav.tsx');
    expect(sidebar).toContain('SidebarProjectQuickNav');
    expect(quickNav).toContain('sidebar-recent-nav');
    expect(quickNav).toContain('sidebar-admin-nav');
    expect(quickNav).toContain('Settings');
    expect(quickNav).toContain('/recent');
    expect(quickNav).toContain('/admin');
    expect(quickNav).not.toContain('>Admin<');
  });

  it('hosts Admin settings and collaborator routes', () => {
    const settings = read('src/app/(dashboard)/[projectId]/admin/page.tsx');
    const collaborators = read('src/app/(dashboard)/[projectId]/admin/collaborators/page.tsx');
    const recent = read('src/app/(dashboard)/[projectId]/recent/page.tsx');
    const legacy = read('src/app/(dashboard)/[projectId]/collaborators/page.tsx');
    const adminSettings = read('src/components/admin/AdminSettingsPage.tsx');
    expect(settings).toContain('AdminSettingsPage');
    expect(collaborators).toContain('AdminCollaboratorsPage');
    expect(recent).toContain('RecentPage');
    expect(legacy).toContain('/admin/collaborators');
    expect(adminSettings).toContain('Payment details');
    expect(adminSettings).toContain('readBillingPrefs');
    expect(adminSettings).not.toContain('StripeCheckoutPanel');
  });

  it('hosts billing plans from the avatar menu', () => {
    const billingPage = read('src/app/(dashboard)/[projectId]/billing/page.tsx');
    const billingUi = read('src/components/billing/BillingPlansPage.tsx');
    const topBar = read('src/components/layout/TopBar.tsx');
    expect(billingPage).toContain('BillingPlansPage');
    expect(billingUi).toContain('Most popular');
    expect(billingUi).not.toContain('Top up credits');
    expect(topBar).toContain('handleBillingNavigation');
    expect(topBar).toContain('user-menu-billing');
  });

  it('treats admin and recent as special project routes', () => {
    const source = read('src/lib/utils/routeParams.ts');
    expect(source).toContain("'admin'");
    expect(source).toContain("'recent'");
    expect(source).toContain("'billing'");
  });
});
