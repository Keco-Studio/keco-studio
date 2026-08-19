# Isolated GDD and Map Generation

**Date:** 2026-08-20
**Status:** Approved design

This specification supersedes the implicit project-source input described by the
2026-08-19 GDD to Create Map integration specification. All other map compilation,
durability, and rendering decisions from that specification remain unchanged.

## Goal

Make `Generate GDD + maps` create a genuinely new GDD from the selected Game
Design System version and the current Creative brief. Map generation must then be
controlled only by that newly generated GDD and its pinned Art Style.

## Product Contract

The workflow has one explicit data path:

```text
Pinned GDS version + current Creative brief
  -> new GDD
  -> map extraction from that new GDD
  -> Create Map image generation
  -> map references written into that new GDD
```

`Generate GDD + maps` must not implicitly read any existing project Document or
Table. This includes manually authored documents and GDDs produced by earlier
generation jobs.

The generated map may use only:

- spatial and gameplay facts present in the newly generated GDD;
- the pinned Art Style attached to the selected GDS version;
- deterministic server constraints such as supported image dimensions and the
  maximum map count.

It must not use an older GDD, another project resource, an earlier generated map,
or a hidden reference asset.

## Request Boundary

The project GDD generation route will construct `GddGenerationRequestV2` with an
empty `projectSources` array. It will not call the automatic project-source
collector for this workflow.

The durable job snapshot remains self-contained and records:

- the selected GDS and version;
- the current Creative brief, when supplied;
- the pinned GDS rules and design document;
- the pinned Art Style;
- an empty project-source snapshot list.

Historical jobs retain their original frozen input and metadata. This change does
not rewrite or delete existing GDDs, map artifacts, or source snapshots.

## GDD Generation

The GDD Agent receives the selected GDS version, its rules and design document,
the current Creative brief, project identity, language, and Art Style metadata.
The prompt must state that no project Documents or Tables are available because
`projectSources` is empty.

A vague Creative brief may still lead the Agent to propose new content consistent
with the GDS, but it cannot recover distinctive names from prior project documents
because those documents are absent from the request.

## Map Generation

After the new GDD is validated, the Map Brief Compiler receives only:

- the finished Markdown of that new GDD;
- the pinned GDS Art Style snapshot.

The compiler returns zero to three schema-validated map briefs. Create Map receives
the selected brief's `createMapDescription`, output size, and deterministic image
generation settings. Collision generation remains disabled.

## Alternatives Considered

### Keep automatic project sources but give Creative brief higher priority

Rejected. Historical content would remain a hidden input, and prompt priority
cannot reliably prevent factual names and locations from leaking into the result.

### Exclude only generated GDDs

Rejected for this workflow. Manually authored Documents and Tables would still be
implicit inputs that the user cannot see or control.

### Remove all implicit project sources (selected)

This gives the button one understandable meaning and makes output reproducible
from visible inputs. A future continuation or reference-driven workflow can add
an explicit source picker without changing this contract.

## Failure Handling

Removing project sources does not change durable job recovery, refresh behavior,
idempotency, provider retries, partial map failure handling, or persisted map
references. Existing errors continue to surface through the current job status.

## Verification

Automated verification will cover:

- the generation route does not enumerate or resolve project Documents/Tables;
- a created V2 job has `input.projectSources` and `source_snapshots` equal to `[]`;
- the GDD prompt reports that no project Documents or Tables are available;
- map compilation still receives the newly generated Markdown and pinned Art
  Style;
- existing map extraction, map worker, refresh, and idempotency tests continue to
  pass.

Manual verification will create a new GDD in a project that contains an older GDD
with a distinctive location name. A generic Creative brief requesting a map must
not reproduce that old location unless it is independently present in the pinned
GDS. The resulting map must match only the new GDD, remain image-only, and render
through its persisted `GddMapReference`.

## Non-Goals

- Adding a project-source picker.
- Adding a continue/revise-existing-GDD workflow.
- Deleting or migrating historical generated documents.
- Changing the GDS version model.
- Generating collision grids, TileMaps, or navigation data.
