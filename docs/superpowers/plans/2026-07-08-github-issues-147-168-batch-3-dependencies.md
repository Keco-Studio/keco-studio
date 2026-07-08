# GitHub Issues 147-168 Batch 3 Dependency Risk Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce #164 production dependency risk by aligning React/Next peers, removing unused packages, moving dev-only tunnel tooling out of production dependencies, and replacing vulnerable `xlsx` imports.

**Architecture:** Add static dependency guard tests first. Install maintained dependencies and update lockfile through npm. Replace `xlsx` use with focused workbook helpers backed by `exceljs`, while keeping CSV/XLSX import preview, import API parsing, and export API behavior stable.

**Tech Stack:** npm, Next.js, React, Jest, TypeScript, ExcelJS.

## Global Constraints

- User-facing final replies stay in Chinese.
- Code, comments, identifiers, and API names stay in English.
- Use TDD for behavior changes where a practical test surface exists.
- Preserve unrelated user changes.
- Keep commits scoped by issue or remediation batch.
- Prefer existing project patterns over new abstractions.
- Every batch must end with a targeted verification command, and the final remediation must run the broadest practical validation chain.
- Do not push commits.
- If a command fails because of sandboxing or network restrictions, rerun it with escalated permissions.

---

### Task 1: Dependency Guardrails And Workbook Migration

**Files:**
- Create: `tests/unit/dependency-risk.test.ts`
- Create: `tests/unit/workbook-utils.test.ts`
- Create: `src/lib/utils/workbook.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/services/importService.ts`
- Modify: `src/app/api/export/route.ts`
- Modify: `src/components/libraries/ImportLibraryModal.tsx`

**Interfaces:**
- Produces: `parseWorkbookRows(buffer: Buffer | ArrayBuffer, fileName: string): Promise<Array<{ name: string; rows: unknown[][] }>>`
- Produces: `writeXlsxWorkbook(sheets: Array<{ name: string; rows: Array<Array<string | number | boolean | null>>; columns?: Array<{ width?: number }> }>): Promise<Buffer>`
- Produces: `previewWorkbookFile(file: File): Promise<{ sheetCount: number; columnCount: number; rowCount: number }>`

- [x] **Step 1: Write failing dependency guard tests**

Add `tests/unit/dependency-risk.test.ts` asserting:

```ts
expect(pkg.dependencies).not.toHaveProperty('xlsx');
expect(pkg.dependencies).not.toHaveProperty('node-fetch');
expect(pkg.dependencies).not.toHaveProperty('@types/echarts');
expect(pkg.dependencies).not.toHaveProperty('ngrok');
expect(pkg.devDependencies).toHaveProperty('ngrok');
expect(pkg.dependencies.react).toMatch(/^19\./);
expect(pkg.dependencies['react-dom']).toMatch(/^19\./);
```

Also scan `src/**/*.{ts,tsx}` and assert no file contains `from 'xlsx'` or `import * as XLSX`.

- [x] **Step 2: Run dependency guard tests to verify they fail**

Run:

```bash
npm run test:unit -- tests/unit/dependency-risk.test.ts --runInBand
```

Expected: FAIL because `xlsx`, `node-fetch`, `@types/echarts`, and prod `ngrok` are still present, React is 18, and app code imports `xlsx`.

- [x] **Step 3: Install dependency changes**

Run:

```bash
npm install react@19.2.7 react-dom@19.2.7 next@16.2.10 axios@latest nodemailer@latest resend@latest exceljs@latest
npm install -D @types/react@latest @types/react-dom@latest ngrok@latest
npm uninstall xlsx node-fetch @types/echarts
```

Expected: `package.json` and `package-lock.json` update. If npm network access fails, rerun the failed command with escalated permissions.

- [x] **Step 4: Write workbook helper tests**

Add `tests/unit/workbook-utils.test.ts` that creates a small workbook through `writeXlsxWorkbook`, parses it back with `parseWorkbookRows`, and verifies sheet names, header cells, data rows, and CSV parsing behavior.

- [x] **Step 5: Run workbook helper tests to verify they fail**

Run:

```bash
npm run test:unit -- tests/unit/workbook-utils.test.ts --runInBand
```

Expected: FAIL because `src/lib/utils/workbook.ts` does not exist.

- [x] **Step 6: Implement workbook helpers**

Create `src/lib/utils/workbook.ts` using `exceljs` for XLSX read/write and a simple quoted-field CSV parser for CSV files.

- [x] **Step 7: Migrate import parsing**

Update `src/lib/services/importService.ts` to use `parseWorkbookRows` instead of `xlsx`.

- [x] **Step 8: Migrate client preview**

Update `src/components/libraries/ImportLibraryModal.tsx` to use `parseWorkbookRows` or `previewWorkbookFile`.

- [x] **Step 9: Migrate export route**

Update `src/app/api/export/route.ts` to use `writeXlsxWorkbook` instead of `xlsx` workbook APIs.

- [x] **Step 10: Verify targeted tests and dependency state**

Run:

```bash
npm run test:unit -- tests/unit/dependency-risk.test.ts tests/unit/workbook-utils.test.ts --runInBand
npm ls react react-dom next --depth=0
npm run typecheck
npm audit --omit=dev --registry=https://registry.npmjs.org
```

Expected: dependency guard and workbook tests pass; React/Next no longer invalid; typecheck passes; audit output is improved and any remaining production advisories are recorded for follow-up.

- [x] **Step 11: Commit Batch 3**

Run:

```bash
git add package.json package-lock.json src/lib/utils/workbook.ts src/lib/services/importService.ts src/app/api/export/route.ts src/components/libraries/ImportLibraryModal.tsx tests/unit/dependency-risk.test.ts tests/unit/workbook-utils.test.ts docs/security/2026-07-08-dependency-audit.md docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-3-dependencies.md
git commit -m "fix: reduce production dependency risks"
```

Expected: Commit created. Do not push.

## Self-Review

- Spec coverage: this plan covers React/Next alignment, `xlsx`, `node-fetch`, `ngrok`, `@types/echarts`, and auditable production dependency risk from #164.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: workbook helper function names and return shapes are consistent across tests and migration steps.
