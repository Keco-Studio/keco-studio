# Keco Slice V2 Planning Detail Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce concrete inputs, outputs, parameter boundaries, module interfaces, exception behavior, state invariants, task dependencies, risks, and verification across every new or materially updated Keco Godot Slice V2 spec/plan pair.

**Architecture:** Keep `SlicePlan` JSON as the machine boundary and make paired Spec/Plan Markdown a parsed projection of it. A canonical contract manifest, templates, and conformance corpus are mirrored into Codex and Claude; Python, TypeScript/MCP, SQL, and cross-document validators consume the same field names and stable reason code. Historical documents and accepted runs remain readable and are neither migrated nor revalidated.

**Tech Stack:** Python 3 standard library validators, TypeScript 5.9 with Zod 4 in Deno MCP functions, PostgreSQL PL/pgSQL migration functions, Markdown tables/checklists, Jest unit tests, Deno tests, and the repository's existing Keco plugin mirror tests.

## Global Constraints

- Preserve `schemaVersion: 2` and `contractVersion: 2`; do not add a legacy compatibility branch for new V2 plans.
- `technicalContract` is strict and rejects unknown keys; all technical collections and IDs are non-empty and unique where specified.
- Required technical IDs are lower-case stable V2 identifiers; every technical row is referenced by a task or acceptance mapping.
- Inputs state `required` plus a concrete default or `none`; outputs state a concrete type, shape, and guarantee.
- Parameters state a numeric range, finite enum/set, or explicit unbounded rule plus boundary behavior.
- Interfaces state provider, consumer, operation/signature, and protocol/data contract; errors state condition, detection, response, and observable result; invariants state the preserved rule.
- Every acceptance row cites a valid source mapping and Eval ID; every Eval evaluation is cited by acceptance and served by a task.
- Every task owns at least one allowed file and declares exact `consumes`, `produces`, `verification`, `dependsOn`, source mappings, RED, GREEN, and review fields.
- Markdown and JSON values must match exactly for identity, source mappings, plan revision, allowed files, technical IDs, task fields, dependencies, Eval IDs, and verification references.
- Missing, malformed, or contradictory technical detail returns `SLICE_TECHNICAL_CONTRACT_INVALID`, leaves `writeToken` null, and performs zero document writes.
- Existing scope failures remain `SLICE_PLAN_SCOPE_INVALID`; Eval reciprocity failures remain `SLICE_EVAL_BINDING_INVALID`.
- Do not migrate, rewrite, or revalidate historical documents or already accepted runs.
- Codex and Claude copies of shared validators, references, templates, manifest, and corpus are byte-equivalent.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `contracts/keco-slice-v2/spec-template.md` | Canonical Spec Markdown template with technical-contract tables and acceptance mapping. |
| `contracts/keco-slice-v2/plan-template.md` | Canonical Plan Markdown template with strategy, dependencies, risks, constraints, task interfaces, RED/GREEN, verification, and delivery gates. |
| `plugins/keco-codex/skills/keco-godot-slice-preflight/references/spec-template.md` | Codex copy of the canonical Spec template. |
| `plugins/keco-codex/skills/keco-godot-slice-preflight/references/plan-template.md` | Codex copy of the canonical Plan template. |
| `plugins/keco-claude/skills/keco-godot-slice-preflight/references/spec-template.md` | Claude copy of the canonical Spec template. |
| `plugins/keco-claude/skills/keco-godot-slice-preflight/references/plan-template.md` | Claude copy of the canonical Plan template. |
| `plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/slice_contract.py` | Python `technicalContract` and task-field schema, ID references, and plan/Eval binding. |
| `plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/validate_plan.py` | Python CLI boundary flags and structured-plan diagnostics. |
| `plugins/keco-claude/scripts/slice_contract.py` | Byte-equivalent Claude Python contract implementation. |
| `plugins/keco-claude/scripts/validate_plan.py` | Byte-equivalent Claude Python CLI. |
| `plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/validate_slice_decomposition.py` | Parsed Markdown sections/tables/task blocks and cross-document consistency. |
| `plugins/keco-claude/scripts/validate_slice_decomposition.py` | Byte-equivalent Claude decomposition validator. |
| `supabase/functions/mcp/slice-v2-contract.ts` | TypeScript contract boundary and stable reason-code decisions. |
| `supabase/functions/mcp/slice-tools.ts` | Zod MCP input schemas for V2 plan and EvalSpec. |
| `contracts/keco-slice-v2/contract-manifest.json` | Canonical fields, limits, and `SLICE_TECHNICAL_CONTRACT_INVALID`. |
| `plugins/keco-codex/skills/keco-godot-slice-preflight/references/contract-manifest.json` | Codex manifest mirror. |
| `plugins/keco-claude/skills/keco-godot-slice-preflight/references/contract-manifest.json` | Claude manifest mirror. |
| `contracts/keco-slice-v2/conformance-cases.json` | Accepted/rejected cross-runtime cases for every new boundary. |
| `supabase/migrations/20260905100000_slice_v2_technical_contract.sql` | Database JSON shape and pre-write validation gate. |
| `supabase/functions/mcp/slice-v2-contract.test.ts` | Deno TypeScript corpus and schema tests. |
| `tests/unit/plugins/keco-godot-slice-v2.test.ts` | Python, mirror, template, and decomposition integration tests. |
| `tests/unit/plugins/keco-claude-plugin.test.ts` | Claude mirror and validator parity tests. |
| `tests/unit/database/deterministic-slice-runs.behavior.test.ts` | SQL conformance and zero-write behavior tests. |

## Dependency Graph

```text
task-001 -> task-002 -> task-003 -> task-004 -> task-005 -> task-006 -> task-007
```

## Risk Register

| riskId | impact | likelihood | trigger | mitigation | fallback |
| --- | --- | --- | --- | --- | --- |
| risk-schema-drift | high | medium | Python, Zod, SQL, or a mirror accepts a different key set | Drive all fields and limits from the manifest and run the same corpus at each boundary | Reject the bundle with `SLICE_TECHNICAL_CONTRACT_INVALID` until parity is restored |
| risk-markdown-parser-ambiguity | high | medium | tables, nested headings, or task blocks are parsed differently across valid documents | Require one heading per section, exact columns, stable IDs, and fixture tests for malformed nesting | Keep `writeToken` null and report the affected section ID |
| risk-legacy-regression | high | medium | old fixtures fail because the validator starts requiring new fields everywhere | Gate the stronger contract only in the new/materially updated V2 path and leave legacy readers unchanged | Preserve old read path and classify only new input as V2 technical-contract failure |
| risk-mirror-drift | medium | medium | Codex and Claude files differ after a fix | Add byte-equivalence checks for every shared file and copy from the canonical source | Block packaging until mirrors are synchronized |
| risk-partial-write | high | low | SQL validates part of a bundle before a later technical mismatch | Validate source, JSON, Markdown, and cross-document mappings before lease acquisition and document mutation | Roll back the transaction and return the first stable reason code |

## Execution Constraints

- Allowed files are exactly those listed in the File Map plus the new timestamped migration and focused test fixtures under `contracts/keco-slice-v2/`.
- Do not alter public V2 routing, SourceProfile kinds, Keco folder hierarchy, write-lease lifecycle, delivery order, runtime evidence, repair limits, or historical fixtures.
- Use the canonical field names from the Design Spec: `technicalContract.inputs`, `outputs`, `parameters`, `interfaces`, `errors`, `invariants`, `acceptance`; task fields `consumes`, `produces`, `verification`.
- Validate Markdown only after validating SourceProfile, SlicePlan, and EvalSpec; compare identity and mappings before any write lease or document mutation.
- Every task below consumes only outputs from earlier tasks and produces the named files/interfaces for later tasks.

## Task Checklist

### Task 001: Add Canonical Spec and Plan Templates

**Files:**
- Create: `contracts/keco-slice-v2/spec-template.md`
- Create: `contracts/keco-slice-v2/plan-template.md`
- Create: `plugins/keco-codex/skills/keco-godot-slice-preflight/references/spec-template.md`
- Create: `plugins/keco-codex/skills/keco-godot-slice-preflight/references/plan-template.md`
- Create: `plugins/keco-claude/skills/keco-godot-slice-preflight/references/spec-template.md`
- Create: `plugins/keco-claude/skills/keco-godot-slice-preflight/references/plan-template.md`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/SKILL.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-preflight/SKILL.md`
- Test: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Test: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: Design Spec sections `Spec Markdown Contract` and `Plan Markdown Contract`.
- Produces: six byte-equivalent template/reference files containing the exact headings and columns consumed by Task 003.

- [ ] **Step 1: Write the failing parity test**

```ts
for (const relative of ['spec-template.md', 'plan-template.md']) {
  const canonical = readFileSync(join(repositoryRoot, 'contracts/keco-slice-v2', relative));
  expect(readFileSync(join(codexPreflightReferences, relative))).toEqual(canonical);
  expect(readFileSync(join(claudePreflightReferences, relative))).toEqual(canonical);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts -t "template"`
Expected: FAIL because the six template files do not exist.

- [ ] **Step 3: Write the canonical templates and links**

`spec-template.md` must include, in order, `Slice Identity`, `Objective`, `Scope`, `Technical Contract`, `Inputs`, `Outputs`, `Parameters & Boundaries`, `Module Interfaces`, `Error & Exception Scenarios`, `State & Invariants`, `Acceptance Mapping`, and `Out of Scope`. Each table must use the exact ID and technical columns from the Design Spec and show concrete example values rather than empty cells.

`plan-template.md` must include `Implementation Strategy`, `Dependency Graph`, `Risk Register`, `Execution Constraints`, `Task Checklist`, and `Delivery Checklist`. Each task block must show `Files`, `Consumes`, `Produces`, `Depends on`, `Source mappings`, `Serves evaluations`, RED, GREEN, `Verification`, and `Review`. Use four-backtick outer fences where an example contains an inner fenced graph.

Add these references to both preflight `SKILL.md` files immediately after `slice-document-contract.md`:

```markdown
- [spec-template.md](references/spec-template.md)
- [plan-template.md](references/plan-template.md)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts -t "template"`
Expected: PASS with canonical/Codex/Claude bytes equal and every required heading present.

- [ ] **Step 5: Commit**

```bash
git add contracts/keco-slice-v2/spec-template.md contracts/keco-slice-v2/plan-template.md plugins/keco-codex/skills/keco-godot-slice-preflight plugins/keco-claude/skills/keco-godot-slice-preflight/SKILL.md tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "feat(slice): add technical planning templates"
```

### Task 002: Extend the Python SlicePlan Contract

**Files:**
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/slice_contract.py:_plan_eval`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/validate_plan.py:validate_v2_plan`
- Modify: `plugins/keco-claude/scripts/slice_contract.py:_plan_eval`
- Modify: `plugins/keco-claude/scripts/validate_plan.py:validate_v2_plan`
- Test: `tests/unit/plugins/keco-godot-slice-v2.test.ts`

**Interfaces:**
- Consumes: `plan`, `evalSpec`, and `sourceProfile` JSON; canonical manifest limits.
- Produces: `validate_contract_case("planEval", value)` returning `{accepted: boolean, reasonCode: string | null}` and the existing CLI's `--eval-spec`/`--source-profile` cross-checking for every new or materially updated V2 plan.

- [ ] **Step 1: Write failing corpus cases**

Add cases to `contracts/keco-slice-v2/conformance-cases.json` for a complete valid `technicalContract`, missing output shape, vague parameter boundary, duplicate technical ID, unknown task consumption, unowned technical row, task JSON/Markdown verification mismatch, and unknown Eval acceptance mapping. Every invalid technical case expects `SLICE_TECHNICAL_CONTRACT_INVALID`; existing scope/Eval cases keep their existing reason codes.

- [ ] **Step 2: Run Python corpus tests to verify failure**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts -t "conformance corpus"`
Expected: FAIL because `_plan_eval` currently rejects unknown `technicalContract` keys or does not enforce its fields.

- [ ] **Step 3: Implement the strict Python schema**

Add `_technical_contract(value: Any, task_ids: set[str], eval_ids: set[str]) -> bool` and make it return `True` only when the exact seven top-level collections are present, each row has the required concrete fields, all IDs are unique lower-case identifiers, every boundary matches the numeric/enum/set/unbounded grammar, and every task/acceptance reference resolves to a known ID. Add `_technical_failure() -> dict[str, Any]` returning `_decision(False, "SLICE_TECHNICAL_CONTRACT_INVALID")`; use it for every technical-contract rejection.

In `_plan_eval`, include `technicalContract` in the exact plan key set, validate it before reciprocal Eval mapping, collect all technical IDs, require each input/parameter/interface/invariant ID in at least one `tasks[].consumes` or `technicalContract.acceptance` mapping, and require each output/interface/error/invariant/acceptance ID in at least one `tasks[].produces` or acceptance mapping. Extend each task's exact key set with `consumes`, `produces`, and `verification`, where `verification` has non-empty `assertions` and `observationPaths` arrays. Return the technical reason code for only these new failures.

In `validate_plan.py`, pass the new artifact paths unchanged to `validate_v2_plan`, print the stable reason code on stderr, and require the technical contract whenever the input declares `schemaVersion: 2`; historical fixtures remain readable through their existing non-mutating readers rather than a bypass inside the V2 validator.

- [ ] **Step 4: Run Python tests to verify the contract**

Run: `python3 plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/validate_contract_case.py planEval /tmp/valid-technical-plan-eval.json`
Expected: `{"accepted": true, "reasonCode": null}`.

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts -t "conformance corpus|reciprocal V2"`
Expected: PASS for valid corpus cases and the exact reason code for each invalid case.

- [ ] **Step 5: Commit**

```bash
git add plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/slice_contract.py plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/validate_plan.py plugins/keco-claude/scripts/slice_contract.py plugins/keco-claude/scripts/validate_plan.py contracts/keco-slice-v2/conformance-cases.json tests/unit/plugins/keco-godot-slice-v2.test.ts
git commit -m "feat(slice): validate technical plan contract in Python"
```

### Task 003: Parse and Cross-Validate Spec/Plan Markdown

**Files:**
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/validate_slice_decomposition.py:sections, main`
- Modify: `plugins/keco-claude/scripts/validate_slice_decomposition.py:sections, main`
- Test: `tests/unit/plugins/keco-godot-slice-v2.test.ts`

**Interfaces:**
- Consumes: decomposition bundle JSON with `planJsonPath` and `sourceProfilePath`, paired Spec/Plan Markdown, and Task 002's Python JSON semantics.
- Produces: deterministic pre-write exit status and diagnostic for missing/duplicate/empty sections, malformed tables, mismatched technical IDs, task fields, files, dependencies, Eval IDs, and verification.

- [ ] **Step 1: Write failing Markdown fixtures**

Add fixtures for each required Spec section, each required Plan section, an empty table, a placeholder value, a parameter without a boundary, a task with a cyclic dependency, an unowned allowed file, a task whose `Produces` differs from JSON, an acceptance row without source/Eval mapping, and a bundle missing `planJsonPath` or `sourceProfilePath`.

- [ ] **Step 2: Run decomposition tests to verify failure**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts -t "decomposition"`
Expected: FAIL because the current parser only checks broad objective/scope/acceptance headings, files, and RED/GREEN lines.

- [ ] **Step 3: Implement exact Markdown parsing and comparison**

Add these bounded helpers:

```python
def parse_markdown_contract(markdown: str, *, kind: str) -> dict[str, object]:
    """Return normalized sections, tables, task blocks, and identity metadata."""

def compare_markdown_to_plan(spec: dict[str, object], plan: dict[str, object], plan_json: dict[str, object], source_profile: dict[str, object]) -> str | None:
    """Return the first stable failure message, or None when every field matches."""
```

Normalize heading case and punctuation only for lookup; reject duplicate headings. Require one non-empty table row per technical section with exact columns, concrete non-placeholder values, an explicit default for every input, and a range/enum/set/unbounded boundary. Parse each checkbox task into an object containing `id`, `files`, `consumes`, `produces`, `dependsOn`, `sourceMappings`, `servesEvaluations`, `red`, `green`, `verification`, and `review`. Compare arrays as ordered values to the JSON plan, reject cycles and forward dependencies, and ensure every allowed file is owned. Compare `sliceId`, source identity, `planRevision`, allowed files, technical IDs, acceptance source/Eval IDs, and every Eval ID against `planJsonPath` and `sourceProfilePath` before running normalized multi-Slice distinctness.

Update the CLI bundle schema to require `planJsonPath` and `sourceProfilePath` for V2. Keep `version: 1` and historical read-only fixtures intact; only newly supplied V2 pairs use the strict path.

- [ ] **Step 4: Run focused parser tests**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts -t "decomposition|Markdown|technical"`
Expected: PASS for a complete paired fixture; each missing section, malformed table, mismatch, dependency cycle, duplicate, or unowned file fails with a bounded diagnostic.

- [ ] **Step 5: Commit**

```bash
git add plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/validate_slice_decomposition.py plugins/keco-claude/scripts/validate_slice_decomposition.py tests/unit/plugins/keco-godot-slice-v2.test.ts
git commit -m "feat(slice): enforce Markdown plan decomposition contract"
```

### Task 004: Add TypeScript and MCP Zod Enforcement

**Files:**
- Modify: `supabase/functions/mcp/slice-v2-contract.ts:validatePlanEval`
- Modify: `supabase/functions/mcp/slice-tools.ts:v2PlanTaskSchema, v2PlanSchema`
- Test: `supabase/functions/mcp/slice-v2-contract.test.ts`
- Test: `supabase/functions/mcp/slice-tools.test.ts`

**Interfaces:**
- Consumes: canonical manifest/corpus and V2 plan/EvalSpec payloads.
- Produces: `validateSliceV2ContractCase("planEval", input)` parity with Python and strict MCP Zod parsing before `create_slice_bundle`.

- [ ] **Step 1: Write failing Deno tests**

Extend the corpus test's required IDs with all technical-contract cases and add a direct Zod parse test showing that a plan without `technicalContract`, with an unknown technical key, or with a task missing `verification` is rejected before the tool handler runs.

- [ ] **Step 2: Run Deno tests to verify failure**

Run: `npm run test:mcp -- --filter "technical|conformance"`
Expected: FAIL because the current V2 schemas omit `technicalContract`, `consumes`, `produces`, and `verification`.

- [ ] **Step 3: Implement strict Zod schemas and reason mapping**

Add schemas with exact shapes:

```ts
const technicalContractSchema = z.object({
  inputs: z.array(inputContractSchema).min(1).max(100),
  outputs: z.array(outputContractSchema).min(1).max(100),
  parameters: z.array(parameterContractSchema).min(1).max(100),
  interfaces: z.array(interfaceContractSchema).min(1).max(100),
  errors: z.array(errorContractSchema).min(1).max(100),
  invariants: z.array(invariantContractSchema).min(1).max(100),
  acceptance: z.array(acceptanceContractSchema).min(1).max(100),
}).strict();

const verificationSchema = z.object({
  assertions: z.array(z.string().trim().min(1)).min(1).max(100),
  observationPaths: z.array(jsonPointer).min(1).max(100),
}).strict();
```

Use `.superRefine` for unique IDs, concrete descriptions, boundary grammar, known task/Eval references, and bidirectional technical references. Extend `v2PlanTaskSchema` with `consumes`, `produces`, and `verification`, and `v2PlanSchema` with required `technicalContract`. Map technical failures to `SLICE_TECHNICAL_CONTRACT_INVALID` while retaining existing scope and Eval reason codes.

- [ ] **Step 4: Run TypeScript checks and tests**

Run: `npm run check:mcp`
Expected: PASS with no TypeScript errors.

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-v2-contract.test.ts supabase/functions/mcp/slice-tools.test.ts`
Expected: PASS with TypeScript and Python decisions equal for every corpus case.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/slice-v2-contract.ts supabase/functions/mcp/slice-tools.ts supabase/functions/mcp/slice-v2-contract.test.ts supabase/functions/mcp/slice-tools.test.ts
git commit -m "feat(mcp): enforce Slice technical contract schema"
```

### Task 005: Gate SQL Before Lease and Document Writes

**Files:**
- Create: `supabase/migrations/20260905100000_slice_v2_technical_contract.sql`
- Modify: `supabase/migrations/20260903120000_slice_v2_contract_convergence.sql` to call the new gate from the existing V2 create/accept wrapper
- Test: `tests/unit/database/deterministic-slice-runs.behavior.test.ts`

**Interfaces:**
- Consumes: V2 `plan_data`, EvalSpec, Markdown projections, and canonical technical reason code.
- Produces: transactional SQL rejection before write lease acquisition, with no partial roadmap/spec/plan writes.

- [ ] **Step 1: Write failing SQL behavior tests**

Drive the database test from the corpus and add cases for a valid technical plan, missing `technicalContract`, malformed boundaries, unknown task references, and Markdown/JSON mismatch. Assert the exception text is `SLICE_TECHNICAL_CONTRACT_INVALID`, `writeToken` remains null, and document row contents plus hashes are unchanged.

- [ ] **Step 2: Run SQL tests to verify failure**

Run: `npx jest --runInBand tests/unit/database/deterministic-slice-runs.behavior.test.ts -t "technical contract|conformance"`
Expected: FAIL because the current SQL V2 wrapper validates scope and lifecycle state but not the technical contract.

- [ ] **Step 3: Implement the transactional SQL gate**

Create immutable helper functions for bounded text, lower-case identifiers, JSON array uniqueness, numeric/enum/set boundaries, and JSON-pointer paths. Add `keco_slice_v2_validate_technical_contract(p_plan jsonb, p_eval_spec jsonb) returns void` that raises `SLICE_TECHNICAL_CONTRACT_INVALID` on the first stable failure. Call it in the V2 create/accept path before generating `writeToken` or invoking document inserts/updates. Validate all structured task arrays, dependency order, allowed-file ownership, acceptance/source/Eval reciprocity, and the already-computed Markdown binding hashes inside the same transaction; full Markdown parsing and JSON projection comparison remain in the preflight validator before this SQL call. Leave existing V1 rows readable by checking `contract_version = 2` only at the new gate.

The migration must be additive, use `create or replace function`, preserve `search_path = ''`, bound loops and JSON array lengths to manifest limits, and never repair malformed input.

- [ ] **Step 4: Run migration and behavior tests**

Run: `npx jest --runInBand tests/unit/database/deterministic-slice-runs.behavior.test.ts -t "technical contract|conformance|zero write"`
Expected: PASS for valid input and exact rejection/no-write assertions for every invalid case.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905100000_slice_v2_technical_contract.sql supabase/migrations/20260903120000_slice_v2_contract_convergence.sql tests/unit/database/deterministic-slice-runs.behavior.test.ts
git commit -m "feat(db): gate Slice technical contract before writes"
```

### Task 006: Synchronize Manifest, Corpus, and Plugin Mirrors

**Files:**
- Modify: `contracts/keco-slice-v2/contract-manifest.json`
- Modify: `contracts/keco-slice-v2/conformance-cases.json`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/references/contract-manifest.json`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-preflight/references/contract-manifest.json`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/contract-manifest.json`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/contract-manifest.json`
- Test: `supabase/functions/mcp/slice-v2-contract.test.ts`
- Test: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Test: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: new Python, Markdown, TypeScript, and SQL boundary fields from Tasks 002-005.
- Produces: one canonical manifest/corpus and byte-equivalent copies for every runtime.

- [ ] **Step 1: Write failing mirror/corpus assertions**

Assert the manifest reason-code list contains `SLICE_TECHNICAL_CONTRACT_INVALID`, technical field limits, and the canonical identifier/boundary rules. Assert every runtime reference copy equals `contracts/keco-slice-v2/contract-manifest.json`, and every corpus case has the same expected `{accepted, reasonCode}` in Python, Deno, and SQL.

- [ ] **Step 2: Run parity tests to verify failure**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts -t "manifest|corpus|mirror"`
Expected: FAIL because the new reason code, limits, cases, and mirror copies are absent.

- [ ] **Step 3: Update the canonical manifest and corpus**

Add a `technicalContract` manifest section containing maximum collection sizes, maximum field lengths, the identifier regex, accepted boundary classes, and forbidden generic values. Add the new stable reason code to `reasonCodes`. Add paired valid/invalid cases covering every field and cross-reference failure listed in the Design Spec. Copy the resulting manifest and corpus only to the explicitly listed mirror locations; do not change historical fixtures.

- [ ] **Step 4: Run all parity checks**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts -t "manifest|corpus|mirror"`
Expected: PASS with no byte drift and all corpus cases classified identically.

- [ ] **Step 5: Commit**

```bash
git add contracts/keco-slice-v2/contract-manifest.json contracts/keco-slice-v2/conformance-cases.json plugins/keco-codex/skills/keco-godot-slice-preflight/references/contract-manifest.json plugins/keco-claude/skills/keco-godot-slice-preflight/references/contract-manifest.json plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/contract-manifest.json plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/contract-manifest.json supabase/functions/mcp/slice-v2-contract.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "test(slice): converge technical contract corpus and mirrors"
```

### Task 007: Integrate the New Gate and Run Full Verification

**Files:**
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/SKILL.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-preflight/SKILL.md`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/references/slice-document-contract.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-preflight/references/slice-document-contract.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md`
- Test: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Test: `tests/unit/plugins/keco-claude-plugin.test.ts`
- Test: `tests/unit/database/deterministic-slice-runs.behavior.test.ts`
- Test: `supabase/functions/mcp/slice-v2-contract.test.ts`

**Interfaces:**
- Consumes: all task outputs and stable reason codes.
- Produces: documented preflight ordering, Codex/Claude byte parity, and a verified end-to-end new/materially-updated V2 planning gate.

- [ ] **Step 1: Write the integration regression tests**

Add one complete bundle fixture containing SourceProfile, SlicePlan, EvalSpec, Spec Markdown, Plan Markdown, and two tasks. Assert the bundle passes Python, TypeScript, and SQL; mutate one input/output/interface/error/invariant row, one task field, one allowed file, one Eval mapping, and one Markdown table cell at a time and assert zero writes plus the stable reason code. Add a historical fixture invocation that remains readable without technical fields.

- [ ] **Step 2: Run the regression tests to verify the missing integration**

Run: `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/database/deterministic-slice-runs.behavior.test.ts`
Expected: FAIL until the references document the new ordering and all entry points invoke the strict gate.

- [ ] **Step 3: Update the shared references**

In both `slice-document-contract.md` files, document that every new/materially updated V2 pair must use the two templates, that the technical tables are normative, and that Keco is authoritative while repository Markdown is a mirror. In both orchestration references, document validation order: SourceProfile, SlicePlan/EvalSpec, Markdown parsing, cross-document comparison, then multi-Slice distinctness. State that technical failures leave `writeToken` null and create no partial writes.

- [ ] **Step 4: Run the complete verification matrix**

Run: `npm run lint`
Expected: PASS.

Run: `npm run typecheck && npm run typecheck:api && npm run check:mcp`
Expected: PASS with no TypeScript or MCP schema errors.

Run: `npm run test:mcp`
Expected: PASS for contract, schema, and corpus Deno tests.

Run: `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/database/deterministic-slice-runs.behavior.test.ts`
Expected: PASS for Python/Claude parity, Markdown decomposition, and SQL behavior.

Run: `git diff --check`
Expected: no whitespace errors; `git status --short` shows only the pre-existing untracked `tmp/` directory, never a generated technical-contract artifact.

- [ ] **Step 5: Commit**

```bash
git add plugins/keco-codex/skills/keco-godot-slice-preflight/SKILL.md plugins/keco-claude/skills/keco-godot-slice-preflight/SKILL.md plugins/keco-codex/skills/keco-godot-slice-preflight/references/slice-document-contract.md plugins/keco-claude/skills/keco-godot-slice-preflight/references/slice-document-contract.md plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/database/deterministic-slice-runs.behavior.test.ts supabase/functions/mcp/slice-v2-contract.test.ts
git commit -m "feat(slice): wire technical planning contract preflight"
```

## Delivery Checklist

- [ ] Canonical Spec and Plan templates exist and are byte-equivalent in Codex/Claude references.
- [ ] `technicalContract` and task interface fields are strict in Python, TypeScript/Zod, and SQL.
- [ ] Markdown Spec/Plan sections and tables are parsed and compared to the exact JSON artifacts.
- [ ] SourceProfile, EvalSpec, allowed-file, dependency, and acceptance mappings remain reciprocal.
- [ ] The new reason code is present in the manifest and every runtime agrees on the conformance corpus.
- [ ] New/materially updated V2 bundles fail before lease/write on missing or contradictory technical detail.
- [ ] Historical documents and accepted runs remain readable and untouched.
- [ ] Codex and Claude references, templates, validators, manifest, and corpus have no byte drift.
- [ ] Lint, type checks, MCP tests, focused unit tests, and database behavior tests pass.
