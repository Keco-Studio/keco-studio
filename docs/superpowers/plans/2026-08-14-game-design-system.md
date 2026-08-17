# Game Design System Implementation Plan (Superseded)

> **Superseded on 2026-08-14 by** `specs/032-game-design-rule-system/spec.md` and
> `docs/superpowers/plans/2026-08-14-game-design-rule-system.md`. This Markdown-first
> MVP plan is retained only as historical context and must not be used to assess the
> current implementation. The status labels below describe the discarded prototype.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add a reusable Game Design System registry with Open Design-style browsing, DeepSeek generation, Markdown detail/editing, and one active project binding.

**Architecture:** Supabase stores official/user systems, generation jobs, and the project binding. Next.js API routes enforce auth and ownership. A small pure core module owns input normalization, prompt construction, Markdown fallback, and required-section validation. The dashboard gets a new left-rail route and a self-contained manager/create UI using existing React Query and CSS module conventions.

**Tech Stack:** Next.js 16, React 19, Supabase, React Query, Jest, existing OpenAI-compatible `completeLlm` client.

## Task 1: Core contract and tests

**Historical status: Superseded**

Files: `src/lib/gameDesignSystem.ts`, `src/lib/gameDesignSystem.test.ts`

- Implement input normalization, provenance serialization, required section list, Markdown fallback, prompt construction, and section validation.
- Keep DeepSeek output Markdown-only and include all reference context.
- Run the focused Jest test before and after implementation.

## Task 2: Database schema and data services

**Historical status: Superseded**

Files: latest migration under `supabase/migrations/`, `src/lib/services/gameDesignSystemService.ts`, service tests.

- Add `game_design_systems`, `project_game_design_systems`, and `game_design_system_generation_jobs` with RLS.
- Seed a small official catalog, including an Ant-inspired tactical system.
- Add typed list/detail/copy/update/bind/job helper functions.
- Ensure project binding is one-row-per-project and replacement is atomic.

## Task 3: API routes

**Historical status: Superseded**

Files: `src/app/api/game-design-systems/**`, `src/app/api/projects/[projectId]/game-design-system/route.ts`, API tests.

- Add list/detail/create/update/copy/delete routes.
- Add generation job create/status routes. The worker updates phase, calls DeepSeek, validates/repairs Markdown once, then persists a user draft.
- Add project binding GET/PUT/DELETE routes using project access checks.
- Keep official rows read-only and preserve failed job input.

## Task 4: Navigation and manager UI

**Historical status: Superseded**

Files: `src/lib/create-map/productNavigation.ts`, `src/components/layout/LeftNav.tsx`, `src/components/layout/LeftNav.module.css`, `src/components/layout/DashboardLayout.tsx`, route/page components.

- Replace the unused rail button with Game Design System navigation.
- Hide the project resource sidebar and chat on the global manager route while keeping the product rail.
- Build the manager with source tabs, search, list/detail split, Markdown rendering, owner actions, and empty/loading/error states.

## Task 5: Create/generation/apply UI

**Historical status: Superseded**

Files: create page/components/styles, query key additions, project binding client helpers.

- Build the reference form with genres, philosophies, description, base system, pasted Markdown, project resource references, and reference games.
- Poll generation jobs with visible phases and retry.
- Show generated detail and allow copy/edit.
- Provide a project selector and atomic apply/clear feedback.

## Task 6: Agent context integration and verification

**Historical status: Superseded**

Files: `src/lib/agent/prompts.ts` or context assembly owner, focused tests.

- Include the active project's Markdown system in Agent context for GDD/system/table tasks without changing unrelated tool behavior.
- Run focused Jest, API tests, typecheck, lint, and a Playwright smoke flow when local Supabase is available.
