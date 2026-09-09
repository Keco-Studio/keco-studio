# GDS Refresh Recovery and Document Translation Isolation Design

## Problem

Two browser failures need a durable fix:

1. Refreshing the Game Design System creation flow loses every form field and
   the active generation progress view. The server job can continue while the
   client forgets its job id, so a user may submit a duplicate generation.
2. Browser translation can rewrite editable document or library-cell DOM. When
   translation is cancelled, the editor may retain altered text and its blur
   handler can persist that text as if it were user input.

The existing root `translate="no"` attribute prevents most automatic page
translation, but editable surfaces must also declare the boundary explicitly.

## Goals

- Restore an in-progress GDS creation session after a same-tab hard refresh.
- Preserve a pre-submit draft after refresh without automatically submitting it.
- Reuse the original idempotency key when recovering a submitted request.
- Never create a second generation job solely because the page was refreshed.
- Prevent browser translation from modifying editable document and library
  content surfaces.
- Keep recovery data bounded, versioned, and scoped to the current browser tab.
- Add focused unit and browser-level regression coverage.

## Non-goals

- Cross-device or cross-browser draft synchronization.
- Persisting abandoned creation drafts in the database.
- Translating document content inside the application.
- Reworking the document collaboration protocol or library data model.
- Adding a database migration for client-only session recovery.

## Design

### 1. GDS creation recovery record

Add a small client-side recovery module with a versioned record stored in
`sessionStorage` under a feature-specific key. The record contains:

- `version`: storage schema version;
- `ownerId`: authenticated user id that owns the recovery state;
- `phase`: `draft` or `submitted`;
- `form`: raw UI state needed to restore every creation stage, including the
  selected stage, `sourceProjectId`, art preset selection, and incomplete
  visual/reference rows;
- `request`: the normalized `GameDesignGenerationRequest` used for submission,
  present only after submission;
- `idempotencyKey`: the original valid request key;
- `jobId`: the returned generation job id when available;
- `retryKey`: the retry request key while a retry POST is in flight;
- `retryParentJobId`: the failed job id used by that retry request;
- `updatedAt`: epoch milliseconds for stale-record cleanup.

Draft records store raw form state because a normalized request cannot represent
incomplete rows or every UI selection. Submitted records retain both raw form
state and the exact normalized request that was sent. The user-entered
`pastedMarkdown` field is explicitly allowed, bounded by its existing request
limit; resolved source snapshots and base-system excerpts are never copied into
recovery storage. Do not store passwords or access tokens.

Records expire 24 hours after `updatedAt`; reads reject non-finite, future, or
otherwise invalid timestamps. Storage writes are best-effort: quota errors and
unavailable storage do not block the UI. Malformed, stale, or oversized records
are cleared. Serialized writes and parsed records are limited to 256 KiB
measured as UTF-8 bytes.

### 2. GDS lifecycle

- While the user edits the creation form, store a `draft` record after raw form
  state changes. Restore it only after authentication is ready and `ownerId`
  matches the current user, including the saved stage and incomplete rows. A
  record for another user is discarded before use.
- Immediately before the POST request, write a `submitted` record containing
  the request and idempotency key. This covers a refresh during the request.
- After the response, add `jobId` and keep the record while the job is
  `queued` or `running`.
- On mount, read one valid record for the current user/session:
  - `draft`: restore fields and stage only;
  - `submitted` with `jobId`: fetch the job and resume polling;
  - `submitted` without `jobId`: replay the POST with the same request and
    idempotency key, then persist the returned job id.
- The generation API checks owner and idempotency key before resolving live
  source snapshots or base-system content. This lets replay return the original
  job even if a selected source changed after the first request.
- Before a retry POST, persist `retryKey` and `retryParentJobId`. Replaying a
  retry uses the same key; once the replacement job is returned, promote its id
  to `jobId`, clear retry fields, and continue normal polling.
- On completed generation or explicit abandonment, clear the recovery record. A
  failed job remains recoverable so its existing Retry UI survives refresh; retry
  uses the existing job id and retry key and does not create a new generation
  request. No new `cancelled` status or cancellation API is added.
- Guard hydration so React Strict Mode does not apply the record twice or start
  two recovery requests.

The existing server idempotency contract remains authoritative. The client must
not invent a new key during recovery.

### 3. Translation isolation

Mark all editable document surfaces with `translate="no"`:

- the MDX document editor frame, allowing the attribute to inherit into the
  MDXEditor-managed contenteditable root;
- library table cell editors;
- text inputs in the library `AddNewRowForm` where applicable.

Also add the standard document-level `meta[name="google"]` value
`notranslate` alongside the existing root attribute. These declarations are
defense in depth and do not alter normal editor input, Markdown, or Yjs state.

No translated DOM text is ever copied back into authoritative state by the
normal browser translation path. The `CellEditor` blur guard also rejects a
value when the editable node changed externally without an input event; only
user input events update the authoritative candidate value. Existing
Lexical/Yjs handlers remain unchanged.

## Error handling

- Storage access and JSON parsing never block rendering or generation.
- A recovery fetch clears the record only when the server definitively reports
  that it is unusable, such as 403 or 404, or when local validation fails.
  Network failures and 5xx responses preserve the record so a later refresh can
  retry recovery, while showing the existing generation error state.
- A malformed or stale record is discarded without affecting server jobs.
- Translation isolation is declarative; no user-facing warning is required.

## Acceptance criteria

### GDS

- After entering values on any creation stage, a hard refresh restores the same
  values and selected stage.
- Recovery occurs only for the authenticated owner; logout followed by login as
  another user cannot expose or submit the previous user's state.
- After generation starts, a hard refresh shows the existing progress/job state
  and resumes polling without a second POST.
- If the refresh occurs before the first POST response, recovery replays the
  same idempotency key and the server returns the original job.
- Completing or abandoning the flow removes the session recovery record; failed
  jobs retain it and restore the Retry UI.
- Stale, malformed, invalid-timestamp, and over-256-KiB records are rejected;
  transient recovery failures retain an otherwise valid record.
- Existing create, retry, validation, and source-selection tests remain green.

### Documents and libraries

- The root document and MDX editor frame expose `translate="no"`; the MDX
  contenteditable root inherits it. Library cell editors and add-row text
  inputs expose the same boundary where applicable.
- A browser translation attempt cannot replace editable text through the normal
  auto-translation path.
- Existing document collaboration, cell editing, and reload persistence tests
  remain green.

### Verification and delivery

- Use deterministic DOM tests to assert translation boundaries and that a
  synthetic external DOM mutation followed by blur is not persisted. Treat an
  actual Chrome translate/cancel pass as manual verification because Playwright
  cannot invoke browser translation deterministically.
- Run focused unit tests, document/library tests, typecheck, lint, build, and
  the relevant Playwright suites.
- Run the repository Chinese-character gate before creating a PR.
- Require every newly tracked file in this change to contain no literal Chinese
  characters, including tests, fixtures, and documentation.
- Do not add or edit a Supabase migration for this client-only fix.
- Review the completed diff with a child agent, fix every Critical or Important
  finding, re-run affected tests, then create the PR.
