import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import type { StoryRelationshipPlan } from './schema';
import { tryParseExplicitStory } from './explicitParser';
import { segmentStorySource } from './sourceSegments';
import { validateStoryPlan } from './validator';

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);

function validCase() {
  const source = segmentStorySource(fixture, 'fixture');
  const plan = tryParseExplicitStory(source)!;
  return { source, plan };
}

function issueCodes(plan: StoryRelationshipPlan): string[] {
  const { source } = validCase();
  return validateStoryPlan(plan, source).map((issue) => issue.code);
}

describe('story plan validation', () => {
  it('accepts the deterministic nested fixture plan', () => {
    const { source, plan } = validCase();
    expect(validateStoryPlan(plan, source)).toEqual([]);
  });

  it('rejects an invalid entry and duplicate ids', () => {
    const { plan } = validCase();
    expect(issueCodes({ ...plan, entryNodeId: 'Missing' })).toContain('invalid_entry');
    expect(issueCodes({ ...plan, nodes: [...plan.nodes, { ...plan.nodes[0] }] }))
      .toContain('duplicate_node_id');
    expect(issueCodes({ ...plan, choices: [...plan.choices, { ...plan.choices[0] }] }))
      .toContain('duplicate_choice_id');
  });

  it('rejects unknown and incompatible segments', () => {
    const { plan } = validCase();
    expect(issueCodes({
      ...plan,
      nodes: plan.nodes.map((node, index) => index === 0
        ? { ...node, contentSegmentIds: ['missing'] }
        : node),
    })).toContain('unknown_segment');
    expect(issueCodes({
      ...plan,
      nodes: plan.nodes.map((node, index) => index === 0
        ? { ...node, contentSegmentIds: [node.speakerSegmentId] }
        : node),
    })).toContain('segment_kind_mismatch');
  });

  it('rejects omitted and duplicated required segments', () => {
    const { plan } = validCase();
    expect(issueCodes({ ...plan, choices: plan.choices.slice(1) })).toContain('omitted_segment');
    expect(issueCodes({
      ...plan,
      nodes: plan.nodes.map((node, index) => index === 1
        ? { ...node, contentSegmentIds: [...node.contentSegmentIds, ...plan.nodes[0].contentSegmentIds] }
        : node),
    })).toContain('duplicate_segment');
  });

  it('rejects unknown commands and duplicate command ownership', () => {
    const { plan } = validCase();
    expect(issueCodes({
      ...plan,
      choices: plan.choices.map((choice, index) => index === 0
        ? { ...choice, commandIds: ['missing'] }
        : choice),
    })).toContain('unknown_command');
    expect(issueCodes({
      ...plan,
      choices: plan.choices.map((choice, index) => index === 1
        ? { ...choice, commandIds: plan.choices[0].commandIds }
        : choice),
    })).toContain('wrong_command_owner');
  });

  it('rejects unresolved targets and unreachable nodes', () => {
    const { plan } = validCase();
    expect(issueCodes({
      ...plan,
      choices: plan.choices.map((choice, index) => index === 0
        ? { ...choice, targetNodeId: 'Missing' }
        : choice),
    })).toContain('unresolved_target');
    expect(issueCodes({
      ...plan,
      nodes: [...plan.nodes, {
        id: 'Isolated',
        type: 'system',
        speakerSegmentId: '',
        contentSegmentIds: [],
        commandIds: [],
        nextNodeId: '',
      }],
    })).toContain('unreachable_node');
  });

  it('rejects a choice node with an automatic fallthrough', () => {
    const { plan } = validCase();
    expect(issueCodes({
      ...plan,
      nodes: plan.nodes.map((node) => node.id === 'Start'
        ? { ...node, nextNodeId: 'Oend' }
        : node),
    })).toContain('branch_leak');
  });

  it('rejects multiple paths merging into an explicit branch label', () => {
    const { plan } = validCase();
    expect(issueCodes({
      ...plan,
      nodes: plan.nodes.map((node) => node.id === 'O1B_END'
        ? { ...node, nextNodeId: 'O1A_END' }
        : node),
    })).toContain('invalid_merge');
  });

  it('rejects an automatic no-progress cycle', () => {
    const { plan } = validCase();
    expect(issueCodes({
      ...plan,
      nodes: plan.nodes.map((node) => {
        if (node.id === 'O1A_END') return { ...node, nextNodeId: 'O1B_END' };
        if (node.id === 'O1B_END') return { ...node, nextNodeId: 'O1A_END' };
        return node;
      }),
    })).toContain('automatic_cycle');
  });
});
