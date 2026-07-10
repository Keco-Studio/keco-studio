import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { tryParseExplicitStory } from './explicitParser';
import { hydrateStoryDocument } from './hydrator';
import { buildStoryAuditProjection } from './projection';
import { segmentStorySource } from './sourceSegments';

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
    expect(projection.table.columns).toEqual(expect.arrayContaining([
      'Option0',
      'Option0_Next',
      'Option0_Commands',
    ]));
  });

  it('enumerates all four terminal paths without sibling leakage', () => {
    const projection = buildStoryAuditProjection(document());

    expect(projection.paths).toEqual([
      { labels: ['Start', 'O1', 'O1A_END', 'Oend'], terminalLabel: 'Oend' },
      { labels: ['Start', 'O1', 'O1B_END', 'Oend'], terminalLabel: 'Oend' },
      { labels: ['Start', 'O2', 'O2A_END', 'Oend'], terminalLabel: 'Oend' },
      { labels: ['Start', 'O2', 'O2B_END', 'Oend'], terminalLabel: 'Oend' },
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
