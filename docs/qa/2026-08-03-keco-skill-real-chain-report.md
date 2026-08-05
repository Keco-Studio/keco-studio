# Keco Skill Post-Merge Real-Chain Report

Date: 2026-08-03

## A/B Result

| Arm | Score | Rate |
|---|---:|---:|
| Without Skill | 16/24 | 66.7% |
| With Skill, final | 21/21 | 100% |

The denominators differ intentionally. Write-dependent behavior that was not
observed because a collision stopped the workflow is marked N/A and excluded
from that scenario's denominator. The detailed scenario evidence is in
`docs/qa/2026-08-03-keco-skill-ab-report.md`.

The observed Skill improvements were concentrated in:

- preview and explicit-confirmation discipline;
- create-new-only collision handling;
- required-reference dependency ordering;
- stable identifier mapping;
- canonical reference values using `{ assetId, fieldId }`;
- read-back verification before a success claim.

## Pull Request And CI

- Pull request: https://github.com/Keco-Studio/keco-studio/pull/287
- Final state: `MERGED`
- Merge commit: `b65959a157c81531af9035832a6737f227246d4a`
- Merged at: `2026-08-03T14:01:50Z`
- Review threads: 5/5 resolved

The final PR run passed:

- CI build;
- CodeQL JavaScript/TypeScript analysis;
- deployment preview;
- English-only tracked-file check;
- four Playwright shards.

The migration and production MCP deployment jobs were skipped as expected
because the final review commit did not change migrations or the production MCP
function.

Local validation before the final push passed:

- MCP tests: 134/134;
- Jest: 348 suites and 2,356 tests passed;
- production Next.js build;
- Skill validator;
- Plugin validator;
- focused plugin contract tests: 4/4.

## Plugin Loaded For The Test

The first read-only process exposed a stale local plugin cache. It was stopped
before any write. The plugin was reinstalled through the cachebuster flow as:

`0.1.0+codex.20260803140436`

The installed Skill directory and MCP configuration were compared against the
merged source. All Skill file hashes matched before the real-chain test was
restarted in a new Codex process.

## Real-Chain Scope

- Disposable project ID:
  `9d2d5247-1dc8-473f-a01a-afe3cb1ae31b`
- Selected source document ID:
  `453eecac-9ec0-4748-87a6-c6474456e4b0`
- BuildPlan version: 1
- Evidence suffix: `SkillChain-20260803-2202`

The source was read completely through MCP. Raw source contents and OAuth
credentials are intentionally omitted from this report.

The workflow completed the following gates:

1. account connection and exact project resolution;
2. project structure and document discovery;
3. complete document read;
4. BuildPlan generation and collision preflight;
5. zero-write preview;
6. explicit user confirmation after the preview;
7. dependency-ordered writes;
8. two independent schema and row read-back passes.

## Retained Evidence

No evidence object was deleted or rolled back.

| Table | Table ID | Verified rows |
|---|---|---:|
| Project Overview - SkillChain-20260803-2202 | `a26fce98-d52b-4fad-8875-c3df8f11e1ea` | 1 |
| Plan Items - SkillChain-20260803-2202 | `7f10b8af-9e27-4824-a819-24bf901c61fe` | 3 |
| Working Agreements - SkillChain-20260803-2202 | `0b190d0c-99ae-4556-82fa-d35b9874ca60` | 3 |

Verified row IDs:

| Stable key | Row ID |
|---|---|
| project-new | `8a2a09f8-4e25-42d1-b519-d1bc74ba8286` |
| plan-item-01 | `a7dd426c-0e63-44f5-a9f2-cbb1ba9011ba` |
| plan-item-02 | `24ffae93-569d-478f-b07b-d490a51981c0` |
| plan-item-03 | `3cb7c146-a1fe-41ca-8d93-10fa7c26c888` |
| agreement-01 | `1bbd580a-7ce6-4de2-9923-845886934b75` |
| agreement-02 | `9f2d17ad-e9c4-4f59-a198-ce08e19b6fe9` |
| agreement-03 | `e91a8611-c9c2-40be-8f3c-e1fa22b347a8` |

Reference contract IDs:

- parent `Project Key` field:
  `a6dddbb5-58d3-4ea2-88f3-b74b89c1ceb4`;
- Plan Items `Project` reference field:
  `8182079c-b4e5-4ab6-85c1-4654554004fd`;
- Working Agreements `Project` reference field:
  `daac0024-90b0-4594-94fc-ea33a9fe3178`.

All six child references resolved to:

```json
{
  "assetId": "8a2a09f8-4e25-42d1-b519-d1bc74ba8286",
  "fieldId": "a6dddbb5-58d3-4ea2-88f3-b74b89c1ceb4"
}
```

## Verification Result

- Three first upserts used `reuseEmpty: true`.
- The resulting row count was exactly 1 + 3 + 3, with no extra empty rows.
- Both required reference fields were created as required fields.
- All six required references were included in the same first upsert calls as
  their rows' non-reference values.
- Both read-back passes observed all seven stable keys.
- Sequence values `[1, 2, 3]` and focus flags
  `[true, true, false]` matched the confirmed plan.
- All row queries completed with `hasMore: false`.
- No schema, value, count, or reference mismatch was found.
- No delete or rollback tool was called.

The real Keco account MCP chain passed end to end. Unrelated configured MCP
servers emitted authentication warnings during process startup, but they did
not participate in this test or affect the Keco results.
