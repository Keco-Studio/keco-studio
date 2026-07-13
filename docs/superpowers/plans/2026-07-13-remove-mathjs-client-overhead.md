# Remove Math.js Client Overhead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `mathjs` from the browser dependency graph while preserving all existing formula results used by Keco Studio.

**Architecture:** Keep the current synchronous formula parser and evaluator. Replace the imported numeric primitives with private native-number helpers inside `src/lib/utils/formula.ts`, then remove the package dependency. A static dependency test prevents the heavy client import from returning, while behavioral tests exercise the public formula API.

**Tech Stack:** TypeScript, Jest, Next.js 16, npm lockfile, Playwright real-environment profiling

## Global Constraints

- Do not change Story IR conversion, script playback, database access, formula syntax, or stored values.
- Do not introduce another numeric library.
- Preserve synchronous formula evaluation and four-decimal result normalization.
- Preserve null handling, division-by-zero behavior, aggregate semantics, and circular-reference protection.

---

### Task 1: Replace Math.js With Native Numeric Helpers

**Files:**
- Create: `tests/unit/formula-lightweight-runtime.test.ts`
- Modify: `src/lib/utils/formula.ts:1-11,31-38,239-252,337-372`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `computeFormulaValuesForRow(fields: FormulaEvaluableField[], propertyValues: Record<string, any>): Record<string, any | null>`
- Produces: unchanged `computeFormulaValuesForRow` behavior with no `mathjs` runtime dependency

- [ ] **Step 1: Write the behavior and dependency regression test**

Create `tests/unit/formula-lightweight-runtime.test.ts` with tests that call `computeFormulaValuesForRow` for arithmetic and built-in aggregate functions, and read `package.json` plus `src/lib/utils/formula.ts` to assert that neither references `mathjs`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { computeFormulaValuesForRow, type FormulaEvaluableField } from '@/lib/utils/formula';

const formula = (id: string, name: string, expression: string): FormulaEvaluableField => ({
  id,
  name,
  dataType: 'formula',
  formulaExpression: expression,
});

describe('lightweight formula runtime', () => {
  it('preserves arithmetic, aggregate, and decimal rounding behavior', () => {
    const fields: FormulaEvaluableField[] = [
      { id: 'a', name: 'A', dataType: 'float' },
      { id: 'b', name: 'B', dataType: 'float' },
      formula('sum', 'Sum', 'SUM(A, B, 3)'),
      formula('average', 'Average', 'AVERAGE(A, B)'),
      formula('minimum', 'Minimum', 'MIN(A, B, -4)'),
      formula('maximum', 'Maximum', 'MAX(A, B, 9)'),
      formula('rounded', 'Rounded', 'ROUND(-1.005, 2)'),
      formula('arithmetic', 'Arithmetic', 'A + B'),
      formula('divideByZero', 'DivideByZero', 'A / 0'),
    ];

    expect(computeFormulaValuesForRow(fields, { a: 0.1, b: 0.2 })).toMatchObject({
      sum: 3.3,
      average: 0.15,
      minimum: -4,
      maximum: 9,
      rounded: -1.01,
      arithmetic: 0.3,
      divideByZero: Infinity,
    });
  });

  it('does not include mathjs in the client formula runtime or dependencies', () => {
    const root = process.cwd();
    const formulaSource = fs.readFileSync(path.join(root, 'src/lib/utils/formula.ts'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

    expect(formulaSource).not.toContain('mathjs');
    expect(packageJson.dependencies?.mathjs).toBeUndefined();
    expect(packageJson.devDependencies?.mathjs).toBeUndefined();
    expect(packageLock.packages?.['node_modules/mathjs']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/formula-lightweight-runtime.test.ts`

Expected: the behavioral test passes, but the dependency test fails because `formula.ts` imports `mathjs` and `package.json` declares it.

- [ ] **Step 3: Implement the local numeric helpers**

Remove the `mathjs` import and add private helpers near `FORMULA_DECIMAL_DIGITS`:

```ts
function roundToDigits(value: number, digits: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(digits) || digits < 0 || digits > 15) {
    return Number.NaN;
  }
  if (digits === 0) return Math.round(value);
  const factor = 10 ** digits;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * factor) / factor;
}

function sumNumbers(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
```

Use native `+`, `-`, `*`, `/`, `Math.min`, `Math.max`, `sumNumbers`, `sumNumbers(values) / values.length`, and `roundToDigits` at the existing call sites. Return `null` from `ROUND` when `roundToDigits` produces a non-finite result.

- [ ] **Step 4: Remove the dependency**

Run: `npm uninstall mathjs`

Expected: `mathjs` is removed from `package.json`, `package-lock.json`, and `node_modules` without changing unrelated dependency versions.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm run test:unit -- --runInBand tests/unit/formula-lightweight-runtime.test.ts`

Expected: both tests pass.

- [ ] **Step 6: Run repository verification**

Run:

```bash
npm run test:unit -- --runInBand
npm run typecheck
npm run typecheck:api
npm run lint
npm run build
git diff --check
```

Expected: all commands pass; ESLint may report only pre-existing warnings and zero errors.

- [ ] **Step 7: Repeat the authenticated real-environment profile**

Start a fresh development server and run the existing `/tmp/profile-script-visual-ui.mjs` against `深海灯塔 Type E2E 1783847766703`.

Expected: the Script view remains functional, no `mathjs` resource is loaded, console errors remain empty, and the decoded development JavaScript total is lower than the 17.4 MB baseline.

- [ ] **Step 8: Commit the implementation**

```bash
git add tests/unit/formula-lightweight-runtime.test.ts src/lib/utils/formula.ts package.json package-lock.json
git commit -m "perf: remove mathjs from client formula runtime"
```
