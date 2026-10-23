# Game Rules Kernel Design

## Status

Approved product direction; implementation has not started.

## Goal

Redefine a newly generated Keco Game Design System (GDS) version as a
project-specific, structured description of how a game runs. Rules describe the
player, legal actions, game state, resolution, and failure handling. They do not
describe how a team should design, review, or produce a game.

The existing rule-policy semantics remain readable for historical versions but
are no longer generated for new systems.

## Product Boundary

The product uses the term "Game Design System" for the versioned container. Its
canonical Rules payload is a **Game Rules Kernel**.

Rules answer runtime questions such as:

- Can this actor take this action now?
- What state and resources are required or consumed?
- In which order do systems resolve?
- What outcome, feedback, or next state follows?
- How is the game bounded in time and space?
- What happens when a roll, target, state, or resolution is invalid?

Rules must not prescribe team workflow, UI process, design-review practice,
agent behavior, code structure, tool use, or production methodology.

## Domain Taxonomy

The requested list contains ten domains, not nine. `domain` is mandatory on
every v2 rule and is one of:

| Domain | Meaning |
| --- | --- |
| `player` | Player role, starting capabilities, authority, and visible information. |
| `objective` | Goals, progression gates, victory, defeat, draw, and end conditions. |
| `action` | Legal player or system actions, targets, preconditions, and availability. |
| `object_state` | Game objects, attributes, statuses, ownership, and state transitions. |
| `sequence` | Turn, phase, priority, interrupt, concurrent, and settlement order. |
| `resource_cost` | Resource types, acquisition, limits, costs, cooldowns, and depletion. |
| `resolution_feedback` | Deterministic result resolution, resulting state, and player-facing feedback. |
| `spatiotemporal` | Map, position, range, region, time progression, and boundary constraints. |
| `randomness` | Random sources, probabilities, seed or roll interpretation, and random result mapping. |
| `fallback` | Illegal input, missing target, invalid state, tie, deadlock, timeout, and recovery behavior. |

The generator must produce at least one `required` rule for `player`,
`objective`, `action`, `object_state`, `sequence`, `resource_cost`,
`resolution_feedback`, and `fallback`. `spatiotemporal` and `randomness` are
required only when the normalized source or user brief declares that the game
uses spatial, temporal, or random mechanics. When either is not applicable, the
generated document must state that absence in its relevant narrative field;
the rules payload does not receive a placeholder rule.

## Canonical v2 Schema

The structured payload remains a flat rule list so existing version identity,
diff, editor, policy-injection, and persistence patterns remain valid. The
semantic change is represented by `schemaVersion: 2` and the new mandatory
`domain` field.

```ts
type GameRuleDomain =
  | 'player'
  | 'objective'
  | 'action'
  | 'object_state'
  | 'sequence'
  | 'resource_cost'
  | 'resolution_feedback'
  | 'spatiotemporal'
  | 'randomness'
  | 'fallback';

type GameRule = {
  id: string; // stable kebab-case identifier, unique in the version
  domain: GameRuleDomain;
  kind: 'principle' | 'constraint' | 'pattern' | 'anti_pattern' | 'check';
  title: string;
  statement: string;
  appliesWhen: string;
  severity: 'required' | 'recommended' | 'warning';
  rationale?: string;
  evidence?: string;
};

type GameRulesKernel = {
  schemaVersion: 2;
  genres: string[];
  philosophies: string[];
  suitableFor: string;
  rules: GameRule[];
  tableGuidance: Array<{ table: string; purpose: string; fields: string[] }>;
};
```

Existing string limits, unique IDs, maximum rule/table counts, and serialized
64 KiB size limits remain unchanged. Unknown properties remain rejected.

`kind` is retained because it describes the form of a rule. `domain` describes
the gameplay surface it governs. A rule is therefore identifiable both by what
it does and where it applies, for example `action` + `constraint` for an action
cost precondition.

## Generation Contract

The generation prompt must:

1. request one strict JSON object with `document` and `rules`;
2. state that rules describe this game's runtime behavior rather than production
   or design-review guidance;
3. require a `domain` for every rule and enumerate the ten allowed domains;
4. require the eight always-applicable domains, with conditional coverage for
   space/time and randomness;
5. use source documents, table snapshots, pasted text, base systems, and
   reference games only as untrusted design facts;
6. preserve a base rule ID only when both its gameplay domain and meaning remain
   materially unchanged;
7. generate Simplified Chinese human-readable fields when the normalized request
   is Chinese, while preserving stable IDs in English;
8. ask for table guidance only when a structured Keco table is useful to model
   an in-game object, action, state, or content collection.

Example v2 rule:

```json
{
  "id": "attack-action-point-cost",
  "domain": "resource_cost",
  "kind": "constraint",
  "title": "Attack action-point cost",
  "statement": "A standard attack consumes one action point. An actor with no action points cannot begin the attack.",
  "appliesWhen": "An actor attempts a standard attack.",
  "severity": "required"
}
```

The JSON repair pass must retain these v2 requirements. One failed repair remains
a terminal validation failure, preserving the existing durable-job behavior.

## Consumers

### Versioning and diffs

Versions stay immutable and flattened. Diff identity stays `id`, while a
changed `domain` is a semantic conflict just like a changed `kind`. The version
editor and deterministic Markdown projection group rules by domain first, then
by kind within a domain.

### Agent policy

The Agent continues to receive only validated, bounded, untrusted declarative
rule data. For v2 it receives `domain` together with the existing safe fields;
it must use the rules as game facts when discussing, generating, or reviewing
game content. Rule text cannot alter agent identity, permissions, tooling,
confirmations, authorization, or secret handling.

### GDD generation

GDD generation consumes the same bound v2 version and translates its gameplay
facts into GDD sections and production tables. It must not reinterpret a v2
rule as an instruction about the production process. `tableGuidance` is treated
as a recommendation for game-data tables, not as a required generic production
table.

## Compatibility and Migration

Existing persisted v1 versions are not rewritten. Runtime parsing supports both
schema versions:

- **v1:** historical design-policy rule set; readable, diffable, and usable by
  existing bound projects.
- **v2:** Game Rules Kernel; required for all newly generated or manually saved
  versions after rollout.

New v2 versions cannot silently inherit a v1 rule ID. A v1-to-v2 conversion must
either assign a new v2 rule ID or require an explicit user-authored rewrite,
because the semantic meaning has changed. Existing v1 systems show a legacy
notice in the editor and can be upgraded by saving a new v2 version.

## Error Handling

- Reject a v2 payload with an unknown `domain`, duplicate ID, missing mandatory
  field, unknown property, missing always-applicable domain, or oversized JSON.
- Reject incompatible base inheritance when a preserved ID changes `domain` or
  `kind`.
- Return actionable field-level errors from manual editing.
- Treat malformed model output as a generation validation error, issue one
  repair request, then fail the job if repair remains invalid.

## Testing and Acceptance Criteria

1. Schema tests parse valid v1 and v2 payloads and reject unknown domains.
2. Schema tests reject v2 outputs that omit an always-applicable domain.
3. Generator tests assert the prompt prohibits production-process rules and
   requires all ten gameplay domains with the conditional coverage rule.
4. Generator tests assert a v2 repair prompt repeats the domain requirements.
5. Diff tests identify a change to `domain` as a conflict.
6. Markdown and editor tests render v2 rules grouped by domain and preserve v1
   legacy rendering.
7. Agent-policy tests include `domain`, retain severity-priority budgeting, and
   preserve untrusted-data safeguards.
8. GDD tests confirm v2 action, state, cost, and resolution rules appear as game
   content rather than process guidance.
9. Existing v1 bound systems remain readable and their current workflows do not
   fail because of the rollout.

## Explicit Non-Goals

- This work does not build a runtime game engine or execute Rules directly.
- This work does not auto-convert legacy v1 rules into assumed gameplay facts.
- This work does not require every game to use random or spatial mechanics.
- This work does not replace Art Style, documents, maps, or GDD generation.
