# GDD to Create Map Integration

**Date:** 2026-08-19
**Status:** Proposed for written-spec review

## Goal

Extend project GDD generation so one user action can generate the GDD and every
explicitly described map, up to three maps. Generated maps appear inside the GDD
for direct reading and remain independent, versioned Create Map assets that can be
opened and edited in the existing workbench.

The integration generates map images only. It does not run collision analysis or
produce collision grids, TileMaps, tilesets, navigation data, spawn points, or
engine exports.

## Confirmed Product Decisions

- The experience is one `Generate GDD + maps` action.
- GDD and map work use separate durable jobs under one parent workflow.
- A successful GDD is retained when any map fails.
- Every explicit map is generated, with a hard maximum of three per GDD.
- Starting the workflow authorizes the disclosed map-generation charges; there is
  no second confirmation dialog for normal submissions.
- Related sections show a compact map preview and the end of the GDD contains a
  full `Maps and Levels` asset area.
- Selecting a map opens its existing Create Map workbench. The GDD does not embed
  map editing or regeneration controls.
- The GDD pins an exact map revision. A later revision is offered as an explicit
  update and never replaces the pinned image silently.
- The pinned Game Design System Art Style is compiled into shared visual
  constraints for all maps in the workflow.
- No explicit map description means zero maps, zero map charges, and no empty map
  section in the GDD.

## Product Boundary

The Game Design System remains the reusable, versioned design contract. The GDD
remains the concrete project document. Create Map remains the owner of map plans,
generation revisions, provider jobs, validated PNG assets, and later manual map
work.

The integration owns only the contracts and orchestration between those systems:

```text
Pinned GDS version
  -> generated GDD
  -> explicit structured Map Briefs
  -> Create Map image jobs
  -> pinned Map Artifacts in the GDD
```

The integration must not infer maps from incidental descriptions of scenery,
rooms, encounters, or illustrations. It must not introduce game-world facts that
are absent from the generated GDD.

## Alternatives Considered

### Extract arbitrary Markdown and insert image URLs

Search the finished GDD for likely map prose, submit it to Create Map, and patch
image URLs into the Markdown. This is small but cannot reliably distinguish maps
from scenes, does not provide stable provenance, and encourages storing expiring
URLs in document content.

### Structured orchestration (selected)

Compile the validated GDD into zero to three schema-validated Map Briefs, run one
Create Map child job per brief, and write exact asset revisions into sanctioned
document nodes. This preserves the one-action experience while isolating failures,
provider state, and version history.

### Event-driven generation after GDD delivery

Publish an event after GDD creation and let a separate service discover and attach
maps later. This scales independently but adds more synchronization states and
does not match the selected expectation that GDD and map generation are one
visible workflow.

## Logical Data Model

The completed workflow logically produces:

```ts
type GddWithMapBriefs = {
  documentId: string;
  mapBriefs: MapBrief[]; // zero to three
};

type MapBrief = {
  id: string;
  title: string;
  mapType: 'world' | 'region' | 'level' | 'settlement' | 'interior' | 'other';
  purpose: string;
  sourceSection: {
    heading: string;
    blockId: string;
  };
  spatialLayout: string;
  regions: string[];
  routes: string[];
  landmarks: string[];
  gameplayRequirements: string[];
  visualDescription: string;
  outputSize: '512x512' | '688x384' | '384x688';
  priority: number;
  styleContract: MapStyleContract;
  createMapDescription: string;
};

type MapStyleContract = {
  sourceArtStyleId: string;
  sourceArtStyleVersion: number;
  palette: string;
  outline: string;
  detail: string;
  shading: string;
  perspective: string;
  avoid: string[];
  contentHash: string;
};

type GddMapArtifact = {
  id: string;
  gddGenerationJobId: string;
  gddDocumentId: string;
  mapBriefId: string;
  mapSystemId: string | null;
  mapRevisionId: string | null;
  assetPlanId: string | null;
  status: 'queued' | 'planning' | 'generating' | 'validating' | 'ready' |
    'failed' | 'blocked';
  inputHash: string;
  failureCode: string | null;
};
```

IDs, field bounds, supported dimensions, and enum values are validated server-side.
The `styleContract` is compiled once from the pinned GDS Art Style snapshot and is
identical for all briefs. Map-specific content remains in the other `MapBrief`
fields. Client-provided style or provenance values are never authoritative.

## Map Brief Compilation

The current production GDD worker emits and validates one Markdown document. It
does not run the staged structured `generateGddV2` pipeline. This design does not
pretend otherwise or require that larger migration.

After the current Markdown and sanctioned MDX validation succeeds, a dedicated
Map Brief Compiler reads:

- the final validated GDD;
- the pinned GDS design document and structured rules;
- the pinned GDS Art Style snapshot;
- the source snapshots already frozen for the GDD job.

The compiler returns JSON only and uses a strict schema with `max(3)`. It may
extract and normalize only maps explicitly described in the final GDD. The prompt
forbids adding new maps, locations, routes, landmarks, or gameplay requirements.
The compiler response is schema-validated and may receive one bounded repair pass.

If the GDD explicitly contains more than three maps, the compiler selects the
three with explicit document priority. When no priority exists, it selects the
first three in document order. It records omitted map names and source block IDs
in job metadata for diagnostics.

If no explicit map exists, the compiler returns an empty array. This is a normal
successful result: no child job or map UI node is created and no provider request
is made.

## Durable Workflow

The parent GDD job gains a bounded map-generation phase:

```text
resolve_inputs
  -> generate_gdd
  -> validate_gdd
  -> save_gdd
  -> compile_map_briefs
  -> create_map_children
  -> generate_maps
  -> finalize_map_references
  -> completed | completed_with_map_failures
```

The GDD Document is persisted before paid map work begins. Each brief creates an
independent Create Map plan, immutable generation revision, provider job, and
`GddMapArtifact`. Existing Create Map validation remains the authority for whether
a provider result is a usable PNG.

At most two map child jobs run concurrently. A third remains queued. The parent is
complete only when every child reaches `ready`, `failed`, or `blocked`, but the GDD
can be opened as soon as its Document exists.

All creation and provider-submission boundaries use deterministic input hashes and
idempotency keys. Worker lease loss, HTTP retries, refreshes, and duplicate queue
delivery must not submit the same paid generation twice.

Normal map retries reuse the frozen Map Brief and style contract. They do not
regenerate the GDD or already successful maps. To change the design, the user opens
the map in Create Map and edits its draft plan; this integration does not silently
recompile a Map Brief after the GDD is edited.

## Document Writeback

Add a sanctioned block-level MDX node for generated maps. It follows the existing
content-owned `ResourceReference` safety model but has map-specific presentation:

```mdx
<GddMapReference
  mapBriefId="..."
  generationJobId="..."
  display="compact"
  mapRevisionId="..."
/>
```

Only fixed validated identifiers and the `compact | full` display enum are
allowed. The node contains no raw URL, executable expression, event handler, or
provider payload. Navigation and authorized image URLs are resolved by application
code.

For each brief, deterministic document assembly places:

- one compact node after its identified source section; and
- one full node in a final `Maps and Levels` section.

After brief compilation and before any paid child submission, the worker inserts
these nodes through targeted authoritative Document edits using the stable source
block IDs. Pending nodes initially contain the brief and job IDs without a map revision.
When a child becomes ready, the worker performs targeted updates to both nodes and
writes the exact `mapRevisionId`. It never replaces the full document body. These
updates participate in authoritative Document collaboration and version history.

Failed or blocked nodes remain in place with their current state and retry action.
A GDD with zero briefs contains no nodes and no `Maps and Levels` section.

The batch resolver verifies that the Document, job, brief, map system, revision,
and asset all belong to the same authorized project. Missing, deleted, or
unreadable targets render as `Map unavailable` without disclosing the reason.
Temporary signed image URLs are resolved at read time and never persisted in MDX.

## User Experience

The generation action is labelled `Generate GDD + maps`. Adjacent text states that
the run can automatically submit up to three paid map generations and shows the
available cost estimate. Activating the button is authorization for those normal
submissions; there is no subsequent confirmation modal.

Progress shows the parent phase and individual maps:

```text
Generating GDD
Compiling maps
Generating maps (1/3)
Finalizing document
```

Once the GDD exists, users may open it while maps continue. Compact references
show a stable-size thumbnail, title, and status. The final asset area shows the
large image, Map Brief purpose, GDS source version, pinned map revision, and an
`Open in Create Map` action.

The GDD itself has no map-generation or collision-editing surface. Opening a map
navigates to the existing Create Map workbench and restores the generated map
system and revision.

## Version Behavior

The GDD pins the exact map revision attached by the workflow. Regeneration in
Create Map creates a new generation revision and preserves the old ready result.
It does not mutate the GDD.

When a newer ready revision exists, the GDD displays `New map version available`.
The user can preview it and explicitly choose `Update reference`. That action
performs a targeted, optimistic-lock update of every matching map node and creates
a normal Document version change. A stale update returns a conflict instead of
overwriting concurrent Document edits.

A map revision referenced by a Document may be archived but may not be permanently
deleted while the reference exists. Restoring a Document version restores its
exact map revision IDs. New GDS versions, GDD runs, and map revisions never move
existing references automatically.

The complete provenance chain is:

```text
GDS version and Art Style snapshot
  -> GDD generation job and source snapshots
  -> Map Brief and input hash
  -> Create Map generation revision
  -> validated PNG asset
  -> GDD map reference
```

## Permissions and Security

- A project admin or editor can start the workflow, retry a normal map failure,
  open editable map work, and update a pinned map reference.
- A viewer can read the GDD and its maps but cannot generate, retry, edit, or
  update references.
- Existing GDS-version readability and project-binding checks remain mandatory.
- Every map resolver and mutation revalidates project ownership and membership;
  IDs supplied by the client are not trusted.
- Maps remain private assets. Resolver responses do not reveal whether an
  unavailable target is missing or forbidden.
- Sanctioned MDX validation rejects unknown fields, malformed IDs, raw URLs,
  expressions, handlers, children, and unsupported display modes.

## Charging and Failure Semantics

The initial action discloses and authorizes up to three normal paid map submissions.
The system submits only the number of validated briefs actually produced.

Automatic retry is allowed only before the provider submission boundary or when
the provider proves that no paid job was created. A submission with an unknown
outcome becomes `blocked`. Reopening a possibly duplicate paid request requires the
existing explicit duplicate-charge acknowledgement even though ordinary generation
does not use a second confirmation.

Failure outcomes are isolated:

| Failure | Required outcome |
| --- | --- |
| GDD generation or validation fails | Create no map children |
| Map Brief compilation fails after repair | Keep GDD; finish with map failure |
| One map plan fails | Continue other map children |
| Provider returns a known failure | Mark that map failed and allow manual retry |
| Provider submission outcome is unknown | Mark blocked; never auto-resubmit |
| PNG validation fails | Do not attach the invalid asset |
| Document reference update conflicts | Keep the ready map and retry the targeted binding idempotently |
| Quota or balance is insufficient | Keep GDD; mark unsubmitted maps blocked |

The parent terminal states are `completed`, `completed_with_map_failures`, and
`failed_gdd`. A map failure never deletes or regenerates a successful GDD.

## Explicit Non-Goals

- Collision-grid analysis or editing during this workflow.
- Exporting collision, TileMap, tileset, atlas, navigation, spawn, or Godot data.
- Generating a map when the GDD does not explicitly describe one.
- Generating more than three maps in one GDD workflow.
- Inline map editing inside the GDD.
- Automatically updating a GDD to the newest map or GDS version.
- Writing provider URLs, prompts, or credentials into Document content.
- Replacing the current production GDD generator with the unused staged
  `generateGddV2` pipeline as part of this feature.

## Testing and Acceptance

### Unit and schema tests

- Accept zero to three valid briefs and reject a fourth at the schema boundary.
- Return zero briefs for GDDs without explicit maps and reject invented map facts.
- Select explicit priority first and document order second when more than three
  maps are present.
- Compile one immutable Art Style snapshot into the same style contract for all
  child maps.
- Parse, validate, serialize, and round-trip pending, ready, failed, compact, and
  full `GddMapReference` nodes.
- Reject malformed IDs, raw URLs, expressions, extra fields, children, and unsafe
  MDX properties.

### Service and worker tests

- A zero-map GDD submits no Create Map or provider request and has no map section.
- One to three briefs create exactly one map system and one initial generation
  revision per brief.
- Child concurrency never exceeds two.
- Duplicate queue delivery, worker lease loss, and HTTP retry do not duplicate a
  paid provider submission.
- One failed child does not cancel ready or pending siblings.
- Unknown provider submission state blocks automatic resubmission.
- PNG validation must pass before a revision is written into the GDD.
- Collision analysis APIs are never called by this workflow.
- Targeted reference updates preserve concurrent unrelated Document edits.
- Updating a pinned revision uses optimistic locking and never silently follows
  future revisions.

### Permission and integration tests

- Admin/editor/viewer/outsider behavior matches the permission contract.
- Cross-project GDS, job, brief, map, revision, and asset combinations are rejected
  without leaking existence.
- Expired signed URLs are refreshed through the resolver and are never stored in
  the Document.
- Archiving a referenced revision keeps it resolvable; permanent deletion is
  rejected while references remain.

### Browser acceptance tests

- A user starts one workflow and sees GDD and per-map progress survive refresh.
- Zero-map output opens as a normal GDD with no empty map UI.
- Compact previews appear in the correct sections and full assets appear at the
  end of the GDD without layout overlap on desktop or mobile.
- A partial failure shows successful images and an isolated retry action.
- `Open in Create Map` restores the correct map system and pinned revision.
- A newer revision produces an update notice; accepting it updates both compact
  and full nodes while preserving the rest of the GDD.

## Success Criteria

- A single authorized action can produce a GDD and every explicit map up to three.
- GDD generation remains useful when zero maps exist or any map fails.
- Every displayed map is a validated private PNG tied to an exact Create Map
  revision and exact upstream GDS/GDD provenance.
- All maps in one workflow use the same pinned GDS Art Style contract.
- Maps remain editable through Create Map without silently changing the GDD.
- No collision work or collision charge is introduced by the integration.
- Refreshes, retries, and worker recovery cannot create duplicate paid requests.
