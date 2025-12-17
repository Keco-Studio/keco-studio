# Tasks: Playwright authentication and workspace state tests

**Input**: Design documents from `/specs/001-playwright-auth-tests/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: This feature is itself about Playwright tests; tasks include implementing and organizing these tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure local environment, Playwright, and seeds are ready.

- [ ] T001 Confirm Supabase local instance is seeded with `supabase/seed.sql` and seeded users are usable
- [ ] T002 Install Playwright browsers via `npx playwright install` in project root
- [x] T003 [P] Create `tests/e2e/` directory to hold new Playwright specs
- [x] T004 [P] Add npm script `"test:e2e": "playwright test"` to `package.json` if not already present

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared helpers and configuration required by all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 Create or update Playwright config (root `playwright.config.ts`) with `baseURL` set to `http://localhost:3000`
- [x] T006 [P] Add shared selector and helper utilities in `tests/e2e/utils/selectors.ts` for auth form, dashboard, projects, and libraries
- [x] T007 [P] Add helper functions for logging in seeded users in `tests/e2e/utils/auth-helpers.ts`
- [x] T008 Define test data generators (unique project/library names, unique emails) in `tests/e2e/utils/data-factories.ts`

**Checkpoint**: Foundational test infrastructure ready – user story-specific specs can now be implemented.

---

## Phase 3: User Story 1 – Authenticate existing accounts and show correct dashboards (Priority: P1) 🎯 MVP

**Goal**: Existing seeded users can log in and see dashboard UI that matches their account state (empty, project-only, project-with-library) with correct layout and error handling.

**Independent Test**: Run only the US1 spec; all three personas render correct dashboard content and auth errors display without touching registration or CRUD flows.

### Tests & Implementation for User Story 1

- [x] T009 [P] [US1] Create Playwright spec `tests/auth.spec.ts` (or extend) to cover seeded login success and failure cases
- [x] T010 [P] [US1] Implement test for empty account persona (`seed-empty@example.com`) asserting no projects and visible create-project empty-state in `tests/auth.spec.ts`
- [x] T011 [P] [US1] Implement test for project-only persona (`seed-project@example.com`) asserting exactly one project and zero libraries in `tests/auth.spec.ts`
- [x] T012 [P] [US1] Implement test for project-with-library persona (`seed-library@example.com`) asserting project plus at least one library in `tests/auth.spec.ts`
- [x] T013 [US1] Implement test for incorrect password showing visible error and staying on auth page in `tests/auth.spec.ts`
- [x] T014 [US1] Refine shared dashboard assertions into helpers in `tests/e2e/utils/dashboard-assertions.ts` to keep specs small

**Checkpoint**: With only US1 tasks complete, seeded logins and dashboard states are fully verified and independently testable.

---

## Phase 4: User Story 2 – Register a new user and onboard to an empty workspace (Priority: P2)

**Goal**: New visitors can register, become authenticated, and land on an empty dashboard that invites them to create their first project.

**Independent Test**: Run only the US2 spec; a freshly generated email can sign up and see the correct empty-state dashboard without depending on seeded personas.

### Tests & Implementation for User Story 2

- [x] T015 [P] [US2] Create Playwright spec `tests/e2e/register-onboarding.spec.ts` for registration and first dashboard load
- [x] T016 [P] [US2] Implement helper to generate unique registration email using timestamp in `tests/e2e/utils/data-factories.ts`
- [x] T017 [US2] Implement happy-path registration test asserting redirect to dashboard and empty-state CTA in `tests/e2e/register-onboarding.spec.ts`
- [x] T018 [US2] Implement tests for invalid registration inputs (e.g., missing fields, password mismatch) asserting inline error messages in `tests/e2e/register-onboarding.spec.ts`

**Checkpoint**: Registration-only flow is fully testable without involving project/library CRUD.

---

## Phase 5: User Story 3 – Manage projects and libraries from the dashboard (Priority: P3)

**Goal**: Authenticated users can create and delete projects and libraries from the dashboard with confirmation modals and immediate UI updates.

**Independent Test**: Run only the US3 spec; starting from a clean or seeded user, CRUD operations behave correctly and update the dashboard without affecting auth or registration behavior.

### Tests & Implementation for User Story 3

- [x] T019 [P] [US3] Create Playwright spec `tests/e2e/dashboard-crud.spec.ts` for project and library CRUD flows
- [x] T020 [P] [US3] Implement test that creates a new project from empty-state or “New Project” control and asserts project appears in sidebar list in `tests/e2e/dashboard-crud.spec.ts`
- [x] T021 [P] [US3] Implement test that creates a new library under a project and asserts library appears under that project in `tests/e2e/dashboard-crud.spec.ts`
- [x] T022 [US3] Implement test that deletes a library via confirmation dialog and asserts it is removed while project remains in `tests/e2e/dashboard-crud.spec.ts`
- [x] T023 [US3] Implement test that deletes a project via confirmation dialog and asserts it disappears; when last project is deleted, empty-state UI returns in `tests/e2e/dashboard-crud.spec.ts`
- [ ] T024 [US3] Add negative-path assertions for failed create/delete operations (e.g., visible error toast/message) if such states can be simulated in `tests/e2e/dashboard-crud.spec.ts`

**Checkpoint**: CRUD behavior is fully covered; combined with US1 and US2, the workspace lifecycle is regression-tested.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and long-term maintainability.

- [ ] T025 [P] Extract common login/registration/dashboard navigation helpers into `tests/e2e/utils/navigation.ts` and simplify specs
- [ ] T026 [P] Add README section pointing to `specs/001-playwright-auth-tests/quickstart.md` and documenting `npm run test:e2e`
- [ ] T027 Review selectors in all specs to favor data attributes (e.g., `data-testid`) where available to reduce brittleness
- [ ] T028 Run full Playwright suite in headed/debug mode to visually confirm UI flows

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies – can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion – blocks all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational phase completion.
  - User Story 1 (P1) should be implemented first as MVP.
  - User Stories 2 and 3 can follow in any order once US1 is stable.
- **Polish (Final Phase)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Setup + Foundational; no dependency on other stories.
- **User Story 2 (P2)**: Depends on Setup + Foundational; independent of US1/US3 behavior.
- **User Story 3 (P3)**: Depends on Setup + Foundational; may reuse helpers from US1/US2 but tests should remain independently runnable.

### Within Each User Story

- Shared helpers/utilities created in Phase 2 should be reused, not reimplemented.
- For each spec: write tests in failing state first, then refine selectors/helpers.
- Keep each spec focused on one story’s behavior to preserve independence.

### Parallel Opportunities

- All tasks marked [P] can be executed in parallel (different files, no blocking dependencies).
- After Phase 2, US1, US2, and US3 specs can be implemented in parallel by different contributors, provided shared helpers are stable.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1 spec updates and helpers.
4. Run only US1-related specs and validate login and dashboard states for seeded personas.

### Incremental Delivery

1. Add User Story 2 registration onboarding coverage and validate independently.
2. Add User Story 3 CRUD coverage and validate independently.
3. Use the Polish phase to consolidate helpers, selectors, and docs once behavior is stable.
