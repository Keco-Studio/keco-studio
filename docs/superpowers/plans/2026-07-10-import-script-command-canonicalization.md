# Import Script Command Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make audited LLM story imports accept provider-stringified numeric command fields without allowing the provider to change or invent command semantics.

**Architecture:** Keep the Converter responsible for story and branch interpretation. Before strict Story IR parsing, traverse only known `commands` arrays and rebuild each command's derived `variable`, `operator`, and numeric `value` from its exact `source` string using the existing numeric-command parser; the existing provenance validator then proves that source occurs in the cited authoritative unit.

**Tech Stack:** TypeScript, Zod, Jest, MiniMax-M3 function tools, existing Story IR validator and table compiler.

## Global Constraints

- Do not expand the Legacy Adapter to bypass the LLM for the half-width nested-branch reproduction.
- Do not use general-purpose Zod coercion or accept arbitrary numeric strings.
- Supported command operators remain exactly `=`, `+=`, `-=`, `*=`, and `/=`.
- Preserve `sourceRefs`; normalize model-provided `source` only by extracting exactly one supported numeric command token from a structural wrapper such as `($trust+=1; jump O1)`.
- Missing, malformed, unsupported, or uncited command sources must fail closed before database writes.
- Unknown JSON properties and unsafe prototype keys must remain rejected.
- Converter and Auditor prompts, retry count, deadlines, and Agent Chat behavior remain unchanged.

---

### Task 1: Canonicalize Commands From Authoritative Source Syntax

**Files:**
- Modify: `src/lib/story-ir/conversion.ts:1-16,129-132,306-342`
- Test: `src/lib/story-ir/conversion.test.ts`

**Interfaces:**
- Consumes: `parseSingleNumericCommandFromText(text: string): { source: string; variable: string; operator: NumericOperator; value: number }` from `src/lib/story-ir/commands.ts`.
- Produces: `canonicalizeStoryCommands(value: unknown): unknown`, called after collection/source-ref normalization and before `parseStoryDocument`.

- [ ] **Step 1: Write failing command-canonicalization tests**

Add `canonicalizeStoryCommands` to the imports from `./conversion`, then add these focused tests:

```typescript
it('rebuilds redundant command fields from the exact command source', () => {
  const value = {
    commands: [{
      source: '$trust+=1',
      variable: 'wrong',
      operator: '-=',
      value: '1',
      sourceRefs: [{ sourceId: 'src', unitId: 'src:0', start: 0, end: 10 }],
    }],
  };

  expect(canonicalizeStoryCommands(value)).toMatchObject({
    commands: [{ variable: 'trust', operator: '+=', value: 1 }],
  });
});

it('rejects a command whose source is not supported numeric syntax', () => {
  expect(() => canonicalizeStoryCommands({
    commands: [{
      source: '$trust plus 1',
      variable: 'trust',
      operator: '+=',
      value: 1,
      sourceRefs: [],
    }],
  })).toThrow(/Invalid numeric command/);
});
```

Also add a mocked `resolveStoryForImport` case whose command has `value: '1'`, followed by a passing audit, and assert that the returned command value is numeric `1`. This proves the helper is wired into the production path.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test:unit -- --runInBand src/lib/story-ir/conversion.test.ts`

Expected: FAIL because `canonicalizeStoryCommands` is not exported and the mocked conversion rejects string-valued commands.

- [ ] **Step 3: Implement the minimal source-backed canonicalizer**

Add `parseSingleNumericCommandFromText` beside the strict parser. It returns the strict command unchanged, extracts one exact supported numeric token from a structural wrapper, and rejects text containing zero or multiple numeric commands. Preserve all object keys in the Converter and replace canonical command fields only for members of a `commands` array:

```typescript
const COMMAND_TOKEN_PATTERN = new RegExp(`${COMMAND_SOURCE_PATTERN}(?![.\\w])`, 'g');

export function parseSingleNumericCommandFromText(
  text: string
): ParsedNumericCommand & { source: string } {
  const trimmed = text.trim();
  try {
    return { source: trimmed, ...parseNumericCommand(trimmed) };
  } catch {
    const matches = Array.from(trimmed.matchAll(COMMAND_TOKEN_PATTERN), (match) => match[0].trim());
    if (matches.length !== 1) throw new Error(`Invalid numeric command source: ${text}`);
    const source = matches[0];
    return { source, ...parseNumericCommand(source) };
  }
}

export function canonicalizeStoryCommands(value: unknown): unknown {
  function visit(current: unknown): unknown {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== 'object') return current;

    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      result[key] = key === 'commands' && Array.isArray(child)
        ? child.map(canonicalizeCommand)
        : visit(child);
    }
    return result;
  }

  function canonicalizeCommand(candidate: unknown): unknown {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const record = visit(candidate) as Record<string, unknown>;
    if (typeof record.source !== 'string') return record;
    return Object.assign(record, parseSingleNumericCommandFromText(record.source));
  }

  return visit(value);
}
```

Wire the production conversion pipeline as:

```typescript
const document = parseStoryDocument(canonicalizeStoryCommands(
  canonicalizeStorySourceRefs(
    normalizeStoryCollections(parseModelJson(raw)),
    chunk.units
  )
));
```

A missing `source` remains unchanged so strict schema parsing rejects it. An invalid or ambiguous fragment throws through `parseSingleNumericCommandFromText` and becomes retry feedback. Unknown properties remain present for strict schema rejection.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm run test:unit -- --runInBand src/lib/story-ir/conversion.test.ts`

Expected: PASS for the complete conversion suite, including all new source-backed normalization tests.

- [ ] **Step 5: Commit the tested implementation**

```bash
git add src/lib/story-ir/conversion.ts src/lib/story-ir/conversion.test.ts
git commit -m "fix: canonicalize LLM story commands from source"
```

---

### Task 2: Verify the Complete Legacy-Style Story Through the Real Pipeline

**Files:**
- Modify only if a newly observed, independently reproduced validation defect requires another failing test first.
- Verify: `src/lib/story-ir/conversion.test.ts`, `src/lib/story-ir/tableCompiler.test.ts`, `src/lib/story-ir/validator.test.ts`

**Interfaces:**
- Consumes: `resolveStoryForImport(source, options)` and `compileStoryTable(document)`.
- Produces: evidence that the user fixture becomes a 17-column branch table and passes all project gates.

- [ ] **Step 1: Run the exact user fixture against configured MiniMax-M3 without database writes**

Use the existing read-only diagnostic invocation with `.env.local`, call `resolveStoryForImport`, then pass the returned document to `compileStoryTable`.

Expected assertions:

```text
converted = true
max option count = 2
columns = 17
choice groups = O1/O2, O1A/O1B, O2A/O2B
option commands = $trust+=1, $trust+=2, $trust+=1, $trust-=1, $trust+=2, $trust-=2
all four leaf branches reach Oend
no branch/merge/jump marker appears as speaker or visible content
```

- [ ] **Step 2: If the real provider exposes another defect, return to RED before production edits**

Add the smallest mocked response reproducing the exact new failure to `src/lib/story-ir/conversion.test.ts`, run it to observe the expected failure, then make only the corresponding source-backed normalization or validation correction. Do not weaken provenance, schema, graph, or audit checks.

- [ ] **Step 3: Run focused and full verification**

```bash
npm run test:unit -- --runInBand src/lib/story-ir/conversion.test.ts src/lib/story-ir/validator.test.ts src/lib/story-ir/tableCompiler.test.ts
npm run test:unit
npm run typecheck
npm run typecheck:api
npm run lint
npm run build
git diff --check
```

Expected: all Jest suites pass, both TypeScript checks exit `0`, ESLint has `0` errors, production build exits `0`, and `git diff --check` prints no errors.

- [ ] **Step 4: Push the completed branch**

Run: `git push origin scriptenhance7-10`

Expected: `origin/scriptenhance7-10` resolves to the same commit as local `HEAD`.

---

### Task 3: Remove Structural Syntax From Visible Option Text

**Files:**
- Modify: `src/lib/story-ir/conversion.ts`
- Test: `src/lib/story-ir/conversion.test.ts`

**Interfaces:**
- Consumes: raw Converter option objects after collection, source-ref, and command canonicalization.
- Produces: `canonicalizeStoryOptionTexts(value: unknown): unknown`, called before `parseStoryDocument`.

- [ ] **Step 1: Write failing option-text tests**

Add direct tests proving the exact imported value is cleaned, prose parentheses are retained, and non-structural text is unchanged:

```typescript
expect(canonicalizeStoryOptionTexts({
  options: [{ text: 'O1: Go left. ($trust+=1; jump O1)' }],
})).toMatchObject({ options: [{ text: 'Go left.' }] });

expect(canonicalizeStoryOptionTexts({
  options: [{ text: 'O1: Ask (why). ($trust+=1; jump O1)' }],
})).toMatchObject({ options: [{ text: 'Ask (why).' }] });

expect(canonicalizeStoryOptionTexts({
  options: [{ text: 'Ask: why (tomorrow)' }],
})).toMatchObject({ options: [{ text: 'Ask: why (tomorrow)' }] });
```

Update the mocked `resolveStoryForImport` regression so its option text contains the complete structured source line and assert that the returned option text is display-only while target and commands remain unchanged.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm run test:unit -- --runInBand src/lib/story-ir/conversion.test.ts`

Expected: FAIL because `canonicalizeStoryOptionTexts` does not exist and the pipeline returns the structural option string unchanged.

- [ ] **Step 3: Implement the minimal canonicalizer**

```typescript
const OPTION_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}\s*[：:]\s*([\s\S]+)$/;
const OPTION_JUMP_PATTERN = /(?:jump|跳转)\s+[A-Za-z][A-Za-z0-9_-]{0,63}/i;

function cleanStructuredOptionText(text: string): string {
  const match = OPTION_PREFIX_PATTERN.exec(text.trim());
  if (!match) return text;
  const body = match[1].trim();
  const closing = body.at(-1);
  const opening = closing === ')' ? '(' : closing === '）' ? '（' : '';
  if (!opening) return text;

  const metadataStart = body.lastIndexOf(opening);
  if (metadataStart < 0) return text;
  const metadata = body.slice(metadataStart + 1, -1);
  const displayText = body.slice(0, metadataStart).trim();
  return displayText && OPTION_JUMP_PATTERN.test(metadata) ? displayText : text;
}
```

Traverse only members of known `options` arrays, preserve all other fields and unknown properties, and call the canonicalizer after command canonicalization but before strict Story IR parsing.

- [ ] **Step 4: Run focused and full verification**

Run the focused conversion test, all unit tests, both TypeScript checks, lint, build, and `git diff --check`. Then import the exact user fixture under a unique Library name and query its option cells to verify `O1/O2` prefixes and metadata wrappers are absent.

- [ ] **Step 5: Commit and push**

```bash
git add docs/superpowers/specs/2026-07-10-import-script-story-ir-design.md docs/superpowers/plans/2026-07-10-import-script-command-canonicalization.md src/lib/story-ir/conversion.ts src/lib/story-ir/conversion.test.ts
git commit -m "fix: clean structural syntax from story options"
git push origin scriptenhance7-10
```
