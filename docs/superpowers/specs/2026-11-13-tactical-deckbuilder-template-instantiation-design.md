# Tactical Deckbuilder Project Template Instantiation Design

**Date:** 2026-11-13

**Implementation note (2026-11-14):** Version 1 currently instantiates the project structure, linked tables, GDD, and GDS without bundled images. The asset descriptor and upload pipeline remain in place so image and character resources can be added later without changing the template flow.

## Goal

Turn the existing `tactical-deckbuilder` project-template card into the first real starter project. A user who selects it and creates a project receives a small, coherent dark-fantasy deckbuilder example that can be browsed and edited immediately: folders, linked tables with sample rows, a bound Game Design System, and an editable GDD document. Image and character resources are a reserved follow-up extension.

The user-entered project name and description remain authoritative. “Ashfall Tactics” is the sample setting embodied by the starter content, not a replacement for the user’s project name.

## Delivery Boundary

This delivery supports two available creation choices:

- `blank`: preserves the current lightweight project-creation behavior;
- `tactical-deckbuilder`: creates the complete starter described below.

The other five catalog cards remain visible but become disabled and display a `Coming soon` label. They must not silently create blank projects. A template card is available only when a matching server-side manifest exists.

Template marketplaces, user-authored templates, template editing, template upgrades after creation, and instantiation of the other catalog entries are out of scope.

## Chosen Architecture

Use a versioned, code-owned template manifest and a synchronous server-side instantiator.

The alternatives considered were cloning a curated database project and running a durable asynchronous provisioning job. A database source project would make authoring convenient but would create environment drift and fragile source-record dependencies. An asynchronous job would offer stronger long-running recovery but would add status UI, polling, leases, and operational machinery that one small starter does not need. The versioned manifest is deterministic, reviewable, testable, and can later be placed behind an asynchronous job without changing its content contract.

The manifest identity is:

```text
key: tactical-deckbuilder
version: 1
theme: Ashfall Tactics
```

The template catalog remains the UI-facing metadata source. A separate server-only registry maps an available key and version to a validated manifest. Server code rejects unknown, unavailable, or client-supplied versions rather than falling back to `blank`.

## Template Manifest Contract

The manifest is a typed server-only value validated before use. It contains:

- stable template key and integer version;
- project compatibility metadata;
- child folders identified by stable logical keys;
- tables, fields, rows, and logical cross-table references;
- one structured Game Design System payload and provenance;
- one Markdown GDD document;
- bundled asset descriptors with category, file path, and display name.

Manifest references use logical keys such as `table.cards`, `row.hero.warden`, or `asset.character.warden`; they never contain environment-specific UUIDs. Instantiation builds maps from logical keys to new database UUIDs and resolves every reference before values are inserted. Validation fails before project creation if keys are duplicated, references are missing, enums are invalid, bundled files do not exist, or the GDS payload does not pass the current structured rule schemas.

Template source files live under a focused `src/lib/project-templates` module. Bundled raster assets live under `public/project-templates/tactical-deckbuilder/v1` and are treated as immutable inputs for version 1. Changing starter content after release requires a new template version.

## Generated Project Structure

The existing `Resources Folder` remains the project’s default root folder. Instantiation creates these child folders beneath it:

| Folder | Contents |
| --- | --- |
| `Game Design` | Editable GDD document |
| `Cards & Combat` | Cards, Keywords, and Encounters tables |
| `Content` | Heroes, Enemies, and Rewards tables |

The project’s special Game Design System binding and Art Resource workspace remain first-class project features rather than fake folders.

### Tables and Example Data

The starter contains six editable tables:

| Table | Primary fields | Initial rows |
| --- | --- | --- |
| `Cards` | Type, Cost, Rarity, Rules Text, Damage, Block, Keywords | 12 cards covering attacks, skills, powers, and simple synergies |
| `Keywords` | Category, Description, Stacking Rule | 5 mechanics such as Burn, Guard, Mark, Exhaust, and Echo |
| `Heroes` | Archetype, Starting HP, Passive, Starting Deck, Art Resource Name | 2 heroes with different deck identities |
| `Enemies` | Role, Max HP, Intent Pattern, Traits, Art Resource Name | 4 enemies from basic to elite |
| `Encounters` | Act, Difficulty, Enemies, Reward Pool | 3 ordered encounters |
| `Rewards` | Reward Type, Rarity, Value, Candidate Cards | 4 reward definitions |

Fields use existing table data types (`string`, `string_array`, `int`, `boolean`, `enum`, and `reference`). Reference fields point to the actual new table IDs and store the actual new row IDs. `Art Resource Name` is a durable display-name link to the corresponding entry in Art Resource; private signed preview URLs are never stored in table cells. Row insertion order is stable and follows the manifest so the starter reads consistently.

The data is intentionally small. It demonstrates deck construction, keyword interaction, enemy intent, encounter composition, and reward progression without pretending to be a complete game.

## Game Design System and GDD

Instantiation creates a user-owned draft Game Design System through the existing structured GDS service. Its title is derived from the user’s project name, while its content describes the Ashfall tactical deckbuilder rules. It includes the current Game Rules Kernel, structured design document, rendered Markdown, dark-fantasy art direction, template provenance, and an initial version. The new current version is bound to the project through `project_game_design_systems`.

The GDS covers:

- short, readable combat turns;
- energy, draw, discard, exhaust, and reshuffle rules;
- telegraphed enemy intentions;
- meaningful attack, defense, and setup tradeoffs;
- compact deck growth and removal pressure;
- encounter and reward pacing; and
- visual readability requirements for cards, characters, icons, and status effects.

The `Game Design` folder receives an editable Markdown document named `<Project Name> GDD`. It contains game overview, player fantasy, core loop, combat flow, deckbuilding, characters and enemies, progression, encounter structure, UI/readability guidance, art direction, and a content-production checklist. It is starter authored content, not an AI generation job, and therefore does not create GDD job or resource-series records.

## Image and Character Resources

Version 1 bundles 15 original, production-safe raster examples: one project key image, three card images, five keyword icons, two hero portraits, and four enemy portraits. Assets are copied into the existing `project-assets` storage bucket under the owning user and new project path. They are registered in `project_game_assets`, counted against project storage, and exposed by the current Art Resource aggregation service. The assets use an original dark-fantasy visual direction and do not reproduce third-party game art or characters.

Hero and enemy images use the `character` category. They are deliberately registered as manual project assets rather than `character_assets`: the latter represents PixelLab generation and animation lifecycle records, which these bundled, already-complete files do not have. Card and keyword resources use the closest existing `media`, `ui`, or `icon` categories.

The instantiator computes and stores MIME type, byte size, SHA-256, dimensions, and transparency metadata. It reuses the existing storage reservation and completion rules so template creation cannot bypass quotas or accounting.

## Request and Data Flow

1. `NewProjectModal` keeps a stable submission request ID while a creation attempt is pending or being retried.
2. `blank` continues through the existing `create_project_with_foundation` path.
3. `tactical-deckbuilder` sends name, description, template key, and request ID to the authenticated project API.
4. The API resolves the current server-owned template version and claims an idempotency record scoped to the user and request ID.
5. The orchestrator creates the base project and default folder through the existing project RPC.
6. It creates child folders, tables, fields, rows, cross-table references, the GDD document, GDS and version, and the project GDS binding.
7. It enables the Art Resource workspace, uploads bundled assets through the quota-aware path, and registers asset records.
8. It verifies the resulting resource counts and bindings, marks the idempotency record complete, and returns the same `{ project, defaultFolderId }` shape used today.
9. The modal resets and follows the existing cache and navigation behavior only after success.

The API never accepts arbitrary manifest JSON or a template version from the browser.

## Idempotency and Failure Handling

A small `project_template_instantiations` table records owner, client request ID, template key/version, status, project ID, created GDS ID, timestamps, and a non-sensitive error code. `(owner_id, request_id)` is unique. It is server-managed and not directly writable by authenticated clients.

- A completed duplicate request returns its original project result.
- A concurrent duplicate receives a deterministic in-progress response rather than creating another project.
- A failed request can be retried with the same request ID after cleanup.

Database and object storage cannot share one transaction, so the feature provides user-visible atomicity with compensation. Any failure after base project creation invokes a service-role-only cleanup boundary that deletes the template-owned GDS and calls the existing project deletion and storage-cleanup-outbox flow. Project deletion cascades folders, tables, rows, documents, membership, bindings, and registered manual asset records; physical object deletion remains durable through the existing cleanup job rather than relying only on an in-request best effort. Cleanup outcomes are logged without exposing internal details to the browser. The idempotency row is retained as failed only after database cleanup is confirmed and any required storage cleanup job is recorded.

The UI keeps the selected template, name, and description after failure and shows a concise creation error. A project is never returned or navigated to until post-creation verification succeeds.

## Component Boundaries

- The template catalog owns display metadata and availability only.
- The server-only template registry owns manifest resolution and validation.
- The tactical deckbuilder manifest owns starter content but performs no I/O.
- The template instantiator owns orchestration, logical-ID resolution, verification, and compensation.
- Existing folder, document, table, GDS, storage quota, and game-asset services remain the data-access boundaries. Shared route-only upload logic is extracted into a reusable server service rather than duplicated.
- The project API authenticates, validates the request, maps domain failures to safe responses, and does not contain template content.
- `NewProjectModal` owns selection and submission state but does not know generated resource details.

This separation allows later templates to add manifests without adding branches to the modal or project API.

## Security and Operational Constraints

- The authenticated user must pass the existing project-creation authorization and quota checks.
- Only a server-resolved allowlisted manifest may run.
- Project, GDS, folders, tables, documents, and asset paths are always bound to the authenticated user and newly created project.
- Bundled file paths are normalized and confined to the versioned template asset directory.
- Client-visible errors do not include SQL, filesystem, storage, or internal manifest details.
- Template creation invokes no LLM, embedding, PixelLab, or other paid external generation service.
- Existing project creation rate and ownership constraints continue to apply.

## Testing

Unit tests cover manifest validation, duplicate logical keys, dangling row/table/asset references, unavailable template selection, stable template version resolution, and logical-to-database ID mapping.

Component and API tests verify:

- Blank and Tactical deckbuilder are available while the remaining cards are disabled and labeled `Coming soon`;
- the modal submits the template key and stable request ID without changing the user’s project name or description;
- unknown or unavailable keys are rejected rather than downgraded to blank;
- blank creation preserves its existing RPC behavior;
- duplicate completed submissions return the original project; and
- safe errors preserve the form state.

Local Supabase integration coverage creates a tactical project and asserts exact folder, table, field, row, reference, document, GDS version/binding, asset, storage-accounting, and provenance results. Fault injection at relational and storage stages verifies cleanup and successful retry. The primary Playwright flow selects Tactical deckbuilder, creates a project, and confirms representative resources in the sidebar, GDS view, GDD, tables, and Art Resource workspace. The test uses bundled files and requires no external AI credentials.

## Acceptance Criteria

- Selecting Tactical deckbuilder creates one complete, immediately browsable starter project with the agreed content.
- The user’s name and description are preserved exactly after current trimming and validation rules.
- All generated records belong to the new project or authenticated owner; cross-table references resolve to cloned rows.
- The project has one bound, editable GDS and one editable GDD document.
- Art Resource shows both general images and character-category resources with working previews.
- Repeating the same successful request does not create a second project.
- A failed attempt does not leave a user-visible partial project or unaccounted storage objects.
- Blank project creation remains behaviorally unchanged.
- Unimplemented templates cannot be selected as if they were functional.

## Out of Scope

- Instantiating Narrative adventure, Survival builder, Management simulation, Action roguelike, or Cooperative puzzle.
- Editing or publishing templates from the application.
- Updating projects created from an older template version.
- Sharing one template-generated GDS among multiple users or projects.
- Generating new art, character animation, embeddings, maps, or dialogue during project creation.
- A background provisioning screen or resumable asynchronous job pipeline.
