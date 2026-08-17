# Game Design System UI Redesign

**Date:** 2026-08-17
**Status:** Approved for implementation
**Scope:** Redesign the existing Game Design System manager and creation experience without changing the canonical rule, version, job, or project-binding semantics.

## Product Intent

The Game Design System surface is a dense authoring and governance tool for game designers. It must feel like a quiet operational workspace, not a marketing page or a collection of unrelated cards.

The redesign keeps Keco's global shell and tool rail. Inside that shell it establishes three stable levels:

1. The Keco tool rail switches products.
2. The Game Design System library switches systems and scope.
3. The system workspace switches views for the selected system.

Workspace view changes are local React state changes. They do not navigate to another route. Creating a system also renders inside the Game Design System workspace rather than navigating to a separate page.

## Design Direction

- Design variance: 4
- Motion intensity: 2
- Visual density: 7
- Foundation: the existing Ant Design dependency and Keco shell
- Palette: Keco neutral surfaces with the existing blue primary accent
- Shape: 6-8px controls and panels; pills only for compact tags
- Typography: existing product typography, compact headings, no hero-scale text

## Information Architecture

### Global Tool Rail

The existing Keco tool buttons remain visible. The Game Design System button stays selected while this surface is active. The redesign must not duplicate, replace, or remove the global rail.

### System Library

The persistent library contains:

- title and icon-only Create action;
- search;
- My Systems and Official scope controls;
- systems visible in the selected scope;
- selected-system state;
- loading, empty, and local retry states.

My Systems uses the current authenticated user's real systems. Official remains visible but empty until official systems are deliberately designed and published. No official examples, cards, counts, or descriptions may be fabricated.

### System Workspace

The selected system header contains:

- title;
- real genres, philosophies, status, and current version;
- contextual actions;
- Overview, Rules, Versions, Sources, and Projects views.

Changing views only replaces the content below the stable header.

## Views

### Overview

Overview shows only values available from the selected system and its readable versions:

- current rule count;
- readable version count;
- current source snapshot count;
- suitable-for text;
- rule-kind breakdown;
- status, content hash, and migration status.

There is no activity feed until a real event source exists. There are no fabricated compliance scores or usage counts.

### Rules

Rules use a three-column desktop workbench:

1. rule outline grouped by kind;
2. selected rule content or form;
3. version and change context.

The default state is read-only. New version starts a local edit session from one readable parent version. The editor exposes every canonical rule field:

- ID;
- kind;
- title;
- statement;
- appliesWhen;
- severity;
- rationale;
- evidence.

It also exposes rule-set genres, philosophies, suitableFor, and table guidance in a separate system-settings section. Adding, editing, deleting, and reordering update one local rule-set draft. No server version is created until the user reviews the complete diff and confirms Create version.

Leaving an edit session with changes requires confirmation. The UI must never imply autosave because no persistent draft API exists.

### Versions

Versions render the real immutable version history. Selecting versions reveals:

- parent;
- added, removed, and changed rule IDs;
- conflicts;
- creator and creation time;
- content hash.

Comparison is local and deterministic using the version payloads already returned by the service. A version with conflicts cannot be applied.

### Sources

Sources render source_snapshots from the selected version. Source content is immutable in this view. Labels, hashes, byte counts, timestamps, resource kinds, and truncation state use the existing redacted server response. The UI never attempts to recover redacted excerpts.

### Projects

Projects show real projects the current user can access and each project's current Game Design System binding. Owners and admins can apply, replace, or remove the selected version. Other roles receive read-only state.

The existing project list and per-project binding endpoints provide the data. The client may aggregate binding requests with bounded parallel queries; the redesign does not introduce invented binding rows.

## Create Flow

Create renders in the existing workspace and preserves the global rail and system library. It uses three local stages:

1. Foundation: title, suitable-for text, description, genres, and philosophies.
2. Sources: project resource picker, owned or official base system selector, reference games, and pasted Markdown.
3. Review: normalized input summary and the real output contract.

Only the active stage is rendered. Validation errors stay with the relevant field and move the user back to that stage. Submitting uses the existing idempotent generation-job API.

After submission the workspace renders the real queued, running, failed, or completed job state. Polling, retry timing, and selection of the generated system retain the existing behavior. Leaving the progress view does not cancel the durable job.

## Data Rules

- All visible systems come from the existing list API.
- All rules, metadata, versions, diffs, conflicts, and source snapshots come from the selected detail response.
- All project names and bindings come from project and binding APIs.
- Generation states come from the generation-job response.
- Counts are derived from loaded real arrays.
- Missing data produces an empty or unavailable state.
- The UI contains no production fixtures, sample official systems, fake activity, fake scores, or fake project usage.

## Component Boundaries

- GameDesignSystemsPage: query ownership and top-level workspace mode.
- GameDesignSystemLibrary: scope, search, selection, and library states.
- GameDesignSystemHeader: selected-system identity and contextual commands.
- GameDesignSystemViewTabs: local workspace view selection.
- GameDesignSystemOverview: derived current-version summary.
- GameDesignSystemRulesWorkspace: rule outline, rule form, and draft changes.
- GameDesignSystemVersionsView: history and deterministic comparison.
- GameDesignSystemSourcesView: immutable snapshot list.
- GameDesignSystemProjectsView: real binding aggregation and mutation.
- GameDesignSystemCreateWorkspace: staged create input.
- GameDesignSystemGenerationProgress: durable job state.

The current large page components are split only along these ownership boundaries. Shared product-shell components remain unchanged.

## Responsive Behavior

Desktop uses the persistent global rail, persistent system library, and selected view.

Below 900px:

- the Keco global rail remains;
- the system library becomes a temporary drawer opened from the workspace header;
- system view tabs scroll horizontally;
- Rules replaces its rule outline with a selector;
- rule context opens below the rule form;
- forms collapse to one column;
- actions wrap without hiding commands.

No feature disappears on mobile.

## States and Accessibility

- Loading skeletons match the library and active-view geometry.
- Empty states explain the next valid action.
- Errors are local to the failed region and provide a Retry command.
- Destructive actions require confirmation.
- Tabs use tab semantics and keyboard navigation.
- The library and rule outline expose selected state.
- Every icon-only command has an accessible name and tooltip.
- Focus remains in the active workspace after a view or stage change.
- Text and control contrast meet WCAG AA.

## Testing

- React tests select scopes, systems, views, rules, create stages, and error states through rendered controls.
- Rules tests verify a draft does not create a version until confirmation.
- Create tests verify the generated request contains only selected real resources.
- Official tests assert an empty state when no official systems exist.
- Projects tests use real project and binding API responses and enforce role-gated mutations.
- Existing route and service tests remain authoritative for authorization and immutable-version behavior.
- Playwright covers desktop and mobile layout, horizontal overflow, view switching, creation, generation progress, rule editing, version creation, and project binding.

## Non-Goals

- Designing or seeding official presets.
- Adding automatic compliance scoring.
- Changing canonical rule or version semantics.
- Adding live multi-user rule editing.
- Adding a second component library.
