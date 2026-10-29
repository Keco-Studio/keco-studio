import { describe, expect, it } from '@jest/globals';
import {
  getMapConversationLabels,
  mapRevisionBelongsToPlan,
  type MapConversationSnapshot,
} from '@/features/create-map/model/mapConversation';

const planId = '10000000-0000-4000-8000-000000000003';
const mapRevisionId = '10000000-0000-4000-8000-000000000006';

const snapshot: MapConversationSnapshot = {
  id: '10000000-0000-4000-8000-000000000001',
  projectId: '10000000-0000-4000-8000-000000000002',
  title: 'GDD delivery island',
  messages: [],
  nodes: [],
  planNodes: [
    {
      id: planId,
      type: 'plan',
      displayVersion: 1,
      displayLabel: 'Plan V1',
      parentPlanNodeId: null,
      mapProjectId: '10000000-0000-4000-8000-000000000004',
      mapPlanVersionId: '10000000-0000-4000-8000-000000000005',
      createdAt: '2026-10-29T01:00:00.000Z',
      maps: [
        {
          id: '10000000-0000-4000-8000-000000000007',
          type: 'map',
          planNodeId: planId,
          revisionId: mapRevisionId,
          assetId: '10000000-0000-4000-8000-000000000008',
          mapVersionNumber: 1,
          status: 'ready',
          createdAt: '2026-10-29T01:01:00.000Z',
          displayLabel: 'Map V1.1',
        },
      ],
    },
  ],
};

describe('Map conversation semantic labels', () => {
  it('uses the displayed Map node without exposing the editable draft revision', () => {
    expect(getMapConversationLabels(snapshot, planId, mapRevisionId)).toEqual({
      planLabel: 'Plan V1',
      canvasLabel: 'Map V1.1',
    });
  });

  it('falls back to the active Plan while no generated Map is displayed', () => {
    expect(getMapConversationLabels(snapshot, planId, null)).toEqual({
      planLabel: 'Plan V1',
      canvasLabel: 'Plan V1',
    });
  });

  it('returns no semantic version when the active Plan is unavailable', () => {
    expect(getMapConversationLabels(snapshot, null, mapRevisionId)).toEqual({
      planLabel: null,
      canvasLabel: null,
    });
  });

  it('does not treat a previous Plan Map as output for the active Plan', () => {
    const nextPlanId = '10000000-0000-4000-8000-000000000009';
    const nextSnapshot: MapConversationSnapshot = {
      ...snapshot,
      planNodes: [
        ...snapshot.planNodes,
        {
          ...snapshot.planNodes[0],
          id: nextPlanId,
          displayVersion: 2,
          displayLabel: 'Plan V2',
          parentPlanNodeId: planId,
          mapProjectId: '10000000-0000-4000-8000-000000000010',
          mapPlanVersionId: '10000000-0000-4000-8000-000000000011',
          maps: [],
        },
      ],
    };

    expect(mapRevisionBelongsToPlan(nextSnapshot, nextPlanId, mapRevisionId)).toBe(false);
    expect(mapRevisionBelongsToPlan(nextSnapshot, planId, mapRevisionId)).toBe(true);
  });
});
