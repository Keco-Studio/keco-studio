# Implementation Plan: Playwright authentication and workspace state tests

**Branch**: `001-playwright-auth-tests` | **Date**: 2025-12-17 | **Spec**: `specs/001-playwright-auth-tests/spec.md`
**Input**: Feature specification from `/specs/001-playwright-auth-tests/spec.md`

## Summary

Implement Playwright end-to-end coverage for authentication (register/login) and dashboard states across seeded Supabase personas (empty, project-only, project+library), plus project/library create/delete flows with confirmation modals. Tests run against the Next.js App Router app on `http://localhost:3000`, using seeded users from `supabase/seed.sql` and transient, uniquely named entities for create/delete flows.

## Technical Context

**Language/Version**: TypeScript 5.9, Next.js 16 (App Router), React 19  
**Primary Dependencies**: `@playwright/test` 1.57, `@supabase/auth-helpers-nextjs`, `@supabase/supabase-js`, Ant Design, CSS modules  
**Storage**: Supabase PostgreSQL (local), seeded via `supabase/seed.sql`  
**Testing**: Playwright test runner (`npx playwright test`), Next lint/build for CI hygiene  
**Target Platform**: Web app (Next.js App Router) on Node 18+ / Linux  
**Project Type**: Web application (frontend; Supabase as managed backend)  
**Performance Goals**: Dashboard and auth pages load usable UI within 3s p95 during tests; interactions respond within 2s p95  
**Constraints**: Honor Supabase RLS, App Router server/client boundaries; keep dependencies minimal and typed (TS strict); confirmation modals for destructive actions  
**Scale/Scope**: Regression coverage for 3 seeded personas plus CRUD happy paths; small Playwright suite under `tests/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Pixel-Perfect Responsive Delivery: tests assert visible states, not pixels; no violation.  
- App Router & Supabase Integrity: respect RLS and auth flows; test data via UI/seeds only.  
- Typed Minimal & Documented Code: Playwright specs in TypeScript; avoid new deps unless required.  
- Resilient Async & Error Handling: assert error messaging for auth failures and network/validation feedback.  
- Simplicity & Single Responsibility: keep test helpers small and shared.

## Project Structure

### Documentation (this feature)

```text
specs/001-playwright-auth-tests/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/                         # Next.js App Router pages/layouts
├── components/                  # Shared UI (AuthForm, etc.)
└── styles/                      # CSS modules and variables

tests/
├── auth.spec.ts                 # Existing Playwright auth coverage
└── e2e/                         # New flows (dashboard states, CRUD)
```

**Structure Decision**: Web application with Playwright specs under `tests/`; reuse existing App Router + components; no backend folder (Supabase managed).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
