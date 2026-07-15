# Feature Specification: Fix parser colon detection past leading time tokens (issue #176)

**Feature Branch**: `issue-fix-172-188`
**Created**: 2026-07-09
**Status**: Draft
**Input**: GitHub issue #176 — `findColon` only inspects the first `:`/`：`; a line like `12:30: dialogue text` has its first colon inside a time token, so the speaker separator is missed and the whole line is mis-classified as narration.

## Overview

`findColon` exists in two files with the same logic:
- `src/lib/script-parser/classifier.ts:54-68`
- `src/lib/script-parser/parser.ts:82` (same implementation)

Current logic (classifier.ts:54-68):

```ts
function findColon(line: string): number {
  const cPos = line.indexOf('：');
  const ePos = line.indexOf(':');
  if (cPos === -1) {
    if (ePos > 0 && /\d/.test(line[ePos - 1]) && /\d/.test(line[ePos + 1] ?? '')) {
      return -1;                       // digit:digit → treat as time, no colon
    }
    return ePos;
  }
  if (ePos === -1) return cPos;
  if (ePos > 0 && /\d/.test(line[ePos - 1]) && /\d/.test(line[ePos + 1] ?? '')) {
    return cPos;                       // half-width is a time; fall back to full-width
  }
  return Math.min(cPos, ePos);
}
```

### Investigation findings (verified 2026-07-09)

1. The function only ever looks at `indexOf` — the **first** occurrence of each colon variant. It has a special case for a digit-surrounded half-width colon (a time like `12:30`), but it only handles the *first* colon.
2. Failure case `12:30: dialogue text` (half-width, no full-width colon present): `cPos === -1`, `ePos` points at the colon in `12:30`. `line[ePos-1]`=`2` and `line[ePos+1]`=`3` are both digits, so the guard returns `-1` — reporting "no colon at all." The real speaker/content separator (the second `:`, after `30`) is never found, so the caller at `classifier.ts:355` (`const colonPos = findColon(stripped)`) treats the entire line as narration and the speaker+dialogue split is lost.
3. The same defect affects the full-width branch: `12:30：dialogue` returns `cPos` (correct here by luck), but a line whose only real separator sits after a leading `HH:MM:` half-width time is not scanned past the first digit-colon.
4. `parser.ts` uses `findColon` at lines 172, 183, 221, 251 for the same speaker/narration decision, so the fix MUST be applied to both copies (or unified) to avoid divergent behavior.
5. Memory note: colocated parser tests live under `src/` and Jest `roots` must include `src/` for them to run in CI — place regression tests where they will actually execute (see `specs/009-issue-159-script-parser-data-loss/spec.md`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Speaker line with a leading time is parsed correctly (Priority: P1)

As a script author, a dialogue line that begins with a timestamp (e.g. `12:30: dialogue`) is parsed as speaker/time + dialogue, not silently demoted to narration.

**Why this priority**: This is the reported data-loss bug; mis-classification drops the speaker attribution for timestamped lines.

**Independent Test**: Unit-test `findColon` and the classifier on `12:30: dialogue text` and assert the returned position is the separator colon after `30`, and the line classifies as a dialogue/speaker node.

**Acceptance Scenarios**:
1. **Given** `12:30: dialogue text`, **When** `findColon` runs, **Then** it returns the index of the second `:` (the separator), not `-1`.
2. **Given** the same line, **When** classified, **Then** it is a speaker/dialogue node, not narration.
3. **Given** a pure time line `12:30` with no further colon, **When** `findColon` runs, **Then** it returns `-1` (no separator) — unchanged.
4. **Given** a normal speaker line `JOHN：dialogue` / `JOHN: dialogue`, **When** classified, **Then** behavior is unchanged.

### Edge Cases

- Multiple time-like tokens then a separator: `08:00 to 12:30: dialogue` → the separator is the colon after `30`.
- Mixed full/half-width: line contains a half-width time and a full-width separator `12:30：dialogue` → returns the full-width separator position.
- Colon at end with nothing after (`Name:`) → still treated as a separator (empty content), matching current non-time behavior.
- No colon at all → `-1`, unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `findColon` MUST continue scanning past any colon that is a time separator (digit on both sides) to find the first colon that is a genuine speaker/content separator.
- **FR-002**: A digit-surrounded colon (`\d:\d`) MUST NOT itself be returned as the separator; only a non-time colon qualifies.
- **FR-003**: If no non-time colon exists, `findColon` MUST return `-1` (preserving current behavior for pure time lines).
- **FR-004**: Full-width `：` and half-width `:` MUST both be scanned; when both a time colon and a real separator exist in either width, the earliest genuine separator wins.
- **FR-005**: The fix MUST be applied consistently to both `classifier.ts` and `parser.ts` (prefer extracting a single shared helper to prevent divergence).

### Non-Functional Requirements

- **NFR-001**: No change to how callers interpret the returned index; only the index computation changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A regression test on `12:30: dialogue text` fails against the current implementation (returns `-1`) and passes after the fix (returns the separator index; classifies as dialogue).
- **SC-002**: Existing parser tests for normal speaker lines and pure time lines still pass.
- **SC-003**: `npm run test:unit` runs the new tests (confirm they are under a Jest `roots` path) and is green, along with `npm run lint`.

## Out of Scope

- Broader time-format parsing/normalization.
- Any change to how narration vs dialogue is rendered downstream.
