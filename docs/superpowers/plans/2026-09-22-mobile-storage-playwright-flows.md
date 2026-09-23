# Mobile And Storage Playwright Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add genuine touch-device Create Map coverage and prove one owner's storage quota remains atomic across browser, MCP, map, and character entry points.

**Architecture:** Add a tag-limited Pixel 5 Playwright project and extend the existing deterministic Create Map backend. For quota, expose narrow test harness functions around the real entry-point storage adapters, backed by the configured Supabase reservation tables and a temporary low quota.

**Tech Stack:** Playwright mobile emulation, Pointer Events, Supabase/PostgreSQL reservations, MCP upload preparation, Deno Edge-function storage adapters.

## Global Constraints

- Do not run paid PixelLab generation.
- The mobile project runs only tests tagged `@mobile`.
- Direct reservation RPC calls alone do not count as cross-entry coverage.
- Every stored object and active reservation created by a test must be removed.
- No fixed-duration waits.

---

### Task 1: Touch-capable Playwright project

**Files:**
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/specs/create-map-v3.spec.ts`

**Interfaces:**
- Produces: project `mobile-chrome` using `devices['Pixel 5']` and `grep: /@mobile/`.

- [ ] **Step 1: Add a failing tagged mobile test**

Rename the focused scenario to include `@mobile`, assert `navigator.maxTouchPoints > 0`, and keep desktop layout coverage in its existing Chromium scenario.

- [ ] **Step 2: Verify RED before enabling the project**

Run: `npx playwright test tests/e2e/specs/create-map-v3.spec.ts --project=mobile-chrome --grep @mobile --workers=1`

Expected: FAIL because `mobile-chrome` is not configured.

- [ ] **Step 3: Enable the isolated mobile project**

```ts
{
  name: 'mobile-chrome',
  grep: /@mobile/,
  use: { ...devices['Pixel 5'] },
}
```

Add `grepInvert: /@mobile/` to desktop Chromium so the focused test is not duplicated.

- [ ] **Step 4: Verify discovery**

Run: `npx playwright test --list tests/e2e/specs/create-map-v3.spec.ts`

Expected: the mobile scenario appears once under `mobile-chrome`; ordinary Create Map scenarios appear under Chromium only.

---

### Task 2: Mobile drawers and touch collision painting

**Files:**
- Modify: `tests/e2e/specs/create-map-v3.spec.ts`
- Test: `tests/e2e/specs/create-map-v3.spec.ts`

**Interfaces:**
- Consumes: `CreateMapV3MockBackend`, `createSavedMap`, `generateReadyMap`, and the editable collision grid.

- [ ] **Step 1: Write the complete mobile assertions**

Start from a generated map, capture the displayed blocked count, close the inspector, open and close source, click `Open inspector panel`, and assert `Map ready` plus `Grid ready` remain visible.

- [ ] **Step 2: Paint through a touch pointer**

Use `page.touchscreen.tap(x, y)` for one cell. For a drag across a second cell, call `overlay.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX, clientY, buttons: 1 })`, followed by `pointermove` and `pointerup` on the same locator with the same `pointerId`. Assert the count changes after each gesture and `All changes saved` appears.

- [ ] **Step 3: Reload and verify restoration**

Reload, reopen the saved map, reopen the inspector, and assert the final blocked count and editable overlay. Retain the nonblank screenshot/channel standard-deviation assertion and zero page/request failures.

- [ ] **Step 4: Run RED/GREEN and commit**

```bash
npx playwright test tests/e2e/specs/create-map-v3.spec.ts --project=mobile-chrome --grep @mobile --workers=1
git add playwright.config.ts tests/e2e/specs/create-map-v3.spec.ts
git commit -m "test: cover Create Map touch interaction"
```

---

### Task 3: Cross-entry quota harness contracts

**Files:**
- Create: `tests/e2e/helpers/storage-quota-live.ts`
- Create: `tests/e2e/specs/storage-quota-cross-entry.spec.ts`
- Modify: `supabase/functions/pixellab-map/storage.ts`
- Modify: `supabase/functions/pixellab-character/storage.ts`
- Modify: `supabase/functions/mcp/write-tools.ts`
- Test: existing focused Deno/Jest storage tests.

**Interfaces:**
- Expose existing storage-entry functions without bypassing their reserve/release logic.
- Produces test helper operations `reserveBrowserUpload`, `reserveMcpUpload`, `persistMapAsset`, and `persistCharacterAsset` returning a normalized `{ entryPoint, ok, reservationId?, code? }`.

- [ ] **Step 1: Add failing export/contract tests**

Extend the existing map, character, and MCP storage unit tests to assert that each entry point accepts an injected storage client/provider boundary and always releases its reservation on upload, read-back, or finalize failure.

- [ ] **Step 2: Run and verify RED**

```bash
npx jest --runInBand tests/unit/project-game-assets-route.test.ts
deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/image-tools.test.ts supabase/functions/pixellab-map/storage.test.ts supabase/functions/pixellab-character/storage.test.ts
```

Expected: at least one assertion fails until each adapter exposes the same observable reservation outcome.

- [ ] **Step 3: Add the minimal dependency boundaries**

Keep production defaults unchanged. Accept optional injected upload/read-back functions only at the current storage adapters, return reservation identity to the harness before finalization, and preserve all existing cleanup paths.

- [ ] **Step 4: Verify unit GREEN**

Run the Step 2 commands again.

Expected: all focused storage suites pass.

---

### Task 4: Live concurrent owner-quota scenario

**Files:**
- Create: `tests/e2e/specs/storage-quota-cross-entry.spec.ts`
- Create: `tests/e2e/helpers/storage-quota-live.ts`
- Modify: `tests/e2e/utils/supabase-admin.ts`

**Interfaces:**
- Consumes: authenticated browser upload preparation, OAuth MCP upload preparation, and locally invoked map/character adapters with real service-role persistence.

- [ ] **Step 1: Build temporary owner fixtures**

Create one owner, one editor, and four owned projects. Save the owner's original quota row, set an isolated quota large enough for exactly three declared reservations, and register unique browser/MCP/map/character object paths.

- [ ] **Step 2: Write the concurrent reservation assertion**

Release all four operations from a shared barrier and await `Promise.allSettled`. Assert exactly three successes, one normalized `STORAGE_QUOTA_EXCEEDED`, and query the owner quota/reservation rows to prove `used_bytes + reserved_bytes <= quota_bytes`.

- [ ] **Step 3: Write failure-release and retry assertions**

Force the map adapter's upload boundary to fail after reservation. Poll until its reservation is released, retry the previously rejected entry, and assert it now succeeds without increasing total accounted bytes beyond the quota.

- [ ] **Step 4: Implement exhaustive cleanup**

Release unfinished reservations, remove unique objects from `project-assets`, `map-assets`, and `character-assets`, restore/delete the quota fixture row, revoke OAuth state, remove projects, and delete users. Query by run UUID and assert zero active reservations remain.

- [ ] **Step 5: Run the live spec twice**

Run twice: `npx playwright test tests/e2e/specs/storage-quota-cross-entry.spec.ts --project=chromium --workers=1`.

Expected: both runs pass, with one quota rejection per run and no leaked rows/objects.

- [ ] **Step 6: Static checks and commit**

```bash
npx eslint tests/e2e/helpers/storage-quota-live.ts tests/e2e/specs/storage-quota-cross-entry.spec.ts tests/e2e/specs/create-map-v3.spec.ts playwright.config.ts
npx tsc --noEmit --pretty false
git add tests/e2e/helpers/storage-quota-live.ts tests/e2e/specs/storage-quota-cross-entry.spec.ts tests/e2e/utils/supabase-admin.ts supabase/functions/pixellab-map/storage.ts supabase/functions/pixellab-character/storage.ts supabase/functions/mcp/write-tools.ts
git commit -m "test: verify cross-entry owner storage quotas"
```

---

### Task 5: Combined release gate

**Files:**
- Verify: all six critical Playwright specs.

- [ ] **Step 1: Run test discovery**

Run: `npx playwright test --list | rg 'account-credits|account-email|stripe-webhook|mcp-authorization|create-map-v3|storage-quota-cross-entry'`

Expected: all six areas are present under their intended projects.

- [ ] **Step 2: Run desktop live suites serially**

Run: `npx playwright test tests/e2e/specs/account-credits.spec.ts tests/e2e/specs/account-email.spec.ts tests/e2e/specs/stripe-webhook.spec.ts tests/e2e/specs/mcp-authorization.spec.ts tests/e2e/specs/storage-quota-cross-entry.spec.ts --project=chromium --workers=1`

Expected: all pass with cleanup complete.

- [ ] **Step 3: Run the mobile gate**

Run: `npx playwright test tests/e2e/specs/create-map-v3.spec.ts --project=mobile-chrome --grep @mobile --workers=1`

Expected: the touch scenario passes with a nonblank screenshot and no browser failures.
