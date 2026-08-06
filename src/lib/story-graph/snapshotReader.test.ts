import { describe, expect, it } from '@jest/globals';
import { buildStoryGraphSnapshotFromRows, StoryGraphSnapshotError } from './snapshotReader';

const library = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Story Conversation',
  project_id: '22222222-2222-4222-8222-222222222222',
  document_export_type: 'script',
  updated_at: '2026-08-05T00:00:00.000Z',
  plot_plan: {
    version: 2,
    entryPlotNodeId: 'Start',
    storyNodeOrder: ['Start', 'End'],
    nodes: [
      { id: 'Start', title: 'Opening', storyNodeIds: ['Start'] },
      { id: 'End', title: 'Ending', storyNodeIds: ['End'] },
    ],
    edges: [{
      fromPlotNodeId: 'Start', toPlotNodeId: 'End',
      optionText: null, optionIndex: null,
    }],
  },
};

const fields = [
  { id: 'field-label', label: 'Label', order_index: 0 },
  { id: 'field-type', label: 'Type', order_index: 1 },
  { id: 'field-name', label: 'Name', order_index: 2 },
  { id: 'field-content', label: 'Content', order_index: 3 },
  { id: 'field-commands', label: 'Commands', order_index: 4 },
];

const assets = [
  {
    id: 'asset-end', name: 'End', row_index: 1,
    created_at: '2026-08-05T00:00:01.000Z', updated_at: '2026-08-05T00:00:01.000Z',
  },
  {
    id: 'asset-start', name: 'Start', row_index: 0,
    created_at: '2026-08-05T00:00:00.000Z', updated_at: '2026-08-05T00:00:00.000Z',
  },
];

const values = [
  { asset_id: 'asset-start', field_id: 'field-label', value_json: 'Start' },
  { asset_id: 'asset-start', field_id: 'field-type', value_json: '3' },
  { asset_id: 'asset-start', field_id: 'field-content', value_json: 'Opening' },
  { asset_id: 'asset-start', field_id: 'field-commands', value_json: '' },
  { asset_id: 'asset-end', field_id: 'field-label', value_json: 'End' },
  { asset_id: 'asset-end', field_id: 'field-type', value_json: '3' },
  { asset_id: 'asset-end', field_id: 'field-content', value_json: 'Ending' },
  { asset_id: 'asset-end', field_id: 'field-commands', value_json: 'End' },
];

describe('story graph snapshot reader', () => {
  it('builds an ordered editable graph and canonical expected snapshot', () => {
    const snapshot = buildStoryGraphSnapshotFromRows({ library, fields, assets, values });

    expect(snapshot.graph.nodes.map((node) => [node.label, node.assetId])).toEqual([
      ['Start', 'asset-start'], ['End', 'asset-end'],
    ]);
    expect(snapshot.graph.nodes[0].nextLabel).toBe('End');
    expect(snapshot.fieldIdByLabel.get('Content')).toBe('field-content');
    expect(snapshot.expectedSnapshot).toEqual({
      libraryUpdatedAt: '2026-08-05T00:00:00.000Z',
      plotPlan: library.plot_plan,
      fields: fields.map((field) => ({
        id: field.id, label: field.label, orderIndex: field.order_index,
      })),
      assets: [
        { id: 'asset-start', rowIndex: 0, updatedAt: '2026-08-05T00:00:00.000Z' },
        { id: 'asset-end', rowIndex: 1, updatedAt: '2026-08-05T00:00:01.000Z' },
      ],
    });
  });

  it.each([
    ['regular library', { ...library, document_export_type: 'table' }, fields, assets],
    ['missing Script columns', library, fields.filter((field) => field.label !== 'Commands'), assets],
    ['missing row indexes', library, fields, [{ ...assets[0], row_index: null }, assets[1]]],
    ['stale plot row count', {
      ...library,
      plot_plan: { ...library.plot_plan, storyNodeOrder: ['Start'] },
    }, fields, assets],
  ])('rejects a %s', (_name, changedLibrary, changedFields, changedAssets) => {
    expect(() => buildStoryGraphSnapshotFromRows({
      library: changedLibrary,
      fields: changedFields,
      assets: changedAssets,
      values,
    })).toThrow(StoryGraphSnapshotError);
  });
});

