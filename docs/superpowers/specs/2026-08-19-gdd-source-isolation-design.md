# GDD Source Isolation Design

## Problem

GDD generation currently auto-selects the first ten documents and tables in a
project. Projects can contain GDDs generated for earlier designs, and those
documents are then fed back into later generations as factual source material.
This caused a project bound to the `超市经营` design system to receive old
`收养猫` GDD content and produce another cat document.

## Approved Design

Keep the existing automatic project-source behavior for ordinary project
documents and tables, but exclude resources marked with a non-null
`gdd_generation_job_id` when the GDD route gathers automatic sources.

The source-listing function receives an explicit `excludeGeneratedResources`
option, defaulting to `false` so the existing Game Design System reference
picker retains its current behavior. The GDD route passes `true`. Both
documents and libraries are filtered, preventing generated GDD tables from
creating the same feedback loop after the version-folder migration.

## Data Flow

1. The GDD route requests project references with
   `excludeGeneratedResources: true`.
2. `listGameDesignReferenceOptions` adds `gdd_generation_job_id IS NULL` to
   the documents and libraries queries.
3. The existing ten-source and excerpt limits remain unchanged.
4. The frozen generation job input contains only ordinary project sources,
   plus the bound design-system version and optional creative brief.

## Testing

- Source-listing tests verify the generated-resource filter is applied only
  when requested and to both resource queries.
- GDD route tests verify automatic source collection requests the filter.
- Existing source snapshot and route tests must continue to pass.

## Non-Goals

- Do not delete or rewrite existing contaminated GDD documents.
- Do not change manual Game Design System source selection.
- Do not change idempotency, model prompts, or GDD rendering.
