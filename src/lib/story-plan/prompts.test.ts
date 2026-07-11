import { describe, expect, it } from '@jest/globals';
import {
  AUDITOR_PLAN_PROMPT,
  AUDITOR_PLAN_TOOL,
  CONVERTER_PLAN_PROMPT,
  CONVERTER_PLAN_TOOL,
  buildConverterPlanMessages,
} from './prompts';
import { segmentStorySource } from './sourceSegments';

describe('flat story plan prompts', () => {
  it('uses a flat converter output contract without old Story IR fields', () => {
    const schema = JSON.stringify(CONVERTER_PLAN_TOOL.function.parameters);

    expect(CONVERTER_PLAN_TOOL.function.name).toBe('submit_story_relationship_plan');
    expect(schema).toContain('entryNodeId');
    expect(schema).toContain('breakAfterNodeIds');
    expect(schema).toContain('nextOverrides');
    expect(schema).toContain('choiceEdges');
    expect(schema).toContain('nodeId');
    expect(schema).toContain('choiceId');
    expect(schema).toContain('fromNodeId');
    expect(schema).toContain('targetNodeId');
    expect(schema).not.toContain('nodeEdges');
    expect(schema).not.toContain('$defs');
    expect(schema).not.toContain('speakerSegmentId');
    expect(schema).not.toContain('contentSegmentIds');
    expect(schema).not.toContain('textSegmentIds');
    expect(schema).not.toContain('commandIds');
    expect(schema).not.toContain('sourceRefs');
    expect(schema).not.toContain('structuralRepair');
    expect(schema).not.toContain('"start"');
    expect(schema).not.toContain('"end"');
    expect(schema).not.toContain('"content"');
    expect(schema).not.toContain('"value"');
  });

  it('uses a flat auditor result contract', () => {
    const schema = JSON.stringify(AUDITOR_PLAN_TOOL.function.parameters);

    expect(AUDITOR_PLAN_TOOL.function.name).toBe('submit_story_plan_audit');
    expect(schema).toContain('verdict');
    expect(schema).toContain('unitIds');
    expect(schema).toContain('nodeIds');
    expect(schema).not.toContain('$defs');
    expect(schema).not.toContain('sourceRefs');
    expect(schema).not.toContain('structuralRepair');
    expect(schema).not.toContain('"start"');
    expect(schema).not.toContain('"end"');
  });

  it('treats all model inputs as untrusted and requires every candidate audit', () => {
    expect(CONVERTER_PLAN_PROMPT).toContain('untrusted');
    expect(CONVERTER_PLAN_PROMPT).toContain('Never author story text');
    expect(AUDITOR_PLAN_PROMPT).toContain('untrusted');
    expect(AUDITOR_PLAN_PROMPT).toContain('Every candidate');
    expect(AUDITOR_PLAN_PROMPT).toContain('Do not repair');
  });

  it('defines exact node, choice, target, and natural branch relationship rules', () => {
    expect(CONVERTER_PLAN_PROMPT).toContain('exactly one choice for each choice_text segment');
    expect(CONVERTER_PLAN_PROMPT).toContain('Never create a choice from dialogue');
    expect(CONVERTER_PLAN_PROMPT).toContain('exactly one node for each source unit');
    expect(CONVERTER_PLAN_PROMPT).toContain('existing non-empty node ID');
    expect(CONVERTER_PLAN_PROMPT).toContain('next sibling branch marker');
    expect(CONVERTER_PLAN_PROMPT).toContain('must not fall through');
  });

  it('requires truly empty reference arrays instead of empty-string items', () => {
    expect(CONVERTER_PLAN_PROMPT).toContain('An empty array has zero items');
    expect(CONVERTER_PLAN_PROMPT).toContain('never [""]');
  });

  it('provides immutable node and choice inventories so the model only plans edges', () => {
    const source = segmentStorySource([
      'Guide: Choose a path.',
      '分支一：选择【Left】（safe）',
      'Left ending.',
      '分支二：选择【Right】（risk）',
      'Right ending.',
    ].join('\n'), 'fixture');
    const messages = buildConverterPlanMessages(source, 1, []);
    const input = JSON.parse(messages[1].content as string);

    expect(input.nodeInventory).toEqual([
      expect.objectContaining({
        id: 'Node1',
        unitId: 'fixture:0',
        type: 'dialogue',
        commandIds: [],
      }),
      expect.objectContaining({ id: 'Node2', unitId: 'fixture:2', type: 'narration' }),
      expect.objectContaining({ id: 'Node3', unitId: 'fixture:4', type: 'narration' }),
    ]);
    expect(input.choiceInventory).toEqual([
      expect.objectContaining({
        id: 'Choice1',
        unitId: 'fixture:1',
        commandIds: [],
      }),
      expect.objectContaining({ id: 'Choice2', unitId: 'fixture:3' }),
    ]);
    expect(input.structuralSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ unitId: 'fixture:1', kind: 'branch_marker' }),
      expect.objectContaining({ unitId: 'fixture:3', kind: 'branch_marker' }),
    ]));
    expect(input).not.toHaveProperty('sourceSegments');
    expect(CONVERTER_PLAN_PROMPT).toContain('Copy every immutable inventory field exactly');
    expect(CONVERTER_PLAN_PROMPT).toContain('Only decide entryNodeId, breakAfterNodeIds, nextOverrides, fromNodeId, and targetNodeId');
    expect(CONVERTER_PLAN_PROMPT).toContain('default physical source order');
    expect(CONVERTER_PLAN_PROMPT).toContain('breakAfterNodeIds');
    expect(CONVERTER_PLAN_PROMPT).toContain('nextOverrides');
  });

  it('prevents observed auditor false positives on commands, paths, and structural output', () => {
    expect(AUDITOR_PLAN_PROMPT).toContain('Never report command_mutation when both source commands and projected commands are empty');
    expect(AUDITOR_PLAN_PROMPT).toContain('explicit next/choice targets and enumerated projection paths');
    expect(AUDITOR_PLAN_PROMPT).toContain('Physical row order alone is not branch leakage');
    expect(AUDITOR_PLAN_PROMPT).toContain('matched heading/quote wrappers');
  });
});
