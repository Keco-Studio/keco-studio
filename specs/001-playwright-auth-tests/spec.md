# Feature Specification: Playwright authentication and workspace state tests

**Feature Branch**: `001-playwright-auth-tests`  
**Created**: 2025-12-17  
**Status**: Draft  
**Input**: User description: "现在我需要给项目使用playwright工具进行测试，包括注册/登录功能，及如果是一个空账号，进入页面应该有什么内容；如果是已经创建了一个project的账号，登录后页面应该是什么样的；如果是已经创建了一个project的账号并且创建了一个library的账号，登录后页面又应该是什么样的；"

## Clarifications

### Session 2025-12-17

- Q: How should project/library deletion be confirmed in the dashboard? → A: Use a confirmation modal with explicit confirm/cancel buttons.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Authenticate existing accounts and show correct dashboards (Priority: P1)

Users with existing accounts can sign in and immediately see the dashboard state that matches their data (empty account, project-only, project-with-library) without errors or missing UI.

**Why this priority**: Ensures core access and correctness for the three seeded personas used in regression testing.

**Independent Test**: Sign in with each seeded account and verify the dashboard content/state without creating new data.

**Acceptance Scenarios**:

1. **Given** the empty account, **When** the user signs in, **Then** the dashboard shows an empty-state prompt to create a project and no project cards appear.
2. **Given** the project-only account, **When** the user signs in, **Then** the dashboard lists the single project with no libraries, and shows UI to add a library.
3. **Given** the project-with-library account, **When** the user signs in, **Then** the dashboard lists the project and its library, with library-level actions available.
4. **Given** any seeded account, **When** sign-in fails due to wrong password, **Then** a clear error is shown and no session is created.
5. **Given** a successful sign-in, **When** the dashboard loads, **Then** primary UI elements (header/nav, project cards, create buttons) render without broken styles or missing text.

---

### User Story 2 - Register a new user and onboard to an empty workspace (Priority: P2)

New visitors can create an account, confirm successful authentication, and land on a clean empty dashboard that invites them to create their first project.

**Why this priority**: Covers first-time user acquisition and ensures the entry point to building content works.

**Independent Test**: Complete sign-up with a fresh email and verify the first-load dashboard shows only empty-state guidance and creation entry points.

**Acceptance Scenarios**:

1. **Given** a new email and valid credentials, **When** the user completes registration, **Then** they are authenticated and redirected to the dashboard.
2. **Given** a newly registered account, **When** the dashboard loads, **Then** no projects or libraries are listed and a create-project CTA is visible.
3. **Given** invalid registration inputs (e.g., weak password or duplicate email), **When** the user submits the form, **Then** inline errors explain what to fix without creating an account.

---

### User Story 3 - Manage projects and libraries from the dashboard (Priority: P3)

Authenticated users can create and delete projects and libraries from the dashboard, with UI updating immediately to reflect the changes.

**Why this priority**: Confirms core workspace CRUD paths and cleanup paths remain stable.

**Independent Test**: While signed in, perform create/delete actions for projects and libraries and verify the dashboard state updates without page reload requirements.

**Acceptance Scenarios**:

1. **Given** an authenticated user on the dashboard, **When** they create a project with a name/description, **Then** the project card appears in the list and is selectable.
2. **Given** a project without libraries, **When** the user creates a library under it, **Then** the library entry appears under the project and library actions become available.
3. **Given** a project with at least one library, **When** the user deletes that library, **Then** the library disappears and the project state reflects zero libraries.
4. **Given** a project card, **When** the user deletes the project with confirmation, **Then** the project is removed from the list and any contained libraries are no longer shown.

---

### Edge Cases

- Incorrect credentials or locked accounts show non-destructive error feedback and keep the user on the login page.
- Session expires mid-flow; subsequent authenticated actions redirect to login without data loss.
- Network/API failure during create/delete shows a recoverable error and leaves data unchanged.
- Deleting the only project or last library returns the dashboard to the correct empty-state UI.
- Creating entities with duplicate names surfaces validation feedback without creating duplicates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Authentication flow must allow existing users to sign in and reach the dashboard with UI elements matching their account state (empty/project/library).
- **FR-002**: Registration flow must create a new account, sign the user in, and land them on an empty-state dashboard that prompts project creation.
- **FR-003**: Login and registration forms must validate inputs and display actionable errors for invalid credentials, weak passwords, or duplicate emails without creating sessions.
- **FR-004**: Dashboard must render required UI sections (navigation, project list/cards, empty-state prompts, create buttons) without missing or broken elements after authentication.
- **FR-005**: Users must be able to create a project from the dashboard, supplying required fields, and see the new project immediately in the list.
- **FR-006**: Users must be able to create a library within a selected project and see it listed under that project without reloading.
- **FR-007**: Users must be able to delete a library and observe it removed from the project view, using a confirmation modal with explicit confirm/cancel buttons to avoid accidental loss.
- **FR-008**: Users must be able to delete a project (including its libraries) with a confirmation modal (explicit confirm/cancel), after which the project no longer appears and the dashboard state updates (including empty-state when no projects remain).
- **FR-009**: Error handling for failed create/delete operations must surface clear feedback and leave existing data unchanged.

### Key Entities *(include if feature involves data)*

- **Account state**: Represents a user profile with zero projects, projects only, or projects with libraries; drives dashboard rendering.
- **Project**: A workspace item owned by a user; has name/description and contains zero or more libraries.
- **Library**: A nested item under a project; listed within its parent project and supports creation and deletion from the dashboard.

### Dependencies & Assumptions

- Seed data provides three baseline personas (`seed-empty@example.com`, `seed-project@example.com`, `seed-library@example.com`) with known passwords for deterministic verification.
- Automated tests can create additional accounts without conflicting with seeded emails.
- Dashboard routes remain reachable after authentication without manual URL changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Existing users reach the correct dashboard state within 3 seconds of successful sign-in in 95% of runs.
- **SC-002**: New users complete registration and land on the dashboard within 5 seconds in 95% of runs.
- **SC-003**: Create/delete actions for projects or libraries reflect in the dashboard UI within 2 seconds in 95% of runs.
- **SC-004**: Authentication and dashboard flows show no unhandled errors or missing primary UI elements across all tested account states.
