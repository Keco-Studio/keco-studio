import React from 'react';
import { expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCreateMapDashboardChrome } from '@/lib/create-map/dashboardChrome';
import { isCreateMapPath } from '@/lib/create-map/isCreateMapPath';
import { parseRouteParams, SPECIAL_ROUTE_SEGMENTS } from '@/lib/utils/routeParams';
import { CreateMapWorkbench } from '@/features/create-map/CreateMapWorkbench';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@/features/create-map/hooks/useMapSources', () => ({
  useMapSources: () => ({ projects: [], documents: [], isLoading: false, error: null }),
}));
jest.mock('@/features/create-map/hooks/useSavedMaps', () => ({
  savedMapOpenIsCurrent: (current: number, expected: number) => current === expected,
  savedMapSwitchBlocked: () => false,
  useSavedMaps: () => ({ maps: [], isLoading: false, error: null, refetch: jest.fn() }),
}));
jest.mock('@/features/create-map/hooks/useMapDraft', () => ({
  createMapDraftAdapterV3: () => ({}),
  useMapDraft: () => ({
    identity: null, status: 'idle', error: null, isDirty: false, isValid: true,
    create: jest.fn(), reload: jest.fn(), saveAsNewRevision: jest.fn(), install: jest.fn(),
    publishForGeneration: jest.fn(), reset: jest.fn(), saveNow: jest.fn(),
  }),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/create-map',
}));

jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    userProfile: null,
    signOut: jest.fn(),
  }),
}));

jest.mock('@/lib/contexts/NavigationContext', () => ({
  useNavigation: () => ({ currentProjectId: null }),
}));

jest.mock('@/components/layout/LeftNav', () => ({
  LeftNav: () => React.createElement('nav', { 'data-left-nav': true }),
}));

jest.mock('@/components/layout/TopBar', () => ({
  TopBar: () => React.createElement('header', { 'data-top-bar': true }),
}));

jest.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => React.createElement('aside', { 'data-studio-sidebar': true }),
}));

jest.mock('@/components/agent/ChatPanel', () => ({
  ChatPanel: () => React.createElement('aside', { 'data-chat-panel': true }),
}));

jest.mock('@/components/agent/AgentImportBridge', () => ({
  AgentImportBridge: () => null,
}));

jest.mock('@/components/script-system/ScriptSidebar', () => ({
  ScriptSidebar: () => React.createElement('aside', { 'data-script-sidebar': true }),
}));

jest.mock('@/components/authform/AuthForm', () => ({
  __esModule: true,
  default: () => React.createElement('form', { 'data-auth-form': true }),
}));

jest.mock('@/components/layout/DashboardLayout.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

import { DashboardLayout } from '@/components/layout/DashboardLayout';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

it('matches only the Create Map workspace', () => {
  expect(isCreateMapPath('/create-map')).toBe(true);
  expect(isCreateMapPath('/create-map/history')).toBe(true);
  expect(isCreateMapPath('/projects')).toBe(false);
});

it('treats Create Map as a root workspace instead of a project id', () => {
  expect(SPECIAL_ROUTE_SEGMENTS).toContain('create-map');
  expect(parseRouteParams('/create-map')).toEqual({
    projectId: null,
    libraryId: null,
    folderId: null,
    assetId: null,
    documentId: null,
    isPredefinePage: false,
    isLibraryPage: false,
  });
  expect(parseRouteParams('/create-map/history').projectId).toBeNull();
});

it('keeps global Create Map chrome visible while hiding Studio-only regions', () => {
  expect(getCreateMapDashboardChrome('/create-map')).toEqual({
    showLeftNav: true,
    showTopBar: true,
    showStudioSidebar: false,
    showChatPanel: false,
  });
});

it('renders the Create Map workbench semantic regions', () => {
  const markup = renderToStaticMarkup(React.createElement(CreateMapWorkbench));

  expect(markup).toContain('data-testid="create-map-workbench"');
  expect(markup).toContain('aria-label="Map source and references"');
  expect(markup).toContain('aria-label="Map canvas"');
  expect(markup).toContain('aria-label="Map plan and generation"');
});

it('stacks the workbench regions into one column below 900px', () => {
  const css = read('src/features/create-map/CreateMapWorkbench.module.css');

  expect(css).toMatch(
    /@media\s*\(max-width:\s*899px\)\s*\{[\s\S]*?\.workbench\s*\{[\s\S]*?min-width:\s*0[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
});

it('renders Create Map dashboard chrome without Studio Sidebar or ChatPanel', () => {
  const markup = renderToStaticMarkup(
    React.createElement(DashboardLayout, null, React.createElement(CreateMapWorkbench))
  );

  expect(markup).toContain('data-left-nav="true"');
  expect(markup).toContain('data-top-bar="true"');
  expect(markup).not.toContain('data-studio-sidebar="true"');
  expect(markup).not.toContain('data-chat-panel="true"');
});
