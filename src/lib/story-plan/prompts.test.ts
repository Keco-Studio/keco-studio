import { describe, expect, it } from '@jest/globals';
import {
  AUDITOR_STORY_EXTRACTION_PROMPT,
  AUDITOR_STORY_EXTRACTION_TOOL,
  EXTRACTOR_STORY_CONTENT_PROMPT,
  EXTRACTOR_STORY_CONTENT_TOOL,
  GRAPH_STORY_PLAN_PROMPT,
  GRAPH_STORY_PLAN_TOOL,
  buildContentExtractionMessages,
  buildGraphExtractionMessages,
} from '@/lib/story-extraction/prompts';
import { segmentStorySource } from './sourceSegments';

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
    const source = segmentStorySource('七号：选择。\n- 左边 $trust+=1\n左边结局。', 'fixture');
    const contentMessages = buildContentExtractionMessages(source, 1, []);
    const contentInput = JSON.parse(contentMessages[1].content as string);
    expect(contentInput.sourceUnits).toEqual(source.units.map(({ id, text }) => ({ id, text })));
    expect(contentInput).not.toHaveProperty('commands');
    expect(contentInput).not.toHaveProperty('nodeInventory');

    const inventory = {
      version: 3 as const,
      structuralUnitIds: [],
      nodes: [{ id: 'start', type: 'dialogue' as const, speaker: '七号', content: '选择。', sourceUnitIds: ['fixture:0'] }],
      choices: [{ id: 'left', text: '左边', sourceUnitIds: ['fixture:1'] }],
    };
    const graphMessages = buildGraphExtractionMessages(source, inventory, 1, []);
    const graphInput = JSON.parse(graphMessages[1].content as string);
    expect(graphInput.nodeInventory).toEqual(inventory.nodes);
    expect(graphInput.choiceInventory).toEqual(inventory.choices);
    expect(graphInput.commands).toEqual([{
      id: source.commands[0].id,
      source: '$trust+=1',
      unitId: 'fixture:1',
    }]);
  });

  it('requires the Auditor to inspect table and paths', () => {
    expect(AUDITOR_STORY_EXTRACTION_TOOL.function.name).toBe('submit_story_plan_audit');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('missing choices');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('compiled table');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('enumerated paths');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('Type 1');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('always stay in OptionN_Commands');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('blank Label');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('Jump in Commands');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('tablePaths');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('exclusive outcome scope');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('repeats an earlier decision unexpectedly');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('Never infer termination or fallthrough');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('does not create shared visible content');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('Do not invent narrative prerequisites');
  });

  it('audits structural decorators and reference Type values consistently', () => {
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'does not require its own empty node or table row'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'Types 1 and 2 are both dialogue boxes'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'must not collapse every speaker to Type 1'
    );
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain(
      'next target is the immediately following physical table row, Commands must be blank'
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

  it('keeps Graph Planner focused on real choices and automatic edges', () => {
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('Never create or delete');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('nodeId->nextNodeId');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('ordinary sequential playback');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('sibling branches');
  });
});
