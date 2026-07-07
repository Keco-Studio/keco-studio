# GitHub Issues 147-168 Remediation Spec

**Date**: 2026-07-08
**Status**: Draft approved for planning
**Scope**: Open GitHub issues #147, #148, #149, #154, #160, #162, #164, #166, and #168 in `keco-studio`.

## Goals

- Resolve the current open engineering-health, security, dependency, synchronization, and maintainability issues.
- Restore a reliable local validation chain before making high-risk behavioral changes.
- Remove exposed Supabase refresh/access tokens from browser-readable cookies.
- Consolidate data refresh behavior around React Query invalidation and Supabase Realtime instead of ad hoc data sync events.
- Replace the current Yjs hybrid usage with a clear online data flow unless a real Yjs provider is introduced later.
- Reduce the size and responsibility of `LibraryAssetsTable.tsx` and `LibraryDataContext.tsx` while keeping their public behavior stable.
- Prevent new Chinese-only developer comments and clean touched comments as files are changed.

## Non-Goals

- Do not build true offline collaborative editing in this remediation pass.
- Do not remove every UI coordination event from `window`; only data synchronization events are in scope.
- Do not enable full TypeScript `strict: true` across the whole repository in a single step if it creates unrelated churn.
- Do not redesign library table UI.
- Do not rewrite Supabase RLS or database schema beyond changes required by these issues.

## Issues Covered

- #162: Test infrastructure broken on clean checkout.
- #149: `src/proxy.ts` fails open on Supabase timeout and does not redirect unauthenticated users.
- #154: Refresh token in non-httpOnly cookie and competing Supabase auth clients/storage adapters.
- #164: Dependency risks including React/Next mismatch, vulnerable `xlsx`, production-only tooling packages, and stale dependencies.
- #148: Stricter TypeScript and no-new-`any` guardrails.
- #166: Replace data-sync CustomEvent bus with typed React Query invalidation.
- #160: Yjs is used without a provider and clobbers local IndexedDB edits.
- #147: Split large library table and data context modules.
- #168: Chinese-only developer comments violate the English-comments project rule.

## Current Context

The repository is clean on `main`. Recent commits already addressed part of #162: Jest now uses `jest.config.mjs`, includes `tests` and `src` roots, and no longer depends on `ts-node` for config parsing. A fresh audit still needs to verify the intended test, lint, typecheck, and build chain before deeper changes.

The data layer currently has overlapping mechanisms:

- React Query is present and has centralized query keys.
- Supabase Realtime is used in several areas.
- Data refreshes are also propagated through many `window.dispatchEvent(new CustomEvent(...))` calls.
- Yjs is used as a local reactive store without a network provider, and the current clear-and-repopulate flow can overwrite offline persisted state.

The auth layer currently has multiple client construction paths and custom browser storage adapters. `src/proxy.ts` writes Supabase session material to browser-readable cookies and allows requests through when auth checks fail or time out.

The dependency set includes packages called out by #164: React 18 under Next 16, `xlsx`, production `ngrok`, `node-fetch`, stale `@types/echarts`, and vulnerable transitive packages.

## Requirements

- User-facing final replies stay in Chinese.
- Code, comments, identifiers, and API names stay in English.
- Use TDD for behavior changes where a practical test surface exists.
- Preserve unrelated user changes.
- Keep commits scoped by issue or remediation batch.
- Prefer existing project patterns over new abstractions.
- Keep UI events that are clearly command/control events, such as topbar mode toggles, unless they are part of data cache synchronization.
- Every batch must end with a targeted verification command, and the final remediation must run the broadest practical validation chain.

## Remediation Order

### Batch 1: Verification Baseline (#162)

Confirm the current Jest setup on a clean checkout shape:

- No TypeScript Jest config requiring `ts-node`.
- No remaining Vitest imports in active test files.
- No dead `battleLogic` test references.
- Co-located parser tests under `src/lib/script-parser` are discovered by Jest.
- Add or confirm an explicit `typecheck` script using `tsc --noEmit`.
- Update `validate` so local validation includes lint, typecheck, unit tests, and build.

Target behavior:

- `npm run test:unit` discovers both `tests` and active `src/**/*.test.ts(x)` files.
- `npm run typecheck` has a stable command entry point.
- `npm run validate` represents the intended local gate.

### Batch 2: Auth And Proxy Security (#149, #154)

Refactor auth around one standard Supabase client path per environment:

- Server/client helpers should use `@supabase/ssr` cookie handling where appropriate.
- Browser-readable cookies must not contain refresh tokens or access tokens.
- `src/proxy.ts` must fail closed for protected routes when auth checks fail or time out.
- Unauthenticated dashboard page requests redirect to the login flow.
- Unauthenticated protected API requests return 401 JSON.
- Public routes, static assets, and auth routes remain reachable.
- Custom storage adapters are removed once no live client uses them.
- Service-role operations move behind server-only boundaries if touched by this work.

Target behavior:

- No `httpOnly: false` Supabase token cookie writes.
- No direct JS-readable `sb-session` or `sb-access-token` session material.
- One browser Supabase client construction path.
- One server Supabase client construction path.
- Protected route access has a centralized backstop.

### Batch 3: Dependency Risk Reduction (#164)

Upgrade and prune dependencies in controlled steps:

- Align React and React DOM with the Next 16 supported peer range.
- Remove `node-fetch` where no runtime import remains.
- Remove stale `@types/echarts`; ECharts ships its own types.
- Move `ngrok` from production dependencies to devDependencies if `dev:tunnel` remains.
- Replace `xlsx` usage with a maintained safer path. Prefer `exceljs` for import/export unless a better existing project dependency already covers the needed behavior.
- Run `npm audit` after changes and document any remaining no-fix advisories.

Target behavior:

- `npm ls react react-dom next` has no invalid peer dependency for React.
- `xlsx` is no longer imported by application code.
- Production dependencies no longer include dev-only tunnel tooling.
- Import/export still supports CSV and XLSX user workflows.

### Batch 4: Type Safety Guardrails (#148)

Introduce incremental type strictness without forcing a whole-repo strict migration:

- Add a lint rule that prevents new explicit `any` usage, with narrowly scoped ignores only for existing unavoidable legacy surfaces.
- Replace `catch (e: any)` with `unknown` plus safe message extraction in touched files.
- Start with high-density API route files and shared helpers touched by the remediation.
- Add typed row mapping for Supabase results where code is already being changed.

Target behavior:

- New explicit `any` is blocked by lint in the touched scope.
- Typecheck remains green.
- The implementation plan can split remaining legacy `any` cleanup into follow-up slices if full strict mode is too broad.

### Batch 5: Data Synchronization Architecture (#166)

Separate events into two categories:

- Data synchronization events: entity created/updated/deleted, cell value replacement, schema changes, and similar cache refresh signals.
- UI command events: topbar commands, page mode changes, keyboard shortcuts, modal open commands, and other local UI orchestration.

Migrate data synchronization events to a typed invalidation helper:

- Use existing React Query `queryKeys.ts`.
- Provide named invalidation functions for projects, folders, libraries, assets, schema, and library cell/value changes.
- Update mutation hooks and realtime handlers to call the helper instead of dispatching data-sync browser events.
- Delete `useRequestCache` only after all live consumers move to React Query or an existing cache.
- Leave UI command events in place unless a local prop/context path is straightforward and low risk.

Target behavior:

- Data refresh behavior is testable without the DOM event bus.
- No self-loop through `window` inside `LibraryDataContext`.
- Remaining `window` events are visibly UI command/control events, not cache invalidation.

### Batch 6: Yjs Simplification (#160)

Remove the misleading offline-editing behavior from the current library table data path:

- Stop clearing and repopulating Yjs documents as the authoritative load strategy.
- Remove or isolate the extra `asset-table-${id}`/`library-${id}` dual document path if it is only bridging local state.
- Replace claims of offline editing support with the actual online behavior.
- Use React Query data plus Supabase Realtime invalidation for library table state in this pass.
- Preserve user-visible table editing, formula updates, reference updates, and presence behavior where currently supported.

Target behavior:

- No code path promises offline editing without a provider.
- No unbounded Yjs IndexedDB growth caused by repeated clear-and-repopulate loads.
- Conflict behavior is explicit and online-only for this pass.

### Batch 7: Library Module Decomposition (#147)

Split large modules along existing local patterns:

- Move data fetching, mutation orchestration, realtime wiring, presence, formula recompute, and touched-at side effects out of `LibraryDataContext.tsx` into focused hooks/helpers.
- Move table toolbar state, section/field grouping, selection shortcuts, row/column actions, filters, and rendering subviews out of `LibraryAssetsTable.tsx` into focused hooks/components.
- Keep public component and context APIs stable until callers are migrated.
- Prefer one extraction at a time, with tests or at least typecheck/build after each meaningful slice.

Target behavior:

- Top-level files become composition surfaces rather than all-in-one implementations.
- Extracted units have clear names, dependencies, and boundaries.
- Existing library table workflows still work.

### Batch 8: English Developer Comments (#168)

Clean comments in files touched by earlier batches:

- Translate Chinese-only developer comments to English.
- Keep Chinese domain data, parser literals, regex examples, and fixture data that represent product data or language syntax.
- Add an audit check or focused grep if practical to prevent reintroducing Chinese-only comments in touched paths.

Target behavior:

- Touched files follow the English-comments rule.
- No user-facing Chinese copy or domain-specific Chinese test data is incorrectly translated.

## Testing And Verification

Batch-level verification:

- #162: targeted Jest discovery tests, `npm run test:unit`, `npm run typecheck`.
- #149/#154: unit tests for route protection classification and proxy fail-closed behavior where practical; static tests for no browser-readable token cookie writes.
- #164: import/export unit coverage for CSV/XLSX conversion behavior; `npm ls` checks for React peer validity; `npm audit` summary.
- #148: lint and typecheck confirm new guardrails.
- #166: unit tests for invalidation helper keys and affected mutation paths.
- #160: tests or static assertions around no offline/Yjs provider claims and removal of clear-repopulate paths.
- #147: typecheck/build plus focused tests for extracted pure helpers.
- #168: grep/audit for Chinese-only comments in touched code paths.

Final verification:

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run build`
- `npm audit --omit=dev`

## Risks And Mitigations

- React 19 migration can expose library incompatibilities. Mitigation: upgrade React in its own dependency batch and run build before deeper app changes continue.
- Auth consolidation can break login/session refresh. Mitigation: write tests for protected route decisions and keep SSR cookie helpers close to Supabase documented patterns.
- Replacing the event bus can miss an implicit listener. Mitigation: classify all event names before editing and migrate data events in narrow groups.
- Removing Yjs may affect table reactivity. Mitigation: preserve the visible context API while replacing internals with React state/query data first.
- Splitting large files can create churn. Mitigation: extract pure helpers and hooks without changing public behavior, then migrate callers incrementally.
- Enabling strict TypeScript globally can create unrelated failures. Mitigation: begin with guardrails and touched-path cleanup, not whole-repo strict mode.

## Acceptance Criteria

- All nine issues have a corresponding implemented batch or documented no-fix residual with rationale.
- Browser-readable Supabase token cookies are gone.
- Protected dashboard/API routes fail closed.
- React/Next peer dependencies are aligned.
- `xlsx` application imports are removed.
- Local validation has lint, typecheck, unit, and build entry points.
- Data sync no longer depends on ad hoc browser events for cache invalidation.
- Current Yjs usage no longer claims or clobbers offline editing state.
- Large library modules are materially decomposed with stable public behavior.
- Touched developer comments are English unless they are domain data.

## Self-Review

- No unresolved placeholders remain.
- The scope is intentionally split into independently verifiable batches because the full issue set spans testing, security, dependencies, architecture, and refactoring.
- UI command events are explicitly out of scope for the #166 data-sync migration to avoid conflating cache invalidation with local command dispatch.
- Full repository `strict: true` is not promised in one pass; the spec commits to incremental strictness and guardrails, matching the current `strict: false` baseline.
- The Yjs decision is explicit: simplify to online React Query plus Supabase Realtime now, and leave real offline CRDT collaboration for a separate future project.
