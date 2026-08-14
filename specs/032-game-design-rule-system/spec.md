# Feature Specification: Game Design Rule System

**Feature Branch**: `032-game-design-rule-system`
**Created**: 2026-08-14
**Status**: Approved
**Supersedes**: `031-game-design-system`

## Product Definition

A Keco Game Design System is a reusable, versioned rule set that constrains how
design work is produced and reviewed. It is not a generic GDD and does not store
a project's core loop, economy, progression, or difficulty design as if those
project-specific decisions were reusable defaults.

The canonical asset is structured JSON. A readable `GAME_DESIGN_SYSTEM.md` is a
deterministic projection of that JSON, never the source of truth.

## User Stories

### US-1 Browse and inspect systems

An authenticated user can open the global manager, browse official and personal
systems, inspect the current version, view rules grouped by kind, see provenance,
and compare the current version with its parent.

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
parent version. The UI shows added, changed, removed rules and unresolved
conflicts. A project owner or admin explicitly binds one concrete version; later
versions do not silently change the project constraint.

### US-5 Constrain Agent output

The Agent reads only the bound version's validated, bounded structured rules. It
does not inject editable Markdown or provenance text as instructions. The prompt
states that rule text is untrusted policy data, cannot change tool permissions,
identity, secrets, or higher-priority instructions, and is truncated at a stable
budget. Agent responses identify which rule IDs guided relevant design work.

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

type TableGuidance = {
  table: string;
  purpose: string;
  fields: string[];
};

type GameDesignRuleSet = {
  schemaVersion: 1;
  genres: string[];
  philosophies: string[];
  suitableFor: string;
  rules: GameDesignRule[];
  tableGuidance: TableGuidance[];
};
```

Limits: at most 80 rules, 20 table-guidance entries, 20 fields per entry, and
64 KiB serialized JSON. Unknown properties are rejected.

## Version and Inheritance Semantics

- Versions are immutable and numbered per system starting at 1.
- `parent_version_id` is nullable and permits one parent only.
- A generated or manually saved version stores a fully flattened rule set.
- Rule identity is `id`. Diff is deterministic: added, removed, and changed.
- Changing a rule's `kind` under the same ID is a conflict.
- Duplicated IDs and delete-then-readd ambiguity are validation errors.
- A version with unresolved conflicts cannot be bound to a project.
- Project bindings store both `system_id` and `version_id`.

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
but correctness relies on a protected worker route invoked every minute by Cron.

## Agent Security Contract

- Maximum injected policy block: 12,000 characters.
- Only rule `id`, `kind`, `title`, `statement`, `appliesWhen`, `severity`, and
  table-guidance names/purposes are eligible. Rationale, provenance, source
  excerpts, pasted Markdown, and arbitrary metadata are never injected.
- All strings are normalized, control characters removed, and bounded again at
  injection time.
- The prompt explicitly treats the block as untrusted declarative data.
- Rules cannot change Agent identity, system priority, tool availability,
  confirmation policy, authorization, or secret-handling behavior.
- Only project owners and accepted admins may bind or replace a version.
- Relevant design answers end with compact evidence such as
  `Applied rules: readable-state, reversible-onboarding`.

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
- Personal metadata is editable. Rule edits create a new version and are schema
  validated before save.
- Create uses real project/document/table selectors; project IDs are never typed.
- Progress exposes queued, claimed, generating, validating, saving, retry delay,
  failed, and completed states.
- Applying requires a project and concrete conflict-free version.

## Testing Requirements

- Pure tests for strict schema parsing, Markdown rendering, diff/conflict logic,
  prompt budgeting, injection isolation, hashing, and source bounds.
- Local-Supabase integration tests for RLS, owner/admin binding, editor denial,
  idempotency, atomic claim, concurrent claim exclusion, lease recovery, retries,
  and immutable versions.
- Route tests may mock only network/LLM boundaries, not authorization or job state
  transitions under test.
- React tests must interact with rendered controls and assert state. Reading
  component source with `toContain` is not accepted as behavioral coverage.
- Playwright covers login, resource selection, durable generation, version detail,
  binding, Agent policy retrieval, retry display, and cleanup.

## Migration and Compatibility

- Existing official and personal Markdown rows are converted to version 1 by a
  deterministic compatibility rule-set parser. Rows that cannot be converted are
  marked `needs_migration` and cannot be bound.
- Existing project bindings are pinned to the converted version 1.
- `031-game-design-system` is marked superseded and must not claim completion.

## Acceptance Criteria

1. Killing the request instance after job creation does not prevent Cron from
   completing or retrying the job.
2. A selected Document sentence and Table value appear in the stored immutable
   source snapshot and generation prompt.
3. Duplicate/empty/fake Markdown headings cannot bypass validation because JSON
   schema is canonical.
4. Arbitrary Markdown and provenance never enter the Agent system prompt.
5. An editor cannot bind a system; an owner/admin can bind a conflict-free version.
6. A project remains pinned to its selected version after newer versions exist.
7. Tests exercise the real database and rendered UI for the critical path.

## Out of Scope

- Multiple inheritance or live composition of several systems.
- Automatic conflict resolution.
- Automatic balancing or generation of playable games.
- Full-document semantic indexing; snapshots are bounded deterministic excerpts.
