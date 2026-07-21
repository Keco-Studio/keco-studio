# Document Attachment Intent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route ordinary document attachments to content analysis, preserve dedicated table-generation workflows, and ground capability answers in implemented product behavior.

**Architecture:** `buildDesignMessage` becomes an intent-aware envelope builder with a required `analyze | tables` discriminator. Every producer chooses an intent explicitly. The system prompt separately owns the authoritative capability manifest and intent-routing rules.

**Tech Stack:** TypeScript, React, Next.js, Jest, Playwright, Mammoth, Supabase

## Global Constraints

- General chat attachments use `analyze`; design upload, project-document table export, and signed table-export reconstruction use `tables`.
- The builder has no default intent.
- Analysis answers from supplied content, summarizes when instructions are empty, and does not force schema tools or unsolicited table/script advice.
- An explicit table request from an analysis attachment remains actionable.
- Table intent preserves structure discovery, field discovery, extraction mode, quality gate, planning, and writes.
- The capability manifest states that `.txt`, `.md`, and `.docx` are supported; visible JSON can be analyzed; legacy `.doc`, hidden Word custom metadata, and exact layout fidelity are unsupported.
- Persisted `[Design document]` messages remain display-compatible.
- Do not change parsing limits, image extraction, script import, database schema, or attachment controls.
- Use TDD: observe each relevant test fail before production edits.

---

### Task 1: Intent-Aware Message Contract and Producers

**Files:**
- Modify: `src/lib/design-message.ts`
- Modify: `src/components/agent/ChatInput.tsx`
- Modify: `src/app/(dashboard)/[projectId]/design-upload/page.tsx`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `tests/unit/design-message.test.ts`
- Modify: `tests/unit/agent/user-message-display.test.ts`
- Modify: `tests/unit/design-upload-document-wiring.test.ts`
- Modify: `tests/unit/documents/document-editor-export.test.tsx`
- Modify: `tests/e2e/specs/agent-chat.spec.ts`

**Interfaces:**
- Produces: `DocumentMessageIntent = 'analyze' | 'tables'`.
- Produces: required `BuildDesignMessageParams.intent`.
- Produces: `[Document attachment]` and `[Document intent]` message markers.
- Preserves: `parseDesignMessage` support for legacy `[Design document]`.

- [ ] **Step 1: Write failing builder and display tests**

Update existing calls to pass an explicit intent. Add these behaviors:

```ts
it('builds neutral analysis without table directives', () => {
  const message = buildDesignMessage({
    fileName: 'story.docx',
    documentText: 'Visible body',
    additionalInstructions: 'What is in this file?',
    intent: 'analyze',
  });
  expect(message).toContain('[Document attachment]');
  expect(message).toContain('[Document intent]\nanalyze');
  expect(message).toContain('[User instructions]\nWhat is in this file?');
  expect(message).toContain('[Document content]\nVisible body');
  expect(message).toContain('already parsed');
  expect(message).not.toContain('First call list_project_structure and list_field_types');
});

it('summarizes analysis attachments with no instructions', () => {
  const message = buildDesignMessage({
    fileName: 'story.docx',
    documentText: 'Visible body',
    intent: 'analyze',
  });
  expect(message).toContain('provide a concise summary of the document');
});

it('retains the workflow for table intent', () => {
  const message = buildDesignMessage({
    fileName: 'design.docx',
    documentText: '| Name | Value |',
    intent: 'tables',
  });
  expect(message).toContain('[Document intent]\ntables');
  expect(message).toContain('First call list_project_structure and list_field_types');
  expect(message).toContain('EXTRACTION mode');
  expect(message).toContain('QUALITY GATE');
});
```

Add a literal legacy-message assertion to `design-message.test.ts` and `user-message-display.test.ts`; both new and legacy envelopes must render the file chip and optional user instructions without displaying document content.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run test:unit -- --runInBand tests/unit/design-message.test.ts tests/unit/agent/user-message-display.test.ts
```

Expected: FAIL because the intent parameter and new markers do not exist and analysis still carries table directives.

- [ ] **Step 3: Add failing producer and browser tests**

Assert `intent: 'tables'` in `design-upload-document-wiring.test.ts` and the DocumentEditor builder expectation.

Add a Playwright case that creates a real DOCX via `Document`, `Paragraph`, and `Packer` from `docx`; attaches it through the Agent file input; asks `What is in this file?`; intercepts `/api/agent-chat`; and asserts:

```ts
expect(body.message).toContain('[Document attachment]');
expect(body.message).toContain('[Document intent]\nanalyze');
expect(body.message).toContain('[User instructions]\nWhat is in this file?');
expect(body.message).toContain('Visible DOCX content');
expect(body.message).not.toContain('First call list_project_structure and list_field_types');
```

Fulfill the intercepted request with the existing `fulfillAgentStream` helper and assert the assistant response is visible.

- [ ] **Step 4: Run producer tests and verify RED**

```bash
npm run test:unit -- --runInBand tests/unit/design-upload-document-wiring.test.ts tests/unit/documents/document-editor-export.test.tsx
npx playwright test tests/e2e/specs/agent-chat.spec.ts --project=chromium -g "routes a DOCX chat attachment to analysis intent"
```

Expected: unit assertions FAIL because intent is absent; Playwright FAILS because the legacy table envelope is sent.

- [ ] **Step 5: Implement the builder**

Add:

```ts
const DOC_HEADER = '[Document attachment]';
const LEGACY_DOC_HEADER = '[Design document]';
const INTENT_HEADER = '[Document intent]';

export type DocumentMessageIntent = 'analyze' | 'tables';

export interface BuildDesignMessageParams {
  fileName: string;
  documentText: string;
  intent: DocumentMessageIntent;
  documentId?: string;
  additionalInstructions?: string;
  sourceKind?: 'upload' | 'project-document';
}
```

Build the common source description, then exactly one intent block. Analysis says the application already parsed the attachment, directs the Agent to supplied content, forbids capability denial and unsolicited project/table work, and requests a concise summary when instructions are absent. Tables retain the existing extraction and quality-gate text verbatim. Append intent, optional user instructions, and content as separate sections.

Make `parseDesignMessage` accept both headers while preserving current file-name and instruction extraction.

- [ ] **Step 6: Route every producer**

- `ChatInput.tsx`: `intent: 'analyze'`.
- Design upload page: `intent: 'tables'`.
- DocumentEditor table export: `intent: 'tables'`.
- Agent route signed snapshot reconstruction: `intent: 'tables'`.

Do not classify by keywords and do not add UI.

- [ ] **Step 7: Verify Task 1 GREEN**

```bash
npm run test:unit -- --runInBand tests/unit/design-message.test.ts tests/unit/agent/user-message-display.test.ts tests/unit/design-upload-document-wiring.test.ts tests/unit/documents/document-editor-export.test.tsx
npx playwright test tests/e2e/specs/agent-chat.spec.ts --project=chromium -g "routes a DOCX chat attachment to analysis intent"
npx tsc --noEmit
```

Expected: all commands PASS and TypeScript finds no missing producer intent.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design-message.ts src/components/agent/ChatInput.tsx 'src/app/(dashboard)/[projectId]/design-upload/page.tsx' src/components/documents/DocumentEditor.tsx src/app/api/agent-chat/route.ts tests/unit/design-message.test.ts tests/unit/agent/user-message-display.test.ts tests/unit/design-upload-document-wiring.test.ts tests/unit/documents/document-editor-export.test.tsx tests/e2e/specs/agent-chat.spec.ts
git commit -m "fix: route document attachments by intent"
```

---

### Task 2: Capability Manifest and Prompt Routing

**Files:**
- Modify: `src/lib/agent/prompts.ts`
- Modify: `tests/unit/agent/system-prompt.test.ts`

**Interfaces:**
- Consumes: the Task 1 envelope markers.
- Produces: one system-prompt capability manifest for ordinary questions and attachment turns.
- Preserves: all detailed table extraction, quality, image, and write rules.

- [ ] **Step 1: Write failing prompt tests**

```ts
it('states implemented document capabilities', () => {
  const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });
  expect(prompt).toContain('.txt, .md, and .docx');
  expect(prompt).toContain('parsed by the application before');
  expect(prompt).toContain('visible JSON');
  expect(prompt).toContain('headings, lists, tables, links');
  expect(prompt).toContain('Legacy .doc is not supported');
  expect(prompt).toContain('custom XML');
  expect(prompt).toContain('must not deny DOCX support');
});

it('routes analysis separately from tables', () => {
  const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });
  expect(prompt).toContain('[Document intent]\nanalyze');
  expect(prompt).toContain('answer from the supplied document content');
  expect(prompt).toContain('do not call project-schema or write tools');
  expect(prompt).toContain('unless the user explicitly asks for a project operation');
  expect(prompt).toContain('[Document intent]\ntables');
  expect(prompt).toContain('FIRST call list_project_structure');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test:unit -- --runInBand tests/unit/agent/system-prompt.test.ts
```

Expected: FAIL because the manifest and analysis routing do not exist.

- [ ] **Step 3: Implement prompt rules**

Add a numbered capability rule stating the exact supported formats and limitations from Global Constraints. It must tell the Agent to answer product capability questions from the manifest and not deny DOCX support because it does not read raw bytes.

Replace the broad `[Design document]` trigger with:

```text
DOCUMENT ATTACHMENT ROUTING:
- [Document intent]\nanalyze: answer from supplied content; do not call project-schema or write tools unless the user explicitly asks for a project operation; do not volunteer table/script advice; summarize when instructions are absent.
- [Document intent]\ntables: FIRST call list_project_structure and list_field_types, then apply all existing table rules.
- A legacy active [Design document] message uses tables for backward compatibility.
```

Keep the existing detailed table workflow under `tables`.

- [ ] **Step 4: Verify GREEN**

```bash
npm run test:unit -- --runInBand tests/unit/agent/system-prompt.test.ts tests/unit/design-message.test.ts tests/unit/agent/user-message-display.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/prompts.ts tests/unit/agent/system-prompt.test.ts
git commit -m "fix: ground document capability answers"
```

---

### Task 3: Full and Real-Environment Verification

**Files:**
- No production changes expected.
- Any discovered defect first receives a failing test in its owning task's test file.

**Interfaces:**
- Consumes: Task 1 and Task 2 commits.
- Produces: fresh unit, static, build, browser, Supabase, and live-Agent evidence.

- [ ] **Step 1: Run focused regression**

```bash
npm run test:unit -- --runInBand tests/unit/document-parser.test.ts tests/unit/design-message.test.ts tests/unit/agent/user-message-display.test.ts tests/unit/design-upload-document-wiring.test.ts tests/unit/documents/document-editor-export.test.tsx tests/unit/agent/system-prompt.test.ts
```

- [ ] **Step 2: Run static and build verification**

```bash
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: all exit 0 with no new errors.

- [ ] **Step 3: Start the real local environment**

```bash
supabase status
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Use the next unused port if 3001 is occupied. Wait for Next.js ready output.

- [ ] **Step 4: Run real Chromium workflows**

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/specs/agent-chat.spec.ts --project=chromium -g "routes a DOCX chat attachment to analysis intent"
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/specs/design-upload.spec.ts --project=chromium -g "hands a valid text design back to the project"
```

Expected: both PASS with real Chromium and local Supabase fixtures, covering `analyze` and dedicated `tables`.

- [ ] **Step 5: Exercise the live Agent without interception**

Through the running app and a temporary local test account/project, send:

```text
Do you support importing Word documents that contain visible JSON?
```

Then attach a DOCX containing visible text and ask:

```text
What is in this file?
```

Expected: the first answer says DOCX and visible JSON are supported. The second summarizes supplied content without `list_project_structure`, `list_field_types`, `setup_library`, or unsolicited `import_script` advice.

Inspect the corresponding `agent_messages` and `agent_traces` rows to confirm `[Document intent]\nanalyze` and no schema tool calls. Remove only temporary fixtures using existing E2E cleanup utilities.

- [ ] **Step 6: Stop the started server and inspect state**

```bash
git status --short
git log --oneline -5
```

Expected: only intended commits and pre-existing user-owned untracked files remain.
