import { describe, expect, it } from '@jest/globals';
import type { StoryDocument } from '@/lib/story-ir/schema';
import { buildStoryPlotGroupingMessages } from './prompts';

const document: StoryDocument = {
  version: 1,
  entryLabel: 'Start',
  nodes: [
    {
      label: 'Start',
      type: 'dialogue',
      speaker: 'Hero',
      content: 'Choose a route.',
      options: [
        { text: 'Left route', target: 'Left', commands: [], sourceRefs: [{ sourceId: 'test', unitId: 'test:0', start: 0, end: 1 }] },
        { text: 'Right route', target: 'Right', commands: [], sourceRefs: [{ sourceId: 'test', unitId: 'test:0', start: 0, end: 1 }] },
      ],
      commands: [],
      sourceRefs: [{ sourceId: 'test', unitId: 'test:0', start: 0, end: 1 }],
    },
    {
      label: 'Left', type: 'narration', content: 'Left outcome.', options: [], commands: [],
      sourceRefs: [{ sourceId: 'test', unitId: 'test:1', start: 1, end: 2 }],
    },
    {
      label: 'Right', type: 'narration', content: 'Right outcome.', options: [], commands: [],
      sourceRefs: [{ sourceId: 'test', unitId: 'test:2', start: 2, end: 3 }],
    },
  ],
};

describe('story plot grouping prompt', () => {
  it('includes server-owned decision constraints for every option target', () => {
    const messages = buildStoryPlotGroupingMessages(document);
    const userPayload = JSON.parse(String(messages[1].content));

    expect(userPayload.decisionPoints).toEqual([{
      ownerNodeId: 'Start',
      options: [
        { text: 'Left route', targetNodeId: 'Left' },
        { text: 'Right route', targetNodeId: 'Right' },
      ],
    }]);
    expect(messages[0].content).toMatch(/outcome/i);
    expect(messages[0].content).toMatch(/must not.*option text/i);
  });
});
