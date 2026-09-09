import { materializeAiBranchStructure, type AiBranchStructure } from './aiBranchPlanner';
import { segmentStorySource } from './sourceSegments';
import { buildStoryExtractionFromPlan } from '@/lib/story-extraction/fromPlan';
import { materializeStoryExtraction } from '@/lib/story-extraction/materializer';

describe('AI branch planner materialization', () => {
  it('anchors repeated choice labels to the supplied source unit', () => {
    const source = segmentStorySource([
      'Choose a route.',
      'Branch 1: Choose [Continue]',
      'The east door opens.',
      'Branch 2: Choose [Continue]',
      'The west door opens.',
    ].join('\n'), 'repeated-choice');
    const unitId = (index: number) => source.units[index].id;
    const structure: AiBranchStructure = {
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: unitId(0),
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: unitId(1),
            text: 'Choose Continue',
            routeUnitIds: [unitId(2)],
            nextUnitId: null,
          },
          {
            sourceUnitId: unitId(3),
            text: 'Choose Continue',
            routeUnitIds: [unitId(4)],
            nextUnitId: null,
          },
        ],
      }],
      choices: [],
      jumps: [],
      breakAfterUnitIds: [unitId(2), unitId(4)],
    };

    const result = materializeAiBranchStructure(source, structure);

    expect(result.plan.choices).toHaveLength(2);
    expect(result.source.segments.filter((segment) => segment.kind === 'choice_text'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ unitId: unitId(1), text: 'Continue' }),
        expect.objectContaining({ unitId: unitId(3), text: 'Continue' }),
      ]));
  });

  it('creates a source-backed menu owner when a script starts with options', () => {
    const source = segmentStorySource([
      'O1: Show the letter (Jump O1)',
      'O2: Leave (Jump O2)',
      'O1 branch [O1 | Gate Opens]',
      'Guide: The gate opens.',
      'O2 branch [O2 | Delayed Entry]',
      'Guide: Return when you have proof.',
    ].join('\n'), 'option-first');
    const unitId = (index: number) => source.units[index].id;
    const structure: AiBranchStructure = {
      version: 2,
      structuralUnitIds: [unitId(2), unitId(4)],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: unitId(0),
        mergeUnitId: null,
        options: [
          { sourceUnitId: unitId(0), text: 'Show the letter', routeUnitIds: [unitId(3)], nextUnitId: null },
          { sourceUnitId: unitId(1), text: 'Leave', routeUnitIds: [unitId(5)], nextUnitId: null },
        ],
      }],
      choices: [],
      jumps: [],
      breakAfterUnitIds: [unitId(3), unitId(5)],
    };

    const result = materializeAiBranchStructure(source, structure);

    expect(result.plan.nodes[0]).toEqual(expect.objectContaining({
      type: 'system',
      contentSegmentIds: [],
    }));
    expect(result.plan.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: result.plan.entryNodeId, targetNodeId: expect.any(String) }),
      expect.objectContaining({ fromNodeId: result.plan.entryNodeId, targetNodeId: expect.any(String) }),
    ]));
    expect(() => materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source,
      {},
      { enforceVisibleTextContract: true },
    )).not.toThrow();
  });
});
