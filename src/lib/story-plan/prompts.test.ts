import { describe, expect, it } from '@jest/globals';
import {
  AUDITOR_PLAN_PROMPT,
  AUDITOR_PLAN_TOOL,
  CONVERTER_PLAN_PROMPT,
  CONVERTER_PLAN_TOOL,
} from './prompts';

describe('flat story plan prompts', () => {
  it('uses a flat converter output contract without old Story IR fields', () => {
    const schema = JSON.stringify(CONVERTER_PLAN_TOOL.function.parameters);

    expect(CONVERTER_PLAN_TOOL.function.name).toBe('submit_story_relationship_plan');
    expect(schema).toContain('entryNodeId');
    expect(schema).toContain('speakerSegmentId');
    expect(schema).toContain('contentSegmentIds');
    expect(schema).toContain('textSegmentIds');
    expect(schema).not.toContain('$defs');
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
});
