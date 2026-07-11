import { describe, expect, it } from '@jest/globals';
import {
  AUDITOR_STORY_EXTRACTION_PROMPT,
  AUDITOR_STORY_EXTRACTION_TOOL,
  CONVERTER_STORY_EXTRACTION_PROMPT,
  CONVERTER_STORY_EXTRACTION_TOOL,
  buildConverterExtractionMessages,
} from '@/lib/story-extraction/prompts';
import { segmentStorySource } from './sourceSegments';

describe('full story extraction prompts', () => {
  it('allows the Converter to create complete nodes and choices', () => {
    const schema = JSON.stringify(CONVERTER_STORY_EXTRACTION_TOOL.function.parameters);

    expect(CONVERTER_STORY_EXTRACTION_TOOL.function.name).toBe('submit_complete_story_ir');
    expect(schema).toContain('entryNodeId');
    expect(schema).toContain('structuralUnitIds');
    expect(schema).toContain('nodes');
    expect(schema).toContain('speaker');
    expect(schema).toContain('content');
    expect(schema).toContain('sourceUnitIds');
    expect(schema).toContain('commandSources');
    expect(schema).toContain('choices');
    expect(schema).toContain('targetNodeId');
    expect(schema).not.toContain('choiceInventory');
    expect(schema).not.toContain('breakAfterNodeIds');
  });

  it('explicitly requires arbitrary prose choice inference and exact source evidence', () => {
    expect(CONVERTER_STORY_EXTRACTION_PROMPT).toContain('arbitrary prose');
    expect(CONVERTER_STORY_EXTRACTION_PROMPT).toContain('Create nodes and choices');
    expect(CONVERTER_STORY_EXTRACTION_PROMPT).toContain('without paraphrasing');
    expect(CONVERTER_STORY_EXTRACTION_PROMPT).toContain('exactly once');
    expect(CONVERTER_STORY_EXTRACTION_PROMPT).toContain('exact command strings');
  });

  it('sends raw source units and parsed commands without semantic inventories', () => {
    const source = segmentStorySource([
      '七号：我们必须选择一条路线。',
      '- 前往能源舱。选择时执行 $resolve+=1。',
      '你进入能源舱。',
    ].join('\n'), 'fixture');
    const messages = buildConverterExtractionMessages(source, 1, []);
    const input = JSON.parse(messages[1].content as string);

    expect(input.sourceUnits).toEqual(source.units.map(({ id, text }) => ({ id, text })));
    expect(input.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: '$resolve+=1' }),
    ]));
    expect(input).not.toHaveProperty('nodeInventory');
    expect(input).not.toHaveProperty('choiceInventory');
  });

  it('requires the Auditor to review source, structure, table, and paths', () => {
    const schema = JSON.stringify(AUDITOR_STORY_EXTRACTION_TOOL.function.parameters);
    expect(AUDITOR_STORY_EXTRACTION_TOOL.function.name).toBe('submit_story_plan_audit');
    expect(schema).toContain('verdict');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('missing choices');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('compiled table');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('enumerated paths');
    expect(AUDITOR_STORY_EXTRACTION_PROMPT).toContain('Do not repair');
  });
});
