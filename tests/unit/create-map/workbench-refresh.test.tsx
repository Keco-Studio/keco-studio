/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DirectMapWorkbench } from '@/features/create-map/DirectMapWorkbench';
import { publishCreateMapAgentRefresh } from '@/lib/create-map/agentRefresh';
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
const mockService = {
  listReferences: jest.fn().mockResolvedValue([]),
  loadSavedMapV3: jest.fn(),
  createPlanV3: jest.fn(),
};
const conversationId = '10000000-0000-4000-8000-000000000011';
const planNodeId = '10000000-0000-4000-8000-000000000012';
const mockConversation = {
  snapshot: null as null | {
    id: string;
    projectId: string;
    title: string;
    nodes: [];
    planNodes: Array<{
      id: string;
      type: 'plan';
      displayVersion: number;
      parentPlanNodeId: string | null;
      mapProjectId: string;
      mapPlanVersionId: string;
      createdAt: string;
      displayLabel: string;
      maps: [];
    }>;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      text: string;
      artifactNodeId: string | null;
      basePlanNodeId: string | null;
      createdAt: string;
    }>;
  },
  refetch: jest.fn(),
  service: {
    findConversationForMap: jest.fn(),
    resolveNode: jest.fn(),
    createPlan: jest.fn(),
    attachGeneratedMap: jest.fn(),
  },
};
let queryClient: QueryClient;
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({ useSearchParams: () => mockSearchParams }));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => mockSupabase }));
jest.mock('@/lib/create-map/projectPreference', () => ({ readCreateMapProjectPreference: () => ({ projectId: '10000000-0000-4000-8000-000000000001' }), CREATE_MAP_SIDEBAR_STATE_EVENT: 'sidebar-state', CREATE_MAP_TOOLBAR_CREATE_EVENT: 'toolbar-create' }));
jest.mock('@/features/create-map/services/createMapService', () => ({ createMapService: () => mockService }));
jest.mock('@/features/create-map/hooks/useMapSources', () => ({ useMapSources: () => ({ projects: [], error: null }) }));
jest.mock('@/features/create-map/hooks/useSavedMaps', () => ({ useSavedMaps: () => mockSaved, savedMapOpenIsCurrent: (a: number, b: number) => a === b,
  savedMapSwitchBlocked: (state: { isDirty: boolean }) => state.isDirty }));
jest.mock('@/features/create-map/hooks/useMapDraft', () => ({ createMapDraftAdapterV3: () => ({}), useMapDraft: () => mockDraft }));
jest.mock('@/features/create-map/hooks/useMapGenerationHistory', () => ({ useMapGenerationHistory: () => mockHistory }));
jest.mock('@/features/create-map/hooks/useDirectMapGeneration', () => ({
  directMapPlanFingerprint: jest.fn().mockResolvedValue('a'.repeat(64)),
  useDirectMapGeneration: () => mockGeneration,
}));
jest.mock('@/features/create-map/hooks/useDirectMapCollisionGrid', () => ({ useDirectMapCollisionGrid: () => ({}) }));
jest.mock('@/features/create-map/hooks/useMapConversation', () => ({
  useMapConversation: () => mockConversation,
}));
jest.mock('@/features/create-map/components/DirectMapCanvas', () => ({ DirectMapCanvas: () => <div data-testid="map-canvas" /> }));
jest.mock('@/features/create-map/components/DirectMapPlanInspector', () => ({ DirectMapPlanInspector: () => <div /> }));
jest.mock('@/features/create-map/components/DirectMapGenerationPanel', () => ({ DirectMapGenerationPanel: () => <div data-testid="generation-monitor" /> }));
jest.mock('@/features/create-map/components/MapReferencePanel', () => ({ MapReferencePanel: () => <div /> }));

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient();
  mockSearchParams = new URLSearchParams();
  window.history.replaceState(null, '', '/create-map');
  mockDraft.isDirty = false;
  mockDraft.identity = { mapId, revisionId: 'revision', revisionNumber: 1, saveVersion: 0 };
  mockConversation.snapshot = null;
  mockConversation.service.findConversationForMap.mockResolvedValue(null);
  const loaded = { projectId, plan: makeValidMapPlanV3(), scene: makeEmptyMapSceneV3(), sourceDocumentId: null, identity: mockDraft.identity };
  mockService.loadSavedMapV3.mockResolvedValue(loaded);
  mockService.createPlanV3.mockResolvedValue({ plan: loaded.plan, sourceToken: null });
  mockConversation.service.createPlan.mockResolvedValue({
    conversationId,
    planNodeId,
    planVersionId: '10000000-0000-4000-8000-000000000013',
    displayVersion: 2,
    identity: {
      mapId: '10000000-0000-4000-8000-000000000020',
      revisionId: '10000000-0000-4000-8000-000000000021',
      revisionNumber: 1,
      saveVersion: 0,
    },
  });
  mockGeneration.prepareRestore.mockResolvedValue({ plan: loaded.plan, scene: loaded.scene, phase: 'generating' });
});
afterEach(cleanup);

function workbench() {
  return <QueryClientProvider client={queryClient}><DirectMapWorkbench /></QueryClientProvider>;
}

function refresh(detail: { projectId: string; mapId?: string } = { projectId, mapId }) {
  act(() => { publishCreateMapAgentRefresh(queryClient, detail); });
}

describe('workbench durable state refresh', () => {
  it('opens conversation links directly in chat detail without showing the saved-map list', async () => {
    mockSearchParams = new URLSearchParams(`conversationId=${conversationId}`);

    render(workbench());

    expect(screen.getByTestId('create-map-workbench').getAttribute('data-view')).toBe('detail');
    expect(screen.queryByRole('heading', { name: 'Saved maps' })).toBeNull();
    await waitFor(() => expect(mockService.listReferences).toHaveBeenCalledWith(projectId));
  });

  it('reloads the active map and installs generation restoration even when its map ID is unchanged', async () => {
    const view = render(workbench());
    refresh();
    await waitFor(() => expect(mockGeneration.installRestore).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockSaved.refetch).toHaveBeenCalledTimes(1));
    expect(mockHistory.refetch).toHaveBeenCalledTimes(1);
    expect(mockService.loadSavedMapV3).toHaveBeenCalledWith(mapId);
    expect(mockDraft.install).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('map-canvas')).toBeTruthy();
    expect(view.getByTestId('generation-monitor')).toBeTruthy();
  });

  it('waits for local edits to save before installing the refreshed map', async () => {
    mockDraft.isDirty = true;
    const view = render(workbench());
    refresh();
    await waitFor(() => expect(mockSaved.refetch).toHaveBeenCalledTimes(1));
    expect(mockService.loadSavedMapV3).not.toHaveBeenCalled();
    mockDraft.isDirty = false;
    view.rerender(workbench());
    await waitFor(() => expect(mockDraft.install).toHaveBeenCalledTimes(1));
  });

  it('ignores other-project refresh requests and stops observing after unmount', async () => {
    const view = render(workbench());
    refresh({ projectId: 'foreign', mapId });
    expect(mockSaved.refetch).not.toHaveBeenCalled();
    expect(mockService.loadSavedMapV3).not.toHaveBeenCalled();
    view.unmount();
    mockSaved.refetch.mockClear();
    refresh();
    expect(mockSaved.refetch).not.toHaveBeenCalled();
  });

  it('reacts to repeated refreshes with the same map identity', async () => {
    render(workbench());
    refresh();
    await waitFor(() => expect(mockDraft.install).toHaveBeenCalledTimes(1));
    refresh();
    await waitFor(() => expect(mockDraft.install).toHaveBeenCalledTimes(2));
  });

  it('does not render synthetic open-map messages while a saved conversation loads', async () => {
    mockConversation.service.findConversationForMap.mockResolvedValue({
      conversationId,
      planNodeId,
    });

    render(workbench());
    refresh();

    await waitFor(() => expect(mockGeneration.installRestore).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/^Open map:/)).toBeNull();
  });

  it('opens a saved conversation with a stable conversation URL instead of a version map ID', async () => {
    mockConversation.service.findConversationForMap.mockResolvedValue({
      conversationId,
      planNodeId,
    });

    render(workbench());
    refresh();

    await waitFor(() => expect(mockGeneration.installRestore).toHaveBeenCalledTimes(1));
    const url = new URL(window.location.href);
    expect(url.searchParams.get('conversationId')).toBe(conversationId);
    expect(url.searchParams.has('mapId')).toBe(false);
  });

  it('restores the latest Plan and its durable history from a conversation-only link', async () => {
    mockSearchParams = new URLSearchParams(`conversationId=${conversationId}`);
    mockDraft.identity = null as never;
    mockConversation.snapshot = {
      id: conversationId,
      projectId,
      title: 'Island delivery',
      nodes: [],
      planNodes: [{
        id: planNodeId,
        type: 'plan',
        displayVersion: 1,
        parentPlanNodeId: null,
        mapProjectId: mapId,
        mapPlanVersionId: '10000000-0000-4000-8000-000000000013',
        createdAt: '2026-10-23T00:00:00.000Z',
        displayLabel: 'Plan V1',
        maps: [],
      }],
      messages: [{
        id: '10000000-0000-4000-8000-000000000014',
        role: 'user',
        text: 'Create an island delivery map.',
        artifactNodeId: null,
        basePlanNodeId: null,
        createdAt: '2026-10-23T00:00:00.000Z',
      }, {
        id: '10000000-0000-4000-8000-000000000015',
        role: 'assistant',
        text: 'Map Plan created',
        artifactNodeId: planNodeId,
        basePlanNodeId: null,
        createdAt: '2026-10-23T00:00:01.000Z',
      }],
    };
    mockConversation.service.findConversationForMap.mockResolvedValue({
      conversationId,
      planNodeId,
    });

    render(workbench());

    await waitFor(() => expect(mockService.loadSavedMapV3).toHaveBeenCalledWith(mapId));
    expect(screen.getByText('Create an island delivery map.')).toBeTruthy();
    expect(screen.getByText('Map Plan created')).toBeTruthy();
  });

  it('does not reopen a Plan it just created when the URL normalizes to its conversation', async () => {
    mockConversation.service.findConversationForMap.mockResolvedValue({
      conversationId,
      planNodeId,
    });
    const view = render(workbench());
    refresh();
    await waitFor(() => expect(mockGeneration.installRestore).toHaveBeenCalledTimes(1));
    mockService.loadSavedMapV3.mockClear();

    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI to help' }), {
      target: { value: 'Move the lighthouse closer to the dock.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockConversation.service.createPlan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(new URL(window.location.href).searchParams.has('mapId')).toBe(false));
    expect(new URL(window.location.href).searchParams.get('conversationId')).toBe(conversationId);
    mockService.loadSavedMapV3.mockClear();

    mockSearchParams = new URLSearchParams(`conversationId=${conversationId}`);
    view.rerender(workbench());

    await act(async () => Promise.resolve());
    expect(mockService.loadSavedMapV3).not.toHaveBeenCalled();
    expect(mockConversation.service.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId, basePlanNodeId: planNodeId }),
    );
  });

  it('shows a follow-up user bubble immediately inside the current conversation', async () => {
    const prompt = 'Add a clinic beside the harbor.';
    let resolveCreatePlan!: (value: unknown) => void;
    mockConversation.service.findConversationForMap.mockResolvedValue({
      conversationId,
      planNodeId,
    });
    mockConversation.snapshot = {
      id: conversationId,
      projectId,
      title: 'Island delivery',
      nodes: [],
      planNodes: [{
        id: planNodeId,
        type: 'plan',
        displayVersion: 1,
        parentPlanNodeId: null,
        mapProjectId: mapId,
        mapPlanVersionId: '10000000-0000-4000-8000-000000000013',
        createdAt: '2026-10-23T00:00:00.000Z',
        displayLabel: 'Plan V1',
        maps: [],
      }],
      messages: [{
        id: '10000000-0000-4000-8000-000000000014',
        role: 'user',
        text: 'Create an island delivery map.',
        artifactNodeId: null,
        basePlanNodeId: null,
        createdAt: '2026-10-23T00:00:00.000Z',
      }],
    };
    mockConversation.service.createPlan.mockReturnValue(
      new Promise((resolve) => { resolveCreatePlan = resolve; }),
    );

    render(workbench());
    refresh();
    await waitFor(() => expect(mockGeneration.installRestore).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI to help' }), {
      target: { value: prompt },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(prompt)).toBeTruthy();
    expect(screen.getByText('Create an island delivery map.')).toBeTruthy();

    await act(async () => {
      resolveCreatePlan({
        conversationId,
        planNodeId,
        planVersionId: '10000000-0000-4000-8000-000000000013',
        displayVersion: 2,
        identity: {
          mapId: '10000000-0000-4000-8000-000000000020',
          revisionId: '10000000-0000-4000-8000-000000000021',
          revisionNumber: 1,
          saveVersion: 0,
        },
      });
      await Promise.resolve();
    });
  });

  it('keeps follow-up navigation scoped to the conversation instead of the new Plan map ID', async () => {
    mockConversation.service.findConversationForMap.mockResolvedValue({
      conversationId,
      planNodeId,
    });
    render(workbench());
    refresh();
    await waitFor(() => expect(mockGeneration.installRestore).toHaveBeenCalledTimes(1));
    window.history.replaceState(
      null,
      '',
      `/create-map?conversationId=${conversationId}&mapId=${mapId}`,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI to help' }), {
      target: { value: 'Add a clinic beside the harbor.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockConversation.service.createPlan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('conversationId')).toBe(conversationId));
    expect(new URL(window.location.href).searchParams.has('mapId')).toBe(false);
    expect(screen.getByTestId('create-map-workbench').getAttribute('data-view')).toBe('detail');
  });
});
