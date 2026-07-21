# Task 5 Report: Project-Binding-Aware OAuth Consent

## RED

Ran:

```text
npx jest tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts
```

Both suites failed before implementation because the binding helper and consent client did not exist.

## GREEN

Implemented strict UUID extraction from the final `mcp/<projectId>` URL path, a Suspense-wrapped OAuth consent page, the client consent flow using Supabase's supported OAuth methods, project access verification, fail-closed approval behavior, and OAuth server configuration with dynamic registration enabled.

Approval remains disabled when the authorization details have no valid resource binding, when an existing `redirect_url` indicates consent was already granted, or when the signed-in user cannot access the bound project. Binding is never inferred from query parameters, state, referrer, client display metadata, or other client-controlled values.

## Files

- `src/lib/mcp/oauthProjectBinding.ts`
- `src/app/oauth/consent/page.tsx`
- `src/components/mcp/OAuthConsentClient.tsx`
- `src/components/mcp/OAuthConsent.module.css`
- `supabase/config.toml`
- `tsconfig.json`
- `tests/unit/mcp/mcp-tsconfig-boundary.test.ts`
- `tests/unit/mcp/oauth-consent-behavior.test.ts`
- `tests/unit/mcp/oauth-project-binding.test.ts`
- `tests/unit/mcp/oauth-consent-wiring.test.ts`

## Tests

The original focused Jest tests passed: 2 suites, 8 tests. Review-fix verification and the current build status are recorded below.

## Concerns

- The installed Supabase Auth SDK's public authorization-details type does not include `resource`, so the client uses a narrow local extension and requires runtime validation.
- The trusted Supabase resource origin is read from `NEXT_PUBLIC_SUPABASE_URL` and normalized with the same helper used to publish OAuth metadata. Callers must not pass a user-supplied project ID as a substitute.

## Important Review Fixes

- Replaced independently retained consent fields with one authorization-ID-keyed state. The approve button is enabled only for a verified binding containing the current authorization ID, the exact resource project ID, and a successful project membership lookup. `decide('approve')` independently enforces that same binding.
- Added async component behavior coverage proving approval remains blocked while membership lookup is pending and that changing `authorization_id` immediately invalidates an earlier verified binding.
- Restricted OAuth resource parsing to the normalized configured Supabase origin and exact `/functions/v1/mcp/{UUID}` path. Credentials, query strings, fragments, hostile origins, scheme changes, non-configured ports, whitespace, and path variants are rejected.
- Excluded `supabase/functions` from the root Next/Node TypeScript project. Deno Edge sources remain covered by `npm run check:mcp`.

## Review Fix Verification

RED evidence before the fixes:

```text
npx jest tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-behavior.test.ts tests/unit/mcp/mcp-tsconfig-boundary.test.ts --runInBand
3 suites failed; 14 failed and 8 passed. The failures reproduced both approval races, hostile resource acceptance, and the missing tsconfig boundary.
```

GREEN evidence after the fixes:

```text
npx jest tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-behavior.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts tests/unit/mcp/mcp-tsconfig-boundary.test.ts --runInBand
4 suites passed; 24 tests passed.

npm run typecheck
exit 0

npm run check:mcp
exit 0

npx eslint src/components/mcp/OAuthConsentClient.tsx src/lib/mcp/oauthProjectBinding.ts tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-behavior.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts tests/unit/mcp/mcp-tsconfig-boundary.test.ts
exit 0, no warnings
```

`npm run build` compiled successfully and finished TypeScript, then failed while prerendering `/_not-found` because the isolated worktree had no Supabase public environment variables. A rerun with public placeholder variables exited unexpectedly during Turbopack compilation without a final diagnostic or `BUILD_ID` and left a stale `.next/lock`; a bounded webpack fallback exited 1 with only `Build failed because of webpack errors` retained by the runner. No successful full production build is claimed.
