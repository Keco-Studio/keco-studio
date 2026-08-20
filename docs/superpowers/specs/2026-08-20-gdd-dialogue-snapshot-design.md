# GDD Dialogue Snapshot Synchronization Design

## Scope and goals

When a GDD-derived dialogue scene finishes conversion, the system must keep the
GDD, Dialogue Document, and Script workspace navigable as one workflow. A
successful conversion therefore:

1. Persists or recovers the Dialogue Document and its Script library as it does
   today.
2. Renders a compact Markdown dialogue snapshot containing the scene name,
   representative dialogue lines, and choice/branch summaries.
3. Renders a deterministic Markdown branch-tree snapshot from the resolved
   story document/plot plan.
4. Inserts both snapshots into the GDD chapter that produced the scene.
5. Adds named links from the snapshot to the Dialogue Document and the Script
   FlowChart.

This feature does not change the existing document, Dialogue Document, or
Script persistence boundaries, and it does not require a new database table.
Snapshots are ordinary GDD Markdown with stable markers and metadata embedded
in the marker attributes.

## Existing conversion flow

The GDD generation stream emits `KECO_DIALOGUE_SCENE` events. The v2 generator
plans scenes concurrently, the generation worker forwards the resulting plan to
the dialogue worker, and `dialogueWorker.ts` resolves/imports the story into a
Dialogue Document and Script library. `serverDocumentReplacement.ts` already
owns server-side replacement of generated GDD references. The new snapshot
writer runs after Script import (including the existing-script recovery path),
using the resolved story document and plot plan returned by the conversion.

The conversion result remains successful when snapshot writing fails. The
failure is logged and returned as retryable snapshot status/diagnostics; it
must not mark a completed Script job as failed or delete persisted documents.

## Snapshot format

Each scene has one replaceable block with a stable opening and closing marker.
The opening marker carries `dialogueJobId`, `chapterKey`, and the generated
document/library IDs so retries can replace the exact prior block:

```md
<!-- KECO_GDD_DIALOGUE_SNAPSHOT
dialogueJobId="job-123"
chapterKey="dialogue-intro"
dialogueDocumentId="doc-456"
scriptLibraryId="lib-789"
-->
### Dialogue: Arrival at the Gate

[Open Dialogue Document](/project/doc/doc-456) · [Open Script FlowChart](/script-system/project-1/script/lib-789)

**Excerpt**

- **Guard:** State your business.
- **Mira:** I carry a sealed letter.

**Choices**

- `show-letter` — Show the letter → `gate-open`
- `leave` — Walk away → `road`

**Branch tree**

- Arrival at the Gate
  - Show the letter → Gate opens
  - Walk away → Road
<!-- /KECO_GDD_DIALOGUE_SNAPSHOT -->
```

The actual renderer must omit the illustrative whitespace inside link URLs,
escape Markdown-sensitive user text, and keep line/excerpt lengths bounded so a
large scene cannot overwhelm the GDD. Choice targets are taken from the
resolved graph; scenes without choices render the excerpt and omit the choice
and branch-tree subsections. A tree with no resolvable branches renders a
`Branch tree` heading with a concise “No branches” line only when the source
plan declares choices; a genuinely linear script has no branch heading.

## Chapter matching

The writer receives the source GDD document and scene metadata. It locates the
chapter by exact `chapterKey` first. If no key match exists, it falls back to an
exact normalized chapter title match. If neither match exists, conversion still
completes and the snapshot result reports `missing-chapter`; no unrelated GDD
content is modified.

## Links

Links are named Markdown links, not bare IDs:

- Dialogue Document: `/project/doc/:dialogueDocumentId`
- Script FlowChart: `/script-system/:projectId/script/:scriptLibraryId`

The project ID comes from the conversion context. Link labels remain stable so
consumers can search for them, while IDs are regenerated only when a new
document/library is actually created.

## Idempotent replacement

Replacement is keyed by `dialogueJobId` in the opening marker. On retry or edit,
the writer removes the complete prior block for that job and inserts the newly
rendered block at the same chapter position. It must preserve all text before
and after the block, preserve snapshots for other jobs, and avoid duplicate
markers when the prior block is malformed or partially streamed. A malformed
opening marker is treated as absent; the new block is appended to the matching
chapter once.

## Error handling and observability

Snapshot rendering validates required IDs and marker attributes before writing.
Invalid or missing IDs produce a structured `snapshot_error` result. Server
document replacement errors are caught by the dialogue worker, logged with
`dialogueJobId`, chapter key, document ID, and library ID, and surfaced as a
retryable warning. Script import status and persisted documents remain intact.

## Testing requirements

Unit tests must cover:

- Rendering dialogue excerpts, choices, branch trees, linear scenes, escaping,
  bounded output, and both named links.
- Chapter lookup by key and title fallback.
- Replacement of the same `dialogueJobId` without duplication while preserving
  unrelated content and snapshots.
- Missing chapters and malformed/partial markers returning diagnostics without
  throwing.
- Dialogue worker calls after a fresh Script import and after existing-Script
  recovery, including propagation of resolved story/plot data and IDs.
- Snapshot-write failure leaving the Script job completed and retryable.

Integration tests should assert that a generated GDD scene is importable from
the Script sidebar and that the resulting FlowChart link resolves to the
created library.
