import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { buildStoryExtractionFromPlan } from '@/lib/story-extraction/fromPlan';
import { materializeStoryExtraction } from '@/lib/story-extraction/materializer';
import { buildStoryAuditView } from './auditView';
import { tryParseExplicitStory } from './explicitParser';
import { buildStoryAuditProjection } from './projection';
import { segmentStorySource } from './sourceSegments';

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);

function auditedCandidate() {
  const source = segmentStorySource(fixture, 'fixture');
  const extraction = buildStoryExtractionFromPlan(tryParseExplicitStory(source)!, source);
  const document = materializeStoryExtraction(extraction, source);
  const projection = buildStoryAuditProjection(document);
  return { source, extraction, document, projection };
}

describe('canonical story audit view', () => {
  it('projects every final logical row exactly once with semantic presentation and evidence', () => {
    const candidate = auditedCandidate();
    const view = buildStoryAuditView(
      candidate.document,
      candidate.extraction,
      candidate.projection
    );

    expect(view.version).toBe(1);
    expect(view.entryRowId).toBe('Start');
    expect(view.rows).toHaveLength(candidate.document.nodes.length);
    expect(view.rows[0]).toEqual({
      id: 'Start',
      presentation: 'dialogue_primary',
      speaker: '光球',
      content: '你醒了。选一条路。',
      sourceUnitIds: ['fixture:0'],
      commands: [],
      nextRowId: '',
      choices: [
        {
          text: '走左边。',
          targetRowId: 'O1',
          sourceUnitIds: ['fixture:1'],
          commands: ['$trust+=1'],
        },
        {
          text: '走右边。',
          targetRowId: 'O2',
          sourceUnitIds: ['fixture:2'],
          commands: ['$trust+=2'],
        },
      ],
    });
    expect(new Set(view.rows.map((row) => row.id)).size).toBe(view.rows.length);
    expect(view.structuralUnitIds).toEqual(candidate.extraction.structuralUnitIds);
  });

  it('summarizes paths by row IDs and selected choices without duplicating row content', () => {
    const candidate = auditedCandidate();
    const view = buildStoryAuditView(
      candidate.document,
      candidate.extraction,
      candidate.projection
    );

    expect(view.paths).toEqual([
      {
        rowIds: ['Start', 'O1', 'O1A_END', 'Oend'],
        choiceTexts: ['走左边。', '回答“我不知道”。'],
        terminalRowId: 'Oend',
        commands: ['$trust+=1', '$trust+=1'],
      },
      {
        rowIds: ['Start', 'O1', 'O1B_END', 'Oend'],
        choiceTexts: ['走左边。', '不回答直接走。'],
        terminalRowId: 'Oend',
        commands: ['$trust+=1', '$trust-=1'],
      },
      {
        rowIds: ['Start', 'O2', 'O2A_END', 'Oend'],
        choiceTexts: ['走右边。', '报真名。'],
        terminalRowId: 'Oend',
        commands: ['$trust+=2', '$trust+=2'],
      },
      {
        rowIds: ['Start', 'O2', 'O2B_END', 'Oend'],
        choiceTexts: ['走右边。', '报假名。'],
        terminalRowId: 'Oend',
        commands: ['$trust+=2', '$trust-=2'],
      },
    ]);
    expect(JSON.stringify(view.paths)).not.toContain('你醒了。选一条路。');
    expect(view).not.toHaveProperty('table');
    expect(view).not.toHaveProperty('tablePaths');
  });
});
