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
- `tests/unit/mcp/oauth-project-binding.test.ts`
- `tests/unit/mcp/oauth-consent-wiring.test.ts`

## Tests

Focused Jest tests pass: 2 suites, 8 tests.

`npm run typecheck` and `npm run build` both fail in pre-existing Supabase Edge Function files included by the root TypeScript configuration (`Deno` globals, Deno `.ts` imports, and Deno-only module aliases). Next.js reports the application bundle compiled successfully before this type-check failure; no consent-page type error was reported.

## Concerns

- The installed Supabase Auth SDK's public authorization-details type does not include `resource`, so the client uses a narrow local extension and requires runtime validation.
- The helper validates the MCP path and UUID shape. The trusted Supabase resource origin must continue to be established by the metadata/OAuth server configuration; callers must not pass a user-supplied project ID as a substitute.
