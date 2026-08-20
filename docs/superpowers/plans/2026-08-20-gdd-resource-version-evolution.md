# GDD Resource Version Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated generation for one project and Game Design System reuse a fixed System-named folder and stable GDD, Table, dialogue Document, and Script Table resources while versioning only changed content.

**Architecture:** Add a database-owned generation series keyed by `(project_id, design_system_id)` plus resource mappings keyed by `(series_id, resource_kind, logical_key)`. The GDD persistence transaction bootstraps legacy output, classifies generated resources as created/updated/reused/preserved, snapshots changed resources into existing version stores, and updates stable IDs atomically; the dialogue worker applies the same mapping and snapshot rules when a Script Table finishes.

**Tech Stack:** Next.js 16, TypeScript 5.9, React Query, Supabase/PostgreSQL PL/pgSQL, Jest, Playwright

---

## File Map

- Create `supabase/migrations/20260820120000_gdd_resource_version_evolution.sql`: series schema, logical resource mappings, generated version types, bootstrap helpers, atomic GDD persistence, and dialogue Script finalization.
- Create `tests/unit/database/gdd-resource-version-evolution-migration.test.ts`: static migration contract and security assertions.
- Create `src/lib/gdd-generation/resourceEvolution.ts`: logical-key normalization, canonical hashes, generated-resource classification, and public summary parsing.
- Create `src/lib/gdd-generation/resourceEvolution.test.ts`: pure classification tests.
- Modify `src/lib/gdd-generation/worker.ts`: canonical resource payloads and persistence result propagation.
- Modify `src/lib/gdd-generation/worker.test.ts`: persistence and retry/idempotency expectations.
- Modify `src/lib/services/gddGenerationService.ts`: revision and resource-change summary types/columns.
- Modify `src/lib/services/gddGenerationService.test.ts`: public projection coverage.
- Modify `src/lib/gdd-generation/dialogueWorker.ts`: stable Script lookup and in-place update flow.
- Modify `src/lib/gdd-generation/dialogueWorker.test.ts`: changed/reused Script scenarios.
- Modify `src/lib/services/dialogueGenerationService.ts`: finalization result contract.
- Modify `src/lib/services/dialogueGenerationService.test.ts`: RPC result parsing.
- Modify `src/lib/documents/documentVersionService.ts`: accept `gdd_generation` history entries.
- Create `src/lib/documents/documentVersionService.test.ts`: generated Document history mapping.
- Modify `src/lib/types/version.ts`: accept `gdd_generation` Library history entries.
- Modify `src/components/documents/DocumentVersionItem.tsx`: generated-version attribution.
- Modify `src/components/version-control/VersionItem.tsx`: generated-version attribution and immutable action rules.
- Create `tests/unit/generated-version-history-ui.test.tsx`: generated Document/Table history presentation.
- Modify `src/components/game-design-system/GameDesignSystemWorkspace.tsx`: completed revision/change summary.
- Modify `src/components/game-design-system/GameDesignSystemsPage.test.tsx`: completion summary rendering.
- Modify `tests/e2e/specs/game-design-system.spec.ts`: fixed folder, stable links, and version-history browser flow.

### Task 1: Define Series, Resource Identity, And Version Types

**Files:**
- Create: `supabase/migrations/20260820120000_gdd_resource_version_evolution.sql`
- Create: `tests/unit/database/gdd-resource-version-evolution-migration.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260820120000_gdd_resource_version_evolution.sql',
);

describe('GDD resource version evolution migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('owns one revisioned series per project and System', () => {
    expect(sql).toMatch(/create table public\.gdd_resource_series/i);
    expect(sql).toMatch(/unique\s*\(\s*project_id\s*,\s*design_system_id\s*\)/i);
    expect(sql).toMatch(/current_revision integer not null default 0/i);
    expect(sql).toMatch(/folder_id uuid/i);
    expect(sql).toMatch(/primary_document_id uuid/i);
  });

  it('maps stable logical resources without trusting display names', () => {
    expect(sql).toMatch(/create table public\.gdd_series_resources/i);
    expect(sql).toMatch(/resource_kind.*gdd_document.*table.*dialogue_document.*script_table/is);
    expect(sql).toMatch(/unique\s*\(\s*series_id\s*,\s*resource_kind\s*,\s*logical_key\s*\)/i);
    expect(sql).toMatch(/content_hash text not null/i);
  });

  it('adds immutable generated history and private manifests', () => {
    expect(sql).toMatch(/gdd_generation/i);
    expect(sql).toMatch(/add column if not exists generation_revision integer/i);
    expect(sql).toMatch(/add column if not exists resource_change_summary jsonb/i);
    expect(sql).not.toMatch(/grant\s+.*gdd_series_resources.*authenticated/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --runInBand tests/unit/database/gdd-resource-version-evolution-migration.test.ts`

Expected: FAIL because `20260820120000_gdd_resource_version_evolution.sql` does not exist.

- [ ] **Step 3: Add the series and resource mapping schema**

Start the migration with these concrete contracts:

```sql
create table public.gdd_resource_series (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  design_system_id uuid not null references public.game_design_systems(id) on delete restrict,
  folder_id uuid references public.folders(id) on delete set null,
  primary_document_id uuid references public.documents(id) on delete set null,
  current_revision integer not null default 0 check (current_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, design_system_id)
);

create table public.gdd_series_resources (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.gdd_resource_series(id) on delete cascade,
  resource_kind text not null check (resource_kind in (
    'gdd_document', 'table', 'dialogue_document', 'script_table'
  )),
  logical_key text not null check (
    logical_key = lower(btrim(logical_key)) and char_length(logical_key) between 1 and 160
  ),
  document_id uuid references public.documents(id) on delete set null,
  library_id uuid references public.libraries(id) on delete set null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, resource_kind, logical_key),
  check (
    (resource_kind in ('gdd_document', 'dialogue_document') and document_id is not null and library_id is null)
    or (resource_kind in ('table', 'script_table') and library_id is not null and document_id is null)
  )
);

alter table public.gdd_generation_jobs
  add column if not exists generation_series_id uuid references public.gdd_resource_series(id) on delete set null,
  add column if not exists generation_revision integer,
  add column if not exists resource_change_summary jsonb not null default
    '{"created":[],"updated":[],"reused":[],"preserved":[]}'::jsonb
    check (jsonb_typeof(resource_change_summary) = 'object');
```

Replace the `document_versions` version-type constraint so it includes
`gdd_generation`. Replace the `library_versions` version-type constraint so it
includes `gdd_generation`. Enable RLS on both new tables, revoke all access from
`public`, `anon`, and `authenticated`, and grant full access only to
`service_role`. Add the existing update trigger explicitly:

```sql
create trigger gdd_resource_series_updated_at
  before update on public.gdd_resource_series
  for each row execute function public.update_updated_at_column();

create trigger gdd_series_resources_updated_at
  before update on public.gdd_series_resources
  for each row execute function public.update_updated_at_column();
```

- [ ] **Step 4: Run the migration contract test**

Run: `npx jest --runInBand tests/unit/database/gdd-resource-version-evolution-migration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the schema contract**

```bash
git add supabase/migrations/20260820120000_gdd_resource_version_evolution.sql tests/unit/database/gdd-resource-version-evolution-migration.test.ts
git commit -m "feat: add GDD resource series schema"
```

### Task 2: Canonicalize And Classify Generated Resources

**Files:**
- Create: `src/lib/gdd-generation/resourceEvolution.ts`
- Create: `src/lib/gdd-generation/resourceEvolution.test.ts`

- [ ] **Step 1: Write failing pure behavior tests**

```ts
import {
  classifyGeneratedResources,
  normalizeGddLogicalKey,
  type ExistingGeneratedResource,
  type NextGeneratedResource,
} from './resourceEvolution';

describe('GDD resource evolution', () => {
  it('normalizes stable keys and rejects empty keys', () => {
    expect(normalizeGddLogicalKey('  Chapter   One ')).toBe('chapter one');
    expect(() => normalizeGddLogicalKey('   ')).toThrow('logical key');
  });

  it('classifies created, updated, reused, and preserved resources', async () => {
    const existing: ExistingGeneratedResource[] = [
      { kind: 'table', logicalKey: 'skills', resourceId: 'table-1', contentHash: 'a'.repeat(64) },
      { kind: 'table', logicalKey: 'items', resourceId: 'table-2', contentHash: 'b'.repeat(64) },
      { kind: 'dialogue_document', logicalKey: 'intro', resourceId: 'doc-1', contentHash: 'c'.repeat(64) },
    ];
    const next: NextGeneratedResource[] = [
      { kind: 'table', logicalKey: 'skills', resourceId: 'new-random-id', contentHash: 'd'.repeat(64) },
      { kind: 'dialogue_document', logicalKey: 'intro', resourceId: 'new-random-id', contentHash: 'c'.repeat(64) },
      { kind: 'table', logicalKey: 'quests', resourceId: 'table-3', contentHash: 'e'.repeat(64) },
    ];

    expect(classifyGeneratedResources(existing, next)).toEqual({
      created: [expect.objectContaining({ logicalKey: 'quests' })],
      updated: [expect.objectContaining({ logicalKey: 'skills', resourceId: 'table-1' })],
      reused: [expect.objectContaining({ logicalKey: 'intro', resourceId: 'doc-1' })],
      preserved: [expect.objectContaining({ logicalKey: 'items', resourceId: 'table-2' })],
    });
  });

  it('rejects duplicate kind/key pairs', () => {
    expect(() => classifyGeneratedResources([], [
      { kind: 'table', logicalKey: 'skills', resourceId: 'a', contentHash: 'a'.repeat(64) },
      { kind: 'table', logicalKey: ' Skills ', resourceId: 'b', contentHash: 'b'.repeat(64) },
    ])).toThrow('Duplicate generated resource key');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --runInBand src/lib/gdd-generation/resourceEvolution.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the focused classifier**

```ts
export type GeneratedResourceKind =
  | 'gdd_document'
  | 'table'
  | 'dialogue_document'
  | 'script_table';

export type ExistingGeneratedResource = {
  kind: GeneratedResourceKind;
  logicalKey: string;
  resourceId: string;
  contentHash: string;
};

export type NextGeneratedResource = ExistingGeneratedResource;

export type ResourceChangeSummary = {
  created: string[];
  updated: string[];
  reused: string[];
  preserved: string[];
};

export function normalizeGddLogicalKey(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  if (!normalized || normalized.length > 160) throw new Error('Invalid GDD logical key.');
  return normalized;
}

export function classifyGeneratedResources(
  existing: readonly ExistingGeneratedResource[],
  next: readonly NextGeneratedResource[],
) {
  const keyOf = (item: ExistingGeneratedResource) =>
    `${item.kind}:${normalizeGddLogicalKey(item.logicalKey)}`;
  const existingByKey = new Map(existing.map((item) => [keyOf(item), item]));
  const seen = new Set<string>();
  const created: NextGeneratedResource[] = [];
  const updated: ExistingGeneratedResource[] = [];
  const reused: ExistingGeneratedResource[] = [];

  for (const candidate of next) {
    const key = keyOf(candidate);
    if (seen.has(key)) throw new Error(`Duplicate generated resource key: ${key}`);
    seen.add(key);
    const current = existingByKey.get(key);
    if (!current) created.push({ ...candidate, logicalKey: normalizeGddLogicalKey(candidate.logicalKey) });
    else if (current.contentHash === candidate.contentHash) reused.push(current);
    else updated.push(current);
  }

  return {
    created,
    updated,
    reused,
    preserved: existing.filter((item) => !seen.has(keyOf(item))),
  };
}
```

Add the canonical hash functions in the same file:

```ts
import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256CanonicalJson(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function hashNormalizedMarkdown(markdown: string): string {
  const normalized = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
  return sha256(normalized);
}
```

- [ ] **Step 4: Run the pure tests**

Run: `npx jest --runInBand src/lib/gdd-generation/resourceEvolution.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the classifier**

```bash
git add src/lib/gdd-generation/resourceEvolution.ts src/lib/gdd-generation/resourceEvolution.test.ts
git commit -m "feat: classify evolving GDD resources"
```

### Task 3: Atomically Reuse The Folder, GDD Document, And Generated Tables

**Files:**
- Modify: `supabase/migrations/20260820120000_gdd_resource_version_evolution.sql`
- Modify: `tests/unit/database/gdd-resource-version-evolution-migration.test.ts`
- Modify: `src/lib/gdd-generation/worker.ts`
- Modify: `src/lib/gdd-generation/worker.test.ts`

- [ ] **Step 1: Add failing persistence assertions**

Extend the migration test:

```ts
it('persists a revision atomically with stable resources', () => {
  expect(sql).toMatch(/create or replace function public\.persist_completed_gdd_generation_job/i);
  expect(sql).toMatch(/pg_advisory_xact_lock/i);
  expect(sql).toMatch(/GDD Version.*v_next_revision/is);
  expect(sql).toMatch(/insert into public\.document_versions/i);
  expect(sql).toMatch(/insert into public\.library_versions/i);
  expect(sql).toMatch(/resource_change_summary/i);
  expect(sql).toMatch(/status\s*=\s*'completed'/i);
});

it('bootstraps only the newest valid legacy output and preserves omissions', () => {
  expect(sql).toMatch(/order by legacy_job\.completed_at desc nulls last/i);
  expect(sql).toMatch(/legacy_job\.output_folder_id is not null/i);
  expect(sql).toMatch(/lower\(btrim\(folder\.name\)\).*lower\(btrim\(v_system_title\)\)/is);
  expect(sql).not.toMatch(/delete from public\.folders/i);
  expect(sql).not.toMatch(/delete from public\.gdd_series_resources/i);
});
```

Extend `worker.test.ts` so the RPC response includes a revision and summary:

```ts
const persisted = {
  document_id: 'document-1',
  document_name: 'Harbor Tactics gdd',
  folder_id: 'folder-1',
  table_ids: ['table-1'],
  table_names: ['Skills'],
  generation_revision: 2,
  resource_change_summary: {
    created: [], updated: ['table:skills'], reused: ['dialogue_document:intro'], preserved: [],
  },
};
```

Assert `persistGeneratedGddV2Document` returns `generationRevision: 2` and the
camel-cased summary.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx jest --runInBand tests/unit/database/gdd-resource-version-evolution-migration.test.ts src/lib/gdd-generation/worker.test.ts`

Expected: FAIL because the persistence RPC still creates job-owned resources
and the worker ignores revision metadata.

- [ ] **Step 3: Implement series bootstrap and fixed folder naming**

In the migration, add `public.normalize_gdd_resource_key(text)` and an internal
`public.resolve_gdd_resource_series(uuid)` security-definer helper. Under the
project/System advisory lock it must:

```sql
select series.* into v_series
from public.gdd_resource_series as series
where series.project_id = v_job.project_id
  and series.design_system_id = v_job.design_system_id
for update;

if not found then
  select legacy_job.* into v_legacy_job
  from public.gdd_generation_jobs as legacy_job
  where legacy_job.project_id = v_job.project_id
    and legacy_job.design_system_id = v_job.design_system_id
    and legacy_job.status = 'completed'
    and legacy_job.output_folder_id is not null
    and legacy_job.output_document_id is not null
  order by legacy_job.completed_at desc nulls last, legacy_job.created_at desc, legacy_job.id desc
  limit 1;

  insert into public.gdd_resource_series(
    project_id, design_system_id, folder_id, primary_document_id, current_revision
  ) values (
    v_job.project_id, v_job.design_system_id,
    v_legacy_job.output_folder_id, v_legacy_job.output_document_id,
    case when v_legacy_job.id is null then 0 else 1 end
  ) returning * into v_series;
end if;
```

When no legacy folder exists, create one named exactly `v_system_title`. Before
create or rename, reject an unrelated normalized root-folder collision with
SQLSTATE `23505`. Never append GDD, a date, or a suffix.

- [ ] **Step 4: Replace job-owned GDD/Table persistence with in-place evolution**

Replace the canonical 10-argument `persist_completed_gdd_generation_job` and
retain compatible 8/9-argument wrappers. The canonical function must:

1. validate the lease, permission, pinned binding, logical keys, and resource
   payload bounds before mutation;
2. return the prior result immediately when the same job is already completed;
3. allocate `v_next_revision := v_series.current_revision + 1` under lock;
4. compare normalized Markdown for the primary GDD;
5. insert the old GDD snapshot as `document_versions.version_type =
   'gdd_generation'` before updating its Markdown/Yjs state and incrementing its
   collaboration epoch/revision;
6. compare each Table's canonical schema/rows hash;
7. snapshot changed Tables into `library_versions` with the same
   `GDD Version <revision>` label before updating fields, assets, and values;
8. reuse unchanged IDs and mappings without inserting a version;
9. create missing logical keys in the fixed folder;
10. retain mappings absent from the generated payload and classify them as
    `preserved`;
11. update the series revision, job output arrays, manifest summary, and job
    completion in the same transaction.

Use metadata that makes generated history immutable and auditable:

```sql
jsonb_build_object(
  'source', 'gdd_generation',
  'seriesId', v_series.id,
  'jobId', v_job.id,
  'revision', v_next_revision,
  'designSystemVersionId', v_job.version_id
)
```

Return these OUT columns from every overload:

```sql
document_id uuid,
document_name text,
folder_id uuid,
table_ids uuid[],
table_names text[],
generation_revision integer,
resource_change_summary jsonb
```

- [ ] **Step 5: Parse and propagate the new persistence result**

In `worker.ts`, replace the two-field result parsing with:

```ts
export type PersistedGddRevision = {
  id: string;
  name: string;
  generationRevision: number;
  resourceChangeSummary: ResourceChangeSummary;
};

const row = Array.isArray(data) ? data[0] : data;
if (!row?.document_id || !Number.isSafeInteger(row.generation_revision)) {
  throw new Error('GDD persistence returned an invalid revision result.');
}
return {
  id: row.document_id,
  name: row.document_name,
  generationRevision: row.generation_revision,
  resourceChangeSummary: parseResourceChangeSummary(row.resource_change_summary),
};
```

- [ ] **Step 6: Run focused persistence tests**

Run: `npx jest --runInBand tests/unit/database/gdd-resource-version-evolution-migration.test.ts src/lib/gdd-generation/worker.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit atomic GDD and Table evolution**

```bash
git add supabase/migrations/20260820120000_gdd_resource_version_evolution.sql tests/unit/database/gdd-resource-version-evolution-migration.test.ts src/lib/gdd-generation/worker.ts src/lib/gdd-generation/worker.test.ts
git commit -m "feat: evolve generated GDD resources in place"
```

### Task 4: Reuse Dialogue Documents And Version Script Tables

**Files:**
- Modify: `supabase/migrations/20260820120000_gdd_resource_version_evolution.sql`
- Modify: `src/lib/gdd-generation/dialogueWorker.ts`
- Modify: `src/lib/gdd-generation/dialogueWorker.test.ts`
- Modify: `src/lib/services/dialogueGenerationService.ts`
- Modify: `src/lib/services/dialogueGenerationService.test.ts`

- [ ] **Step 1: Write failing dialogue evolution tests**

Add worker tests with these expectations:

```ts
it('reuses an unchanged mapped Script without importing it again', async () => {
  const importStory = jest.fn();
  const complete = jest.fn(async () => ({ scriptLibraryId: 'script-1', change: 'reused' as const }));
  const result = await processClaimedDialogueJob(input, {
    read: jest.fn(async () => sourceState),
    findExistingScript: jest.fn(async () => 'script-1'),
    importStory,
    complete,
    updateReference: jest.fn(async () => undefined),
  });
  expect(result).toBe('completed');
  expect(importStory).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledWith(expect.anything(), 'dialogue-job-1', 'worker-1', 'script-1');
});

it('imports a changed Script into staging then finalizes over the stable mapped ID', async () => {
  const finalize = jest.fn(async () => ({ scriptLibraryId: 'stable-script', change: 'updated' as const }));
  await processClaimedDialogueJob(input, {
    findExistingScript: jest.fn(async () => null),
    importStory: jest.fn(async () => ({ libraryId: 'staging-script' })),
    complete: finalize,
  });
  expect(finalize).toHaveBeenCalledWith(expect.anything(), 'dialogue-job-1', 'worker-1', 'staging-script');
});
```

- [ ] **Step 2: Run dialogue tests to verify they fail**

Run: `npx jest --runInBand src/lib/gdd-generation/dialogueWorker.test.ts src/lib/services/dialogueGenerationService.test.ts`

Expected: FAIL because completion returns no change result and Script identity is
still tied to one dialogue job.

- [ ] **Step 3: Reuse dialogue source Documents during GDD persistence**

In the canonical GDD persistence function, map `p_dialogue_resources` by
normalized `chapterKey`. For changed dialogue Markdown, insert a
`gdd_generation` Document version and update the existing dialogue Document.
For equal hashes, reuse it without a version or a new dialogue job. For new
keys, create the Document and mapping. Preserve omitted keys.

Create a dialogue generation job only for a created or updated source. Store its
series ID, revision, and logical key so Script finalization can resolve the
stable `script_table` mapping.

- [ ] **Step 4: Add an atomic Script finalizer**

Replace `complete_dialogue_generation_job` with a function returning:

```sql
returns table(script_library_id uuid, resource_change text)
```

It must validate the lease and exact dialogue source state, resolve the
`script_table` mapping, canonicalize the staging Script snapshot, and then:

- create: keep the staging ID, move it to the series folder, and add its mapping;
- update: snapshot the mapped Script into `library_versions` as
  `GDD Version <revision>`, replace its schema/rows from staging, then delete the
  staging Library;
- reuse: delete the staging Library without adding a version;

Finish by marking the dialogue job complete with the stable Script ID. The
entire operation remains one transaction.

- [ ] **Step 5: Update the service and worker result contract**

In `dialogueGenerationService.ts`:

```ts
export type DialogueScriptCompletion = {
  scriptLibraryId: string;
  change: 'created' | 'updated' | 'reused';
};

export async function completeDialogueGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  scriptLibraryId: string,
): Promise<DialogueScriptCompletion> {
  const { data, error } = await serviceClient.rpc('complete_dialogue_generation_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_script_library_id: scriptLibraryId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.script_library_id || !['created', 'updated', 'reused'].includes(row.resource_change)) {
    throw new Error('Dialogue completion returned an invalid resource result.');
  }
  return { scriptLibraryId: row.script_library_id, change: row.resource_change };
}
```

Use the returned stable ID for GDD link replacement.

- [ ] **Step 6: Run dialogue evolution tests**

Run: `npx jest --runInBand src/lib/gdd-generation/dialogueWorker.test.ts src/lib/services/dialogueGenerationService.test.ts tests/unit/database/gdd-resource-version-evolution-migration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit dialogue and Script evolution**

```bash
git add supabase/migrations/20260820120000_gdd_resource_version_evolution.sql src/lib/gdd-generation/dialogueWorker.ts src/lib/gdd-generation/dialogueWorker.test.ts src/lib/services/dialogueGenerationService.ts src/lib/services/dialogueGenerationService.test.ts
git commit -m "feat: version generated dialogue resources"
```

### Task 5: Expose Revision Summaries And Generated Version History

**Files:**
- Modify: `src/lib/services/gddGenerationService.ts`
- Modify: `src/lib/services/gddGenerationService.test.ts`
- Modify: `src/lib/documents/documentVersionService.ts`
- Modify: `src/lib/types/version.ts`
- Modify: `src/components/documents/DocumentVersionItem.tsx`
- Modify: `src/components/version-control/VersionItem.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`

- [ ] **Step 1: Write failing service and UI tests**

Add this public-job expectation:

```ts
expect(toPublicGddGenerationJob(job)).toEqual(expect.objectContaining({
  generation_revision: 2,
  resource_change_summary: {
    created: ['table:quests'],
    updated: ['gdd_document:gdd'],
    reused: ['table:skills'],
    preserved: ['dialogue_document:outro'],
  },
}));
```

Add a page test that renders a completed job and asserts:

```ts
expect(screen.getByText('GDD Version 2')).toBeInTheDocument();
expect(screen.getByText('1 updated')).toBeInTheDocument();
expect(screen.getByText('1 reused')).toBeInTheDocument();
```

Add document and Library mapping tests asserting `gdd_generation` is accepted
and displayed as `generated by Keco` without delete actions.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npx jest --runInBand src/lib/services/gddGenerationService.test.ts src/components/game-design-system/GameDesignSystemsPage.test.tsx src/lib/documents/documentVersionService.test.ts tests/unit/generated-version-history-ui.test.tsx`

Expected: FAIL because public job types and history UIs do not recognize the
generated revision.

- [ ] **Step 3: Extend public job and version types**

Add to `GddGenerationJob` and `PublicGddGenerationJob`:

```ts
generation_series_id: string | null;
generation_revision: number | null;
resource_change_summary: ResourceChangeSummary;
```

Add these fields to private/public select constants and `toPublicGddGenerationJob`.
Extend `DocumentVersionType` and `VersionType` with `'gdd_generation'`.

- [ ] **Step 4: Render generated history and the completion summary**

In both version-item components, treat `gdd_generation` as immutable and use
the text `generated by Keco`. Do not show manual delete or edit actions.

In `GameDesignSystemWorkspace.tsx`, render completed jobs as:

```tsx
<strong>GDD Version {job.generation_revision}</strong>
<span>{job.resource_change_summary.created.length} created</span>
<span>{job.resource_change_summary.updated.length} updated</span>
<span>{job.resource_change_summary.reused.length} reused</span>
<span>{job.resource_change_summary.preserved.length} preserved</span>
```

Keep the existing link pointed at `output_document_id`, which now remains stable
across revisions.

- [ ] **Step 5: Run service and UI tests**

Run: `npx jest --runInBand src/lib/services/gddGenerationService.test.ts src/components/game-design-system/GameDesignSystemsPage.test.tsx src/lib/documents/documentVersionService.test.ts tests/unit/generated-version-history-ui.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit public revision UX**

```bash
git add src/lib/services/gddGenerationService.ts src/lib/services/gddGenerationService.test.ts src/lib/documents/documentVersionService.ts src/lib/documents/documentVersionService.test.ts src/lib/types/version.ts src/components/documents/DocumentVersionItem.tsx src/components/version-control/VersionItem.tsx tests/unit/generated-version-history-ui.test.tsx src/components/game-design-system/GameDesignSystemWorkspace.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx
git commit -m "feat: show generated GDD revision history"
```

### Task 6: Verify Migration Behavior, Idempotency, And Browser Workflow

**Files:**
- Modify: `scripts/verify-game-design-system-jobs.ts`
- Modify: `tests/e2e/specs/game-design-system.spec.ts`

- [ ] **Step 1: Add database verification scenarios**

Extend the verifier to perform two jobs for the same project/System and assert:

```ts
assert(first.folderId === second.folderId, 'series folder changed');
assert(first.documentId === second.documentId, 'primary GDD document changed');
assert(second.revision === first.revision + 1, 'revision did not increment');
assert(second.folderName === systemTitle, 'folder name contains legacy decoration');
assert(changedVersionCount === 1, 'changed resource did not get one history snapshot');
assert(unchangedVersionCount === 0, 'unchanged resource got a duplicate history snapshot');
assert(omittedResourceStillExists, 'omitted resource was deleted');
```

Replay the second job persistence call and assert revision and version counts do
not change. Attempt a same-name unrelated root folder and assert the transaction
fails without a suffixed folder or partial resources.

- [ ] **Step 2: Add the browser regression**

In the existing serial Game Design System E2E flow:

1. generate the first GDD;
2. record folder, GDD Document, and generated Table links;
3. generate again with one changed and one unchanged fixture;
4. assert the links are unchanged and the folder title equals the System title;
5. open the GDD's right-side Version History;
6. assert `GDD Version 1` is visible and previewable;
7. open the changed Table's version history and assert one generated entry;
8. open the unchanged Table and assert no generated duplicate.

- [ ] **Step 3: Run all targeted tests**

Run:

```bash
npx jest --runInBand \
  tests/unit/database/gdd-resource-version-evolution-migration.test.ts \
  src/lib/gdd-generation/resourceEvolution.test.ts \
  src/lib/gdd-generation/worker.test.ts \
  src/lib/gdd-generation/dialogueWorker.test.ts \
  src/lib/services/gddGenerationService.test.ts \
  src/lib/services/dialogueGenerationService.test.ts \
  src/components/game-design-system/GameDesignSystemsPage.test.tsx
```

Expected: all suites PASS.

- [ ] **Step 4: Run static verification**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

Run: `npm run typecheck:api`

Expected: PASS with no TypeScript errors.

Run: `npx eslint src/lib/gdd-generation/resourceEvolution.ts src/lib/gdd-generation/worker.ts src/lib/gdd-generation/dialogueWorker.ts src/lib/services/gddGenerationService.ts src/lib/services/dialogueGenerationService.ts src/components/game-design-system/GameDesignSystemWorkspace.tsx src/components/documents/DocumentVersionItem.tsx src/components/version-control/VersionItem.tsx`

Expected: PASS with no lint errors.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Run database and browser verification when local Supabase is available**

Run: `npx tsx scripts/verify-game-design-system-jobs.ts`

Expected: output includes `Game Design System database verification passed` and
the resource-series assertions.

Run: `npx playwright test tests/e2e/specs/game-design-system.spec.ts --workers=1`

Expected: PASS.

- [ ] **Step 6: Commit verification coverage**

```bash
git add scripts/verify-game-design-system-jobs.ts tests/e2e/specs/game-design-system.spec.ts
git commit -m "test: verify evolving GDD resource versions"
```

### Task 7: Final Regression Review

**Files:**
- Review only: all files changed in Tasks 1-6

- [ ] **Step 1: Confirm the committed diff contains only scoped work**

Run: `git status --short`

Expected: only pre-existing unrelated user files, or a clean tree when none
exist.

Run: `git log --oneline -7`

Expected: the scoped schema, classifier, persistence, dialogue, UI, and test
commits appear above the approved design commit.

- [ ] **Step 2: Re-run the complete focused command from Task 6**

Expected: every targeted Jest suite passes from a fresh invocation.

- [ ] **Step 3: Review the final invariants**

Confirm from test output and the migration diff:

- successful folders contain only the Game Design System title;
- repeated generation keeps stable resource IDs;
- changed resources get exactly one restorable generated history entry;
- unchanged and omitted resources get no duplicate history entry;
- omitted resources remain available;
- idempotent replay and concurrent conflicts cannot partially advance revision;
- generated dialogue work runs only for created or changed sources.
