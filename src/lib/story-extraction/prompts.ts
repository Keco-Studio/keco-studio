import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryAuditView } from '@/lib/story-plan/auditView';
import type { StoryPlanAuditIssue } from '@/lib/story-plan/schema';
import type { SegmentedStorySource } from '@/lib/story-plan/sourceSegments';
import type { StoryExtractionIssue } from './materializer';
import type { StoryContentExtraction, StoryGraphExtraction } from './pipeline';

export type StoryExtractionRetryIssue =
  | StoryExtractionIssue
  | StoryPlanAuditIssue
  | { code: 'model_output'; message: string; unitIds: string[]; nodeIds: string[] };

export const EXTRACTOR_STORY_CONTENT_PROMPT = `You are the semantic story content extractor.
Call submit_story_content_inventory exactly once and return no prose.
Identify every visible node and every real selectable choice from arbitrary prose. The source does not need labels, branch keywords, Markdown, or a standard format.
Create concise unique IDs for all nodes and choices. Do not decide entry, transitions, command ownership, choice owners, targets, merges, or graph edges; a separate Graph Planner does that.

Evidence rules:
- Use only supplied source unit IDs. Assign every source unit to node sourceUnitIds, choice sourceUnitIds, or structuralUnitIds.
- Copy visible speaker, content, and choice text without paraphrasing, summarizing, translating, correcting, or inventing text.
- When one source unit contains multiple branch outcomes, create separate nodes using an exact contiguous clause for each outcome. Never add connective words or implied actions.
- You may remove speaker cues, quote wrappers, list markers, labels, choice-control phrases, jump metadata, and command metadata.
- Remove parenthetical acting or emotion directions attached to a speaker name. They are speaker metadata, not dialogue content and not separate visible nodes unless they stand alone as source prose.
- structuralUnitIds is only for units with no visible story content, such as pure formatting, choice instructions, branch markers, merge markers, and jump instructions.
- A branch or merge declaration names the next visible node. Use its declared label as that next node's ID, keep the declaration unit only in structuralUnitIds, and keep the visible node's sourceUnitIds on its own visible source unit. Never create a separate empty node for the declaration.

Choice rules:
- Create choices only for real decisions presented to the player.
- Never create Continue, Next, or navigation choices for ordinary sequential playback.
- Do not duplicate a decision. One source decision produces one choice item per selectable option.
- A sentence that describes multiple alternatives may supply multiple choices, but each choice text must be traceable to that source.
- An option source unit belongs only to its choice item, including its option text and selection command. Never also create a node from that option unit. The target node must use the branch declaration and visible content reached after selection, not the option row itself.
- In screenplay prose, options may be declared as "\u5206\u652f\u70b9 A / B" followed by "\u9009\u62e9 A（\u7559\u4e0b）：" and "\u9009\u62e9 B（\u79bb\u5f00）：". Treat these as real choices, not dialogue speakers. Nested declarations such as "\u5d4c\u5957\u5206\u652f A1 / A2" and "\u5d4c\u5957\u9009\u62e9 A1（\u7528\u4e8b\u5b9e\u8bc1\u660e）：" are child decisions inside the enclosing branch. Preserve exact option text inside parentheses and use the later branch outcome as the target.

Node types:
- dialogue requires a speaker.
- A known character name followed by an action cue and a colon still introduces dialogue by that character. For example, "The boy slowly fades away: I have to go." is dialogue spoken by the boy; the action cue may be omitted from the dialogue content.
- narration is visible prose, action, background, outcome, or stage direction.
- scene is a visible scene or section heading.
- system is visible system text, not a navigation placeholder.

Presentation Type rules (the target Excel Type column):
- presentationType 1 and 2 are both dialogue boxes. Assign one consistently to each speaking role; never make every speaker Type 1. When the source provides an explicit character list, dialogue Types MUST follow that order: first listed speaking role is Type 1, second listed speaking role is Type 2. Recognize shortened names and role aliases from that list. Only when no character order exists, use first distinct dialogue speaker as Type 1 and second as Type 2. Keep the same speaker on the same Type throughout the story.
- presentationType 3 is a gray narration box for action beats, reactions, and narrator interjections.
- presentationType 4 is visible prose without a dialogue box, used for titles, scene-setting background, long environmental description, and cinematic outcome prose.
- presentationType 5 is centered screen/system text.
- dialogue nodes must use presentationType 1 or 2. Non-dialogue nodes must use 3, 4, or 5.

Every field is required. Use [] and "" for empty values. Never wrap the object or add unknown fields.`;

export const GRAPH_STORY_PLAN_PROMPT = `You are the story Graph Planner.
Call submit_story_graph exactly once and return no prose.
The Extractor already created immutable node and choice inventories. Never create or delete IDs and never rewrite content, speakers, source units, or commands. nodeInventory is intentionally compact: use each node's id and sourceUnitIds together with sourceUnits for visible text and speaker context.

Output rules:
- Write each automatic edge in nodeLinks as {nodeId, nextNodeId}. Use nextNodeId="" for a choice owner or terminal.
- Write each choice edge in choiceLinks as {choiceId, fromNodeId, targetNodeId}.
- Write each command assignment in commandLinks as {commandId, kind, ownerId}, where kind is "node" or "choice". Include every supplied commandId exactly once.
- Commands described as happening when selected belong to choices. Commands described as happening on entry belong to nodes.
- Include every node ID exactly once in nodeLinks and every choice ID exactly once in choiceLinks.
- Choose one existing node as entryNodeId.
- Use nextNodeId for ordinary sequential playback. Never represent ordinary sequence as a choice.
- A node that owns choices must have nextNodeId "".
- Nested decisions belong to the prompt node encountered inside that branch.
- Prevent sibling branches from falling through into each other.
- Branches may merge by pointing their final nodes to the same successor. Independent endings use "".
- If option previews and detailed outcomes are separated in source order, do not connect a preview into the next sibling preview. Follow branch labels and connect each leaf to the shared epilogue.
- Labels such as "\u6765\u81ea\u5206\u652f A【\u82b1\u9999\u5f15\u8def】\u7684\u963f\u57ce：" and "\u6765\u81ea\u5206\u652f B【\u82b1\u9999\u8fdf\u5230】\u7684\u963f\u57ce：" introduce branch-exclusive continuation sections. Do not connect the A section into the B section merely because they are adjacent in source order. Route each section from the corresponding branch path, then connect both section termini to the following shared cinematic/final node.
- Do not merge paths at a shared act heading or shared setup if branch-exclusive "\u6765\u81ea\u5206\u652f X" sections still follow it. A graph cannot split automatically by earlier history after a merge. Keep paths separate through those exclusive sections, then merge at the first truly shared node after all variants. If needed, place the shared setup on the common continuation after the variants instead of creating unreachable variant nodes.
- A pure branch/merge label is structural evidence, not a visible story node. Keep its following visible content on the branch it names.
- Before returning, traverse from entryNodeId through every nextNodeId and choice target. Every node must be reachable. An empty nextNodeId is allowed only for a true terminal node or a node that owns choices; never leave an ordinary intermediate node empty.
- Preserve source order where it matches playback, but graph meaning overrides physical order.
- On a retry, previousGraphCandidate is the last structurally valid graph. Preserve its valid entry and edges, and change only the links required to resolve priorIssues. Do not redraw unrelated branches.

Never add prose or unknown fields.`;

export const AUDITOR_STORY_EXTRACTION_PROMPT = `You independently audit one canonical final story view against the original source.
Call submit_story_plan_audit exactly once and return no prose.
The supplied auditView is the only candidate source of truth. There are no extraction, document, numeric Type, or compiled-table representations to compare.
Check every source unit, canonical row, choice, command, structural unit, and canonical path.
Reject omissions, duplicated or invented content, paraphrasing, wrong speakers, missing choices, false choices, wrong branch ownership, wrong targets, invalid merges, sibling leakage, command changes, wrong command ownership, and unreachable required content.
When the source has an explicit character list, verify that dialogue_primary and dialogue_secondary follow the listed role order and remain consistent for every speaker. Treat shortened names and role aliases as the listed character. Reject collapsing distinct dialogue speakers onto one presentation or changing a speaker's presentation.
Treat a known character name followed by an action cue and a colon as dialogue by that character, not narration. Parenthetical acting directions attached to a speaker name may be removed from dialogue content and must not become separate visible nodes unless they are standalone prose.
Visible source content must not be hidden in structuralUnitIds.
Source units with authoritative=false are server-created replay references for shared setup that must appear once on each history-dependent path before those paths diverge again. Their text and offsets come from an authoritative source unit. Do not report them as invented or duplicated content when each canonical path plays that setup exactly once; do reject a path that plays both the authoritative unit and its replay copy.
Choice-control prompts such as "you can choose", "choose one", and "make your choice" are structural UI instructions when their real options are extracted as choices. They must stay non-visible and are not omissions.
A pure branch or merge declaration may name and decorate the immediately following visible node. The declaration stays in structuralUnitIds and does not require its own empty node or table row; the following visible node may use the declared label as its ID while citing only its own visible source unit.
A pure merge declaration that names a location but does not create shared visible content means branches converge immediately before the next shared visible node. Never force other paths through sibling-specific content at that location.
A complete grammatical sentence can still be a pure merge control, for example "all investigation paths merge before lights out". It stays structural and must not be shown as narration.
An option source unit is owned by its choice only. Reject a candidate that also uses an option unit as node evidence.
An exact standalone command line immediately after a visible node may be owned by that preceding node. This is the canonical representation and does not require an empty command-only node.
Do not invent narrative prerequisites, variable conditions, clue requirements, or plot-logic objections that are not encoded by the source. Audit whether the source was preserved, not whether the source story is plausible.
Judge the actual graph from explicit nextRowId/targetRowId values and canonical paths, not physical source order alone.
For every source decision and every extracted choice:
- Trace every supplied path beginning with that choice.
- A source line such as "if you choose X" begins the exclusive outcome scope for X until the next sibling branch or declared merge.
- Reject a path that enters a sibling outcome, repeats an earlier decision unexpectedly, skips its selected outcome, merges at the wrong semantic point, or terminates before required shared content.
- Reject a choice owner or target that changes which source outcome follows the player's selection.
- Treat explicit source merge statements as semantic constraints. All named incoming branches must reach the shared successor, while branch-only content must remain exclusive before that merge.
- A pure merge declaration that names a location but does not create shared visible content means branches converge immediately before the next shared visible node. Do not route other branches through sibling-specific content merely because that content occurs at the named location.
- Judge nextRowId, targetRowId, and the supplied canonical paths directly.
- Do not invent narrative prerequisites, variable conditions, or clue requirements that the source does not encode as graph structure. Audit faithful extraction, not story plausibility.
Choices and commands appear only under their owning canonical row. Choice commands execute on selection; row commands execute on entry.
If source units, commands, canonical rows, choices, structural units, and canonical paths agree, return pass with an empty issues array.
Never include an issue whose own message says the candidate is correct, acceptable, or needs no action. Omit that issue instead.
Do not repair the candidate. Return only the verdict and specific evidence-backed issues.`;

export const AUDITOR_STORY_ADJUDICATION_PROMPT = `You independently verify concrete allegations from a Primary Story Auditor.
Call submit_story_audit_adjudication exactly once and return no prose.
For every supplied issueId, decide only whether that allegation is confirmed or unsupported by the supplied source units, canonical rows, and canonical paths.
Use confirmed only when the cited evidence directly proves the exact alleged problem. Use unsupported when evidence is missing, contradictory, assigns multiple values to one canonical field, expresses a stylistic preference, or invents a narrative prerequisite.
Do not introduce new issues, rewrite the story, reconsider unrelated rows, or omit an issueId.
Return exactly one decision for every supplied issueId and no extra decisions.`;

const idSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };
const nonEmptyString = { type: 'string', minLength: 1 };
const stringArray = { type: 'array', items: nonEmptyString };

const contentNodeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: idSchema,
    type: { type: 'string', enum: ['dialogue', 'narration', 'scene', 'system'] },
    presentationType: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    speaker: { type: 'string' },
    content: { type: 'string' },
    sourceUnitIds: stringArray,
  },
  required: ['id', 'type', 'presentationType', 'speaker', 'content', 'sourceUnitIds'],
};

const contentChoiceSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: idSchema,
    text: nonEmptyString,
    sourceUnitIds: stringArray,
  },
  required: ['id', 'text', 'sourceUnitIds'],
};

const auditIssueSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    code: { type: 'string', enum: ['omission', 'duplicate_content', 'added_content', 'meaning_change', 'wrong_speaker', 'wrong_branch', 'invalid_merge', 'branch_leak', 'command_mutation', 'wrong_command_owner', 'table_mismatch'] },
    severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
    unitIds: stringArray,
    nodeIds: stringArray,
    message: nonEmptyString,
  },
  required: ['code', 'severity', 'unitIds', 'nodeIds', 'message'],
};

export const EXTRACTOR_STORY_CONTENT_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_content_inventory',
    description: 'Submit complete source-grounded story content and choice inventories.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [3] },
        structuralUnitIds: stringArray,
        nodes: { type: 'array', items: contentNodeSchema, minItems: 1 },
        choices: { type: 'array', items: contentChoiceSchema },
      },
      required: ['version', 'structuralUnitIds', 'nodes', 'choices'],
    },
  },
};

export const GRAPH_STORY_PLAN_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_graph',
    description: 'Connect every extracted node and choice into a playable graph.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [3] },
        entryNodeId: idSchema,
        nodeLinks: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: { nodeId: idSchema, nextNodeId: { type: 'string' } },
            required: ['nodeId', 'nextNodeId'],
          },
        },
        choiceLinks: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: { choiceId: idSchema, fromNodeId: idSchema, targetNodeId: idSchema },
            required: ['choiceId', 'fromNodeId', 'targetNodeId'],
          },
        },
        commandLinks: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              commandId: nonEmptyString,
              kind: { type: 'string', enum: ['node', 'choice'] },
              ownerId: idSchema,
            },
            required: ['commandId', 'kind', 'ownerId'],
          },
        },
      },
      required: ['version', 'entryNodeId', 'nodeLinks', 'choiceLinks', 'commandLinks'],
    },
  },
};

export const AUDITOR_STORY_EXTRACTION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_plan_audit',
    description: 'Submit the mandatory semantic audit verdict.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        issues: { type: 'array', items: auditIssueSchema },
      },
      required: ['verdict', 'issues'],
    },
  },
};

export const AUDITOR_STORY_ADJUDICATION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_audit_adjudication',
    description: 'Confirm or dismiss each supplied Primary Auditor allegation.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        decisions: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              issueId: nonEmptyString,
              status: { type: 'string', enum: ['confirmed', 'unsupported'] },
            },
            required: ['issueId', 'status'],
          },
        },
      },
      required: ['decisions'],
    },
  },
};

export function buildContentExtractionMessages(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[]
): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACTOR_STORY_CONTENT_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'EXTRACT_STORY_CONTENT_INVENTORY', attempt,
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      priorIssues,
    }) },
  ];
}

export function buildGraphExtractionMessages(
  source: SegmentedStorySource,
  content: StoryContentExtraction,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[],
  previousGraphCandidate?: StoryGraphExtraction
): ChatMessage[] {
  return [
    { role: 'system', content: GRAPH_STORY_PLAN_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: previousGraphCandidate ? 'REPAIR_STORY_GRAPH' : 'BUILD_STORY_GRAPH',
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      nodeInventory: content.nodes.map(({ id, sourceUnitIds }) => ({ id, sourceUnitIds })),
      choiceInventory: content.choices,
      commands: source.commands.map((command) => ({
        id: command.id,
        source: command.source,
        unitId: source.segments.find((segment) => segment.id === command.segmentId)?.unitId ?? '',
      })),
      priorIssues,
      ...(previousGraphCandidate ? { previousGraphCandidate } : {}),
    }) },
  ];
}

export function buildAuditorExtractionMessages(
  source: SegmentedStorySource,
  auditView: StoryAuditView
): ChatMessage[] {
  return [
    { role: 'system', content: AUDITOR_STORY_EXTRACTION_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'AUDIT_COMPLETE_STORY_IR',
      sourceUnits: source.units.map(({ id, text, authoritative }) => ({
        id,
        text,
        authoritative,
      })),
      commands: source.commands.map((command) => ({
        id: command.id,
        source: command.source,
        unitId: source.segments.find((segment) => segment.id === command.segmentId)?.unitId ?? '',
      })),
      auditView,
    }) },
  ];
}

export function buildAuditAdjudicationMessages(
  source: SegmentedStorySource,
  auditView: StoryAuditView,
  issues: StoryPlanAuditIssue[]
): ChatMessage[] {
  const referencedUnitIds = new Set(issues.flatMap((issue) => issue.unitIds));
  const referencedRowIds = new Set(issues.flatMap((issue) => issue.nodeIds));
  return [
    { role: 'system', content: AUDITOR_STORY_ADJUDICATION_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'ADJUDICATE_STORY_AUDIT_ISSUES',
      allegations: issues.map((issue, index) => ({ issueId: `issue-${index + 1}`, ...issue })),
      sourceUnits: source.units
        .filter((unit) => referencedUnitIds.has(unit.id))
        .map(({ id, text, authoritative }) => ({ id, text, authoritative })),
      rows: auditView.rows.filter((row) => referencedRowIds.has(row.id)),
      paths: auditView.paths.filter((path) =>
        path.rowIds.some((rowId) => referencedRowIds.has(rowId))
      ),
    }) },
  ];
}
