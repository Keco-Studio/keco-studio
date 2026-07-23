# Simulation Import Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-connect selected Studio tables and replace invalid curve-sequence blockers with dimension-aware errors and warnings.

**Architecture:** Extend canonical field definitions with aliases/types, produce mappings deterministically on table selection, and make the import adapter return blocking errors separately from non-blocking warnings. Add optional character/skill dimensions to curve rules with specific-first/shared-fallback lookup.

**Tech Stack:** React 19, TypeScript, Zod, Jest

---

### Task 1: Field contracts and automatic mapping

**Files:** `src/lib/simulation/types.ts`, `src/lib/simulation/data.ts`, `src/lib/simulation/SimulationProjectProvider.tsx`, `src/components/simulation/workbench/ImportScreen.tsx`, simulation tests.

- [ ] Add failing tests proving required fields, aliases/type compatibility, mapping replacement, and stale response isolation.
- [ ] Run focused tests and confirm failure.
- [ ] Add `aliases`/`valueTypes` metadata and return `valueType` from `loadFields`.
- [ ] Reset and auto-map immediately after each successful table selection.
- [ ] Run focused tests and confirm pass.

### Task 2: Dimension-aware curve import issues

**Files:** `src/lib/simulation/types.ts`, `src/lib/simulation/importAdapter.ts`, `tests/unit/simulation/importAdapter.test.ts`.

- [ ] Add failing tests where repeated/non-contiguous levels import successfully with warnings.
- [ ] Add failing tests for missing mappings, invalid types, and unresolved character/skill references.
- [ ] Add `warnings` to import results and parse optional `characterId` plus required `skillId`.
- [ ] Deduplicate composite curve keys in source order and emit warnings.
- [ ] Run adapter tests and confirm pass.

### Task 3: Runtime and persisted schema compatibility

**Files:** `src/lib/simulation/data.ts`, `src/lib/simulation/storage.ts`, `src/components/simulation/workbench/ProgressionScreen.tsx`, `src/components/simulation/workbench/BattleScreen.tsx`, `src/lib/simulation/sessionReducer.ts`, related tests.

- [ ] Add failing tests for specific-first/shared-fallback lookups and optional persisted dimensions.
- [ ] Update `needExp`/`skillCost`, progression callers, battle rewards, reducer limits, and Zod schemas.
- [ ] Run simulation tests, typecheck, and lint.

### Task 4: Warning presentation

**Files:** `src/components/simulation/workbench/ImportScreen.tsx`, `tests/unit/simulation/workbench-flow.test.tsx`.

- [ ] Add a failing UI contract test for `Imported with warnings`.
- [ ] Store warnings independently from errors and render them without disabling continuation.
- [ ] Run focused and full simulation verification.
