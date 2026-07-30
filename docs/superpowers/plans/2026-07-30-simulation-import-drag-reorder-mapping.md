# Simulation Import Drag-Reorder Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ImportScreen wire mapping with row-aligned slots + drag-to-remap and a bottom unmapped pool.

**Architecture:** Pure layout/drag helpers in `src/lib/simulation/mappingLayout.ts`; `ImportScreen` derives slots from `FieldMapping` + `SIM_FIELDS`, drops wires/ports, and applies drag results via the helpers.

**Tech Stack:** React, TypeScript, Jest (no new DnD library).

## Global Constraints

- English-only source (CI CJK check)
- Keep `FieldMapping` shape and LLM API unchanged
- Do not add `cls` to `SIM_FIELDS.characters`
- Native pointer drag only

---

### Task 1: Pure mapping layout helpers

**Files:**
- Create: `src/lib/simulation/mappingLayout.ts`
- Create: `tests/unit/simulation/mapping-layout.test.ts`

- [x] Write failing tests for `buildMappingLayout`, `applyMappingDrag`, `slotMappingStatus`
- [x] Implement helpers until green

### Task 2: ImportScreen drag-reorder UI

**Files:**
- Modify: `src/components/simulation/workbench/ImportScreen.tsx`
- Modify: `tests/unit/simulation/workbench-flow.test.tsx` (copy / wire assertions)

- [x] Remove Port, bezier, wire SVG, port-based drag
- [x] Render left slots aligned to `SIM_FIELDS`, Unmapped pool at bottom
- [x] Pointer drag between slots / unmapped; call `applyMappingDrag` + `mapField`/`setMappings`
- [x] Status icons; update helper copy
- [x] Update flow static tests; run unit tests green
