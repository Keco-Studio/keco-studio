# Design Document → Agent Auto Config Tables

**Date**: 2026-06-15
**Status**: Approved
**Scope**: In keco-studio, the user uploads a design document, and the Agent autonomously reasons about and creates tables + fills in data

---

## 1. Overview

The user uploads a design document (worldbuilding, character settings, combat system, etc.) in keco-studio. After analyzing the document content, the Agent autonomously infers which tables (libraries) are needed, plans the fields, extracts entity data, and fills it into the tables.

**Core effect**: The user uploads a worldbuilding description (e.g. "On a fictional fantasy continent, there are three great factions..."). After analysis, the Agent automatically creates tables such as "Characters", "Factions", and "Locations", plans the fields, and extracts the entities mentioned in the document into data rows.

**Supported formats**: `.txt` `.md` `.docx` (legacy `.doc` is not supported)
**Document size**: Initially support small-to-medium documents (<50 pages, recommended <10MB)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  keco-studio UI                                                  │
│                                                                  │
│  ┌─────────────────────┐     ┌──────────────────────────────┐   │
│  │  Upload page (new)  │     │  Chat page (existing)         │   │
│  │  /project/[id]/     │     │  /project/[id]/               │   │
│  │  design-upload      │     │  chat                         │   │
│  │                     │     │                               │   │
│  │  1. Select file     │     │  3. Receive parsed text msg   │   │
│  │  2. Optional notes  │     │  4. Agent infers table setup  │   │
│  │  3. Click "Start"   │────→│  5. setup_library creates     │   │
│  │  4. Parse in FE     │     │  6. create_asset fills data   │   │
│  │  5. Go to chat page │     │  7. Confirm → execute         │   │
│  └─────────────────────┘     └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │ /api/agent-chat     │  (existing)
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Agent Core         │  (existing)
                          │  LLM + ReAct loop   │
                          │  tools: setup_library│
                          │  create_asset, etc. │
                          └─────────────────────┘
```

### Key design decisions

| Decision | Choice | Rationale |
|------|------|------|
| Document parsing location | Frontend (JS) | Reduces server-side complexity; JS libraries are mature |
| Agent tool/skill | Reuse existing | setup_library etc. can already handle table creation + filling |
| Message passing | sessionStorage | Document text can be very long; URLs have length limits |
| Image handling | Ignore | MiniMax M2.7 does not support native image input |

### Data flow

1. User selects a file on the upload page + optionally fills in instructions
2. Frontend JS parses the document into plain text (mammoth.js handles docx; text/md read directly)
3. Assemble the message: system instruction + additional instructions + full document text
4. Write to sessionStorage, navigate to the chat page
5. Chat page detects the pending message and automatically sends it to the Agent
6. The Agent recognizes this as a "design document to tables" request based on the system prompt
7. The Agent calls `setup_library` to create tables, and `create_asset`/`update_row` to fill in data
8. Reuse the existing confirmation mechanism for user confirmation

---

## 3. Frontend — Upload Page

### Page path

`/project/[projectId]/design-upload`

### Page layout

- Title and description text
- File upload area (drag-and-drop / click)
- Additional instructions textarea (optional)
- Image handling notice
- "Start table setup" button

### Components

| Component | Responsibility |
|------|------|
| `DesignUploadPage` | Page component |
| `DocumentDropZone` | Drag-and-drop / click upload area (based on antd Upload) |

### Document parsing logic

```typescript
// lib/document-parser.ts

export async function parseDocument(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'txt':
    case 'md':
      return await file.text();

    case 'docx': {
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.default.extractRawText({ arrayBuffer });
      return result.value;
    }

    case 'doc':
      throw new Error('Legacy .doc format is not supported; please convert to .docx or .txt');

    default:
      throw new Error(`Unsupported file format: .${ext}`);
  }
}
```

### Message assembly template

```typescript
function buildDesignMessage(params: {
  fileName: string;
  documentText: string;
  additionalInstructions?: string;
}): string {
  const parts: string[] = [];

  parts.push(`[System Instruction]`);
  parts.push(`The user uploaded a design document "${params.fileName}". Please analyze the document content, autonomously infer which tables (libraries) need to be created, plan the fields for each table, and extract the relevant entity data from the document to fill into the tables.`);

  if (params.additionalInstructions?.trim()) {
    parts.push(`Additional user requirements: ${params.additionalInstructions.trim()}`);
  }

  parts.push(``);
  parts.push(`[Document Content]`);
  parts.push(params.documentText);

  return parts.join('\n');
}
```

### sessionStorage handoff

```typescript
// Write (upload page)
const key = `design-upload:${projectId}:pending-message`;
sessionStorage.setItem(key, JSON.stringify({
  message: string;        // Fully assembled message
  fileName: string;       // Original file name
  timestamp: number;      // Timestamp
}));

// Read (when chat page ChatPanel mounts)
const pending = sessionStorage.getItem(key);
if (pending) {
  // Auto-send the message, clear sessionStorage
  sessionStorage.removeItem(key);
}
```

### File validation

| Check | Rule | Handling |
|--------|------|------|
| File format | `.txt` `.md` `.docx` | Reject other formats |
| File size | ≤ 10MB | Reject oversized files |
| .doc format | Not supported | Prompt to convert |
| Empty file | Content is empty | Reject |
| Very long text | > 100KB | Warn but still allow |

---

## 4. Agent Prompt Enhancement

### New rule in system prompt

Append in `buildSystemPrompt` in `prompts.ts`:

```
27. When the user uploads a design document and asks to "set up tables" or "create tables from design":
    - Analyze the document content thoroughly
    - Infer what tables (libraries) are needed based on the content (e.g., characters, locations, items, factions, skills)
    - For each table, design appropriate fields (columns) with correct data types
    - Extract entities from the document and fill data rows
    - Use setup_library to create each table with all fields
    - Use update_row / create_asset to fill initial data
    - Present a summary of all planned tables before executing
    - Table names, field names, and data should be in English
```

### Agent processing flow

1. Receive the message and recognize it as a "design document to tables" request
2. Analyze the document and infer the list of required tables
3. First output a table planning summary (so the user knows what will be created)
4. For each table: call `setup_library` (`post_preview` confirmation → user confirms → `executeImport` creates)
5. For each table's data: call `update_row` or `create_asset` to fill it in (`pre_execute` confirmation)
6. After all operations complete, output a summary

---

## 5. Dependencies

| Dependency | Purpose | Installation |
|------|------|------|
| `mammoth` | docx text extraction | `npm install mammoth` |

---

## 6. Edge Cases and Error Handling

| Scenario | Handling |
|------|---------|
| File >10MB | Upload page rejects, shows "File too large" |
| Unsupported format | Upload page rejects, shows "Only .txt .md .docx are supported" |
| .doc format | Upload page shows "Legacy .doc is not supported; please convert to .docx or .txt" |
| Empty file | Upload page shows "File content is empty" |
| docx parsing failure | Upload page shows "Failed to parse file; please check the file format" |
| Very long text (>100KB) | Upload page shows warning "The document is long; Agent processing may take a while", allows continuing |
| Network disconnect | Chat page SSE connection fails, shows retry button |
| Agent tool call failure | Error shown in chat, Agent gives suggestions |
| User refreshes page while Agent is processing | Chat page restores the previous conversation (existing mechanism) |
| Images | Ignored; UI notifies the user "Images in the document will not be processed" |

---

## 7. Security Considerations

- Frontend parsing; the document is not uploaded to the server → no server-side storage security concerns
- Text in sessionStorage is protected by the same-origin policy
- File size limit is validated on the frontend
- Agent tool calls are permission-controlled (`requiredPermission: 'editor'`)

---

## 8. Testing Strategy

| Test type | Coverage | Tool |
|---------|---------|------|
| Unit test | `parseDocument` function (text/md/docx → plain text) | Jest |
| Unit test | `buildDesignMessage` message assembly function | Jest |
| E2E test | Full flow: upload page → parse → navigate to chat → Agent processing | Playwright |
| Manual test | Real design documents of various types | — |

---

## 9. Future Enhancements

- Support more document formats (PDF, Notion exports, etc.)
- Chunked processing for large documents (>50 pages)
- Multimodal LLM support (image understanding)
- Table setup template presets (quick setup for common game genres)
