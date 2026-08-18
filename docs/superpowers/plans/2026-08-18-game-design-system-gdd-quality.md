# Game Design System GDD Quality Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shallow one-call GDD drafts with a backward-compatible v2 pipeline that supports quick and professional modes, optional project briefs, adaptive structured documents, staged recovery, and deterministic quality gates.

**Architecture:** Keep `src/lib/gddGeneration.ts` as the v1 compatibility path for already-created jobs. New jobs carry `contractVersion: 2` and use a strict document AST, a blueprint shared by all generation stages, per-stage database checkpoints, section-level review/repair, and a deterministic Markdown renderer. The worker processes one durable stage per claim so professional generation remains within request limits and resumes after failure or refresh.

**Tech Stack:** Next.js App Router, TypeScript, Zod, existing OpenAI-compatible `completeLlm`, Supabase/Postgres RPCs and RLS, React Query, React Testing Library, Jest, sanctioned MDX/Yjs document persistence.

---

## File Map

- Create `src/lib/gdd-generation/v2/contracts.ts`: v2 input, blueprint, AST, review, and artifact schemas/types.
- Create `src/lib/gdd-generation/v2/contracts.test.ts`: strict parsing, hierarchy, table, and reference tests.
- Create `src/lib/gdd-generation/v2/renderer.ts`: deterministic numbered Markdown rendering without visible provenance.
- Create `src/lib/gdd-generation/v2/quality.ts`: length, structure, repetition, placeholder, formula, and registry checks.
- Create `src/lib/gdd-generation/v2/quality.test.ts`: renderer and deterministic-quality tests.
- Create `src/lib/gdd-generation/v2/generator.ts`: stage-specific prompts, JSON repair, and model calls.
- Create `src/lib/gdd-generation/v2/generator.test.ts`: prompt, truthfulness, batching, and repair tests.
- Create `src/lib/gdd-generation/v2/stageRunner.ts`: pure next-stage selection and one-stage execution.
- Create `src/lib/gdd-generation/v2/stageRunner.test.ts`: quick/professional transitions and targeted repair tests.
- Create `supabase/migrations/20260818120000_gdd_generation_v2.sql`: v2 columns, phases, checkpoint RPC, and retry semantics.
- Create `tests/unit/database/gdd-generation-v2-migration.test.ts`: static migration security/state assertions.
- Modify `src/lib/services/gddGenerationService.ts`: v1/v2 job union, public mode/version, checkpoint service, and latest-job reader.
- Modify `src/lib/services/gddGenerationService.test.ts`: checkpoint, public DTO, and latest-job tests.
- Modify `src/lib/gdd-generation/worker.ts`: dispatch v1 or one v2 stage, lease heartbeat, final persistence.
- Modify `src/lib/gdd-generation/worker.test.ts`: resume, checkpoint, repair-limit, and atomic-save tests.
- Modify `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`: accept mode/brief and return latest matching job on GET.
- Modify `tests/unit/gdd-generation-routes.test.ts`: request normalization, limits, contract v2, and restore tests.
- Modify `src/lib/services/gameDesignSystemClient.ts`: typed v2 start and latest-job functions.
- Modify `src/lib/utils/queryKeys.ts`: latest GDD job cache key.
- Create `src/components/game-design-system/GddGenerationDialog.tsx`: accessible mode/brief generation dialog.
- Create `src/components/game-design-system/GddGenerationDialog.test.tsx`: isolated dialog behavior tests.
- Modify `src/components/game-design-system/GameDesignSystemWorkspace.tsx`: open dialog, restore/poll jobs, and show phase labels.
- Modify `src/components/game-design-system/GameDesignSystemsPage.module.css`: compact dialog and stable progress styling.
- Modify `src/components/game-design-system/GameDesignSystemsPage.test.tsx`: complete generation workflow tests.
- Create `tests/fixtures/gdd-quality/street-corner-warmth.json`: reference-derived structure/density expectations without copied game content.
- Create `scripts/verify-gdd-generation-quality.ts`: opt-in real-model quality report.
- Modify `package.json`: add the gated quality command.

## Task 1: Define the v2 structured generation contract

**Files:**
- Create: `src/lib/gdd-generation/v2/contracts.ts`
- Create: `src/lib/gdd-generation/v2/contracts.test.ts`

- [ ] **Step 1: Write strict contract tests**

Create fixtures for a blueprint with one top-level section and two nested sections, a paragraph/table/formula/example document, and a review report. Include these exact assertions:

```ts
expect(parseGddBlueprint(validBlueprint).outline).toHaveLength(3);
expect(() => parseGddBlueprint({
  ...validBlueprint,
  outline: [{ ...validBlueprint.outline[1], parentId: 'missing' }],
})).toThrow(/parent/i);
expect(() => parseGddDocument({
  ...validDocument,
  sections: [{
    ...validDocument.sections[0],
    blocks: [{ type: 'data-table', columns: ['A', 'B'], rows: [['only-one']] }],
  }],
})).toThrow(/column/i);
expect(isGddGenerationInputV2({ contractVersion: 2, mode: 'professional' })).toBe(true);
expect(isGddGenerationInputV2({ projectName: 'legacy' })).toBe(false);
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
npx jest src/lib/gdd-generation/v2/contracts.test.ts --runInBand
```

Expected: FAIL because `contracts.ts` does not exist.

- [ ] **Step 3: Implement bounded strict schemas and exported types**

Implement this public surface in `contracts.ts`:

```ts
export const gddGenerationModeSchema = z.enum(['quick', 'professional']);
export type GddGenerationMode = z.infer<typeof gddGenerationModeSchema>;

export type GddGenerationInputV2 = {
  contractVersion: 2;
  mode: GddGenerationMode;
  creativeBrief?: string;
  language: 'zh-CN';
  projectId: string;
  projectName: string;
  designSystemId: string;
  versionId: string;
  versionNumber: number;
  systemTitle: string;
  rules: GameDesignRuleSet;
  designDocument: GameDesignDocument;
  projectSources: GameDesignSourceSnapshot[];
};

export const gddOutlineItemSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  title: z.string().trim().min(1).max(120),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  parentId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).nullable(),
  group: z.enum(['core', 'systems', 'content']),
  purpose: z.string().trim().min(1).max(600),
  requiredBlocks: z.array(z.enum([
    'paragraph', 'bullet-list', 'data-table', 'formula', 'flow', 'example', 'quote',
  ])).max(8),
}).strict();

export const numericDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().max(40),
  unit: z.string().trim().max(80),
  definition: z.string().trim().min(1).max(500),
  valueOrRange: z.string().trim().min(1).max(160),
}).strict();

export const gddBlueprintSchema = z.object({
  title: z.string().trim().min(1).max(160),
  premise: z.string().trim().min(1).max(1200),
  genreProfile: z.string().trim().min(1).max(800),
  designPillars: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
  outline: z.array(gddOutlineItemSchema).min(3).max(40),
  terminology: z.array(z.object({
    term: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(1).max(500),
  }).strict()).max(80),
  numericRegistry: z.array(numericDefinitionSchema).max(100),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(30),
}).strict();
```

Define `gddBlockSchema` as a strict discriminated union. Formula and example blocks include `numericRefs: string[]`; table rows must have exactly the same number of cells as columns. Define `gddSectionSchema` with `id`, `title`, `depth`, `parentId`, and `blocks`; `gddDocumentSchema` with `title`, optional `versionLabel`, optional `gameType`, optional `targetPlatforms`, `premise`, `sections`, `numericRegistry`, and `assumptions`; and `gddReviewReportSchema` with `status`, `repairRound`, and bounded structured issues.

Export these functions and types:

```ts
export function parseGddBlueprint(value: unknown): GddBlueprint;
export function parseGddSections(value: unknown): GddSection[];
export function parseGddDocument(value: unknown): GddDocument;
export function parseGddReviewReport(value: unknown): GddReviewReport;
export function isGddGenerationInputV2(value: unknown): value is GddGenerationInputV2;
export type GddGenerationArtifacts = {
  blueprint: GddBlueprint | null;
  sectionDrafts: GddSection[];
  reviewReport: GddReviewReport | null;
  repairRound: number;
};
```

Use `superRefine` to enforce unique IDs, valid parent ordering, depth increments of exactly one, unique terminology/numeric IDs, and valid numeric references.

- [ ] **Step 4: Run the contract tests**

Run:

```bash
npx jest src/lib/gdd-generation/v2/contracts.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/lib/gdd-generation/v2/contracts.ts src/lib/gdd-generation/v2/contracts.test.ts
git commit -m "feat: define structured GDD v2 contract"
```

## Task 2: Render natural Markdown and enforce deterministic quality

**Files:**
- Create: `src/lib/gdd-generation/v2/renderer.ts`
- Create: `src/lib/gdd-generation/v2/quality.ts`
- Create: `src/lib/gdd-generation/v2/quality.test.ts`
- Modify: `src/lib/gddGeneration.ts`
- Modify: `src/lib/gddGeneration.test.ts`

- [ ] **Step 1: Write failing renderer and quality tests**

Cover numbered headings, each block type, conditional metadata, conditional assumptions, and forbidden provenance. Use assertions shaped like:

```ts
const markdown = renderGddV2Markdown(validDocument);
expect(markdown).toContain('## 1. 游戏概述');
expect(markdown).toContain('### 1.1. 核心体验');
expect(markdown).toContain('| 行为 | 基础值 |');
expect(markdown).toContain('```text\n实际增量 = max(1, round(原始增量))\n```');
expect(markdown).not.toMatch(/Provenance/i);
expect(renderGddV2Markdown({ ...validDocument, assumptions: [] }))
  .not.toContain('待确认事项');

const issues = validateGddQuality(validDocument, 'professional');
expect(issues).toEqual([]);
expect(validateGddQuality(documentWithDuplicateParagraph, 'professional'))
  .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate-content' })]));
expect(validateGddQuality(documentWithUnknownNumericRef, 'professional'))
  .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-numeric-ref' })]));
```

Build the professional fixture with generated repeated Chinese prose so it crosses 6,000 readable characters without checking in a huge literal.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx jest src/lib/gdd-generation/v2/quality.test.ts src/lib/gddGeneration.test.ts --runInBand
```

Expected: FAIL because the v2 renderer/validator are missing and the v1 renderer still emits provenance text.

- [ ] **Step 3: Implement deterministic rendering**

Export:

```ts
export function renderGddV2Markdown(document: GddDocument): string;
```

Render section depth 1/2/3 as Markdown depth 2/3/4 and derive hierarchical numbers from document order. Render blocks as follows:

```ts
switch (block.type) {
  case 'paragraph': return block.text;
  case 'bullet-list': return block.items.map((item) => `- ${item}`).join('\n');
  case 'data-table': return renderTable(block.columns, block.rows);
  case 'formula': return `\`\`\`text\n${block.expression}\n\`\`\``;
  case 'flow': return `\`\`\`text\n${block.steps.join(' -> ')}\n\`\`\``;
  case 'example': return `**${block.title}**\n\n${block.body}`;
  case 'quote': return block.text.split('\n').map((line) => `> ${block.speaker ? `${block.speaker}：` : ''}${line}`).join('\n');
}
```

Do not render source names, rule IDs, AI disclaimers, or provenance. Render `## 待确认事项` only when `document.assumptions.length > 0`.

- [ ] **Step 4: Implement deterministic quality findings**

Export:

```ts
export type DeterministicQualityIssue = {
  code: 'length' | 'section-count' | 'empty-section' | 'placeholder'
    | 'duplicate-content' | 'forbidden-provenance' | 'missing-required-block'
    | 'unknown-numeric-ref';
  sectionId: string | null;
  message: string;
};

export function countReadableCharacters(markdown: string): number;
export function validateGddQuality(
  document: GddDocument,
  mode: GddGenerationMode,
  blueprint?: GddBlueprint,
): DeterministicQualityIssue[];
```

Professional mode requires 6,000-10,000 readable characters and normally 9-13 depth-1 sections. Quick mode requires 2,500-4,000. Reject case-insensitive `Provenance`, empty sections, placeholder markers, normalized duplicate paragraphs, missing blueprint-required block types, and missing numeric registry IDs.

- [ ] **Step 5: Remove visible provenance from the v1 compatibility renderer**

Update `renderGddMarkdown` so historical v1 jobs also render clean prose. Remove every provenance block and the final AI-draft disclaimer. Render `Assumptions to Confirm` only when assumptions are non-empty; keep generation evidence exclusively in Document metadata.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx jest src/lib/gdd-generation/v2/quality.test.ts src/lib/gddGeneration.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit rendering and quality gates**

```bash
git add src/lib/gdd-generation/v2/renderer.ts src/lib/gdd-generation/v2/quality.ts src/lib/gdd-generation/v2/quality.test.ts src/lib/gddGeneration.ts src/lib/gddGeneration.test.ts
git commit -m "feat: render and validate professional GDD documents"
```

## Task 3: Implement stage-specific model generation

**Files:**
- Create: `src/lib/gdd-generation/v2/generator.ts`
- Create: `src/lib/gdd-generation/v2/generator.test.ts`

- [ ] **Step 1: Write failing prompt and generation tests**

Test the exact stage boundaries and truthfulness contract:

```ts
expect(buildBlueprintMessages(input)[0].content).toContain('9 to 13 first-level sections');
expect(buildBlueprintMessages(input)[0].content).toContain('Do not add a production milestone section');
expect(buildBlueprintMessages(input)[1].content).toContain(input.creativeBrief);
expect(buildBlueprintMessages(input)[1].content).toContain('BEGIN_UNTRUSTED_GAME_DESIGN_DOCUMENT_DATA');

await generateSectionBatch(input, blueprint, 'systems', complete);
expect(complete).toHaveBeenCalledWith(
  expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('numericRegistry') })]),
  expect.objectContaining({ temperature: 0.2 }),
);

const report = await reviewGddDocument(input, blueprint, document, deterministicIssues, complete);
expect(report.issues[0].sectionId).toBe('probability-system');
```

Also prove one malformed JSON response receives one schema repair, a transport error remains retryable, source instructions stay untrusted, and the section prompt includes only the requested group plus shared registries.

- [ ] **Step 2: Run the generator tests and verify failure**

Run:

```bash
npx jest src/lib/gdd-generation/v2/generator.test.ts --runInBand
```

Expected: FAIL because `generator.ts` does not exist.

- [ ] **Step 3: Implement a reusable strict JSON completion helper**

Use the existing isolated GDD provider environment variables and export stage functions:

```ts
type Completion = (messages: ChatMessage[], options?: StreamLlmOptions) => Promise<string>;

export function gddV2LlmOptions(maxCompletionTokens: number): StreamLlmOptions {
  return {
    model: process.env.GDD_GENERATION_LLM_MODEL || process.env.LLM_MODEL || 'deepseek-v4-flash',
    ...(process.env.GDD_GENERATION_LLM_API_URL ? { baseUrl: process.env.GDD_GENERATION_LLM_API_URL } : {}),
    ...(process.env.GDD_GENERATION_LLM_API_KEY ? { apiKey: process.env.GDD_GENERATION_LLM_API_KEY } : {}),
    thinking: 'disabled',
    temperature: 0.2,
    maxCompletionTokens,
  };
}

async function completeStrictJson<T>(input: {
  messages: ChatMessage[];
  parse: (value: unknown) => T;
  shape: string;
  maxCompletionTokens: number;
  complete: Completion;
}): Promise<T>;
```

`completeStrictJson` parses the first response and performs exactly one JSON/schema repair. It must not turn network/provider errors into permanent validation errors.

- [ ] **Step 4: Implement the stage prompt builders and calls**

Export:

```ts
export function buildBlueprintMessages(input: GddGenerationInputV2): ChatMessage[];
export async function generateGddBlueprint(input: GddGenerationInputV2, complete?: Completion): Promise<GddBlueprint>;
export async function generateQuickGddDocument(input: GddGenerationInputV2, blueprint: GddBlueprint, complete?: Completion): Promise<GddDocument>;
export async function generateSectionBatch(input: GddGenerationInputV2, blueprint: GddBlueprint, group: 'core' | 'systems' | 'content', complete?: Completion): Promise<GddSection[]>;
export async function reviewGddDocument(input: GddGenerationInputV2, blueprint: GddBlueprint, document: GddDocument, deterministicIssues: DeterministicQualityIssue[], complete?: Completion): Promise<GddReviewReport>;
export async function repairGddSections(input: GddGenerationInputV2, blueprint: GddBlueprint, document: GddDocument, report: GddReviewReport, complete?: Completion): Promise<GddSection[]>;
```

Blueprint requirements include the adaptive default skeleton, nested depth, group assignment, terminology, numeric registry, no default milestone section, and production-fact truthfulness. Professional section calls target roughly 2,000-3,500 Chinese characters per group. Review returns only structured issues; repair receives only failing section IDs plus the shared blueprint and registries.

- [ ] **Step 5: Run generator tests**

Run:

```bash
npx jest src/lib/gdd-generation/v2/generator.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit stage generation**

```bash
git add src/lib/gdd-generation/v2/generator.ts src/lib/gdd-generation/v2/generator.test.ts
git commit -m "feat: add staged GDD generation prompts"
```

## Task 4: Add durable v2 checkpoints and public job fields

**Files:**
- Create: `supabase/migrations/20260818120000_gdd_generation_v2.sql`
- Create: `tests/unit/database/gdd-generation-v2-migration.test.ts`
- Modify: `src/lib/services/gddGenerationService.ts`
- Modify: `src/lib/services/gddGenerationService.test.ts`

- [ ] **Step 1: Write failing migration and service tests**

Assert the migration adds `mode`, `contract_version`, `blueprint`, `section_drafts`, `review_report`, and `repair_round`; expands the phase check; keeps artifacts out of authenticated column grants; and defines a service-role-only checkpoint RPC. Add service assertions:

```ts
await checkpointGddGenerationJob(client, {
  jobId: 'job-1', workerId: 'worker-1', nextPhase: 'generating_core',
  blueprint, sectionDrafts: [], reviewReport: null, repairRound: 0,
});
expect(rpc).toHaveBeenCalledWith('checkpoint_gdd_generation_job', expect.objectContaining({
  p_job_id: 'job-1',
  p_next_phase: 'generating_core',
}));
expect(toPublicGddGenerationJob(v2Job)).toEqual(expect.objectContaining({
  mode: 'professional', contract_version: 2,
}));
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npx jest tests/unit/database/gdd-generation-v2-migration.test.ts src/lib/services/gddGenerationService.test.ts --runInBand
```

Expected: FAIL because the migration and checkpoint service do not exist.

- [ ] **Step 3: Add the additive v2 migration**

The migration must:

```sql
alter table public.gdd_generation_jobs
  add column if not exists mode text not null default 'quick',
  add column if not exists contract_version integer not null default 1,
  add column if not exists blueprint jsonb,
  add column if not exists section_drafts jsonb not null default '[]'::jsonb,
  add column if not exists review_report jsonb,
  add column if not exists repair_round integer not null default 0;
```

Add bounded JSON/type checks, mode/version/repair constraints, and replace the phase check with:

```sql
phase in (
  'collecting', 'planning', 'generating_core', 'generating_systems',
  'generating_content', 'reviewing', 'repairing', 'saving',
  'generating', 'validating', 'completed', 'failed'
)
```

Create `checkpoint_gdd_generation_job(uuid,text,text,jsonb,jsonb,jsonb,integer)`. It must lock and verify the running leased row, persist the full artifacts, reset `attempt_count` to zero for the next stage, set `status = 'queued'`, set the next phase, and clear the lease. Replace claim/retry functions so claim preserves the queued phase and retry preserves the current phase unless it becomes terminal. Grant checkpoint execution only to `service_role`; grant authenticated users only `mode` and `contract_version` in addition to the existing public columns.

- [ ] **Step 4: Extend service types and functions**

Use:

```ts
export type GddJobPhase =
  | 'collecting' | 'planning' | 'generating_core' | 'generating_systems'
  | 'generating_content' | 'reviewing' | 'repairing' | 'saving'
  | 'generating' | 'validating' | 'completed' | 'failed';

export type GddGenerationJob = {
  // existing fields
  mode: GddGenerationMode;
  contract_version: number;
  input: GddGenerationInput | GddGenerationInputV2;
  blueprint: GddBlueprint | null;
  section_drafts: GddSection[];
  review_report: GddReviewReport | null;
  repair_round: number;
};

export async function checkpointGddGenerationJob(
  serviceClient: SupabaseClient,
  input: {
    jobId: string;
    workerId: string;
    nextPhase: GddJobPhase;
    blueprint: GddBlueprint | null;
    sectionDrafts: GddSection[];
    reviewReport: GddReviewReport | null;
    repairRound: number;
  },
): Promise<void>;

export async function getLatestPublicGddGenerationJob(
  supabase: SupabaseClient,
  input: { projectId: string; designSystemId: string; versionId: string },
): Promise<PublicGddGenerationJob | null>;
```

`createGddGenerationJob` writes mode/contract version from v2 input and defaults legacy inputs to quick/v1.

- [ ] **Step 5: Run migration and service tests**

Run:

```bash
npx jest tests/unit/database/gdd-generation-v2-migration.test.ts tests/unit/database/gdd-generation-migration.test.ts src/lib/services/gddGenerationService.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit persistence changes**

```bash
git add supabase/migrations/20260818120000_gdd_generation_v2.sql tests/unit/database/gdd-generation-v2-migration.test.ts src/lib/services/gddGenerationService.ts src/lib/services/gddGenerationService.test.ts
git commit -m "feat: persist staged GDD generation checkpoints"
```

## Task 5: Execute one resumable v2 stage per worker claim

**Files:**
- Create: `src/lib/gdd-generation/v2/stageRunner.ts`
- Create: `src/lib/gdd-generation/v2/stageRunner.test.ts`
- Modify: `src/lib/gdd-generation/worker.ts`
- Modify: `src/lib/gdd-generation/worker.test.ts`

- [ ] **Step 1: Write failing stage-transition tests**

Exercise the full state table without network calls:

```ts
expect(nextGddStage(quickJobWithoutBlueprint)).toBe('planning');
expect(nextGddStage(quickJobWithBlueprint)).toBe('generating_core');
expect(nextGddStage(proJobWithCoreSections)).toBe('generating_systems');
expect(nextGddStage(proJobWithAllSections)).toBe('reviewing');
expect(nextGddStage(jobWithFailingReview)).toBe('repairing');
expect(nextGddStage(jobWithPassingReview)).toBe('saving');
```

Prove each successful non-saving stage calls `checkpoint` once and returns `queued`; repair replaces only issue-linked sections; repair round two with remaining issues throws `GddGenerationValidationError`; saving renders validated Markdown and invokes the existing atomic persistence function.

- [ ] **Step 2: Run stage tests and verify failure**

Run:

```bash
npx jest src/lib/gdd-generation/v2/stageRunner.test.ts src/lib/gdd-generation/worker.test.ts --runInBand
```

Expected: FAIL because the v2 stage runner does not exist.

- [ ] **Step 3: Implement pure stage selection and assembly**

Export:

```ts
export type GddV2Stage =
  | 'planning' | 'generating_core' | 'generating_systems'
  | 'generating_content' | 'reviewing' | 'repairing' | 'saving';

export function nextGddStage(job: GddGenerationJob): GddV2Stage;
export function assembleGddDocument(input: GddGenerationInputV2, blueprint: GddBlueprint, sections: GddSection[]): GddDocument;
export function replaceSections(current: GddSection[], replacements: GddSection[]): GddSection[];
```

Selection is artifact-driven rather than trusting the visible phase. A stage is complete only when its expected blueprint groups are present. Quick mode stores its complete document sections after `generating_core` and skips professional system/content batches.

- [ ] **Step 4: Implement one-stage execution**

Use an injectable dependency contract:

```ts
export type GddV2StageDependencies = {
  generateBlueprint: typeof generateGddBlueprint;
  generateQuickDocument: typeof generateQuickGddDocument;
  generateSectionBatch: typeof generateSectionBatch;
  reviewDocument: typeof reviewGddDocument;
  repairSections: typeof repairGddSections;
  checkpoint: typeof checkpointGddGenerationJob;
  persistV2: typeof persistGeneratedGddV2Document;
};

export async function processClaimedGddV2Stage(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddGenerationJob },
  dependencies?: GddV2StageDependencies,
): Promise<GddJobStatus>;
```

Before semantic review, call `validateGddQuality`. Store deterministic and semantic findings together in `review_report`. If review passes, checkpoint to `saving`. If it fails and `repair_round < 2`, checkpoint to `repairing`; a repair increments the round, replaces only referenced sections, clears the previous report, and checkpoints back to `reviewing`.

Add `persistGeneratedGddV2Document(serviceClient, job, workerId, document, markdown)` beside the existing v1 persistence helper. It must call the same atomic `persist_completed_gdd_generation_job` RPC, include `contractVersion`, `mode`, and the server-owned rule/source metadata, and accept `GddDocument` rather than the legacy `GeneratedGdd` shape. Keep `persistGeneratedGddDocument` unchanged for v1 tests and callers.

- [ ] **Step 5: Dispatch v1 and v2 from the existing leased worker**

In `processClaimedGddJob`, retain existing v1 behavior when `isGddGenerationInputV2(job.input)` is false. For v2, revalidate project/binding permissions, heartbeat with the current stage, run exactly one v2 stage, and return `queued` after a checkpoint. Generalize the 30-second lease heartbeat helper so every model stage renews the lease.

- [ ] **Step 6: Run worker tests**

Run:

```bash
npx jest src/lib/gdd-generation/v2/stageRunner.test.ts src/lib/gdd-generation/worker.test.ts tests/unit/game-design-system-worker-route.test.ts --runInBand
```

Expected: PASS, including existing v1 tests.

- [ ] **Step 7: Commit worker staging**

```bash
git add src/lib/gdd-generation/v2/stageRunner.ts src/lib/gdd-generation/v2/stageRunner.test.ts src/lib/gdd-generation/worker.ts src/lib/gdd-generation/worker.test.ts
git commit -m "feat: run resumable professional GDD stages"
```

## Task 6: Accept v2 requests and restore durable jobs

**Files:**
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`
- Modify: `tests/unit/gdd-generation-routes.test.ts`
- Modify: `src/lib/services/gameDesignSystemClient.ts`
- Modify: `src/lib/utils/queryKeys.ts`

- [ ] **Step 1: Write failing API and client contract tests**

Add route cases for professional mode, a trimmed optional brief, invalid mode, a brief over 4,000 characters, and collection GET. The successful POST assertion is:

```ts
expect(createGddGenerationJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
  input: expect.objectContaining({
    contractVersion: 2,
    mode: 'professional',
    creativeBrief: 'A quiet game about earning a stray cat’s trust.',
    language: 'zh-CN',
  }),
}));
```

GET must authorize editor/admin access, filter by project/system/version, and return `{ job: null }` when no matching job exists.

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
npx jest tests/unit/gdd-generation-routes.test.ts --runInBand
```

Expected: FAIL because the POST schema ignores v2 fields and the collection GET is absent.

- [ ] **Step 3: Extend the request and response contract**

Use:

```ts
const requestSchema = z.object({
  designSystemId: z.string().uuid(),
  versionId: z.string().uuid(),
  mode: z.enum(['quick', 'professional']).default('quick'),
  creativeBrief: z.string().trim().max(4000).optional(),
}).strict();
```

Build `GddGenerationInputV2` with `contractVersion: 2`, `language: 'zh-CN'`, and omit `creativeBrief` after trimming if it is empty. Keep permissions, exact pinned binding, authorized source resolution, idempotency, and opportunistic worker scheduling unchanged.

- [ ] **Step 4: Add collection GET for refresh recovery**

Parse required `designSystemId` and `versionId` search parameters, use the same editor/admin permission boundary, call `getLatestPublicGddGenerationJob`, and return the bounded public DTO. Do not expose input, creative brief, artifacts, source excerpts, or lease data.

- [ ] **Step 5: Update client functions and query keys**

Use:

```ts
export type StartProjectGddGenerationInput = {
  mode: GddGenerationMode;
  creativeBrief?: string;
};

export async function startProjectGddGeneration(
  projectId: string,
  designSystemId: string,
  versionId: string,
  input: StartProjectGddGenerationInput,
  key = crypto.randomUUID(),
): Promise<PublicGddGenerationJob>;

export async function fetchLatestProjectGddGenerationJob(
  projectId: string,
  designSystemId: string,
  versionId: string,
): Promise<PublicGddGenerationJob | null>;
```

Add `queryKeys.projectGddGenerationJob(projectId, designSystemId, versionId)`.

- [ ] **Step 6: Run API/service-related tests**

Run:

```bash
npx jest tests/unit/gdd-generation-routes.test.ts src/lib/services/gddGenerationService.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit API and client contracts**

```bash
git add src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts tests/unit/gdd-generation-routes.test.ts src/lib/services/gameDesignSystemClient.ts src/lib/utils/queryKeys.ts
git commit -m "feat: expose GDD modes and durable job restore"
```

## Task 7: Add the generation dialog and phase-aware project UI

**Files:**
- Create: `src/components/game-design-system/GddGenerationDialog.tsx`
- Create: `src/components/game-design-system/GddGenerationDialog.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`

- [ ] **Step 1: Write isolated failing dialog tests**

Cover the default professional mode, mode switching, opening context, brief trimming, cancellation, max length, and pending disablement:

```ts
expect((screen.getByRole('radio', { name: 'Professional' }) as HTMLInputElement).checked).toBe(true);
await user.type(screen.getByLabelText('Project creative brief'), '  A quiet cat story.  ');
await user.click(screen.getByRole('button', { name: 'Generate professional GDD' }));
expect(onSubmit).toHaveBeenCalledWith({
  mode: 'professional',
  creativeBrief: 'A quiet cat story.',
});
```

- [ ] **Step 2: Write failing workspace workflow tests**

Update the existing generation test to open the dialog, explicitly select Quick Draft, and submit it. Add default professional-mode payload, restored running job after remount, human-readable phase labels, failure retry reopening the dialog, and completed-document link tests.

- [ ] **Step 3: Run component tests and verify failure**

Run:

```bash
npx jest src/components/game-design-system/GddGenerationDialog.test.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx --runInBand
```

Expected: FAIL because the dialog and restore query do not exist.

- [ ] **Step 4: Implement the focused dialog**

Use this public contract:

```ts
type Props = {
  open: boolean;
  projectName: string;
  systemTitle: string;
  versionNumber: number;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: { mode: GddGenerationMode; creativeBrief?: string }) => void;
};
```

Render a `role="dialog"` modal surface, a two-option radio/segmented mode control, an optional textarea with `maxLength={4000}`, read-only project/system/version rows, cancel, and a mode-specific submit button. Initialize and reset the local mode to `professional`; the API's `quick` default exists only for backward compatibility with old callers. Reset local fields when a different project opens. Keep the dialog width responsive and do not nest cards.

- [ ] **Step 5: Integrate job restore and polling**

Replace the immediate row mutation with `generationTarget` state. Submit the dialog payload to `startProjectGddGeneration`. Query the latest job for each selected project/system/version and seed `gddJobs` from those results so refresh restores queued, running, failed, and completed states.

Use a single phase label map:

```ts
const GDD_PHASE_LABELS: Record<GddJobPhase, string> = {
  collecting: 'Analyzing project context',
  planning: 'Planning document structure',
  generating_core: 'Generating core gameplay',
  generating_systems: 'Generating systems and numbers',
  generating_content: 'Generating content and presentation',
  reviewing: 'Checking consistency',
  repairing: 'Repairing inconsistent sections',
  saving: 'Saving document',
  generating: 'Generating draft',
  validating: 'Validating draft',
  completed: 'Completed',
  failed: 'Failed',
};
```

Keep the existing 900 ms polling behavior, stop at terminal state, invalidate project documents on completion, and disable removal while a job is active.

- [ ] **Step 6: Add restrained dialog/progress styles**

Add fixed responsive constraints for the overlay, dialog, segmented control, textarea, context rows, action bar, and phase line. Keep radius at 6-8 px, preserve existing neutral/blue palette, and ensure controls wrap without overlap at 320 px width.

- [ ] **Step 7: Run component tests**

Run:

```bash
npx jest src/components/game-design-system/GddGenerationDialog.test.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit the generation experience**

```bash
git add src/components/game-design-system/GddGenerationDialog.tsx src/components/game-design-system/GddGenerationDialog.test.tsx src/components/game-design-system/GameDesignSystemWorkspace.tsx src/components/game-design-system/GameDesignSystemsPage.module.css src/components/game-design-system/GameDesignSystemsPage.test.tsx
git commit -m "feat: add quick and professional GDD generation dialog"
```

## Task 8: Add the reference-derived quality benchmark

**Files:**
- Create: `tests/fixtures/gdd-quality/street-corner-warmth.json`
- Create: `scripts/verify-gdd-generation-quality.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the structural benchmark fixture**

Store only benchmark inputs and expectations, not the reference GDD body:

```json
{
  "creativeBrief": "A healing single-player game about meeting and earning the trust of three stray cats across a changing city corner.",
  "expected": {
    "language": "zh-CN",
    "minimumReadableCharacters": 6000,
    "maximumReadableCharacters": 10000,
    "minimumTopLevelSections": 9,
    "maximumTopLevelSections": 13,
    "requiredBlockTypes": ["data-table", "formula", "flow", "example", "quote"],
    "forbiddenText": ["Provenance"]
  }
}
```

- [ ] **Step 2: Implement the opt-in verifier**

The script must exit before making a model call unless explicitly enabled:

```ts
if (process.env.RUN_GDD_MODEL_QUALITY !== '1') {
  throw new Error('Set RUN_GDD_MODEL_QUALITY=1 to run the paid GDD quality check.');
}
```

Build a fixed v2 professional input from the fixture using this Game Design System seed:

```ts
const benchmarkRules: GameDesignRuleSet = {
  schemaVersion: 1,
  genres: ['Emotional companion simulation', 'Light narrative'],
  philosophies: ['Irreversible bonds', 'Behavior-led storytelling', 'Gentle responsibility'],
  suitableFor: 'Single-player mobile and PC games centered on trust and companionship',
  rules: [
    {
      id: 'trust-through-behavior', kind: 'principle', title: 'Trust through behavior',
      statement: 'Express relationship change through observable behavior before exposition.',
      appliesWhen: 'Designing character reactions and bond progression.', severity: 'required',
    },
    {
      id: 'weather-has-consequence', kind: 'constraint', title: 'Weather has consequence',
      statement: 'Weather must change survival state, encounter rules, or available choices.',
      appliesWhen: 'Designing weather and seasonal content.', severity: 'required',
    },
    {
      id: 'no-forced-energy-purchase', kind: 'anti_pattern', title: 'No forced energy purchase',
      statement: 'Do not monetize recovery of core daily actions.',
      appliesWhen: 'Designing economy and monetization.', severity: 'required',
    },
  ],
  tableGuidance: [
    { table: 'CatProfiles', purpose: 'Define distinct character behavior and bond responses.', fields: ['name', 'temperament', 'encounterWeight', 'bondModifiers'] },
    { table: 'WeatherRules', purpose: 'Define encounter and survival effects.', fields: ['weather', 'encounterModifier', 'bondModifier', 'actionModifier'] },
  ],
};
```

Use a design document that names the rescue/companionship loop, behavioral trust, differentiated cats, weather pressure, and a warm watercolor presentation. Run blueprint/core/systems/content/review/repair in memory using the exported generator functions, render Markdown, run deterministic quality checks, and print a JSON report containing character count, section count, block counts, deterministic findings, semantic findings, and pass/fail. Write the Markdown report to `/tmp/keco-gdd-quality.md`; do not write generated model output into the repository.

- [ ] **Step 3: Add the package command**

```json
"accept:gdd-quality:paid": "tsx scripts/verify-gdd-generation-quality.ts"
```

- [ ] **Step 4: Verify the guard without spending model tokens**

Run:

```bash
npm run accept:gdd-quality:paid
```

Expected: non-zero exit with `Set RUN_GDD_MODEL_QUALITY=1` and no network call.

- [ ] **Step 5: Commit the benchmark tooling**

```bash
git add tests/fixtures/gdd-quality/street-corner-warmth.json scripts/verify-gdd-generation-quality.ts package.json
git commit -m "test: add professional GDD quality benchmark"
```

## Task 9: End-to-end verification and documentation check

**Files:**
- Verify only; modify files only for failures caused by this feature.

- [ ] **Step 1: Run all focused GDD tests**

```bash
npx jest src/lib/gdd-generation/v2/contracts.test.ts src/lib/gdd-generation/v2/quality.test.ts src/lib/gdd-generation/v2/generator.test.ts src/lib/gdd-generation/v2/stageRunner.test.ts src/lib/gddGeneration.test.ts src/lib/gdd-generation/worker.test.ts src/lib/services/gddGenerationService.test.ts tests/unit/gdd-generation-routes.test.ts tests/unit/database/gdd-generation-migration.test.ts tests/unit/database/gdd-generation-v2-migration.test.ts src/components/game-design-system/GddGenerationDialog.test.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx tests/unit/game-design-system-worker-route.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run static validation**

```bash
npm run typecheck
npm run typecheck:api
npm run lint
```

Expected: all commands exit 0. If the repository has unrelated pre-existing failures, record the exact command and failure without changing unrelated files.

- [ ] **Step 3: Run migration verification when local Supabase is available**

```bash
npx supabase db reset
npx jest tests/unit/database/gdd-generation-migration.test.ts tests/unit/database/gdd-generation-v2-migration.test.ts --runInBand
```

Expected: migrations apply and both tests pass. Do not reset a non-local database.

- [ ] **Step 4: Exercise the browser workflow**

Start the local app, select a bound Game Design System version, open the generation dialog, submit quick mode, then submit professional mode with a brief. Verify the mode/brief request, phase labels, refresh recovery, failure retry, completed document link, nested headings, tables, formulas, examples, conditional assumptions, and absence of visible `Provenance`.

- [ ] **Step 5: Run the paid benchmark only with configured credentials and explicit approval**

```bash
RUN_GDD_MODEL_QUALITY=1 npm run accept:gdd-quality:paid
```

Expected: JSON report has `pass: true` and `/tmp/keco-gdd-quality.md` contains 6,000-10,000 readable Chinese characters. This step is skipped when credentials or explicit paid-test approval are absent.

- [ ] **Step 6: Inspect the final diff**

```bash
git diff --check
git status --short
git log --oneline -10
```

Expected: no whitespace errors, no generated model output in the repository, and only planned feature files plus pre-existing user changes are present.
