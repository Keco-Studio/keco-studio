/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { DirectMapWorkbench } from '@/features/create-map/DirectMapWorkbench';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from './fixtures';

const projectId = '10000000-0000-4000-8000-000000000001';
const mapId = '10000000-0000-4000-8000-000000000002';
const mockSupabase = {};
const mockMap = { id: mapId, projectId, projectName: 'Project', name: 'Map', schemaVersion: 3, currentRevisionId: 'revision', updatedAt: '2026-09-24' };
const mockSaved = { maps: [mockMap], refetch: jest.fn(), isLoading: false, error: null };
const mockHistory = { revisions: [], refetch: jest.fn() };
const mockDraft = { identity: { mapId, revisionId: 'revision', revisionNumber: 1, saveVersion: 0 }, status: 'saved', isDirty: false, isValid: true, error: null,
  create: jest.fn(), reset: jest.fn(), install: jest.fn(), reload: jest.fn() };
const mockGeneration = { phase: 'idle', asset: null, error: null, boundImage: null, canRetry: false, canResolveUnknown: false,
  generate: jest.fn(), retry: jest.fn(), resolveUnknownAndRestart: jest.fn(), reset: jest.fn(), prepareRestore: jest.fn(), installRestore: jest.fn() };
const mockService = { listReferences: jest.fn().mockResolvedValue([]), loadSavedMapV3: jest.fn() };
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => mockSupabase }));
jest.mock('@/lib/create-map/projectPreference', () => ({ readCreateMapProjectPreference: () => ({ projectId: '10000000-0000-4000-8000-000000000001' }), CREATE_MAP_SIDEBAR_STATE_EVENT: 'sidebar-state', CREATE_MAP_TOOLBAR_CREATE_EVENT: 'toolbar-create' }));
jest.mock('@/features/create-map/services/createMapService', () => ({ createMapService: () => mockService }));
jest.mock('@/features/create-map/hooks/useMapSources', () => ({ useMapSources: () => ({ projects: [], error: null }) }));
jest.mock('@/features/create-map/hooks/useSavedMaps', () => ({ useSavedMaps: () => mockSaved, savedMapOpenIsCurrent: (a: number, b: number) => a === b,
  savedMapSwitchBlocked: (state: { isDirty: boolean }) => state.isDirty }));
jest.mock('@/features/create-map/hooks/useMapDraft', () => ({ createMapDraftAdapterV3: () => ({}), useMapDraft: () => mockDraft }));
jest.mock('@/features/create-map/hooks/useMapGenerationHistory', () => ({ useMapGenerationHistory: () => mockHistory }));
jest.mock('@/features/create-map/hooks/useDirectMapGeneration', () => ({ useDirectMapGeneration: () => mockGeneration }));
jest.mock('@/features/create-map/hooks/useDirectMapCollisionGrid', () => ({ useDirectMapCollisionGrid: () => ({}) }));
jest.mock('@/features/create-map/components/DirectMapCanvas', () => ({ DirectMapCanvas: () => <div data-testid="map-canvas" /> }));
jest.mock('@/features/create-map/components/DirectMapPlanInspector', () => ({ DirectMapPlanInspector: () => <div /> }));
jest.mock('@/features/create-map/components/DirectMapGenerationPanel', () => ({ DirectMapGenerationPanel: () => <div data-testid="generation-monitor" /> }));
jest.mock('@/features/create-map/components/MapReferencePanel', () => ({ MapReferencePanel: () => <div /> }));

beforeEach(() => {
  jest.clearAllMocks();
  mockDraft.isDirty = false;
  const loaded = { projectId, plan: makeValidMapPlanV3(), scene: makeEmptyMapSceneV3(), sourceDocumentId: null, identity: mockDraft.identity };
  mockService.loadSavedMapV3.mockResolvedValue(loaded);
  mockGeneration.prepareRestore.mockResolvedValue({ plan: loaded.plan, scene: loaded.scene, phase: 'generating' });
});
afterEach(cleanup);

function refresh(detail: unknown = { projectId, mapId }) {
  act(() => { window.dispatchEvent(new CustomEvent('create-map:refresh', { detail })); });
}

describe('workbench durable state refresh', () => {
  it('reloads the active map and installs generation restoration even when its map ID is unchanged', async () => {
    const view = render(<DirectMapWorkbench />);
    refresh();
    await waitFor(() => expect(mockGeneration.installRestore).toHaveBeenCalledTimes(1));
    expect(mockSaved.refetch).toHaveBeenCalledTimes(1);
    expect(mockHistory.refetch).toHaveBeenCalledTimes(1);
    expect(mockService.loadSavedMapV3).toHaveBeenCalledWith(mapId);
    expect(mockDraft.install).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('map-canvas')).toBeTruthy();
    expect(view.getByTestId('generation-monitor')).toBeTruthy();
  });

  it('waits for local edits to save before installing the refreshed map', async () => {
    mockDraft.isDirty = true;
    const view = render(<DirectMapWorkbench />);
    refresh();
    expect(mockSaved.refetch).toHaveBeenCalledTimes(1);
    expect(mockService.loadSavedMapV3).not.toHaveBeenCalled();
    mockDraft.isDirty = false;
    view.rerender(<DirectMapWorkbench />);
    await waitFor(() => expect(mockDraft.install).toHaveBeenCalledTimes(1));
  });

  it('ignores malformed and other-project refresh requests, and removes its listener on unmount', async () => {
    const view = render(<DirectMapWorkbench />);
    refresh(null);
    refresh({ projectId: {}, mapId });
    expect(mockSaved.refetch).not.toHaveBeenCalled();
    refresh({ projectId: 'foreign', mapId });
    expect(mockService.loadSavedMapV3).not.toHaveBeenCalled();
    view.unmount();
    mockSaved.refetch.mockClear();
    refresh();
    expect(mockSaved.refetch).not.toHaveBeenCalled();
  });
});
