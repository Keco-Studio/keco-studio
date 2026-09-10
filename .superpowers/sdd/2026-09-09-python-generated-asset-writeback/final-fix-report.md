# Final Whole-Branch Fix Report

## Summary

Addressed all five findings from the final review wave as one test-driven
change set:

- PNG inspection bounds IDAT inflation to the exact expected scanline size and
  does not pass compressed ancillary chunks to the pixel decoder.
- PNG grayscale, truecolor, and indexed `tRNS` transparency is derived from
  actual decoded samples when it can be proven safely.
- SVG dimensions that cannot be represented by PostgreSQL `integer` are
  normalized to `null` both during inspection and at the registration RPC
  boundary.
- Printable ASCII filenames are preserved through a reversible storage-path
  encoding while legacy sanitized paths remain accepted.
- Acceptance cleanup resolves uncertain registration state through an exact
  administrative lookup and deletes storage only after registry cleanup is
  proven successful.

No deployment, remote access, environment-file change, plugin installation,
installed-cache mutation, or subagent/reviewer dispatch was performed.

## RED/GREEN Evidence

### 1. Bounded PNG decompression and `tRNS`

RED command:

```bash
./node_modules/.bin/deno test --config supabase/functions/mcp/deno.json \
  supabase/functions/mcp/image-metadata.test.ts
```

RED observations:

- A compact 1x1 PNG whose IDAT expanded to 64 MiB was accepted by the previous
  decoder path.
- Used grayscale, truecolor, and indexed `tRNS` samples were reported as
  opaque.

GREEN implementation:

- Parse and validate the original PNG signature, chunk order, critical chunks,
  lengths, and CRCs before decoding.
- Stream only concatenated IDAT data through `pako`, with output chunks capped
  to at most 64 KiB and total output capped to the exact non-interlaced or
  Adam7 scanline budget.
- Rebuild a decoder input containing only the signature, IHDR, optional PLTE,
  IDAT, and IEND chunks, preventing ancillary compressed data such as iCCP from
  reaching `fast-png`.
- Validate `tRNS` structure and compare its color key or palette alpha entries
  with the decoded samples.

GREEN result: the metadata suite passed 26/26, including IDAT and iCCP bombs
and used-versus-unused grayscale, truecolor, and indexed transparency cases.

### 2. SVG dimensions and PostgreSQL int4

RED command:

```bash
./node_modules/.bin/deno test --config supabase/functions/mcp/deno.json \
  --allow-env --allow-net \
  supabase/functions/mcp/image-metadata.test.ts \
  supabase/functions/mcp/image-tools.test.ts
```

RED observations:

- Positive fractional and out-of-int4 attribute dimensions remained numeric.
- Fractional and out-of-int4 viewBox dimensions remained numeric and reached
  registration arguments.

GREEN implementation:

- Accept dimensions only when they are positive integers no greater than
  `2147483647`.
- Retain integer-valued exponent syntax such as `1e2`.
- Reapply the same normalization immediately before the RPC as a defensive
  boundary.

GREEN result: metadata cases pass with null dimensions and the MCP registration
test proves `p_width` and `p_height` are null for unsafe SVG dimensions.

### 3. Printable ASCII filename preservation

RED command:

```bash
./node_modules/.bin/deno test --config supabase/functions/mcp/deno.json \
  --allow-env --allow-net supabase/functions/mcp/image-tools.test.ts
```

RED observations:

- Non-ASCII filenames could reach image preparation.
- A filename containing spaces was reconstructed from its sanitized storage
  leaf rather than preserved exactly.

GREEN implementation:

- Reject non-printable-ASCII filenames before storage preparation.
- Keep a raw storage leaf only when sanitization does not change the filename.
- Otherwise encode the exact printable ASCII filename as `~h` followed by its
  UTF-8 bytes in hexadecimal.
- Decode and revalidate the new representation during completion while
  continuing to accept pre-existing percent-encoded/sanitized leaves.

GREEN result: the image-tools suite passed 63/63. Coverage includes spaces,
plus/punctuation, tilde, a leading hyphen, Unicode rejection, crafted Unicode
hex rejection, exact retry reuse, and legacy prepared paths.

### 4. Double completion-response loss cleanup

RED command:

```bash
npm run test:unit -- --runInBand \
  tests/unit/mcp/python-generated-asset-acceptance.test.ts
```

RED observations:

- After two completion responses were lost following a remote commit, cleanup
  performed no exact registry lookup and could not delete the committed row.
- An ambiguous or metadata-mismatched row did not prevent object deletion.

GREEN implementation:

- Record the expected project, path, creator identity, filename, category,
  status, MIME type, SHA-256, dimensions, transparency, and size before the
  first registration attempt.
- Query at most two rows by the exact project/path after every attempted
  registration, validate the complete expected identity and metadata, and
  recover the asset ID only from one exact match.
- Delete the storage object only after registry absence is proven or the exact
  matched row has been deleted successfully.
- Treat ambiguous, mismatched, missing-when-expected, or failed registry lookup
  state as cleanup failure and retain the object.

GREEN result: the focused acceptance suite passed 11/11, including exact
row/object cleanup after two lost responses and safe object retention on a
mismatched row.

### 5. Existing behavior and integration surface

The tests above run through public MCP handlers and the real metadata inspector,
not test-only production branches. Existing generic completion behavior,
project path restrictions, signature and safe-SVG checks, ordered batch
responses, registration idempotency, and capability advertisement remain
covered by the focused and full suites below.

## Files Changed

- `scripts/accept-python-generated-asset-writeback.ts`
- `supabase/functions/mcp/deno.json`
- `supabase/functions/mcp/deno.lock`
- `supabase/functions/mcp/image-metadata.test.ts`
- `supabase/functions/mcp/image-metadata.ts`
- `supabase/functions/mcp/image-tools.test.ts`
- `supabase/functions/mcp/write-tools.ts`
- `tests/unit/mcp/python-generated-asset-acceptance.test.ts`
- `.superpowers/sdd/2026-09-09-python-generated-asset-writeback/final-fix-report.md`

The lockfile was restored after Deno verification so its final diff contains
only the direct `npm:pako@2.2.0` specifier. The existing transitive pako package
record and tarball metadata were preserved.

## Final Verification

Focused Deno:

```bash
./node_modules/.bin/deno test --config supabase/functions/mcp/deno.json \
  --allow-env --allow-net \
  supabase/functions/mcp/image-metadata.test.ts \
  supabase/functions/mcp/image-tools.test.ts \
  supabase/functions/mcp/server.test.ts
```

Result: 109 passed, 0 failed.

Focused Jest:

```bash
npm run test:unit -- --runInBand \
  tests/unit/mcp/python-generated-asset-acceptance.test.ts \
  tests/unit/database/project-game-assets-mcp-migration.test.ts \
  tests/unit/database/project-game-assets-mcp-registration.behavior.test.ts \
  tests/unit/mcp/capabilities-probe.test.ts \
  tests/unit/plugins/keco-plugin.test.ts \
  tests/unit/plugins/keco-claude-plugin.test.ts
```

Result: 5 suites and 102 tests passed; 1 database-gated suite and 9 tests were
skipped by the environment.

Repository-wide suites:

```bash
npm run test:mcp
npm run test:unit -- --runInBand --silent
```

Results:

- MCP: 294 passed, 0 failed.
- Unit: 607 suites and 4,310 tests passed; 23 suites and 246 tests skipped by
  repository configuration.

Static checks:

```bash
npm run check:mcp
./node_modules/.bin/deno fmt --check \
  supabase/functions/mcp/image-metadata.ts \
  supabase/functions/mcp/image-metadata.test.ts \
  supabase/functions/mcp/write-tools.ts \
  supabase/functions/mcp/image-tools.test.ts
npx eslint scripts/accept-python-generated-asset-writeback.ts \
  tests/unit/mcp/python-generated-asset-acceptance.test.ts
npx tsc --noEmit --pretty false
git diff --check
```

Result: all commands exited 0 on the final source tree. Deno-owned files are
intentionally ignored by ESLint and are checked by `deno check` and
`deno fmt --check` instead.

## Self-Review

- Confirmed IDAT decompression stops after at most the exact scanline budget
  plus one bounded output chunk and never decompresses ancillary chunks.
- Confirmed the original PNG, rather than only the decoder reconstruction,
  receives full CRC, ordering, and structure validation.
- Confirmed `tRNS` is validated before sample inspection and invalid or
  unprovable cases fail closed to null metadata.
- Confirmed unsafe SVG dimensions cannot reach PostgreSQL integer arguments,
  even if future metadata inspection regresses.
- Confirmed the storage leaf cannot introduce slashes and decoded filenames are
  accepted only after printable-ASCII and extension revalidation.
- Confirmed registration retries use identical arguments and metadata conflicts
  never overwrite an existing row.
- Confirmed acceptance cleanup never deletes the object when registry state is
  ambiguous or exact row deletion fails.
- Confirmed raw bytes, Base64, local/public/signed URLs, upload headers, bearer
  tokens, and service-role credentials remain outside MCP JSON and evidence.
- Confirmed the final diff contains no temporary diagnostics and no unrelated
  source or metadata churn.

## Concerns And Deferred Evidence

- The database behavior suite's 9 integration tests remain skipped because the
  local database environment is not configured. The migration itself was not
  changed in this fix wave; its static and capability coverage passed.
- Live acceptance was not run because the brief forbids deployment and remote
  contact. No remote registry row or storage object was created or deleted.
- No build was required by the final-fix completion contract. The preceding
  Task 6 report records the known local build prerequisite for public Supabase
  environment variables, which were intentionally not supplied or read here.
