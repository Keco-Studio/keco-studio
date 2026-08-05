import { describe, expect, it } from '@jest/globals';
import {
  AUDITOR_STORY_ADJUDICATION_PROMPT,
  AUDITOR_STORY_ADJUDICATION_TOOL,
  AUDITOR_STORY_EXTRACTION_PROMPT,
  AUDITOR_STORY_EXTRACTION_TOOL,
  EXTRACTOR_STORY_CONTENT_PROMPT,
  EXTRACTOR_STORY_CONTENT_TOOL,
  GRAPH_STORY_PLAN_PROMPT,
  GRAPH_STORY_PLAN_TOOL,
  buildAuditAdjudicationMessages,
  buildAuditorExtractionMessages,
  buildContentExtractionMessages,
  buildGraphExtractionMessages,
} from '@/lib/story-extraction/prompts';
import type { StoryAuditView } from './auditView';
import { segmentStorySource } from './sourceSegments';

const auditView: StoryAuditView = {
  version: 1,
  entryRowId: 'start',
  structuralUnitIds: [],
  rows: [{
    id: 'start',
    presentation: 'dialogue_primary',
    speaker: 'Seven',
    content: 'Choose.',
    sourceUnitIds: ['fixture:0'],
    commands: [],
    nextRowId: '',
    choices: [{
      text: 'Left',
      targetRowId: 'left',
      sourceUnitIds: ['fixture:1'],
      commands: ['$trust+=1'],
    }],
  }, {
    id: 'left',
    presentation: 'prose',
    speaker: '',
    content: 'Left ending.',
    sourceUnitIds: ['fixture:2'],
    commands: [],
    nextRowId: '',
    choices: [],
  }],
  paths: [{
    rowIds: ['start', 'left'],
    choiceTexts: ['Left'],
    terminalRowId: 'left',
    commands: ['$trust+=1'],
  }],
};

describe('two-stage full story extraction prompts', () => {
  it('lets the Extractor create content nodes and choices without graph fields', () => {
    const schema = JSON.stringify(EXTRACTOR_STORY_CONTENT_TOOL.function.parameters);
    expect(EXTRACTOR_STORY_CONTENT_TOOL.function.name).toBe('submit_story_content_inventory');
    expect(schema).toContain('nodes');
    expect(schema).toContain('choices');
    expect(schema).toContain('speaker');
    expect(schema).toContain('content');
    expect(schema).toContain('sourceUnitIds');
    expect(schema).not.toContain('commandUnitIds');
    expect(schema).not.toContain('nextNodeId');
    expect(schema).not.toContain('fromNodeId');
    expect(schema).not.toContain('targetNodeId');
  });

  it('lets the Graph Planner connect every extracted ID without changing content', () => {
    const schema = JSON.stringify(GRAPH_STORY_PLAN_TOOL.function.parameters);
    expect(GRAPH_STORY_PLAN_TOOL.function.name).toBe('submit_story_graph');
    expect(schema).toContain('entryNodeId');
    expect(schema).toContain('nodeLinks');
    expect(schema).toContain('choiceLinks');
    expect(schema).not.toContain('content');
    expect(schema).not.toContain('speaker');
  });

  it('requires exact extraction and forbids synthetic navigation choices', () => {
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('arbitrary prose');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('without paraphrasing');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('exact contiguous clause');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('Never create Continue');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('command ownership');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('Do not duplicate a decision');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('presentationType 1 and 2 are both dialogue boxes');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('MUST follow that order');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('known character name followed by an action cue');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('分支点 A / B');
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain('嵌套选择 A1');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('来自分支 A');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('Every node must be reachable');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('Keep paths separate through those exclusive sections');
  });

  it('gives structural declarations and option rows one unambiguous owner', () => {
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain(
      'A branch or merge declaration names the next visible node'
    );
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain(
      'Never create a separate empty node for the declaration'
    );
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain(
      'An option source unit belongs only to its choice item'
    );
    expect(EXTRACTOR_STORY_CONTENT_PROMPT).toContain(
      'Never also create a node from that option unit'
    );
  });

  it('sends raw units to Extractor and LLM-created inventories to Graph Planner', () => {
    const source = segmentStorySource('Seven: Choose.\n- Left $trust+=1\nLeft ending.', 'fixture');
    const contentMessages = buildContentExtractionMessages(source, 1, []);
    const contentInput = JSON.parse(contentMessages[1].content as string);
    expect(contentInput.sourceUnits).toEqual(source.units.map(({ id, text }) => ({ id, text })));
    expect(contentInput).not.toHaveProperty('commands');
    expect(contentInput).not.toHaveProperty('nodeInventory');

    const inventory = {
      version: 3 as const,
      structuralUnitIds: [],
      nodes: [{ id: 'start', type: 'dialogue' as const, speaker: 'Seven', content: 'Choose.', sourceUnitIds: ['fixture:0'] }],
      choices: [{ id: 'left', text: 'Left', sourceUnitIds: ['fixture:1'] }],
    };
    const graphMessages = buildGraphExtractionMessages(source, inventory, 1, []);
    const graphInput = JSON.parse(graphMessages[1].content as string);
    expect(graphInput.nodeInventory).toEqual([
      { id: 'start', sourceUnitIds: ['fixture:0'] },
    ]);
    expect(graphInput.choiceInventory).toEqual(inventory.choices);
    expect(graphInput.commands).toEqual([{
      id: source.commands[0].id,
      source: '$trust+=1',
      unitId: 'fixture:1',
    }]);
  });

  it('includes the prior graph candidate for a targeted Graph Planner retry', () => {
    const source = segmentStorySource('Seven: Choose.\n- Left\nLeft ending.', 'fixture');
    const inventory = {
      version: 3 as const,
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'dialogue' as const, presentationType: 1 as const, speaker: 'Seven', content: 'Choose.', sourceUnitIds: ['fixture:0'] },
        { id: 'left', type: 'narration' as const, presentationType: 3 as const, speaker: '', content: 'Left ending.', sourceUnitIds: ['fixture:2'] },
      ],
      choices: [{ id: 'go_left', text: 'Left', sourceUnitIds: ['fixture:1'] }],
    };
    const previousGraph = {
      version: 3 as const,
      entryNodeId: 'start',
      nodeLinks: ['start->', 'left->'],
      choiceLinks: ['go_left->start->left'],
      commandLinks: [],
    };
    const messages = buildGraphExtractionMessages(
      source,
      inventory,
      2,
      [{ code: 'unreachable_node', message: 'Unreachable node left', unitIds: [], nodeIds: ['left'] }],
      previousGraph
    );
    const input = JSON.parse(messages[1].content as string);

    expect(input.task).toBe('REPAIR_STORY_GRAPH');
    expect(input.previousGraphCandidate).toEqual(previousGraph);
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('change only the links required');
  });

  it('requires the Primary Auditor to inspect one canonical audit view', () => {
    expect(AUDITOR_STORY_EXTRACTION_TOOL.function.name).toBe('submit_story_plan_audit');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('missing choices');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('only candidate source of truth');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('canonical paths');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('exclusive outcome scope');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('repeats an earlier decision unexpectedly');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('does not create shared visible content');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('Do not invent narrative prerequisites');

    const source = segmentStorySource('Seven: Choose.\n- Left $trust+=1\nLeft ending.', 'fixture');
    const input = JSON.parse(buildAuditorExtractionMessages(source, auditView)[1].content as string);
    expect(Object.keys(input).sort()).toEqual(['auditView', 'commands', 'sourceUnits', 'task']);
    expect(input.auditView).toEqual(auditView);
    expect(input).not.toHaveProperty('extraction');
    expect(input).not.toHaveProperty('document');
    expect(input).not.toHaveProperty('projection');
    expect(JSON.stringify(input)).not.toContain('tablePaths');
  });

  it('audits structural decorators and reference Type values consistently', () => {
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'does not require its own empty node or table row'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'dialogue_primary and dialogue_secondary'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'Reject collapsing distinct dialogue speakers onto one presentation'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'Choices and commands appear only under their owning canonical row'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'Never include an issue whose own message says the candidate is correct, acceptable, or needs no action'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'standalone command line immediately after a visible node'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'Do not invent narrative prerequisites'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'Choice-control prompts such as "you can choose"'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'A complete grammatical sentence can still be a pure merge control'
    );
  });

  it('gives the Targeted Adjudicator only allegations and referenced evidence', () => {
    expect(AUDITOR_STORY_ADJUDICATION_TOOL.function.name).toBe('submit_story_audit_adjudication');
    expect(AUDITOR_STORY_ADJUDICATION_PROMPT).toContain('confirmed or unsupported');
    expect(AUDITOR_STORY_ADJUDICATION_PROMPT).toContain('Do not introduce new issues');

    const source = segmentStorySource('Seven: Choose.\n- Left $trust+=1\nLeft ending.', 'fixture');
    const messages = buildAuditAdjudicationMessages(source, auditView, [{
      code: 'wrong_speaker',
      severity: 'major',
      unitIds: ['fixture:0'],
      nodeIds: ['start'],
      message: 'Speaker is wrong.',
    }]);
    const input = JSON.parse(messages[1].content as string);
    expect(input.allegations).toEqual([expect.objectContaining({ issueId: 'issue-1' })]);
    expect(input.sourceUnits).toEqual([{
      id: 'fixture:0', text: 'Seven: Choose.', authoritative: true,
    }]);
    expect(input.rows).toEqual([auditView.rows[0]]);
    expect(input.paths).toEqual([auditView.paths[0]]);
    expect(input).not.toHaveProperty('auditView');
  });

  it('keeps Graph Planner focused on real choices and automatic edges', () => {
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('Never create or delete');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('{nodeId, nextNodeId}');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('ordinary sequential playback');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('sibling branches');
  });
});
