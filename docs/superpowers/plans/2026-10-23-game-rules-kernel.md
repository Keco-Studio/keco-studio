# Game Rules Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new Game Design System versions express validated, project-specific gameplay rules rather than production or design-review policy.

**Architecture:** Preserve the JSON-backed version store and flat rule list, but introduce a versioned discriminated Rule Set union. Historical `schemaVersion: 1` rule sets remain readable. New gameplay rule sets use `schemaVersion: 2`, require a gameplay `domain` on every rule, and enforce domain coverage before they can be generated or saved. Generation, Agent policy, GDD generation, Markdown, version diffs, API tools, and the editor consume the same parsed union.

**Tech Stack:** TypeScript, Next.js App Router, React, Zod, Jest, Supabase RPC-backed version persistence.

**Spec:** `docs/superpowers/specs/2026-10-23-game-rules-kernel-design.md`

## Global Constraints

- Preserve existing v1 rows as readable, diffable historical design-policy versions; do not rewrite stored rows.
- Generate and create new gameplay systems as `schemaVersion: 2` only.
- A v2 rule has exactly one of ten domains: `player`, `objective`, `action`, `object_state`, `sequence`, `resource_cost`, `resolution_feedback`, `spatiotemporal`, `randomness`, `fallback`.
- V2 must contain a required rule for `player`, `objective`, `action`, `object_state`, `sequence`, `resource_cost`, `resolution_feedback`, and `fallback`.
- V2 requires `spatiotemporal` and `randomness` only when the user input or normalized project source declares those mechanics; otherwise generation must state their absence in the design document.
- Keep the 80-rule, 20-table, 20-fields-per-table, and 64 KiB serialized rule-set limits.
- Preserve untrusted-policy sanitization and the 12,000-character Agent policy budget.
- Do not auto-convert v1 policy rules into v2 gameplay facts or retain their IDs across an automatic conversion.
- Keep user-authored dirty changes in `GameDesignSystemVersionEditor.tsx`; integrate with the existing editor rather than discarding or rewriting unrelated work.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/game-design-system/ruleSchema.ts` | Discriminated v1/v2 rule-set schemas, domain constants, domain coverage validation, stable exported types. |
| `src/lib/game-design-system/ruleDiff.ts` | Version-diff conflicts for changed `kind` or `domain`. |
| `src/lib/game-design-system/versionDiff.ts` | Version-diff settings classification that remains correct for both schema versions. |
| `src/lib/game-design-system/ruleMarkdown.ts` | Deterministic v1 legacy rendering and v2 domain-first rendering. |
| `src/lib/gameDesignSystemGeneration.ts` | v2 generation prompt, output example, language checks, repair prompt, and mechanics applicability hints. |
| `src/lib/game-design-system/agentPolicy.ts` | Safe policy projection that includes v2 `domain` without widening v1 output. |
| `src/lib/gddGeneration.ts` | Legacy GDD prompt language that treats v2 rules as game facts. |
| `src/lib/gdd-generation/v2/generator.ts` | Professional GDD prompt language that treats v2 rules as game facts. |
| `src/lib/agent/tools/game-design-system-version-schema.ts` | Agent JSON Schema exposing both legacy v1 and v2 rule contracts. |
| `src/lib/agent/tools/create-game-design-system.ts` | Agent tool copy that documents the v2 gameplay contract. |
| `src/components/game-design-system/GameDesignSystemRuleEditor.tsx` | V2 domain filter, selector, display labels, and domain-aware draft rule creation. |
| `src/components/game-design-system/GameDesignSystemVersionEditor.tsx` | V1 legacy notice and explicit v2 kernel draft/validation flow. |
| `src/lib/game-design-system/*.test.ts` | Schema, diff, Markdown, and policy unit coverage. |
| `src/lib/gameDesignSystemGeneration.test.ts` | Generation and repair prompt coverage. |
| `src/lib/gddGeneration.test.ts` and `src/lib/gdd-generation/v2/generator.test.ts` | GDD consumption coverage. |
| `src/components/game-design-system/*.test.tsx` | Editor and review UI coverage. |

## Task 1: Add the Versioned Gameplay Rule Contract

**Files:**
- Modify: `src/lib/game-design-system/ruleSchema.ts`
- Modify: `src/lib/game-design-system/ruleDiff.ts`
- Modify: `src/lib/game-design-system/versionDiff.ts`
- Test: `src/lib/game-design-system/ruleSchema.test.ts`
- Test: `src/lib/game-design-system/versionDiff.test.ts`

**Interfaces:**
- Consumes: existing v1 JSON rows through `parseRuleSet(value)`.
- Produces: `GAME_RULE_DOMAINS`, `GameRuleDomain`, `LegacyGameDesignRuleSet`, `GameRulesKernel`, `GameDesignRuleSet`, `isGameRulesKernel(ruleSet)`, and a version-aware `parseRuleSet(value)`.
- Produces: `assertGameRulesKernelCoverage(ruleSet)` behavior through Zod `superRefine`.

- [ ] **Step 1: Write failing v2 schema tests**

Add a valid v2 fixture containing the eight always-applicable domains and assert it parses. Add separate tests for an unknown `domain`, a v2 rule without `domain`, an omitted required domain, and a duplicate rule ID. Preserve the current v1 fixture and assert it still parses unchanged.

```ts
const v2 = {
  ...valid,
  schemaVersion: 2,
  rules: REQUIRED_DOMAINS.map((domain) => ({
    id: `${domain.replaceAll('_', '-')}-rule`,
    domain,
    kind: 'constraint',
    title: `${domain} rule`,
    statement: 'Defines a concrete runtime rule.',
    appliesWhen: 'Resolving gameplay.',
    severity: 'required',
  })),
};

expect(parseRuleSet(v2)).toEqual(v2);
expect(() => parseRuleSet({ ...v2, rules: v2.rules.slice(1) })).toThrow(/player/);
```

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx jest src/lib/game-design-system/ruleSchema.test.ts --runInBand`

Expected: FAIL because `schemaVersion: 2` and `domain` are not accepted.

- [ ] **Step 3: Implement the discriminated v1/v2 union**

In `ruleSchema.ts`, split the current single schema into:

```ts
export const GAME_RULE_DOMAINS = [
  'player', 'objective', 'action', 'object_state', 'sequence',
  'resource_cost', 'resolution_feedback', 'spatiotemporal',
  'randomness', 'fallback',
] as const;

export const REQUIRED_GAME_RULE_DOMAINS = [
  'player', 'objective', 'action', 'object_state', 'sequence',
  'resource_cost', 'resolution_feedback', 'fallback',
] as const;
```

Keep the v1 rule schema byte-for-byte compatible. Define a v2 rule schema by
extending shared fields with `domain: z.enum(GAME_RULE_DOMAINS)`. Define v2
rules as `schemaVersion: z.literal(2)` and enforce each required domain has at
least one `severity: 'required'` rule. Export a type guard that checks
`schemaVersion === 2`.

- [ ] **Step 4: Add domain-aware version conflicts**

In `ruleDiff.ts`, retain the current kind-change conflict and append a domain
conflict only when both compared rules are v2:

```ts
if ('domain' in previous && 'domain' in current && previous.domain !== current.domain) {
  conflicts.push({ ruleId: id, reason: `Rule domain changed from ${previous.domain} to ${current.domain}.` });
}
```

Ensure a v1/v2 same-ID comparison is also reported as a domain/semantic conflict
instead of silently treating it as a regular changed rule.

- [ ] **Step 5: Make version-diff settings schema-version aware**

Extend `ruleSetSettings()` in `versionDiff.ts` to include `schemaVersion` so a
v1-to-v2 change is recorded even when genres, philosophies, and suitableFor
match. Do not add any database migration: rules are already stored as JSON.

- [ ] **Step 6: Run focused schema and diff tests**

Run: `npx jest src/lib/game-design-system/ruleSchema.test.ts src/lib/game-design-system/versionDiff.test.ts --runInBand`

Expected: PASS, including v1 compatibility and v2 coverage/conflict assertions.

- [ ] **Step 7: Commit the contract change**

```bash
git add src/lib/game-design-system/ruleSchema.ts src/lib/game-design-system/ruleDiff.ts src/lib/game-design-system/versionDiff.ts src/lib/game-design-system/ruleSchema.test.ts src/lib/game-design-system/versionDiff.test.ts
git commit -m "feat(gds): add gameplay rules kernel schema"
```

## Task 2: Generate and Validate v2 Gameplay Rules

**Files:**
- Modify: `src/lib/gameDesignSystemGeneration.ts`
- Modify: `src/lib/gameDesignSystemGeneration.test.ts`
- Modify: `src/lib/agent/tools/game-design-system-version-schema.ts`
- Modify: `src/lib/agent/tools/create-game-design-system.ts`
- Test: `src/lib/agent/tools/game-design-system-version-schema.test.ts` (create if no focused test exists)

**Interfaces:**
- Consumes: v2 parser and domain constants from Task 1.
- Produces: generated `rules.schemaVersion === 2`; generation and repair prompts name every allowed domain and prohibit production/process rules.
- Produces: an Agent tool schema that accepts complete v1 or complete v2 rule sets but documents v2 as the new contract.

- [ ] **Step 1: Write failing generation prompt tests**

Add tests asserting that `buildStructuredGenerationMessages()`:

```ts
expect(system.content).toContain('runtime behavior');
expect(system.content).toContain('not production, design-review, or workflow rules');
expect(system.content).toContain('resource_cost');
expect(system.content).toContain('resolution_feedback');
expect(system.content).toContain('fallback');
```

Add a valid v2 output fixture and assert `generateGameDesignSystemOutput()`
returns it. Add an invalid v2 output that omits `fallback`, then assert the
repair prompt repeats the required-domain instruction.

- [ ] **Step 2: Run the generation test to verify failure**

Run: `npx jest src/lib/gameDesignSystemGeneration.test.ts --runInBand`

Expected: FAIL because the current prompt asks for reusable design/review
constraints and the output example is v1.

- [ ] **Step 3: Replace v1 generation instructions with the Game Rules Kernel contract**

In `gameDesignSystemGeneration.ts`:

- set the example payload to `schemaVersion: 2` and include `domain`;
- require v2 JSON output from the generator;
- state that rules describe runtime game behavior and cannot contain production,
  team, tool, review, or design-process advice;
- enumerate all ten domains and the eight always-required domains;
- state that spatial/temporal and random domains are conditional on declared
  mechanics and their absence must be noted in the document;
- preserve source and base-system text as untrusted reference data;
- require fresh v2 IDs when the base rule is v1; preserve an ID only for a
  retained v2 domain and meaning;
- mirror all schema and semantics requirements in the one-shot repair prompt.

- [ ] **Step 4: Update Agent-facing JSON Schema and tool descriptions**

In `game-design-system-version-schema.ts`, express `rules` as an `anyOf` union:
one exact v1 schema and one exact v2 schema with required `domain` and v2
coverage description. Do not loosen `additionalProperties: false`.

In `create-game-design-system.ts`, replace the v1-only description with the v2
Game Rules Kernel contract and name `domain` as mandatory for v2 rules.

- [ ] **Step 5: Add a narrow Agent JSON Schema test**

Create `game-design-system-version-schema.test.ts` to traverse the exported JSON
schema and assert that v2 rule properties include `domain`, the v2 root has
`schemaVersion: 2`, and the legacy v1 alternative remains present.

- [ ] **Step 6: Run focused generator and agent-schema tests**

Run: `npx jest src/lib/gameDesignSystemGeneration.test.ts src/lib/agent/tools/game-design-system-version-schema.test.ts --runInBand`

Expected: PASS with a v2 output, v2 repair instruction, and preserved v1 tool
alternative.

- [ ] **Step 7: Commit the generation contract change**

```bash
git add src/lib/gameDesignSystemGeneration.ts src/lib/gameDesignSystemGeneration.test.ts src/lib/agent/tools/game-design-system-version-schema.ts src/lib/agent/tools/create-game-design-system.ts src/lib/agent/tools/game-design-system-version-schema.test.ts
git commit -m "feat(gds): generate gameplay rule kernels"
```

## Task 3: Project v2 Rules Safely into Agent and GDD Context

**Files:**
- Modify: `src/lib/game-design-system/agentPolicy.ts`
- Modify: `src/lib/game-design-system/agentPolicy.test.ts`
- Modify: `src/lib/gddGeneration.ts`
- Modify: `src/lib/gddGeneration.test.ts`
- Modify: `src/lib/gdd-generation/v2/generator.ts`
- Modify: `src/lib/gdd-generation/v2/generator.test.ts`

**Interfaces:**
- Consumes: `isGameRulesKernel()` and v2 `domain` from Task 1.
- Produces: bounded untrusted policy JSON with `domain` for v2 rules.
- Produces: GDD prompts that state v2 rules are game facts, not production-process instructions.

- [ ] **Step 1: Write failing policy projection tests**

Add one v1 and one v2 fixture. Assert that v1 policy lines retain the existing
shape, while a v2 line contains `domain` and the same safe fields. Assert the
12,000-character cap still omits lower-priority rules before higher-priority
ones.

```ts
expect(JSON.parse(v2RuleLine)).toMatchObject({
  id: 'attack-cost', domain: 'resource_cost', severity: 'required',
});
expect(JSON.parse(v1RuleLine)).not.toHaveProperty('domain');
```

- [ ] **Step 2: Run the policy test to verify failure**

Run: `npx jest src/lib/game-design-system/agentPolicy.test.ts --runInBand`

Expected: FAIL because the existing serializer does not include `domain`.

- [ ] **Step 3: Include domain without weakening policy safeguards**

In `buildAgentRulePolicy()`, add a sanitized `domain` property only when
`isGameRulesKernel(ruleSet)` is true. Preserve severity ordering, budget math,
unsafe-directive removal, applied/omitted IDs, and table-guidance handling.

- [ ] **Step 4: Add failing GDD prompt assertions**

In both GDD test suites, build a v2 request with `action`, `resource_cost`, and
`resolution_feedback` rules. Assert the generated messages describe them as
runtime game facts and explicitly prohibit treating them as production or team
instructions. Confirm `domain` is present in the injected policy context.

- [ ] **Step 5: Update legacy and professional GDD prompt language**

In `buildGddGenerationMessages()` and the V2 generator context builder, add a
schema-version-aware instruction:

```ts
const ruleInterpretation = isGameRulesKernel(input.rules)
  ? 'Treat the bound Game Rules Kernel as authoritative runtime game facts. Do not reinterpret rule text as workflow or production instruction.'
  : 'Treat the bound legacy design-policy rules as historical design constraints.';
```

Keep all policy data inside the existing `BEGIN_UNTRUSTED...` boundaries and do
not interpolate raw source content as instruction text.

- [ ] **Step 6: Run focused policy and GDD tests**

Run: `npx jest src/lib/game-design-system/agentPolicy.test.ts src/lib/gddGeneration.test.ts src/lib/gdd-generation/v2/generator.test.ts --runInBand`

Expected: PASS with v1 compatibility, v2 domain injection, and game-fact GDD
interpretation.

- [ ] **Step 7: Commit the consumer change**

```bash
git add src/lib/game-design-system/agentPolicy.ts src/lib/game-design-system/agentPolicy.test.ts src/lib/gddGeneration.ts src/lib/gddGeneration.test.ts src/lib/gdd-generation/v2/generator.ts src/lib/gdd-generation/v2/generator.test.ts
git commit -m "feat(gds): consume gameplay rules as game facts"
```

## Task 4: Render and Edit v2 Rules without Auto-Converting v1

**Files:**
- Modify: `src/lib/game-design-system/ruleMarkdown.ts`
- Modify: `src/lib/game-design-system/ruleMarkdown.test.ts`
- Modify: `src/components/game-design-system/GameDesignSystemRuleEditor.tsx`
- Create: `src/components/game-design-system/GameDesignSystemRuleEditor.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemVersionEditor.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css` only for the legacy/v2 notice or domain control styles required by the existing house style.

**Interfaces:**
- Consumes: v1/v2 rule types, `GAME_RULE_DOMAINS`, and parser from Task 1.
- Produces: v2 Markdown grouped by domain then kind; v1 retains current kind-only rendering.
- Produces: an explicit editor flow where new draft rules use v2 domains and a v1 version is identified as legacy rather than silently recast as game facts.

- [ ] **Step 1: Write failing Markdown rendering tests**

Add a v2 fixture with `action` and `resource_cost` rules. Assert deterministic
Markdown includes separate domain headings, preserves kind labels inside each
domain, and does not change the current v1 heading order.

```ts
expect(markdown).toContain('## Actions');
expect(markdown).toContain('### Constraints');
expect(markdown.indexOf('## Actions')).toBeLessThan(markdown.indexOf('## Resource Costs'));
```

- [ ] **Step 2: Run the Markdown test to verify failure**

Run: `npx jest src/lib/game-design-system/ruleMarkdown.test.ts --runInBand`

Expected: FAIL because the renderer groups only by `kind`.

- [ ] **Step 3: Implement v2 domain-first Markdown rendering**

Add a stable domain label/order record in `ruleMarkdown.ts`. Branch on
`isGameRulesKernel(ruleSet)`: render v2 as `## <Domain>` then `### <Kind>` then
rules; retain the existing v1 output byte-for-byte where practical. Keep table
guidance after all rule content.

- [ ] **Step 4: Write failing editor interaction tests**

Create/extend React tests to cover:

- a v2 rule displays a domain selector and filtering by domain;
- adding a v2 rule gives it an explicit default domain and never omits it;
- a v1 version displays a legacy-policy notice;
- saving a v2 draft missing required domain coverage focuses the Rules section
  and shows the parser error;
- no UI action silently assigns gameplay domains to legacy v1 rules.

- [ ] **Step 5: Implement domain-aware editor behavior**

In `GameDesignSystemRuleEditor.tsx`, add a `domainFilter` and a `<select>` bound
to `rule.domain` only for v2 rule sets. Update `emptyRule()` to receive the rule
set schema version and create a valid v2 draft rule with a visible `player`
domain default. Update labels and empty-state copy to refer to gameplay rules.

In `GameDesignSystemVersionEditor.tsx`, retain its clone-and-parse-on-review
flow. Show a non-editing legacy notice for v1. For a v2 version, route Zod
coverage errors to the Rules section just as existing field errors are routed.
Do not populate `domain` on a v1 payload; an upgrade must come from generating
or explicitly authoring a separate v2 kernel.

- [ ] **Step 6: Run focused UI and Markdown tests**

Run: `npx jest src/lib/game-design-system/ruleMarkdown.test.ts src/components/game-design-system/GameDesignSystemRuleEditor.test.tsx src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx --runInBand`

Expected: PASS with v1 legacy behavior intact and v2 domain controls/validation
verified.

- [ ] **Step 7: Commit the rendering and editor change**

```bash
git add src/lib/game-design-system/ruleMarkdown.ts src/lib/game-design-system/ruleMarkdown.test.ts src/components/game-design-system/GameDesignSystemRuleEditor.tsx src/components/game-design-system/GameDesignSystemRuleEditor.test.tsx src/components/game-design-system/GameDesignSystemVersionEditor.tsx src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx src/components/game-design-system/GameDesignSystemsPage.module.css
git commit -m "feat(gds): edit and render gameplay rule domains"
```

## Task 5: Preserve Version Writes and Service Hydration across Schema Versions

**Files:**
- Modify: `src/lib/game-design-system/versionRequest.ts`
- Modify: `src/lib/services/gameDesignSystemWriteService.server.ts`
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/app/api/game-design-systems/route.ts`
- Test: `src/lib/services/gameDesignSystemWriteService.server.test.ts`
- Test: `src/lib/services/gameDesignSystemService.test.ts`
- Test: `src/app/api/game-design-systems/route.test.ts` (create if no route test exists)

**Interfaces:**
- Consumes: versioned parser and diff behavior from Task 1.
- Produces: API and service paths that hydrate both v1 and v2, accept v2 direct creation, and reject malformed v2 writes with field-level validation errors.

- [ ] **Step 1: Write failing service/route tests**

Add cases that:

- hydrate an existing v1 version without modification;
- create a v2 draft through `POST /api/game-design-systems`;
- reject a v2 direct create missing `fallback` with a 400 field error;
- reject a v1-to-v2 same-ID version write with the semantic conflict surfaced in
  the stored diff;
- retain version idempotency and stale-version behavior for valid v2 writes.

- [ ] **Step 2: Run focused service tests to verify failure**

Run: `npx jest src/lib/services/gameDesignSystemWriteService.server.test.ts src/lib/services/gameDesignSystemService.test.ts src/app/api/game-design-systems/route.test.ts --runInBand`

Expected: FAIL until route/service fixtures and semantic conflict propagation are
updated for v2.

- [ ] **Step 3: Update request, write, and hydrate paths**

Keep `createGameDesignSystemVersionRequestSchema` and the draft-create route
using the version-aware `gameDesignRuleSetSchema`; no persistence migration is
needed. In write-service code, preserve existing `parseRuleSet()` calls, but
explicitly map `diff.conflicts.length > 0` to the existing conflict payload
instead of allowing a v1/v2 same-ID semantic conflict to look like a successful
version candidate. In service hydration, continue parsing rows with the union
and build compatibility documents for legacy rows only.

Update direct-create API copy from “structured rule set” to “structured game
rule set” without weakening its strict parser.

- [ ] **Step 4: Run focused service and route tests**

Run: `npx jest src/lib/services/gameDesignSystemWriteService.server.test.ts src/lib/services/gameDesignSystemService.test.ts src/app/api/game-design-systems/route.test.ts --runInBand`

Expected: PASS for v1 hydration, v2 create/write, idempotency, and semantic
conflict behavior.

- [ ] **Step 5: Commit the persistence compatibility change**

```bash
git add src/lib/game-design-system/versionRequest.ts src/lib/services/gameDesignSystemWriteService.server.ts src/lib/services/gameDesignSystemService.ts src/app/api/game-design-systems/route.ts src/lib/services/gameDesignSystemWriteService.server.test.ts src/lib/services/gameDesignSystemService.test.ts src/app/api/game-design-systems/route.test.ts
git commit -m "feat(gds): persist versioned gameplay rule sets"
```

## Task 6: Run Cross-Feature Regression Checks and Update Product Specifications

**Files:**
- Modify: `specs/032-game-design-rule-system/spec.md`
- Modify: `docs/mcp/README.md`
- Test: all focused tests named in Tasks 1–5

**Interfaces:**
- Consumes: completed contract, generator, consumer, UI, and persistence work.
- Produces: user-facing product documentation that accurately describes a Game
  Rules Kernel and verifies no v1 assumptions remain in new-generation paths.

- [ ] **Step 1: Update canonical product wording**

Revise `specs/032-game-design-rule-system/spec.md` so its product definition,
generation requirements, canonical schema, source contract, Agent contract, and
acceptance criteria refer to game runtime rules. Keep the historical-version
compatibility statement and remove language that prohibits concrete game rules.

Update `docs/mcp/README.md` tool descriptions to say generated GDS rules use
the v2 gameplay rule contract and that older v1 systems are readable legacy
versions.

- [ ] **Step 2: Run all focused Jest suites together**

Run:

```bash
npx jest \
  src/lib/game-design-system/ruleSchema.test.ts \
  src/lib/game-design-system/versionDiff.test.ts \
  src/lib/gameDesignSystemGeneration.test.ts \
  src/lib/game-design-system/agentPolicy.test.ts \
  src/lib/gddGeneration.test.ts \
  src/lib/gdd-generation/v2/generator.test.ts \
  src/lib/game-design-system/ruleMarkdown.test.ts \
  src/components/game-design-system/GameDesignSystemRuleEditor.test.tsx \
  src/components/game-design-system/GameDesignSystemVersionEditor.test.tsx \
  src/lib/services/gameDesignSystemWriteService.server.test.ts \
  src/lib/services/gameDesignSystemService.test.ts \
  src/app/api/game-design-systems/route.test.ts \
  --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run static verification**

Run: `npm run lint && npm run typecheck`

Expected: PASS with no unused v1-only fields, broken discriminated-union access,
or invalid React props.

- [ ] **Step 4: Commit documentation and regression verification updates**

```bash
git add specs/032-game-design-rule-system/spec.md docs/mcp/README.md
git commit -m "docs(gds): document gameplay rules kernel"
```

## Plan Self-Review

- **Spec coverage:** Task 1 implements v2 contract and compatibility; Task 2
  implements generation/repair; Task 3 updates Agent and GDD consumers; Task 4
  updates Markdown/editor behavior; Task 5 preserves version and API paths;
  Task 6 updates documentation and runs regression checks.
- **Placeholder scan:** No task defers an action without exact files, interfaces,
  test commands, or expected outcome.
- **Type consistency:** `GameDesignRuleSet` remains the shared union consumed by
  generation, policies, UI, services, and GDD paths. Only v2 rule objects expose
  `domain`, guarded by `isGameRulesKernel()` or discriminated union narrowing.
