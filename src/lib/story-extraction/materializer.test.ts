import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from '@/lib/story-plan/sourceSegments';
import { parseStoryExtraction, type StoryExtraction } from './schema';
import {
  materializeStoryExtraction,
  StoryExtractionValidationError,
} from './materializer';

const sourceText = [
  'Seven: We must pick a route.',
  '- Head to the energy bay. When this choice is selected run $resolve+=1',
  'The energy route begins here.',
  'You enter the energy bay.',
  'You reach the evacuation platform.',
].join('\n');

function extraction(): StoryExtraction {
  return {
    version: 3,
    entryNodeId: 'start',
    structuralUnitIds: ['fixture:2'],
    choices: [{
      id: 'go_energy',
      fromNodeId: 'start',
      text: 'Head to the energy bay.',
      targetNodeId: 'energy',
      sourceUnitIds: ['fixture:1'],
      commandSources: ['$resolve+=1'],
    }],
    nodes: [
      {
        id: 'start',
        type: 'dialogue',
        speaker: 'Seven',
        content: 'We must pick a route.',
        sourceUnitIds: ['fixture:0'],
        commandSources: [],
        nextNodeId: '',
      },
      {
        id: 'energy',
        type: 'narration',
        speaker: '',
        content: 'You enter the energy bay.',
        sourceUnitIds: ['fixture:3'],
        commandSources: [],
        nextNodeId: 'end',
      },
      {
        id: 'end',
        type: 'narration',
        speaker: '',
        content: 'You reach the evacuation platform.',
        sourceUnitIds: ['fixture:4'],
        commandSources: [],
        nextNodeId: '',
      },
    ],
  };
}

function materialize(value: StoryExtraction = extraction()) {
  return materializeStoryExtraction(
    value,
    segmentStorySource(sourceText, 'fixture')
  );
}

describe('full story extraction materializer', () => {
  it('materializes LLM-created nodes, choices, refs, and canonical commands', () => {
    const document = materialize();

    expect(document.entryLabel).toBe('start');
    expect(document.nodes[0]).toMatchObject({
      label: 'start',
      type: 'dialogue',
      speaker: 'Seven',
      content: 'We must pick a route.',
      sourceRefs: [{ sourceId: 'fixture', unitId: 'fixture:0' }],
      options: [{
        text: 'Head to the energy bay.',
        target: 'energy',
        commands: [{
          source: '$resolve+=1',
          variable: 'resolve',
          operator: '+=',
          value: 1,
        }],
      }],
    });
  });

  it('rejects an unknown source unit', () => {
    const value = extraction();
    value.nodes[0].sourceUnitIds = ['fixture:99'];
    expect(() => materialize(value)).toThrow(/unknown source unit/i);
  });


  it('normalizes redundant structural ownership when visible evidence uses the unit', () => {
    const value = extraction();
    value.structuralUnitIds.push('fixture:0');
    expect(materialize(value).nodes[0].content).toBe('We must pick a route.');
  });

  it('allows distinct branch outcomes to cite different text from the same source unit', () => {
    const text = [
      'Pick how to handle it.',
      '- Shut it down manually.',
      '- Shut it down remotely.',
      'Manual shutdown stabilizes the reactor; remote shutdown darkens every backup light.',
    ].join('\n');
    const source = segmentStorySource(text, 'shared');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      choices: [
        { id: 'manual_choice', fromNodeId: 'start', text: 'Shut it down manually.', targetNodeId: 'manual', sourceUnitIds: ['shared:1'], commandSources: [] },
        { id: 'remote_choice', fromNodeId: 'start', text: 'Shut it down remotely.', targetNodeId: 'remote', sourceUnitIds: ['shared:2'], commandSources: [] },
      ],
      nodes: [
        {
          id: 'start', type: 'narration', speaker: '', content: 'Pick how to handle it.',
          sourceUnitIds: ['shared:0'], commandSources: [], nextNodeId: '',
        },
        {
          id: 'manual', type: 'narration', speaker: '', content: 'Manual shutdown stabilizes the reactor',
          sourceUnitIds: ['shared:3'], commandSources: [], nextNodeId: '',
        },
        {
          id: 'remote', type: 'narration', speaker: '', content: 'remote shutdown darkens every backup light',
          sourceUnitIds: ['shared:3'], commandSources: [], nextNodeId: '',
        },
      ],
    };

    expect(materializeStoryExtraction(value, source).nodes).toHaveLength(3);
  });

  it('rejects an omitted source unit', () => {
    const value = extraction();
    value.structuralUnitIds = [];
    expect(() => materialize(value)).toThrow(/not assigned/i);
  });

  it('rejects an orphan component even when it already targets a reachable node', () => {
    const source = segmentStorySource([
      'The story starts.',
      'The main path continues.',
      'A displaced scene returns to the main path.',
    ].join('\n'), 'orphan-insert');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      choices: [],
      nodes: [
        {
          id: 'start', type: 'narration', speaker: '', content: 'The story starts.',
          sourceUnitIds: ['orphan-insert:0'], commandSources: [], nextNodeId: 'main',
        },
        {
          id: 'main', type: 'narration', speaker: '', content: 'The main path continues.',
          sourceUnitIds: ['orphan-insert:1'], commandSources: [], nextNodeId: '',
        },
        {
          id: 'orphan', type: 'narration', speaker: '', content: 'A displaced scene returns to the main path.',
          sourceUnitIds: ['orphan-insert:2'], commandSources: [], nextNodeId: 'main',
        },
      ],
    };

    expect(() => materializeStoryExtraction(value, source)).toThrow(/unreachable.*orphan/i);
  });

  it('classifies an omitted pure merge marker as structural evidence', () => {
    const text = 'You reach the platform.\nFinal merge:';
    const source = segmentStorySource(text, 'merge');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'end',
      structuralUnitIds: [],
      nodes: [{
        id: 'end', type: 'narration', speaker: '', content: 'You reach the platform.',
        sourceUnitIds: ['merge:0'], commandSources: [], nextNodeId: '',
      }],
      choices: [],
    };

    expect(materializeStoryExtraction(value, source).nodes).toHaveLength(1);
  });

  it('removes a visible path-merge control node and reconnects incoming branches', () => {
    const text = 'Pick a route.\n- Left path\n- Right path\nThe left path ends.\nThe right path ends.\nThe two paths finally merge in the hall.\nA shared ending.';
    const source = segmentStorySource(text, 'path-merge');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Pick a route.', sourceUnitIds: ['path-merge:0'], commandSources: [], nextNodeId: '' },
        { id: 'left', type: 'narration', speaker: '', content: 'The left path ends.', sourceUnitIds: ['path-merge:3'], commandSources: [], nextNodeId: 'merge' },
        { id: 'right', type: 'narration', speaker: '', content: 'The right path ends.', sourceUnitIds: ['path-merge:4'], commandSources: [], nextNodeId: 'merge' },
        { id: 'merge', type: 'narration', speaker: '', content: 'The two paths finally merge in the hall.', sourceUnitIds: ['path-merge:5'], commandSources: [], nextNodeId: 'end' },
        { id: 'end', type: 'narration', speaker: '', content: 'A shared ending.', sourceUnitIds: ['path-merge:6'], commandSources: [], nextNodeId: '' },
      ],
      choices: [
        { id: 'go_left', fromNodeId: 'start', text: 'Left path', targetNodeId: 'left', sourceUnitIds: ['path-merge:1'], commandSources: [] },
        { id: 'go_right', fromNodeId: 'start', text: 'Right path', targetNodeId: 'right', sourceUnitIds: ['path-merge:2'], commandSources: [] },
      ],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => node.label)).toEqual(['start', 'left', 'right', 'end']);
    expect(document.nodes.find((node) => node.label === 'left')?.next).toBe('end');
    expect(document.nodes.find((node) => node.label === 'right')?.next).toBe('end');
  });

  it('classifies omitted natural branch headings as structural evidence', () => {
    const text = 'If you check the deck:\nYou find wet footprints on the deck.';
    const source = segmentStorySource(text, 'branch-heading');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'deck',
      structuralUnitIds: [],
      nodes: [{
        id: 'deck', type: 'narration', speaker: '', content: 'You find wet footprints on the deck.',
        sourceUnitIds: ['branch-heading:1'], commandSources: [], nextNodeId: '',
      }],
      choices: [],
    };

    expect(materializeStoryExtraction(value, source).nodes).toHaveLength(1);
  });

  it('removes structural choice prompts and moves their choices to the preceding node', () => {
    const text = 'Pick a route.\nThere are 2 choices here:\n- The left side.\nThe left ending.';
    const source = segmentStorySource(text, 'prompt');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Pick a route.', sourceUnitIds: ['prompt:0'], commandSources: [], nextNodeId: 'marker' },
        { id: 'marker', type: 'narration', speaker: '', content: 'There are 2 choices here:', sourceUnitIds: ['prompt:1'], commandSources: [], nextNodeId: '' },
        { id: 'left', type: 'narration', speaker: '', content: 'The left ending.', sourceUnitIds: ['prompt:3'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'go_left', fromNodeId: 'marker', text: 'The left side.', targetNodeId: 'left', sourceUnitIds: ['prompt:2'], commandSources: [] }],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => node.label)).toEqual(['start', 'left']);
    expect(document.nodes[0]).toMatchObject({
      options: [{ text: 'The left side.', target: 'left' }],
    });
  });

  it('removes branch-command metadata nodes and redirects their incoming choice', () => {
    const text = 'Pick a route.\nIf you choose left, when this choice is selected run $trust+=1\nYou take the left path.';
    const source = segmentStorySource(text, 'metadata');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Pick a route.', sourceUnitIds: ['metadata:0'], commandSources: [], nextNodeId: '' },
        { id: 'metadata', type: 'narration', speaker: '', content: 'If you choose left, when this choice is selected run $trust+=1', sourceUnitIds: ['metadata:1'], commandSources: [], nextNodeId: 'left' },
        { id: 'left', type: 'narration', speaker: '', content: 'You take the left path.', sourceUnitIds: ['metadata:2'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'go_left', fromNodeId: 'start', text: 'left', targetNodeId: 'metadata', sourceUnitIds: ['metadata:1'], commandSources: ['metadata:1'] }],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => node.label)).toEqual(['start', 'left']);
    expect(document.nodes[0].options[0].target).toBe('left');
  });

  it('rejects invented or paraphrased visible content', () => {
    const value = extraction();
    value.nodes[1].content = 'You repaired the entire station.';
    expect(() => materialize(value)).toThrow(/not traceable/i);
  });

  it('rejects collapsing multiple dialogue speakers onto one presentation Type', () => {
    const text = 'Keeper: Who are you?\nBoy: A passerby from the sea.';
    const source = segmentStorySource(text, 'dialogue-types');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'keeper',
      structuralUnitIds: [],
      nodes: [
        {
          id: 'keeper', type: 'dialogue', presentationType: 1, speaker: 'Keeper',
          content: 'Who are you?', sourceUnitIds: ['dialogue-types:0'], commandSources: [], nextNodeId: 'youth',
        },
        {
          id: 'youth', type: 'dialogue', presentationType: 1, speaker: 'Boy',
          content: 'A passerby from the sea.', sourceUnitIds: ['dialogue-types:1'], commandSources: [], nextNodeId: '',
        },
      ],
      choices: [],
    };

    expect(() => materializeStoryExtraction(value, source)).toThrow(/presentation Type/i);
  });

  it('rejects changing presentation Type for the same speaker', () => {
    const text = 'Boy: The first line.\nBoy: The second line.';
    const source = segmentStorySource(text, 'speaker-type');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'first',
      structuralUnitIds: [],
      nodes: [
        {
          id: 'first', type: 'dialogue', presentationType: 1, speaker: 'Boy',
          content: 'The first line.', sourceUnitIds: ['speaker-type:0'], commandSources: [], nextNodeId: 'second',
        },
        {
          id: 'second', type: 'dialogue', presentationType: 2, speaker: 'Boy',
          content: 'The second line.', sourceUnitIds: ['speaker-type:1'], commandSources: [], nextNodeId: '',
        },
      ],
      choices: [],
    };

    expect(() => materializeStoryExtraction(value, source)).toThrow(/presentation Type/i);
  });

  it('normalizes a character-list role name to the exact dialogue cue alias', () => {
    const text = 'Characters: You (Keeper), Sea Boy\nBoy (standing at the pier edge): The lighthouse is still lit.\nBoy fades slowly: I should go.';
    const source = segmentStorySource(text, 'speaker-alias');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'boy',
      structuralUnitIds: ['speaker-alias:0'],
      nodes: [
        {
          id: 'boy', type: 'dialogue', presentationType: 2, speaker: 'Sea Boy',
          content: 'The lighthouse is still lit.', sourceUnitIds: ['speaker-alias:1'], commandSources: [], nextNodeId: 'fade',
        },
        {
          id: 'fade', type: 'dialogue', presentationType: 2, speaker: 'Sea Boy',
          content: 'I should go.', sourceUnitIds: ['speaker-alias:2'], commandSources: [], nextNodeId: '',
        },
      ],
      choices: [],
    };

    expect(materializeStoryExtraction(value, source).nodes.map((node) => node.speaker))
      .toEqual(['Boy', 'Boy']);
  });

  it('does not accept an incidental one-character prefix as a speaker alias', () => {
    const text = 'Characters: Sea Boy\nSudden wind sweeps the reef: The lighthouse still shines.';
    const source = segmentStorySource(text, 'false-alias');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'wind',
      structuralUnitIds: ['false-alias:0'],
      nodes: [{
        id: 'wind', type: 'dialogue', presentationType: 1, speaker: 'Sea Boy',
        content: 'The lighthouse still shines.', sourceUnitIds: ['false-alias:1'], commandSources: [], nextNodeId: '',
      }],
      choices: [],
    };

    expect(() => materializeStoryExtraction(value, source)).toThrow(/speaker.*not traceable/i);
  });

  it('normalizes dialogue presentation Types to explicit character-list order', () => {
    const text = 'Characters: You (Keeper), Sea Boy\nBoy: The lighthouse is still lit.\nYou: I know.';
    const source = segmentStorySource(text, 'role-order');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'boy',
      structuralUnitIds: ['role-order:0'],
      nodes: [
        {
          id: 'boy', type: 'dialogue', presentationType: 1, speaker: 'Boy',
          content: 'The lighthouse is still lit.', sourceUnitIds: ['role-order:1'], commandSources: [], nextNodeId: 'you',
        },
        {
          id: 'you', type: 'dialogue', presentationType: 2, speaker: 'You',
          content: 'I know.', sourceUnitIds: ['role-order:2'], commandSources: [], nextNodeId: '',
        },
      ],
      choices: [],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => [node.speaker, node.presentationType]))
      .toEqual([['Boy', 2], ['You', 1]]);
  });

  it('keeps the protagonist on Type 1 without an explicit character list', () => {
    const text = 'Empress：Discuss military affairs first。\nYou：As ordered。';
    const source = segmentStorySource(text, 'protagonist-side');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'empress',
      structuralUnitIds: [],
      nodes: [
        {
          id: 'empress', type: 'dialogue', presentationType: 1, speaker: 'Empress',
          content: 'Discuss military affairs first。', sourceUnitIds: ['protagonist-side:0'], commandSources: [], nextNodeId: 'you',
        },
        {
          id: 'you', type: 'dialogue', presentationType: 2, speaker: 'You',
          content: 'As ordered。', sourceUnitIds: ['protagonist-side:1'], commandSources: [], nextNodeId: '',
        },
      ],
      choices: [],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => [node.speaker, node.presentationType]))
      .toEqual([['Empress', 2], ['You', 1]]);
  });

  it('recognizes first-person I as the protagonist and keeps it on Type 1', () => {
    const text = 'Empress：Discuss military affairs first。\nI：As ordered。';
    const source = segmentStorySource(text, 'first-person-protagonist-side');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'empress',
      structuralUnitIds: [],
      nodes: [
        {
          id: 'empress', type: 'dialogue', presentationType: 1, speaker: 'Empress',
          content: 'Discuss military affairs first。', sourceUnitIds: ['first-person-protagonist-side:0'], commandSources: [], nextNodeId: 'me',
        },
        {
          id: 'me', type: 'dialogue', presentationType: 2, speaker: 'I',
          content: 'As ordered。', sourceUnitIds: ['first-person-protagonist-side:1'], commandSources: [], nextNodeId: '',
        },
      ],
      choices: [],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => [node.speaker, node.presentationType]))
      .toEqual([['Empress', 2], ['I', 1]]);
  });

  it('keeps the existing speaker types when no protagonist marker exists', () => {
    const text = 'Empress：Discuss military affairs first。\nGeneral：I accept the order。';
    const source = segmentStorySource(text, 'existing-speaker-sides');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'empress',
      structuralUnitIds: [],
      nodes: [
        {
          id: 'empress', type: 'dialogue', presentationType: 2, speaker: 'Empress',
          content: 'Discuss military affairs first。', sourceUnitIds: ['existing-speaker-sides:0'], commandSources: [], nextNodeId: 'general',
        },
        {
          id: 'general', type: 'dialogue', presentationType: 1, speaker: 'General',
          content: 'I accept the order。', sourceUnitIds: ['existing-speaker-sides:1'], commandSources: [], nextNodeId: '',
        },
      ],
      choices: [],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => [node.speaker, node.presentationType]))
      .toEqual([['Empress', 2], ['General', 1]]);
  });


  it('rejects a changed source command', () => {
    const value = extraction();
    value.choices[0].commandSources = ['$resolve+=9'];
    expect(() => materialize(value)).toThrow(/command.*not found/i);
  });

  it('canonicalizes a command source unit id when it contains one exact command', () => {
    const value = extraction();
    value.choices[0].commandSources = ['fixture:1'];

    expect(materialize(value).nodes[0].options[0].commands[0].source).toBe('$resolve+=1');
  });

  it('extracts one exact command from a model-added source suffix', () => {
    const value = extraction();
    value.choices[0].commandSources = ['$resolve+=1|fixture:1'];

    expect(materialize(value).nodes[0].options[0].commands[0].source).toBe('$resolve+=1');
  });

  it('repairs a wrong option ref only when text and command units are deterministic', () => {
    const text = [
      'Pick a route.',
      'You can visit the energy bay first, or the archive bay first.',
      'If you choose to head to the energy bay, when this choice is selected run $resolve+=1',
      'You enter the energy bay.',
    ].join('\n');
    const source = segmentStorySource(text, 'split-evidence');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: ['split-evidence:2'],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Pick a route.', sourceUnitIds: ['split-evidence:0'], commandSources: [], nextNodeId: '' },
        { id: 'energy', type: 'narration', speaker: '', content: 'You enter the energy bay.', sourceUnitIds: ['split-evidence:3'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{
        id: 'go_energy',
        fromNodeId: 'start',
        text: 'You can visit the energy bay first',
        targetNodeId: 'energy',
        sourceUnitIds: ['split-evidence:2'],
        commandSources: ['$resolve+=1|split-evidence:2'],
      }],
    };

    const option = materializeStoryExtraction(value, source).nodes[0].options[0];
    expect(option.sourceRefs.map((ref) => ref.unitId)).toEqual([
      'split-evidence:1',
      'split-evidence:2',
    ]);
    expect(option.commands[0].sourceRefs[0].unitId).toBe('split-evidence:2');
  });

  it('removes choice-control and command metadata from visible option text', () => {
    const value = extraction();
    value.choices[0].text = 'If you choose to Head to the energy bay, when this choice is selected run $resolve+=1';
    value.choices[0].commandSources = ['$resolve+=1|fixture:1'];

    expect(materialize(value).nodes[0].options[0].text).toBe('Head to the energy bay');
  });

  it('adds the exact command unit to a choice source when the text and command are split', () => {
    const text = 'Choose the energy bay.\nRun $resolve+=1\nEnergy bay ending.';
    const source = segmentStorySource(text, 'split');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Choose the energy bay.', sourceUnitIds: ['split:0'], commandSources: [], nextNodeId: '' },
        { id: 'end', type: 'narration', speaker: '', content: 'Energy bay ending.', sourceUnitIds: ['split:2'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'go', fromNodeId: 'start', text: 'the energy bay', targetNodeId: 'end', sourceUnitIds: ['split:0'], commandSources: ['$resolve+=1'] }],
    };

    expect(materializeStoryExtraction(value, source).nodes[0].options[0].commands[0].value).toBe(1);
  });

  it('distinguishes identical command text by the owner source unit', () => {
    const text = [
      'Pick a route.',
      'The left road. $trust+=1',
      'The right road. $trust+=1',
      'You reach the left end.',
      'You reach the right end.',
    ].join('\n');
    const source = segmentStorySource(text, 'same-command');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Pick a route.', sourceUnitIds: ['same-command:0'], commandSources: [], nextNodeId: '' },
        { id: 'left', type: 'narration', speaker: '', content: 'You reach the left end.', sourceUnitIds: ['same-command:3'], commandSources: [], nextNodeId: '' },
        { id: 'right', type: 'narration', speaker: '', content: 'You reach the right end.', sourceUnitIds: ['same-command:4'], commandSources: [], nextNodeId: '' },
      ],
      choices: [
        { id: 'go_left', fromNodeId: 'start', text: 'The left road.', targetNodeId: 'left', sourceUnitIds: ['same-command:1'], commandSources: ['$trust+=1'] },
        { id: 'go_right', fromNodeId: 'start', text: 'The right road.', targetNodeId: 'right', sourceUnitIds: ['same-command:2'], commandSources: ['$trust+=1'] },
      ],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes[0].options.map((option) => option.commands[0].sourceRefs[0].unitId))
      .toEqual(['same-command:1', 'same-command:2']);
  });

  it('infers an empty source unit list only from unique exact visible evidence', () => {
    const value = extraction();
    value.nodes[1].sourceUnitIds = [];
    const parsed = parseStoryExtraction(value);

    expect(materialize(parsed).nodes[1].sourceRefs[0].unitId).toBe('fixture:3');
  });

  it('converts one synthetic Continue choice into an automatic transition', () => {
    const text = 'The first line.\nThe second line.';
    const source = segmentStorySource(text, 'continue');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'first',
      structuralUnitIds: [],
      nodes: [
        { id: 'first', type: 'narration', speaker: '', content: 'The first line.', sourceUnitIds: ['continue:0'], commandSources: [], nextNodeId: '' },
        { id: 'second', type: 'narration', speaker: '', content: 'The second line.', sourceUnitIds: ['continue:1'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'continue', fromNodeId: 'first', text: 'Continue', targetNodeId: 'second', sourceUnitIds: ['continue:0'], commandSources: [] }],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes[0].next).toBe('second');
    expect(document.nodes[0].options).toEqual([]);
  });

  it('rejects a source command owned more than once', () => {
    const value = extraction();
    value.nodes[0].commandSources = ['$resolve+=1'];
    expect(() => materialize(value)).toThrow(/command.*more than once/i);
  });

  it('removes a duplicated choice-trigger command from that choice target node', () => {
    const value = extraction();
    value.nodes[1].commandSources = ['fixture:1'];

    const document = materialize(value);
    expect(document.nodes[0].options[0].commands[0].source).toBe('$resolve+=1');
    expect(document.nodes[1].commands).toEqual([]);
    expect(document.nodes[1].sourceRefs.map((ref) => ref.unitId)).toEqual(['fixture:3']);
  });

  it('removes a direct option placeholder node duplicated from its choice row', () => {
    const text = [
      'Pick a route.',
      '- Head to the energy bay. When this choice is selected run $resolve+=1',
      'You enter the energy bay.',
    ].join('\n');
    const source = segmentStorySource(text, 'option-node');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Pick a route.', sourceUnitIds: ['option-node:0'], commandSources: [], nextNodeId: '' },
        { id: 'option_placeholder', type: 'narration', speaker: '', content: 'Head to the energy bay.', sourceUnitIds: ['option-node:1'], commandSources: ['$resolve+=1'], nextNodeId: 'energy' },
        { id: 'energy', type: 'narration', speaker: '', content: 'You enter the energy bay.', sourceUnitIds: ['option-node:2'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{
        id: 'go_energy', fromNodeId: 'start', text: 'Head to the energy bay.', targetNodeId: 'option_placeholder',
        sourceUnitIds: ['option-node:1'], commandSources: ['$resolve+=1'],
      }],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => node.label)).toEqual(['start', 'energy']);
    expect(document.nodes[0].options[0]).toMatchObject({
      text: 'Head to the energy bay.',
      target: 'energy',
      commands: [expect.objectContaining({ source: '$resolve+=1' })],
    });
  });

  it('rejects unresolved and unreachable graph nodes', () => {
    const unresolved = extraction();
    unresolved.choices[0].targetNodeId = 'missing';
    expect(() => materialize(unresolved)).toThrow(/target.*does not exist/i);

    const unreachable = extraction();
    unreachable.choices = [];
    unreachable.nodes[0].nextNodeId = 'end';
    try {
      materialize(unreachable);
      throw new Error('Expected unreachable graph validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(StoryExtractionValidationError);
      expect((error as StoryExtractionValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'unreachable_node',
          nodeIds: ['energy'],
          unitIds: ['fixture:3'],
        })
      );
    }
  });

  it('rejects choice fallthrough and automatic cycles', () => {
    const fallthrough = extraction();
    fallthrough.nodes[0].nextNodeId = 'energy';
    expect(() => materialize(fallthrough)).toThrow(/choices.*automatic/i);

    const cycle = extraction();
    cycle.nodes[1].nextNodeId = 'energy';
    expect(() => materialize(cycle)).toThrow(/automatic cycle/i);
  });

  it('rejects an automatic path from one sibling choice into another sibling target', () => {
    const text = [
      'Pick a route.',
      'Take the left route.',
      'Take the right route.',
      'The left route begins.',
      'The right route begins.',
    ].join('\n');
    const source = segmentStorySource(text, 'sibling-leak');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      choices: [
        { id: 'left_choice', fromNodeId: 'start', text: 'Take the left route.', targetNodeId: 'left', sourceUnitIds: ['sibling-leak:1'], commandSources: [] },
        { id: 'right_choice', fromNodeId: 'start', text: 'Take the right route.', targetNodeId: 'right', sourceUnitIds: ['sibling-leak:2'], commandSources: [] },
      ],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: 'Pick a route.', sourceUnitIds: ['sibling-leak:0'], commandSources: [], nextNodeId: '' },
        { id: 'left', type: 'narration', speaker: '', content: 'The left route begins.', sourceUnitIds: ['sibling-leak:3'], commandSources: [], nextNodeId: 'right' },
        { id: 'right', type: 'narration', speaker: '', content: 'The right route begins.', sourceUnitIds: ['sibling-leak:4'], commandSources: [], nextNodeId: '' },
      ],
    };

    expect(() => materializeStoryExtraction(value, source)).toThrow(/sibling.*target/i);
  });
});
