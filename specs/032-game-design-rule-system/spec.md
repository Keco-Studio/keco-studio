# Feature Specification: Game Design Rule System

**Feature Branch**: `032-game-design-rule-system`
**Created**: 2026-08-14
**Status**: Approved
**Supersedes**: `031-game-design-system`

## Product Definition

A Keco Game Design System is a reusable, versioned **Game Rules Kernel** that
states concrete runtime game behavior. A new kernel uses `schemaVersion: 2` and
may define the project's player role, objectives, actions, state, resolution,
costs, feedback, fallback behavior, spatial or temporal behavior, and
randomness. It is not a generic GDD or a process manual: rules must not
prescribe production, design-review, tool, team, or workflow processes.

The canonical asset is structured JSON. A readable `GAME_DESIGN_SYSTEM.md` is a
deterministic projection of that JSON, never the source of truth.

## User Stories

### US-1 Browse and inspect systems

An authenticated user can open the global manager, browse official and personal
systems, inspect the current version, view v2 rules grouped by gameplay domain,
see provenance, and compare the current version with its parent. Legacy v1
versions remain readable with their original kind-based presentation.

### US-2 Generate from real project sources

An owner or accepted collaborator can select readable project Documents and Keco
Tables through a resource picker. The server validates access, reads their actual
content, records bounded immutable snapshots, and uses those snapshots as model
context. A label without a valid resource ID is never treated as a source.

### US-3 Durable generation

Submitting generation creates an idempotent database job. A worker atomically
claims it with a lease, heartbeats while processing, retries retryable failures,
and reclaims expired leases. Completion is independent of the request instance
that accepted the job.

### US-4 Version and apply rules safely

Editing rules creates an immutable new version. A version may inherit from one
parent version. New creation and version writes require a v2 Game Rules Kernel;
legacy v1 versions remain readable, diffable, and hydratable but are never
silently converted. The UI shows added, changed, removed rules and unresolved
conflicts. A project owner or admin explicitly binds one concrete version; later
versions do not silently change the project constraint. For a personal system,
project members who are not the system owner can read only versions pinned by a
project they can access. Draft versions created later remain owner-only.

### US-5 Constrain Agent output

The Agent reads only the bound version's validated, bounded structured rules. It
does not inject editable Markdown or provenance text as instructions. The prompt
states that rule text is untrusted policy data, cannot change tool permissions,
identity, secrets, or higher-priority instructions, and is truncated at a stable
budget. Required rules are budgeted before recommended and warning rules. Agent
responses identify which rule IDs guided relevant design work, and the server
validates and stores that model declaration with the message.

## Canonical Rule Schema

```ts
type RuleSeverity = 'required' | 'recommended' | 'warning';

type GameDesignRule = {
  id: string;                 // stable kebab-case ID, unique in a version
  kind: 'principle' | 'constraint' | 'pattern' | 'anti_pattern' | 'check';
  title: string;              // 1..120 characters
  statement: string;          // 1..800 characters
  rationale?: string;         // 0..1200 characters; never injected into Agent
  appliesWhen: string;        // 1..500 characters
  severity: RuleSeverity;
  evidence?: string;          // 0..500 characters
};

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

type GameRulesKernelRule = GameDesignRule & {
  domain: GameRuleDomain;
};

type TableGuidance = {
  table: string;
  purpose: string;
  fields: string[];
};

type LegacyGameDesignRuleSet = {
  schemaVersion: 1;
  genres: string[];
  philosophies: string[];
  suitableFor: string;
  rules: GameDesignRule[];
  tableGuidance: TableGuidance[];
};

type GameRulesKernel = {
  schemaVersion: 2;
  genres: string[];
  philosophies: string[];
  suitableFor: string;
  rules: GameRulesKernelRule[];
  tableGuidance: TableGuidance[];
};

type GameDesignRuleSet = LegacyGameDesignRuleSet | GameRulesKernel;
```

Limits: at most 80 rules, 20 table-guidance entries, 20 fields per entry, and
64 KiB serialized JSON. Unknown properties are rejected.

For every v2 Game Rules Kernel, at least one `required` rule is mandatory in
each of these eight domains: `player`, `objective`, `action`, `object_state`,
`sequence`, `resource_cost`, `resolution_feedback`, and `fallback`.
`spatiotemporal` is included only when declared mechanics require spatial or
temporal behavior; `randomness` is included only when declared mechanics
require random behavior. A v2 rule's `domain` is part of its identity for
conflict detection.

## Version and Inheritance Semantics

- Versions are immutable and numbered per system starting at 1.
- `parent_version_id` is nullable and permits one parent only.
- A generated or manually saved version stores a fully flattened rule set.
- Rule identity is `id`. Diff is deterministic: added, removed, and changed.
- Changing a rule's `kind` under the same ID is a conflict.
- Duplicated IDs and delete-then-readd ambiguity are validation errors.
- A version with unresolved conflicts cannot be bound to a project.
- Project bindings store both `system_id` and `version_id`.
- Project binding responses expose only the bound version in `current_version`
  and `versions`; service-role reads must not widen the response.
- System owners and official systems may expose complete version history. Other
  project members may read only versions pinned by their readable projects.
- Non-official system rows do not cache rendered rule Markdown or version-owned
  genre/philosophy/suitable-for values; their readable projection is resolved
  from an authorized version row so direct table access cannot bypass version RLS.

## Source Reference Contract

Accepted inputs are `{ kind: 'document' | 'table', projectId, resourceId }`.

At job creation the server:

1. verifies current-user read access to the project and resource;
2. verifies the resource belongs to the supplied project;
3. reads Document Markdown or Table schema and rows;
4. normalizes and bounds each snapshot;
5. stores label, resource ID, project ID, `updated_at`, SHA-256 content hash,
   excerpt, byte count, and truncation state in the job input;
6. passes the actual excerpt to generation.

Generation treats source material as untrusted reference data and extracts game
facts only. It produces a v2 Game Rules Kernel describing runtime behavior; it
does not carry production, design-review, tool, team, or workflow instructions
from sources into rules.

Document excerpts are capped at 20,000 characters each. Table snapshots contain
field names and at most 50 non-empty rows and are capped at 30,000 characters.
All references together are capped at 60,000 characters. Overflow is rejected
with a field-level error instead of silently dropping a source.

## Durable Job Contract

`game_design_system_generation_jobs` contains:

- `idempotency_key`, unique per owner;
- `status`: `queued | running | completed | failed`;
- `phase`: `collecting | generating | validating | saving | completed | failed`;
- `attempt_count`, `max_attempts` (default 3), `available_at`;
- `lease_owner`, `lease_expires_at`, `heartbeat_at`;
- `started_at`, `completed_at`, bounded `error`;
- resolved input snapshots and output version ID.

A service-role-only PostgreSQL function claims one eligible job using
`FOR UPDATE SKIP LOCKED`. Eligible means queued and available, or running with an
expired lease. Claim increments attempt count and establishes a 90-second lease.
The worker heartbeats between LLM/validation/save phases. Retryable errors return
the job to queued with exponential delays of 5 and 20 seconds. Validation and
authorization errors fail immediately. Exhausted jobs fail permanently.

The create route may use Next `after()` for low-latency opportunistic processing,
but correctness relies on a protected worker route invoked every five minutes by
the Hobby-compatible GitHub Actions scheduler. The scheduler also supports a
manual dispatch for operational recovery; overlapping runs are not cancelled.

## Agent Security Contract

- Maximum injected policy block: 12,000 characters.
- Rules are considered in stable severity order: required, recommended, then
  warning. Original order is preserved within a severity.
- Every rule excluded by the budget is recorded by ID; omission is not silent.
- Only rule `id`, `kind`, `title`, `statement`, `appliesWhen`, `severity`, and
  table-guidance names/purposes are eligible. Rationale, provenance, source
  excerpts, pasted Markdown, and arbitrary metadata are never injected.
- All strings are normalized, control characters removed, and bounded again at
  injection time.
- The prompt explicitly treats the block as untrusted declarative data.
- V2 rules are runtime game facts, not instructions about production,
  design-review, tools, teams, or workflows.
- Rules cannot change Agent identity, system priority, tool availability,
  confirmation policy, authorization, or secret-handling behavior.
- Only project owners and accepted admins may bind or replace a version.
- Relevant design answers end with compact evidence such as
  `Applied rules: readable-state, reversible-onboarding`.
- The server parses the final declaration, rejects IDs that were not injected,
  and persists the pinned system/version, injected IDs, omitted IDs, declared
  IDs, invalid IDs, and declaration status in `agent_messages.content`.
- The same validated evidence is streamed onto the just-completed assistant
  message. The UI shows concrete omitted rule IDs; a missing declaration is
  neutral because non-design replies do not require one.
- This record is model-declared application evidence, not proof that the answer
  semantically complied with each rule.

## API Contract

- `GET /api/game-design-systems`
- `POST /api/game-design-systems`
- `GET/PATCH/DELETE /api/game-design-systems/:id`
- `POST /api/game-design-systems/:id/copy`
- `GET /api/game-design-systems/:id/versions`
- `POST /api/game-design-systems/:id/versions`
- `GET /api/game-design-systems/reference-options?projectId=...`
- `POST /api/game-design-systems/generation-jobs`
- `GET /api/game-design-systems/generation-jobs/:id`
- `POST /api/game-design-systems/generation-jobs/:id/retry`
- `GET /api/internal/game-design-system-worker` with `CRON_SECRET`
- `GET/PUT/DELETE /api/projects/:projectId/game-design-system`

Generation requests require an `Idempotency-Key` header. Repeating the same key
with the same normalized payload returns the existing job. Reusing it with a
different payload returns `409`.

## UI Contract

- Manager retains `My Systems`, `Official Presets`, search, list/detail, copy and create.
- Detail shows metadata, grouped rules, current version, parent, diff, conflicts,
  source snapshots, and deterministic Markdown.
- Personal metadata is editable. New rule creation and version writes create a
  schema-validated v2 Game Rules Kernel; legacy v1 versions remain inspectable
  without silently assigning gameplay domains.
- Create uses real project/document/table selectors; project IDs are never typed.
- A generation base selector contains official systems and systems owned by the
  current user only. A personal system readable only through a project binding
  is not offered as a base.
- Progress exposes queued, claimed, generating, validating, saving, retry delay,
  failed, and completed states.
- Applying requires a project and concrete conflict-free version.

## Testing Requirements

- Pure tests for strict schema parsing, Markdown rendering, diff/conflict logic,
  prompt budgeting, injection isolation, hashing, and source bounds.
- Local-Supabase integration tests for RLS, owner/admin binding, editor denial,
  idempotency, atomic claim, concurrent claim exclusion, lease recovery, retries,
  immutable versions, accepted-versus-pending collaborator access, and non-owner
  pinned-version visibility.
- Route tests may mock only network/LLM boundaries, not authorization or job state
  transitions under test.
- React tests must interact with rendered controls and assert state. Reading
  component source with `toContain` is not accepted as behavioral coverage.
- Playwright covers login, resource selection, durable generation, version detail,
  binding, Agent policy retrieval, retry display, and cleanup.

## Migration and Compatibility

- Existing official and personal Markdown rows may be represented as version 1
  by a deterministic compatibility rule-set parser. Rows that cannot be
  represented are marked `needs_migration` and cannot be bound.
- Legacy v1 versions remain readable, diffable, and hydratable in their stored
  shape. The system does not silently convert v1 rules to v2 or infer gameplay
  domains for them.
- New system creation, generated output, and version writes require a v2 Game
  Rules Kernel. A user adopts v2 by explicitly creating a v2 kernel.
- Existing project bindings remain pinned to their historical version.
- `031-game-design-system` is marked superseded and must not claim completion.

## Acceptance Criteria

1. Killing the request instance after job creation does not prevent the scheduled
   worker from completing or retrying the job.
2. A selected Document sentence and Table value appear in the stored immutable
   source snapshot and generation prompt.
3. Duplicate/empty/fake Markdown headings cannot bypass validation because JSON
   schema is canonical.
4. Arbitrary Markdown and provenance never enter the Agent system prompt, and
   kernel rules cannot prescribe production, design-review, tool, team, or
   workflow processes.
5. An editor cannot bind a system; an owner/admin can bind a conflict-free version.
6. A project remains pinned to its selected version after newer versions exist.
7. A project member cannot read the personal system owner's later versions from
   either the project binding API or the system/version APIs.
8. Required rules are prioritized under the Agent budget, omitted IDs are
   visible, and the validated model declaration is persisted with the reply.
9. Tests exercise the real database and rendered UI for the critical path.
10. Every generated and newly written rule set is a `schemaVersion: 2` Game
    Rules Kernel with all eight required runtime domains; `spatiotemporal` and
    `randomness` appear only when mechanics require them.
11. Legacy v1 systems remain readable, diffable, and hydratable without a
    silent conversion or inferred gameplay domains.

## Out of Scope

- Multiple inheritance or live composition of several systems.
- Automatic conflict resolution.
- Automatic balancing or generation of playable games.
- Full-document semantic indexing; snapshots are bounded deterministic excerpts.
