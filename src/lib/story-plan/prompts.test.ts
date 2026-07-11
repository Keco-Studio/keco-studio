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
  });

  it('keeps Graph Planner focused on real choices and automatic edges', () => {
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('Never create or delete');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('nodeId->nextNodeId');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('ordinary sequential playback');
    expect(GRAPH_STORY_PLAN_PROMPT).toContain('sibling branches');
  });
});
