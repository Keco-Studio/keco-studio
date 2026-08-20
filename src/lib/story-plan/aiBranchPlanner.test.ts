import { materializeAiBranchStructure, type AiBranchStructure } from './aiBranchPlanner';
import { segmentStorySource } from './sourceSegments';

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
});
