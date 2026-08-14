# Feature Specification: Game Design System

**Feature Branch**: `031-game-design-system`
**Created**: 2026-08-14
**Status**: Superseded by `032-game-design-rule-system`
**Input**: User-approved MVP based on Open Design's Design System interaction

## User Scenarios & Testing

### User Story 1 - Browse Game Design Systems (Priority: P1)

As a game designer, I need a dedicated Game Design System surface so that I can
choose an official design approach or manage my own reusable systems.

**Independent Test**: An authenticated user can open the left product rail's
Game Design System entry and browse systems without opening a game project.

**Acceptance Scenarios**:

1. Given an authenticated user, when they select the Game Design System icon in
   the left rail, then the dedicated manager opens and the left rail marks the
   entry active.
2. Given systems from multiple sources, when the manager loads, then it groups
   them into `我的体系` and `官方预设` sections and shows title, summary, genre,
   philosophy, and source badges.
3. Given a search term, when the user enters it, then results are filtered by
   title, summary, genre, philosophy, and Markdown body.
4. Given no systems in a scope, then the manager shows an actionable empty state
   with `创建 Game Design System`.

### User Story 2 - Inspect and Apply a System (Priority: P1)

As a game designer, I need to inspect the complete system contract and apply it
to a project so that later GDD and table work follows the same rules.

**Independent Test**: A user can open a system, read its Markdown, and bind it
to a selected project; a subsequent project read returns that system as active.

**Acceptance Scenarios**:

1. Given a system row, when the user selects it, then the detail pane shows
   name, summary, genre tags, philosophy tags, source, core principles,
   anti-patterns, recommended Keco tables, and the full
   `GAME_DESIGN_SYSTEM.md`.
2. Given an official system, then `使用此体系` is available, while edit and
   delete controls are absent.
3. Given a user system, then `编辑`, `复制并修改`, and `删除` are available to
   its owner.
4. Given a project choice, when the user clicks `使用此体系`, then exactly one
   active system is stored for that project and the UI confirms the binding.
5. Given an existing project binding, when the user applies another system,
   then the previous binding is replaced atomically.

### User Story 3 - Create a Custom System from References (Priority: P1)

As a game designer, I need to provide structured and unstructured references so
that DeepSeek can produce a complete, reusable game design contract.

**Independent Test**: A user can submit the creation form with genre,
philosophy, and at least one meaningful input, observe generation progress, and
open the resulting editable system.

**Acceptance Scenarios**:

1. Given the creation form, then the user can select multiple genres and
   philosophies, add a natural-language description, choose a base system,
   paste an existing `GAME_DESIGN_SYSTEM.md`, add project GDD/doc/table
   references, and add reference games with explicit “参考什么 / 不参考什么”.
2. Given no genre, philosophy, or reference material, when the user submits,
   then validation prevents generation and identifies the missing input.
3. Given valid input, when the user starts generation, then the UI shows ordered
   phases: `整理参考`, `生成系统`, `检查结构`, `保存体系`.
4. Given a successful generation, then the result contains all eleven required
   Markdown sections and is saved as a personal draft.
5. Given a generation failure, then the UI preserves the input, shows a concise
   error, and offers retry without creating a duplicate system.

### User Story 4 - Edit and Reuse Personal Systems (Priority: P2)

As a game designer, I need to edit or copy my system without changing official
content so that I can evolve a project-specific design language.

**Acceptance Scenarios**:

1. Given a personal draft, when the user edits metadata or Markdown and saves,
   then the latest values appear in the list and detail view.
2. Given any system, when the user selects `复制并修改`, then a new personal
   draft is created with copied content and provenance pointing to the source.
3. Given an official system, no mutation request can change the official row,
   even if a client manually calls the API.

## Functional Requirements

- **FR-001**: The left product rail MUST replace the unused final button with a
  Game Design System entry and route to `/game-design-systems`.
- **FR-002**: The manager MUST support `我的体系`, `官方预设`, search, and
  create actions; team systems remain a reserved source value but are not
  required in this MVP.
- **FR-003**: A system MUST store title, summary, genres, philosophies,
  suitable-for text, Markdown body, source, owner, provenance, and timestamps.
- **FR-004**: Official systems MUST be read-only and personal systems MUST be
  editable only by their owner.
- **FR-005**: The canonical body MUST be a readable and editable
  `GAME_DESIGN_SYSTEM.md` with these sections:
  `Design Intent & Player Fantasy`, `Core Loop`, `Decision Structure`,
  `Rules & System Boundaries`, `Progression & Economy`, `Content Model`,
  `Difficulty & Balance`, `Experience & Presentation`, `Design Principles`,
  `Anti-patterns`, and `Keco Table Guidance`.
- **FR-006**: Creation MUST retain source references as structured provenance;
  references are context only and do not automatically create Keco tables.
- **FR-007**: Generation MUST use the existing OpenAI-compatible LLM client with
  DeepSeek as the explicit model (`DEEPSEEK_MODEL` fallback to `LLM_MODEL`, then
  `deepseek-v4-flash`).
- **FR-008**: Generation MUST be represented by a durable job with status,
  phase, error, and output system id, and MUST be queryable for polling.
- **FR-009**: A project MUST have at most one active Game Design System binding;
  applying a system MUST replace the prior binding in one transaction.
- **FR-010**: Agent context assembly MUST be able to retrieve the active
  system's Markdown and provenance for GDD, system-design, and table tasks.
- **FR-011**: API routes MUST enforce authentication, project access for
  project-bound reads/writes, and owner-only mutations for personal systems.
- **FR-012**: The UI MUST implement loading, empty, validation, error, retry,
  and success states without losing user-entered references.

## Data Model

### `game_design_systems`

- `id uuid primary key`
- `owner_id uuid null` (`NULL` means official preset)
- `source text` in `official | user | team`
- `title text not null`
- `summary text`
- `genres text[] not null default '{}'`
- `philosophies text[] not null default '{}'`
- `suitable_for text`
- `body text not null`
- `provenance jsonb not null default '{}'`
- `status text` in `draft | published`, default `published` for official and
  `draft` for user rows
- `created_at`, `updated_at timestamptz`

### `project_game_design_systems`

- `project_id uuid primary key references projects(id) on delete cascade`
- `design_system_id uuid not null references game_design_systems(id) on delete restrict`
- `applied_by uuid not null references auth.users(id)`
- `created_at`, `updated_at timestamptz`

### `game_design_system_generation_jobs`

- `id uuid primary key`
- `owner_id uuid not null references auth.users(id)`
- `status text` in `queued | running | completed | failed`
- `phase text` in `collecting | generating | validating | saving | completed | failed`
- `input jsonb not null`
- `error text`
- `design_system_id uuid null references game_design_systems(id) on delete set null`
- `created_at`, `updated_at timestamptz`

## API Contract

- `GET /api/game-design-systems`: list official and caller-owned systems.
- `POST /api/game-design-systems`: create a personal draft from supplied body.
- `GET /api/game-design-systems/:id`: return metadata, provenance, and body.
- `PATCH /api/game-design-systems/:id`: owner-only metadata/body update.
- `POST /api/game-design-systems/:id/copy`: create an owner draft copy.
- `DELETE /api/game-design-systems/:id`: owner-only delete when unbound.
- `POST /api/game-design-systems/generation-jobs`: validate input and enqueue a
  DeepSeek generation job; return `202` with job id.
- `GET /api/game-design-systems/generation-jobs/:id`: return job status and
  output id when complete.
- `GET /api/projects/:projectId/game-design-system`: return the active binding.
- `PUT /api/projects/:projectId/game-design-system`: replace the active binding.
- `DELETE /api/projects/:projectId/game-design-system`: clear the binding.

## Generation Contract

The worker uses the existing OpenAI-compatible client and a dedicated system
prompt. The user prompt contains normalized genres, philosophies, description,
base system body, pasted Markdown, project references, and reference-game
constraints. DeepSeek MUST return only Markdown. The worker validates the eleven
required H2 sections; on a missing section it performs one repair pass before
failing. If the model still fails validation, the job is marked failed and no
partial system is persisted.

## UI Flow

1. Left rail Game Design System icon → `/game-design-systems`.
2. Manager header: title, search, `创建 Game Design System`.
3. Scope tabs: `我的体系`, `官方预设`.
4. Two-column body: system list on the left; selected detail on the right.
5. Detail actions: `使用此体系`, `复制并修改`, and owner-only `编辑` / `删除`.
6. Create page: reference form, submit action, progress view, result detail.
7. Apply action: project selector → atomic binding → success state.

## Error Handling

- Invalid input returns `400` with field-level messages.
- Unauthenticated requests return `401`; unauthorized project/system access
  returns `403`.
- Missing system returns `404`.
- DeepSeek/network/validation failures mark the job `failed` with a bounded
  message and preserve the original input JSON.
- Duplicate submissions are prevented by an idempotency key on the generation
  request; retries create a new job only when explicitly requested.

## Testing Requirements

- Unit tests for input normalization, provenance serialization, Markdown
  template, required-section validation, and DeepSeek prompt construction.
- Route tests for owner isolation, official read-only behavior, project binding
  replacement, and generation job transitions.
- Component tests for scope filtering, empty/detail states, form validation,
  polling success/failure, and apply-to-project behavior.
- A focused Playwright flow covering left-rail entry → create → generated detail
  → apply to project.

## Out of Scope

- Team sharing and live multi-system composition.
- Strict schema validation beyond required Markdown headings.
- Automatic Keco table creation, balancing, playable game generation, or video/
  external-game analysis.
- Version merge UI; future revisions may add it after the MVP.

## Success Criteria

- A user can reach the manager from the left rail in one click.
- A user can select an official preset or create a personal system and read the
  complete Markdown contract.
- A successful DeepSeek run produces a saved editable draft with all required
  sections and visible provenance.
- Applying a system to a project changes the active binding atomically and the
  agent context can read the resulting Markdown.
