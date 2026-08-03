# Document Script Generation Performance

**Date:** 2026-08-03  
**Status:** Approved for implementation  

## Goal

Reduce repeated document-to-script/table generation work without weakening the existing deterministic validation or mandatory LLM audit.

## Root Cause

The `/api/import-script` conversion path performs Story IR resolution before database writes. A deterministic 24-node fixture still spent 35.4 seconds on one Auditor request. Natural-language documents can make three sequential LLM requests, with adjudication and candidate retries on audit failures. Table and conversation exports use the same Story IR conversion but currently resolve it independently.

The derived-import client also downloads the document source and then uploads a generated text file, while the server re-reads the authoritative source to verify the signed snapshot. For document-derived requests the uploaded file is redundant.

## Design

### Conversion cache and in-flight coalescing

Add a bounded process-local cache around `resolveStoryForImport`. The cache key is a SHA-256 hash of the normalized plain-text source plus parser/prompt version. The resolved Story IR, projection, and audit result are immutable cache values. Cache entries expire after ten minutes and are limited to eight completed entries; in-flight promises are shared immediately so concurrent requests for the same source make one LLM conversion request. A failed or aborted conversion is never cached.

Because the key includes the complete source and conversion version, document edits and code/model changes cannot reuse stale results. The cache is an optimization only; cold serverless instances continue to execute the existing path.

### Derived import transport

When `sourceDocumentId` is present, `/api/import-script` no longer requires a `File`; it uses the verified server snapshot as the source and derives the filename from the document name. `runDocumentDerivedImport` stops appending the redundant file. Non-document file imports retain the current required-file validation and extension/size checks.

### Escaped Markdown screenplay fast path

Studio documents can persist visible Markdown punctuation as escaped text, including `\###`, `\*\*`, `\-`, and `\>`. Normalize those markers before story segmentation. When the normalized source contains at least one scene heading, at least two dialogue lines, and no real choice segments, build a linear Story Relationship Plan directly from the server-owned inventory. Scene headings, narration, dialogue speakers, action cues, commands, and source order remain deterministic.

This path is deliberately narrow. Documents with real choices continue through the explicit/natural branch parsers or the LLM fallback. A linear screenplay never calls Extractor, Graph Planner, or Auditor for document-derived generation.

### Observability

Keep the existing sanitized LLM telemetry and add conversion-cache progress events. Cache hits report a distinct progress message, while cache misses preserve the existing conversion progress contract. No source text, prompt, token, or authorization data is logged.

## Safety and error handling

- Snapshot authorization and freshness validation remain unchanged.
- Cache entries are keyed by source content, never by document ID alone.
- Cache failures fall back to normal conversion and do not change import errors.
- Aborted requests do not populate the cache.
- A cache hit still runs the existing Story IR database compilation and write path.
- File imports remain behaviorally unchanged.

## Testing

- Unit tests cover cache hits, concurrent coalescing, TTL/size eviction, failed conversion eviction, and abort behavior.
- Route tests cover document-derived requests without a file and preserve file-required validation for ordinary imports.
- Existing conversion, route, and derived-import tests remain green.
- TypeScript, lint, focused unit tests, and `git diff --check` are required before completion.

## Document-derived validation fast path

Document-derived table and conversation generation prioritizes interactive latency. After Story IR materialization, source coverage validation, graph validation, command validation, path enumeration, and table projection succeed, the request may accept the candidate without the independent LLM Auditor. Strictly structured documents therefore require no LLM calls; arbitrary prose still requires Extractor and Graph Planner but skips the final Auditor.

This policy is opt-in through `ResolveStoryPlanOptions` and is enabled only by document-derived `/api/import-script` requests. Ordinary file imports retain mandatory semantic audit. Results record `approval: 'validation_pass'` and `auditSkipped: true` so deterministic acceptance is never represented as an LLM audit.

The conversion cache key includes the audit policy. Audited and validation-only results cannot be reused across policy boundaries.
