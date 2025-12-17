# Data Model – Playwright authentication and workspace state tests

## Entities

### Account Persona
- Fields: `email`, `password`, `username/meta`, `projects[]` (optional)
- States: empty (0 projects), project-only (>=1 project, 0 libraries), project-with-library (>=1 project with >=1 library)
- Notes: Seeds provide three deterministic personas; tests may create additional accounts via registration flow.

### Project
- Fields: `id`, `name`, `description`, `owner_id`, `libraries[]`
- Relationships: belongs to `Account Persona`; has many `Library`
- Validation (tests assert): name required; description optional; deletion requires confirmation modal; empty-state shown when none exist.

### Library
- Fields: `id`, `project_id`, `name`, `description`
- Relationships: belongs to `Project`
- Validation (tests assert): name required; deletion requires confirmation modal; creation UI present when project selected.

## State Transitions (covered by tests)
- Account registration → new empty dashboard state.
- Login existing persona → dashboard renders according to persona state.
- Create project → dashboard transitions from empty-state to listing project card.
- Create library → project transitions from zero to one-or-more libraries displayed.
- Delete library → project transitions back to zero libraries; empty hint reappears if applicable.
- Delete project → project removed from list; dashboard returns to empty-state if none remain.
