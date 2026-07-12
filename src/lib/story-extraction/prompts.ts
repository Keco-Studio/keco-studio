import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryDocument } from '@/lib/story-ir/schema';
import type { StoryAuditProjection } from '@/lib/story-plan/projection';
import type { StoryPlanAuditIssue } from '@/lib/story-plan/schema';
import type { SegmentedStorySource } from '@/lib/story-plan/sourceSegments';
import type { StoryExtractionIssue } from './materializer';
import type { StoryContentExtraction } from './pipeline';
import type { StoryExtraction } from './schema';

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
- Never create Continue, 继续, next, or navigation choices for ordinary sequential playback.
- Do not duplicate a decision. One source decision produces one choice item per selectable option.
- A sentence that describes multiple alternatives may supply multiple choices, but each choice text must be traceable to that source.
- An option source unit belongs only to its choice item, including its option text and selection command. Never also create a node from that option unit. The target node must use the branch declaration and visible content reached after selection, not the option row itself.

Node types:
- dialogue requires a speaker.
- A known character name followed by an action cue and a colon still introduces dialogue by that character. For example, "少年身影渐渐透明：我该走了。" is dialogue spoken by 少年; the action cue may be omitted from the dialogue content.
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
The Extractor already created immutable node and choice inventories. Never create or delete IDs and never rewrite content, speakers, source units, or commands.

Output rules:
- Write each automatic edge in nodeLinks as nodeId->nextNodeId. Use nodeId-> for a choice owner or terminal.
- Write each choice edge in choiceLinks as choiceId->fromNodeId->targetNodeId.
- Write each command assignment in commandLinks as commandId->node->nodeId or commandId->choice->choiceId. Include every supplied commandId exactly once.
- Commands described as happening when selected belong to choices. Commands described as happening on entry belong to nodes.
- Include every node ID exactly once in nodeLinks and every choice ID exactly once in choiceLinks.
- Choose one existing node as entryNodeId.
- Use nextNodeId for ordinary sequential playback. Never represent ordinary sequence as a choice.
- A node that owns choices must have nextNodeId "".
- Nested decisions belong to the prompt node encountered inside that branch.
- Prevent sibling branches from falling through into each other.
- Branches may merge by pointing their final nodes to the same successor. Independent endings use "".
- Preserve source order where it matches playback, but graph meaning overrides physical order.

Never add spaces, prose, or fields inside a link string.`;

export const GRAPH_AUDITOR_STORY_EXTRACTION_PROMPT = `You independently audit only story graph meaning and enumerated playback paths against the original source.
Call submit_story_graph_audit exactly once and return no prose.
Do not audit table formatting, physical row fallthrough, Type values, wording fidelity, speakers, or command values; a separate Auditor handles those.

For every source decision and every extracted choice:
- Trace every supplied path beginning with that choice.
- A source line such as "if you choose X" begins the exclusive outcome scope for X until the next sibling branch or declared merge.
- Reject a path that enters a sibling outcome, repeats an earlier decision unexpectedly, skips its selected outcome, merges at the wrong semantic point, or terminates before required shared content.
- Reject a choice owner or target that changes which source outcome follows the player's selection.
- Treat explicit source merge statements as semantic constraints. All named incoming branches must reach the shared successor, while branch-only content must remain exclusive before that merge.
- A pure merge declaration that names a location but does not create shared visible content means branches converge immediately before the next shared visible node. Do not route other branches through sibling-specific content merely because that content occurs at the named location.
- Judge nextNodeId and the supplied Story IR paths directly. Never infer termination or fallthrough from compiled table rows.
- Do not invent narrative prerequisites, variable conditions, or clue requirements that the source does not encode as graph structure. Audit faithful extraction, not story plausibility.

If every choice path matches the source branch structure, return pass with an empty issues array.
Never include an issue whose own message says the candidate is correct, acceptable, or needs no action.`;

export const AUDITOR_STORY_EXTRACTION_PROMPT = `You independently audit a complete Story IR extraction against the original source.
Call submit_story_plan_audit exactly once and return no prose.
Check every source unit, extraction node, choice, command, compiled table row, and enumerated path.
Reject omissions, duplicated or invented content, paraphrasing, wrong speakers, missing choices, false choices, wrong branch ownership, wrong targets, invalid merges, sibling leakage, command changes, wrong command ownership, unreachable content, and compiled table mismatches.
When the source has an explicit character list, verify that dialogue presentationType 1 and 2 follow the listed role order and remain consistent for every speaker. Treat shortened names and role aliases as the listed character. Reject collapsing distinct dialogue speakers onto one Type or changing a speaker's Type.
Treat a known character name followed by an action cue and a colon as dialogue by that character, not narration. Parenthetical acting directions attached to a speaker name may be removed from dialogue content and must not become separate visible nodes unless they are standalone prose.
Visible source content must not be hidden in structuralUnitIds.
Choice-control prompts such as "you can choose", "choose one", "你可以选择", and "请选择" are structural UI instructions when their real options are extracted as choices. They must stay non-visible and are not omissions.
A pure branch or merge declaration may name and decorate the immediately following visible node. The declaration stays in structuralUnitIds and does not require its own empty node or table row; the following visible node may use the declared label as its ID while citing only its own visible source unit.
A pure merge declaration that names a location but does not create shared visible content means branches converge immediately before the next shared visible node. Never force other paths through sibling-specific content at that location.
A complete grammatical sentence can still be a pure merge control, for example "all investigation paths merge before lights out" or "所有调查路径在熄灯前合流". It stays structural and must not be shown as narration.
An option source unit is owned by its choice only. Reject a candidate that also uses an option unit as node evidence.
An exact standalone command line immediately after a visible node may be owned by that preceding node. This is the canonical representation and does not require an empty command-only node.
Do not invent narrative prerequisites, variable conditions, clue requirements, or plot-logic objections that are not encoded by the source. Audit whether the source was preserved, not whether the source story is plausible.
Judge the actual graph from explicit next/choice targets and enumerated paths, not physical source order alone.
Audit the compiled table by playback equivalence using these reference-table rules:
- The table Type must equal each node's presentationType. Types 1 and 2 are both dialogue boxes and should distinguish speaking roles consistently; a story with multiple speakers must not collapse every speaker to Type 1. Type 3 is a gray narration box, Type 4 is visible scene/background/cinematic prose without a dialogue box, and Type 5 is centered screen/system text.
- A blank Label is valid for a row reached only by physical fallthrough. Entry, option targets, and non-fallthrough jump targets retain labels.
- Automatic non-fallthrough transitions use Jump in Commands; terminal rows before later physical rows use End.
- When a node's next target is the immediately following physical table row, Commands must be blank. This physical fallthrough is the canonical playback-equivalent encoding even when the source used an explicit jump or merge instruction. Never demand Jump or End for that row.
- Option commands always stay in OptionN_Commands and execute only when that option is selected. Node commands stay in Commands and execute on entry.
- Do not require If metadata to represent graph exclusivity.
- projection.tablePaths is produced by deterministic server playback of the compiled table and has already been matched against the Story IR paths. Do not claim a table path is unreachable when tablePaths demonstrates it.
If source, extraction, StoryDocument, compiled table, and enumerated paths agree, return pass with an empty issues array.
Never include an issue whose own message says the candidate is correct, acceptable, or needs no action. Omit that issue instead.
Do not repair the candidate. Return only the verdict and specific evidence-backed issues.`;

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
        nodeLinks: { type: 'array', items: nonEmptyString },
        choiceLinks: { type: 'array', items: nonEmptyString },
        commandLinks: { type: 'array', items: nonEmptyString },
      },
      required: ['version', 'entryNodeId', 'nodeLinks', 'choiceLinks', 'commandLinks'],
    },
  },
};

export const GRAPH_AUDITOR_STORY_EXTRACTION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_graph_audit',
    description: 'Submit the independent story graph and path audit verdict.',
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
  priorIssues: StoryExtractionRetryIssue[]
): ChatMessage[] {
  return [
    { role: 'system', content: GRAPH_STORY_PLAN_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'BUILD_STORY_GRAPH', attempt,
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      nodeInventory: content.nodes,
      choiceInventory: content.choices,
      commands: source.commands.map((command) => ({
        id: command.id,
        source: command.source,
        unitId: source.segments.find((segment) => segment.id === command.segmentId)?.unitId ?? '',
      })),
      priorIssues,
    }) },
  ];
}

export function buildAuditorExtractionMessages(
  source: SegmentedStorySource,
  extraction: StoryExtraction,
  document: StoryDocument,
  projection: StoryAuditProjection
): ChatMessage[] {
  return [
    { role: 'system', content: AUDITOR_STORY_EXTRACTION_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'AUDIT_COMPLETE_STORY_IR',
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      commands: source.commands,
      extraction,
      document,
      projection,
    }) },
  ];
}

export function buildGraphAuditorExtractionMessages(
  source: SegmentedStorySource,
  extraction: StoryExtraction,
  projection: StoryAuditProjection
): ChatMessage[] {
  return [
    { role: 'system', content: GRAPH_AUDITOR_STORY_EXTRACTION_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'AUDIT_STORY_GRAPH_AND_PATHS',
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      extraction,
      paths: projection.paths,
    }) },
  ];
}
