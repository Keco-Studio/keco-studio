# Remove Math.js Client Overhead

## Context

Real-environment profiling of the 17-row `深海灯塔 Type E2E` story library showed that Supabase reads complete in hundreds of milliseconds, while `next dev` loads about 17.4 MB of decoded JavaScript and can block the main thread for 18.9 seconds. Eight development chunks attributable to `mathjs` account for about 2.1 MB. The production build switches to Script view in 67-116 ms, so this change targets client bundle and development responsiveness without changing story playback.

## Decision

Remove `mathjs` from the formula evaluator and package dependencies. Replace its nine numeric operations with small local helpers based on JavaScript number arithmetic:

- addition, subtraction, multiplication, and division use native operators;
- sum and average use `Array.prototype.reduce`;
- minimum and maximum use `Math.min` and `Math.max`;
- decimal rounding uses a local finite-number helper that preserves the existing configured decimal precision.

The formula evaluator remains synchronous. Its public API, supported expression syntax, null handling, division-by-zero behavior, circular-reference protection, and four-decimal result normalization remain unchanged.

## Boundaries

This change does not alter Story IR conversion, script table compilation, visual novel playback, database access, formula syntax, or stored values. It does not introduce another numeric library.

## Verification

Development follows TDD:

1. Add a static regression test proving the client formula path and production dependencies do not reference `mathjs`.
2. Add or retain behavioral tests for arithmetic, aggregate functions, decimal rounding, empty aggregates, and division by zero.
3. Confirm the new regression test fails before implementation and passes afterward.
4. Run focused formula tests, TypeScript checks, lint, production build, and `git diff --check`.
5. Repeat the authenticated Playwright test against the real story library and compare page-ready and Script-view timings, JavaScript size, and long tasks.

## Success Criteria

- `mathjs` is absent from `package.json`, `package-lock.json`, and client source imports.
- Existing formula results remain compatible with current tests.
- The application builds successfully.
- No `mathjs` development chunks are loaded in the real-browser regression.
- Script view remains functionally correct in the real story library.
