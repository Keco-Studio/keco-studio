import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { tryParseExplicitStory } from './explicitParser';
import { hydrateStoryDocument } from './hydrator';
import { buildStoryAuditProjection } from './projection';
import { segmentStorySource } from './sourceSegments';
import { STORY_BASE_COLUMNS } from '@/lib/story-ir/tableFormat';

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);

function document() {
  const source = segmentStorySource(fixture, 'fixture');
  return hydrateStoryDocument(tryParseExplicitStory(source)!, source);
}

describe('story audit projection', () => {
  it('projects exact rows and compiled option columns', () => {
    const projection = buildStoryAuditProjection(document());

    expect(projection.rows[0]).toEqual({
      label: 'Start',
      type: 'dialogue',
      speaker: '光球',
      content: '你醒了。选一条路。',
      commands: [],
      nextNodeId: '',
      choices: [
        { text: '走左边。', targetNodeId: 'O1', commands: ['$trust+=1'] },
        { text: '走右边。', targetNodeId: 'O2', commands: ['$trust+=2'] },
      ],
    });
    expect(projection.table.columns).toEqual([
      ...STORY_BASE_COLUMNS,
      'Option0_Commands',
      'Option1_Commands',
    ]);
    const o1Row = projection.table.rows.find(
      (row) => row[projection.table.columns.indexOf('Label')] === 'O1'
    );
    expect(o1Row?.[projection.table.columns.indexOf('Option0_Commands')]).toBe('$trust+=1');
  });

  it('enumerates all four terminal paths without sibling leakage', () => {
    const projection = buildStoryAuditProjection(document());

    expect(projection.paths).toEqual([
      { labels: ['Start', 'O1', 'O1A_END', 'Oend'], terminalLabel: 'Oend' },
      { labels: ['Start', 'O1', 'O1B_END', 'Oend'], terminalLabel: 'Oend' },
      { labels: ['Start', 'O2', 'O2A_END', 'Oend'], terminalLabel: 'Oend' },
      { labels: ['Start', 'O2', 'O2B_END', 'Oend'], terminalLabel: 'Oend' },
    ]);
    expect(projection.tablePaths).toHaveLength(4);
    expect(projection.tablePaths.map((path) => path.rowIndexes)).toEqual([
      [0, 1, 2, 7],
      [0, 1, 3, 7],
      [0, 4, 5, 7],
      [0, 4, 6, 7],
    ]);
  });

  it('stops instead of enumerating an automatic cycle forever', () => {
    const cyclic = document();
    cyclic.nodes = cyclic.nodes.map((node) => {
      if (node.label === 'O1A_END') return { ...node, next: 'O1B_END' };
      if (node.label === 'O1B_END') return { ...node, next: 'O1A_END' };
      return node;
    });

    expect(() => buildStoryAuditProjection(cyclic)).toThrow(/cycle/i);
  });
});
