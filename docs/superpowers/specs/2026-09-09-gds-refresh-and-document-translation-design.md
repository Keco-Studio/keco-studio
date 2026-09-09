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
- `phase`: `draft` or `submitted`;
- `request`: the normalized `GameDesignGenerationRequest` used for submission;
- `idempotencyKey`: the original valid request key;
- `jobId`: the returned generation job id when available;
- `updatedAt`: epoch milliseconds for stale-record cleanup.

The raw form state is converted to the existing normalized request shape before
being stored. Do not store passwords, access tokens, or source excerpts.

Storage writes are best-effort: quota errors, unavailable storage, malformed
JSON, and records larger than a fixed 256 KiB limit are ignored and cleared.

### 2. GDS lifecycle

- While the user edits the creation form, store a `draft` record after the
  normalized input changes. The record is restored on mount and selects the
  saved stage.
- Immediately before the POST request, write a `submitted` record containing
  the request and idempotency key. This covers a refresh during the request.
- After the response, add `jobId` and keep the record while the job is
  `queued` or `running`.
- On mount, read one valid record for the current user/session:
  - `draft`: restore fields and stage only;
  - `submitted` with `jobId`: fetch the job and resume polling;
  - `submitted` without `jobId`: replay the POST with the same request and
    idempotency key, then persist the returned job id.
- On completed, failed, cancelled, or explicitly abandoned creation, clear the
  recovery record. A failed job keeps its normal retry UI, but retry uses the
  existing job id and retry key; it does not create a new generation request.
- Guard hydration so React Strict Mode does not apply the record twice or start
  two recovery requests.

The existing server idempotency contract remains authoritative. The client must
not invent a new key during recovery.

### 3. Translation isolation

Mark all editable document surfaces with `translate="no"`:

- the MDX document editor frame and its contenteditable root;
- library table cell editors and any add-row contenteditable editor.

Also add the standard document-level `meta[name="google"]` value
`notranslate` alongside the existing root attribute. These declarations are
defense in depth and do not alter normal editor input, Markdown, or Yjs state.

No translated DOM text is ever copied back into authoritative state by this
change. Existing blur and Lexical/Yjs handlers remain unchanged unless a test
demonstrates that an explicitly marked surface still receives a translation
mutation.

## Error handling

- Storage access and JSON parsing never block rendering or generation.
- A failed recovery fetch shows the existing generation error and clears only
  the unusable recovery record.
- A malformed or stale record is discarded without affecting server jobs.
- Translation isolation is declarative; no user-facing warning is required.

## Acceptance criteria

### GDS

- After entering values on any creation stage, a hard refresh restores the same
  values and selected stage.
- After generation starts, a hard refresh shows the existing progress/job state
  and resumes polling without a second POST.
- If the refresh occurs before the first POST response, recovery replays the
  same idempotency key and the server returns the original job.
- Completing or abandoning the flow removes the session recovery record.
- Existing create, retry, validation, and source-selection tests remain green.

### Documents and libraries

- The root document, MDX editor frame/contenteditable root, library cell editor,
  and add-row editor expose `translate="no"` in the rendered DOM.
- A browser translation attempt cannot replace editable text through the normal
  auto-translation path.
- Existing document collaboration, cell editing, and reload persistence tests
  remain green.

### Verification and delivery

- Run focused unit tests, document/library tests, typecheck, lint, build, and
  the relevant Playwright suites.
- Run the repository Chinese-character gate before creating a PR.
- Do not add or edit a Supabase migration for this client-only fix.
- Review the completed diff with a child agent, fix every Critical or Important
  finding, re-run affected tests, then create the PR.
