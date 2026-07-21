# Task 6 Implementation Report

## Status

Implemented the local/testable OAuth protected-resource discovery, authorization-server metadata, and dynamic client registration probe. No hosted endpoint was invoked and no remote OAuth client state was created.

## RED / GREEN

### RED 1

Command:

```bash
npx jest tests/unit/mcp/oauth-probe.test.ts --runInBand
```

Observed failure: Jest could not resolve `../../../scripts/probe-mcp-oauth` because the implementation did not exist.

### GREEN 1

Added the probe module and npm script. The focused suite passed 7 tests covering Bearer metadata parsing, issuer-path RFC 8414 URL construction, recursive credential/JWT redaction, the successful discovery/DCR flow, and a missing registration capability.

### RED 2

Self-review identified that a JWT stored as a non-secret URL query value could enter evidence. Added a regression test and observed the full JWT remain in `authorization_endpoint`.

### GREEN 2

Extended URL redaction to inspect query values for complete JWTs. The focused suite then passed all 8 tests.

## Files

- `scripts/probe-mcp-oauth.ts`: exported parsers/redactor and the discovery/DCR probe CLI.
- `tests/unit/mcp/oauth-probe.test.ts`: parser, RFC 8414, redaction, discovery, and failure tests.
- `package.json`: added `probe:mcp-oauth`.
- `package-lock.json`: intentionally unchanged because no dependency changed.

## Verification

- `npx jest tests/unit/mcp/oauth-probe.test.ts --runInBand`: 8 passed, 0 failed.
- `npx eslint scripts/probe-mcp-oauth.ts tests/unit/mcp/oauth-probe.test.ts`: exit 0.
- `npx tsc --noEmit --pretty false`: exit 0.
- Local CLI failure probe against `127.0.0.1:1`: exit 1 and no evidence file written.
- `git diff --check`: exit 0.

## Security Notes

- Evidence recursively redacts access tokens, refresh tokens, client secrets, authorization codes, PKCE verifiers, registration access tokens, ID tokens, and complete JWT values.
- Credential-bearing URL query parameters and complete JWT query values are redacted.
- Probe failures do not log HTTP response bodies.

## Concerns

- Successful DCR was tested with a local in-process fetch mock only, by design. Hosted compatibility and creation of a real dynamic client remain Task 8 work.

## Review Remediation

Addressed every Task 6 review finding with focused regressions:

- Redaction now covers compact three-part JWS and five-part JWE values, including nested arrays/objects and tokens embedded in URL paths, queries, and fragments.
- Credential-shaped fields ending in `token`, `code`, `verifier`, or `secret`, URL query/fragment credentials, and URL username/password values are redacted. Ordinary endpoint and code-challenge metadata remains visible.
- `parseBearerMetadata` now accepts `resource_metadata` only from an actual Bearer challenge, including a Bearer challenge in a multi-challenge header.
- Authorization, token, and registration endpoints must be nonempty valid HTTP(S) URLs; dynamic registration must return a nonempty `client_id`.
- Fetch and response JSON failures are converted to stable phase errors. The CLI emits only `OAuth probe failed.` for all failures and never prints caught native or remote-controlled error text.
- The exported argument parser rejects absent values and any next value beginning with `--`.

### RED 3

Command:

```bash
npx jest tests/unit/mcp/oauth-probe.test.ts --runInBand
```

Observed 9 failures covering non-Bearer metadata acceptance, absent argument parsing, invalid OAuth endpoints, blank `client_id`, propagated fetch/JSON text, and CLI native URL text disclosure.

### GREEN 3

The same focused suite passed all 22 tests after the protocol, validation, error-boundary, and argument-parser fixes.

## Final Review Verification

- `npx jest tests/unit/mcp/oauth-probe.test.ts --runInBand`: exit 0; 1 suite passed, 22 tests passed, 0 failed.
- `npx tsc --noEmit --pretty false`: exit 0.
- `npx eslint scripts/probe-mcp-oauth.ts tests/unit/mcp/oauth-probe.test.ts`: exit 0.
- `node --import tsx scripts/probe-mcp-oauth.ts --mcp-url 'not-a-url?access_token=cli-safety-sentinel' --output unused-evidence.json --redirect-uri http://127.0.0.1/callback`: expected exit 1; stderr was exactly `OAuth probe failed.`.
- `test ! -e unused-evidence.json`: exit 0; failure evidence was not written.
- `git diff --check`: exit 0.
- No hosted endpoint was called and no remote OAuth state was created.

## Important Test-Gap Remediation

The CLI failure test now writes to an evidence path inside a unique local temporary directory. After the real `spawnSync` process exits with status 1 and the generic `OAuth probe failed.` stderr, the test asserts that the evidence file does not exist. A `finally` block recursively removes the temporary directory even when an assertion fails.

Verification:

- `npx jest tests/unit/mcp/oauth-probe.test.ts --runInBand`: exit 0; 1 suite passed, 22 tests passed, 0 failed.
- `npx eslint tests/unit/mcp/oauth-probe.test.ts`: exit 0.
- `npx tsc --noEmit --pretty false`: exit 0.
- `git diff --check`: exit 0.
- No hosted endpoint was called and no remote OAuth state was created.
