# Keco-Studio Agent Design

**Date**: 2026-06-10  
**Status**: Draft (revised after architecture review)  
**Scope**: keco-studio dedicated agent — in-app chat window + fixed tool list + Supabase operations at the API layer

---

## 1. Overview

The keco-studio agent is an AI operator embedded in the app: users issue instructions via a chat panel, and the agent reads/writes data by directly calling the service layer and Supabase through a fixed tool list.

**Core principles:**

- **API-layer operations**: the agent never touches the DOM; it calls services / writes to Supabase directly
- **Fixed tool list**: developers hard-code tool schemas + handlers; adding a new tool doesn't change the loop logic
- **Dangerous operations require confirmation**: write-type tools follow different confirmation flows per `confirmationMode` (CRUD confirmations can be skipped per conversation; import preview cannot be skipped)
- **Persistent conversation history**: the DB is the single source of state, supporting resumption from breakpoints without losing context
- **Permission alignment**: reuse the existing `authorizationService`; Viewer is read-only, Editor/Admin can write
- **UI sync**: successful write tools trigger cache invalidation, and the current page refreshes automatically

**v1 capability scope:**

- Read-only queries (assets, script lines)
- CRUD operations (create / update / delete assets, including field name → fieldId resolution)
- Import script conversion (the LLM pipeline in [test.md](../../../../test.md) wrapped as a tool)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│  keco-studio UI                                 │
│  ┌──────────────────────┐  ┌─────────────────┐  │
│  │  Existing pages      │  │  ChatPanel      │  │
│  │  (libraries, etc.)   │  │  (new component)│  │
│  └──────────────────────┘  └───────┬─────────┘  │
└────────────────────────────────────┼────────────┘
                                     │ SSE / REST
                          ┌──────────▼──────────┐
                          │ /api/agent-chat     │
                          │ (new API route)     │
                          └──────────┬──────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │  Agent Core                      │
                    │  ┌───────────┐  ┌────────────┐  │
                    │  │ LLM Client│  │ Tool Router│  │
                    │  │ (DeepSeek)│  │            │  │
                    │  │ streaming │  └─────┬──────┘  │
                    │  └───────────┘        │         │
                    └───────────────────────┼─────────┘
                                            │
                    ┌───────────────────────┼─────────┐
                    │  Tool Handlers        │         │
                    │  ┌──────┐ ┌──────┐ ┌──┴───┐    │
                    │  │query │ │mutate│ │import│    │
                    │  │assets│ │CRUD  │ │script│    │
                    │  └──┬───┘ └──┬───┘ └──┬───┘    │
                    └─────┼────────┼────────┼────────┘
                          │        │        │
                    ┌─────▼────────▼────────▼────────┐
                    │  Existing service layer/Supabase│
                    │  scriptImportService, etc.      │
                    └────────────────────────────────┘
```

### Layers

| Layer | Responsibility | Status |
|-------|---------------|--------|
| **ChatPanel** | Chat UI, message list, input, confirmation cards | New |
| **`/api/agent-chat`** | SSE streaming, auth, conversation management | New |
| **Agent Core** | ReAct loop, LLM streaming calls, tool routing | New |
| **Tool Handlers** | Each tool's implementation, calls existing services | New |
| **Existing Services / Supabase** | Actual data operations | Reused |

### Data Flow (one typical request)

1. User types in ChatPanel → POST `/api/agent-chat` (SSE response)
2. API route starts Agent Core → calls DeepSeek streaming (with tools definition)
3. DeepSeek stream yields tool_call → Agent Core routes to matching Tool Handler
4. Depending on `confirmationMode`:
   - `pre_execute`: pause → push `confirmation_request` SSE → close SSE → wait for `/api/agent-chat/confirm`
   - `post_preview`: execute (read-only conversion) → push preview card → close SSE → wait for confirm
   - `meta`: pause → push confirmation_request (for set_conversation_option)
5. User confirms → POST `/api/agent-chat/confirm` (new SSE) → resume
6. Agent Core feeds tool result back to DeepSeek → streams text summary
7. Text summary streams via SSE to ChatPanel

### Auth Pattern

Reuses the same dual-mode auth as existing `import-script/route.ts`:

```typescript
const supabase = authHeader
  ? createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : createSupabaseServerClient(request);
```

### Route Timeout

```typescript
export const maxDuration = 60; // seconds — import_script with LLM retries needs >10s
```

---

## 3. Tool System

### Tool Interface

```typescript
// src/lib/agent/types.ts
type ConfirmationMode =
  | "pre_execute"   // Pause BEFORE execution, confirm args (create/update/delete_asset)
  | "post_preview"  // Execute first (non-mutating), show preview, then confirm (import_script)
  | "meta";         // Confirm the option change itself (set_conversation_option)

interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: "read" | "write";
  confirmationMode: ConfirmationMode;
  requiredPermission?: "editor" | "admin"; // Defaults to "editor" for write, none for read
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  userId: string;
  projectId: string;
  currentFolderId?: string;   // Injected from page context (user is viewing a folder)
  currentLibraryId?: string;  // Injected from page context (user is viewing a library)
  supabase: SupabaseClient;
  userRole: "admin" | "editor" | "viewer"; // From authorizationService
}
// currentFolderId/currentLibraryId are passed in the POST /api/agent-chat request body,
// populated by the frontend from the current route/page state.
// If empty, tools that need them (e.g. import_script) should ask the user via LLM reply.

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  displayHint?: "table" | "text" | "list" | "script_preview";
  invalidateCache?: string[]; // Paths to revalidate after write (e.g. ["/libraries"])
}
```

### v1 Tool List

| Tool | Category | confirmationMode | Description |
|------|----------|-----------------|-------------|
| `query_assets` | read | — | Query library assets by name, type, tag. Params: `libraryName`, `nameFilter?`, `type?`, `limit?` |
| `query_script_lines` | read | — | Query script lines and branch structure of a library. Params: `libraryName` |
| `create_asset` | write | `pre_execute` | Add a new asset. Params: `libraryName`, `name`, `propertyValues?` (semantic field names, resolved to fieldId internally) |
| `update_asset` | write | `pre_execute` | Modify asset fields. Params: `libraryName`, `assetId`, `propertyValues?` |
| `delete_asset` | write | `pre_execute` | Delete an asset. Params: `libraryName`, `assetId` |
| `import_script` | write | `post_preview` | LLM conversion + parseText + preview → confirm → import. Params: `libraryName`, `folderId`, `sourceText`, `characterMapping?` |
| `set_conversation_option` | write | `meta` | Toggle conversation options. Params: `option` ("skipConfirmation"), `value` (boolean) |

**Category rules:**
- `read` tools: execute immediately, no confirmation ever
- `write` + `pre_execute`: pause before execution, show args, user confirms
- `write` + `post_preview`: execute (non-mutating conversion), show preview, user decides to import / edit / cancel
- `write` + `meta`: confirm the option change itself
- `skipConfirmation` only applies to `pre_execute` tools. `post_preview` and `meta` ALWAYS require confirmation.

### Field Name → fieldId Resolution

`create_asset` and `update_asset` accept semantic field names (e.g. `{"Type": "character", "Tag": "NPC"}`). Tool handler internally:

1. Query `library_field_definitions` table for the target library (same data source as the schema/predefine page)
2. Build name→fieldId map: `{ "Type": "uuid-abc", "Tag": "uuid-def" }`
3. Translate LLM's params to `{ "uuid-abc": "character", "uuid-def": "NPC" }`
4. If field name not found → return error with available field names → LLM adapts

Encapsulated in `src/lib/agent/field-resolver.ts`.

### Tool Registration

```typescript
// src/lib/agent/tools/index.ts
export const allTools: AgentTool[] = [
  queryAssets,
  queryScriptLines,
  createAsset,
  updateAsset,
  deleteAsset,
  importScript,
  setConversationOption,
];

export function getToolsForLlm(): ChatCompletionTool[] {
  return allTools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function resolveTool(name: string): AgentTool | undefined {
  return allTools.find(t => t.name === name);
}
```

Adding a new tool: **write one file → import → add to `allTools` array**. No changes to the ReAct loop.

---

## 4. Confirmation Flow

### Mechanism

Three confirmation modes (see §3). All modes use short SSE connections: the SSE closes when a confirmation is needed, and a new SSE opens when the user responds.

### Pending Action Store — DB as Single Source of Truth

```sql
CREATE TABLE agent_pending_actions (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES agent_conversations(id),
  tool_name text NOT NULL,
  args jsonb NOT NULL,
  confirmation_mode text NOT NULL,  -- 'pre_execute' | 'post_preview' | 'meta'
  status text DEFAULT 'pending',    -- 'pending' | 'approved' | 'rejected'
  suspended_state jsonb NOT NULL,   -- { messages, pendingToolCall, toolResult? }
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '30 minutes'
);
```

- **`suspended_state`** stores the complete ReAct loop state (messages array + pending tool_call + optional partial tool result for `post_preview`)
- In-memory Map is a **cache only** — on miss, fallback to DB query
- Survives server restarts and multi-instance deployments

### Sequence: `pre_execute` (create/update/delete_asset)

```
User: "Add a character Nova"
  │
  ▼ POST /api/agent-chat (SSE)
  │
Agent Core:
  ├─ LLM stream yields tool_call: create_asset({name: "Nova", ...})
  ├─ confirmationMode === "pre_execute" && !skipConfirmation
  ├─ Save suspended_state to agent_pending_actions (DB)
  ├─ SSE push: { type: "confirmation_request", actionId: "xxx", tool: "create_asset", args: {...} }
  ├─ SSE push: { type: "done" }
  ├─ SSE closes
  │
  ▼ Frontend renders confirmation card
  ▼ User clicks [Confirm]
  │
  ▼ POST /api/agent-chat/confirm { actionId: "xxx", decision: "approve" }
  │  (Returns new SSE stream)
  │
Agent Core (resume):
  ├─ Load suspended_state from DB
  ├─ Execute tool → get result
  ├─ Save tool_result to agent_messages
  ├─ Feed result back to LLM (new streaming call)
  ├─ LLM streams summary: "Created character Nova"
  ├─ Trigger cache invalidation
  └─ SSE push: { type: "done" }
```

### Sequence: `post_preview` (import_script)

```
User: "Import this story as Chapter 1"
  │
  ▼ POST /api/agent-chat (SSE)
  │
Agent Core:
  ├─ LLM stream yields tool_call: import_script({libraryName: "Chapter 1", sourceText: "...", folderId: "..."})
  ├─ confirmationMode === "post_preview"
  ├─ Execute tool (LLM conversion + parseText — non-mutating, no DB write)
  ├─ Tool returns preview data (ScriptLine[], fullText, stats, errors)
  ├─ Save suspended_state with toolResult to DB
  ├─ SSE push: { type: "tool_result", tool: "import_script", displayHint: "script_preview", data: {...} }
  ├─ SSE push: { type: "confirmation_request", actionId: "xxx", tool: "import_script", preview: {...} }
  ├─ SSE closes
  │
  ▼ Frontend renders preview card with [Edit in Modal] [Import Directly] [Cancel]
  ▼ User clicks [Import Directly]
  │
  ▼ POST /api/agent-chat/confirm { actionId: "xxx", decision: "approve" }
  │
Agent Core (resume):
  ├─ Load suspended_state from DB (has toolResult with fullText)
  ├─ Call tool.executeImport(toolResult) — actual DB write via scriptImportService
  ├─ Feed result to LLM → streams summary
  └─ SSE done
```

### Context Recovery

All conversation history persists in `agent_messages`. The `agent_pending_actions.suspended_state` stores the exact ReAct loop state (messages array + pending tool_call). On resume:

1. Load `suspended_state` from `agent_pending_actions`
2. Restore messages array
3. If approved: execute pending tool → push tool_result → continue loop
4. If rejected: push "user cancelled" as tool_result → continue loop
5. Delete pending action after resolution

### Skip Confirmation

Per-conversation setting in `agent_conversations.meta`:

```typescript
interface ConversationMeta {
  skipConfirmation: boolean;  // Only applies to pre_execute tools
  // post_preview and meta tools ALWAYS confirm
}
```

User triggers via chat → LLM calls `set_conversation_option` (meta confirmation required) → updates `meta.skipConfirmation`.

---

## 5. Chat UI + Streaming

### ChatPanel Placement

Collapsible sidebar / floating panel in the layout layer. Mount point: main dashboard layout.

### Message Types & Rendering

| Message Type | Rendering |
|-------------|-----------|
| `user_text` | Standard chat bubble |
| `assistant_text` | Markdown rendered (streaming via text_delta) |
| `tool_call` | Collapsible card: tool name + args summary + status (running/success/failure) |
| `confirmation_request` | Card with action buttons (varies by tool) |
| `script_preview` | Preview card with [Edit in Modal] [Import Directly] [Cancel] |
| `error` | Red alert + retry button |

### SSE Event Protocol

```typescript
type SSEEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_call_start"; tool: string; args: string }
  | { type: "tool_call_end" }
  | { type: "tool_result"; tool: string; data: unknown; displayHint: string }
  | { type: "confirmation_request"; actionId: string; tool: string; args: unknown; preview?: unknown }
  | { type: "cache_invalidated"; paths: string[] }
  | { type: "done" }
  | { type: "error"; message: string }
```

### UI Refresh After Write Operations

When a write tool succeeds, the tool result includes `invalidateCache` paths. After saving the tool result:

1. Agent Core pushes `{ type: "cache_invalidated", paths }` SSE event
2. Frontend `useAgentChat` hook calls `router.refresh()` for affected paths
3. For library data: trigger the same cache invalidation used by `LibraryDataContext` (Supabase Realtime broadcast or `globalRequestCache.invalidate()`)

If automatic refresh is not feasible for a specific case, ChatPanel shows: "Data updated — please refresh the page."

### Conversation Persistence (Supabase)

```sql
CREATE TABLE agent_conversations (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  project_id uuid REFERENCES projects(id),
  meta jsonb DEFAULT '{}',  -- { skipConfirmation: boolean }
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE agent_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES agent_conversations(id),
  role text NOT NULL,       -- 'user' | 'assistant' | 'tool'
  content jsonb NOT NULL,   -- Full message body (including tool_calls, tool_results)
  created_at timestamptz DEFAULT now()
);
```

### Entry & Interaction

- Chat icon in layout top-right / sidebar, click to expand ChatPanel
- ChatPanel shows conversation history for current project (switchable)
- New conversation = new conversationId, bound to current projectId
- Input: Enter to send, Shift+Enter for newline

### Permission-Based Access

- **Viewer**: can open ChatPanel, use read tools only. Write tool calls return error: "Viewer role cannot modify data."
- **Editor**: full access within project scope
- **Admin**: full access

---

## 6. LLM Integration & ReAct Loop

### LLM Client — Streaming Throughout

```typescript
// src/lib/agent/llm-client.ts
// DeepSeek OpenAI-compatible streaming API

async function* streamLlm(
  messages: ChatMessage[],
  tools: ChatCompletionTool[]
): AsyncGenerator<StreamChunk> {
  const response = await fetch(`${DEEPSEEK_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [systemPrompt, ...messages],
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,  // v1: one tool call per turn
      temperature: 0.3,
      max_tokens: 4096,
      stream: true,
    }),
  });

  // Parse SSE stream from DeepSeek, yield chunks
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  // ... parse "data: {...}" lines, yield parsed chunks
}

type StreamChunk =
  | { type: "text_delta"; content: string }
  | { type: "tool_call_delta"; id: string; name: string; arguments: string }
  | { type: "finish"; reason: "stop" | "tool_calls"; usage: TokenUsage };
```

### Agent Core Main Loop

```typescript
async function* runAgentTurn(input: AgentTurnInput): AsyncGenerator<SSEEvent> {
  const messages = await loadConversationHistory(input.conversationId);
  messages.push({ role: "user", content: input.userMessage });
  await saveMessage(input.conversationId, { role: "user", content: input.userMessage });

  let maxIterations = 10;

  while (maxIterations-- > 0) {
    // Collect full LLM response from stream
    let assistantContent = "";
    let toolCalls: ToolCall[] = [];
    let currentToolCall: Partial<ToolCall> | null = null;
    let finishReason = "";

    for await (const chunk of streamLlm(messages, getToolsForLlm())) {
      if (chunk.type === "text_delta") {
        assistantContent += chunk.content;
        yield { type: "text_delta", content: chunk.content };  // Relay to frontend
      }
      if (chunk.type === "tool_call_delta") {
        // Accumulate tool call from stream
        if (!currentToolCall || currentToolCall.id !== chunk.id) {
          if (currentToolCall) toolCalls.push(currentToolCall as ToolCall);
          currentToolCall = { id: chunk.id, function: { name: chunk.name, arguments: "" } };
        }
        currentToolCall.function!.arguments += chunk.arguments;
      }
      if (chunk.type === "finish") {
        finishReason = chunk.reason;
      }
    }
    if (currentToolCall) toolCalls.push(currentToolCall as ToolCall);

    // Save assistant message (text part only — tool_calls are NOT persisted until after confirmation)
    // Rationale: if we persist tool_calls before confirmation, a page refresh shows
    // "assistant initiated tool_call with no result" which is confusing.
    // The tool_call lives only in suspended_state until resume completes.
    await saveMessage(input.conversationId, {
      role: "assistant",
      content: assistantContent,
    });

    // 1. Text response → done
    if (finishReason === "stop") {
      yield { type: "done" };
      return;
    }

    // 2. Tool calls → process (v1: exactly 1 due to parallel_tool_calls: false)
    if (finishReason === "tool_calls" && toolCalls.length > 0) {
      const call = toolCalls[0];
      const tool = resolveTool(call.function.name);

      // Unknown tool → feed error back
      if (!tool) {
        const errorResult = { success: false, error: `Unknown tool "${call.function.name}". Available: ${allTools.map(t => t.name).join(", ")}` };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(errorResult) });
        await saveMessage(input.conversationId, { role: "tool", tool_call_id: call.id, content: errorResult });
        continue;
      }

      // Permission check
      if (tool.category === "write" && input.toolContext.userRole === "viewer") {
        const errorResult = { success: false, error: "Viewer role cannot perform write operations." };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(errorResult) });
        continue;
      }

      // Handle by confirmationMode
      const parsedArgs = parseArgs(call.function.arguments);

      if (needsConfirmation(tool, input.conversationMeta)) {
        // pre_execute or meta → pause before execution
        if (tool.confirmationMode === "pre_execute" || tool.confirmationMode === "meta") {
          const actionId = crypto.randomUUID();
          await savePendingAction({
            id: actionId,
            conversationId: input.conversationId,
            toolName: tool.name,
            args: parsedArgs,
            confirmationMode: tool.confirmationMode,
            suspendedState: { messages: [...messages], pendingToolCall: call },
          });
          yield { type: "confirmation_request", actionId, tool: tool.name, args: parsedArgs };
          yield { type: "done" };
          return; // Close SSE, wait for /confirm
        }

        // post_preview → execute first (non-mutating), then pause for preview
        if (tool.confirmationMode === "post_preview") {
          yield { type: "tool_call_start", tool: tool.name, args: call.function.arguments };
          const result = await tool.execute(parsedArgs, input.toolContext); // Non-mutating conversion
          if (!result.success) {
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
            continue;
          }
          const actionId = crypto.randomUUID();
          await savePendingAction({
            id: actionId,
            conversationId: input.conversationId,
            toolName: tool.name,
            args: parsedArgs,
            confirmationMode: "post_preview",
            suspendedState: { messages: [...messages], pendingToolCall: call, toolResult: result },
          });
          yield { type: "tool_result", tool: tool.name, data: result.data, displayHint: result.displayHint! };
          yield { type: "confirmation_request", actionId, tool: tool.name, args: parsedArgs, preview: result.data };
          yield { type: "done" };
          return; // Close SSE, wait for /confirm
        }
      }

      // No confirmation needed (read tool, or skipConfirmation for pre_execute)
      yield { type: "tool_call_start", tool: tool.name, args: call.function.arguments };
      const result = await tool.execute(parsedArgs, input.toolContext);
      yield { type: "tool_result", tool: tool.name, data: result.data, displayHint: result.displayHint };

      // Cache invalidation
      if (result.invalidateCache) {
        yield { type: "cache_invalidated", paths: result.invalidateCache };
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      await saveMessage(input.conversationId, { role: "tool", tool_call_id: call.id, content: result });
    }
  }

  yield { type: "error", message: "Agent reached maximum iterations" };
  yield { type: "done" };
}

function needsConfirmation(tool: AgentTool, meta: ConversationMeta): boolean {
  if (tool.confirmationMode === "post_preview" || tool.confirmationMode === "meta") return true;
  if (tool.confirmationMode === "pre_execute" && meta.skipConfirmation) return false;
  return true;
}
```

### Confirmation Resume Endpoint

```
POST /api/agent-chat/confirm
Body: { actionId: string, decision: "approve" | "reject" }
Response: SSE stream (same protocol as /api/agent-chat)

1. Load pending action from DB
2. Load suspended_state (messages + pendingToolCall + optional toolResult)
3. Persist the assistant message WITH tool_calls now (was deferred during suspend):
   saveMessage(conversationId, { role: "assistant", content: "", tool_calls: [pendingToolCall] })
4. If approved:
   - pre_execute: execute tool → save tool_result message → push tool_result SSE → continue loop
   - post_preview: execute final import (mutating) using saved toolResult → save tool_result → push SSE → continue loop
   - meta: update conversation meta → save tool_result → push SSE → continue loop
5. If rejected:
   - Save "user cancelled" as tool_result message → push SSE → continue loop
6. Delete pending action
```

### System Prompt

```text
You are Keco Assistant, an AI agent for the keco-studio Galgame script management system.

You help users manage their project data through tool calls. You can:
- Query assets and script lines
- Create, update, and delete assets
- Convert narrative text into standard import script format

RULES:
1. Always use tools to fetch real data before answering questions. Never fabricate data.
2. For write operations, explain what you're about to do before calling the tool.
3. If a tool call fails, explain the error and suggest alternatives.
4. Respond in the same language the user uses.
5. Be concise. Show data in structured format when appropriate.
6. Branch labels use letter O + digit (O1, O2, Oend), never 01, 02.
7. When the user says "skip confirmation" or equivalent, call set_conversation_option to enable skip mode.
8. For create/update_asset, use semantic field names (e.g. "Type", "Tag") — the system resolves them to internal IDs.
9. For import_script, use the currentFolderId from context. If it is empty, ask the user which folder to import into — do NOT guess.

CURRENT CONTEXT:
- Project: {projectName}
- Project ID: {projectId}
- Current folder ID: {currentFolderId}
- Current library (if any): {libraryName}
- User role: {userRole}
```

---

## 7. Import Script Tool

### Position

`import_script` is a write tool with `confirmationMode: "post_preview"`, encapsulating the full pipeline from [test.md](../../../../test.md):

```
User pastes/inputs free text
    ↓
Agent calls import_script tool
    ↓
┌────────────────────────────────────────────┐
│  import_script.execute() — NON-MUTATING    │
│                                            │
│  1. Try parseText(raw) directly            │
│     → success → skip LLM                  │
│  2. Failure → call DeepSeek to convert     │
│     (uses prompts from test.md §6)         │
│  3. sanitize → parseText → validate        │
│  4. Validation fails → retry ≤2x           │
│  5. Return preview data (NO DB WRITE)      │
└────────────────────────────────────────────┘
    ↓
Preview card shown to user
    ↓
User confirms → import_script.executeImport()
    ↓
┌────────────────────────────────────────────┐
│  MUTATING: scriptImportService.importXxx() │
│  Uses folderId from tool params            │
└────────────────────────────────────────────┘
```

### Tool Schema

```json
{
  "name": "import_script",
  "description": "Convert free-form narrative text into keco-studio standard script format and import it as a library. Use this when the user pastes story text, wants to create a script from prose, or asks to import narrative content.",
  "parameters": {
    "type": "object",
    "properties": {
      "libraryName": { "type": "string", "description": "Name for the new library" },
      "folderId": { "type": "string", "format": "uuid", "description": "Target folder UUID for the import. If unknown, ask the user." },
      "sourceText": { "type": "string", "description": "The raw narrative text to convert" },
      "characterMapping": {
        "type": "object",
        "description": "Optional mapping of character names to dialogue types. e.g. {\"Atana\": 1, \"AI\": 2}. Type 1=player, 2=AI, 3=narrator, 5=fullscreen",
        "additionalProperties": { "type": "number", "enum": [1, 2, 3, 5] }
      }
    },
    "required": ["libraryName", "folderId", "sourceText"]
  }
}
```

### Relationship with Direct parseText

```
User inputs text
    │
    ├─ Via agent chat → agent calls import_script tool → post_preview flow
    │
    └─ Via ImportScriptModal: upload .txt file → existing flow unchanged
```

Both paths end at `parseText()` + `scriptImportService`. Agent path adds LLM pre-conversion.

### Import Preview Card

```
┌─────────────────────────────────┐
│ Chapter 1                       │
│ 45 lines · 38 dialogues · 3 options
│ ┌─────────────────────────────┐ │
│ │ [Start | Afternoon...]      │ │
│ │ (Type3·Narrator) At three.. │ │
│ │ ...                         │ │
│ └─────────────────────────────┘ │
│                                 │
│ [Edit in Import Modal]  [Import Directly]  [Cancel]
└─────────────────────────────────┘
```

- **[Edit in Import Modal]**: Fill fullText into existing ImportScriptModal textarea, user fine-tunes then imports via existing flow
- **[Import Directly]**: Confirm → agent calls `executeImport()` → scriptImportService → done
- **[Cancel]**: Reject → discarded

**Note**: import_script preview is NEVER skipped by `skipConfirmation`. User always sees the preview before import.

### characterMapping → roleMap Conversion

The tool schema accepts `{ "Atana": 1, "AI": 2 }` (name → type number). `scriptImportService` expects `roleMap: Record<string, { id: string; type: number }>`.

Tool handler converts internally:
```typescript
// LLM provides: { "Atana": 1, "AI": 2 }
// Convert to: { "Atana": { id: "", type: 1 }, "AI": { id: "", type: 2 } }
// id is left empty — scriptImportService resolves it from the character name
```

### executeImport — Internal Convention

`import_script` tool has two phases: `execute()` (non-mutating conversion) and `executeImport()` (mutating DB write). This is an **internal module convention** — the generic `AgentTool` interface only declares `execute()`. The ReAct loop does NOT need to know about `executeImport`. The confirmation resume handler in `/api/agent-chat/confirm` calls `executeImport` directly for `post_preview` tools with a saved `toolResult`.

### "Edit in Import Modal" Handoff Protocol

When user clicks [Edit in Import Modal] on the preview card:

1. ChatPanel dispatches a custom event: `window.dispatchEvent(new CustomEvent("agent:open-import-modal", { detail: { folderId, libraryName, fullText } }))`
2. Layout-level listener opens `ImportScriptModal` with pre-filled textarea
3. User edits and imports via existing modal flow
4. On successful import, modal dispatches: `window.dispatchEvent(new CustomEvent("agent:import-complete", { detail: { libraryName } }))`
5. ChatPanel listens for this event and appends a tool_result message: "User imported '{libraryName}' via Import Modal"

If the user closes the modal without importing, no message is appended — the pending action is simply marked as rejected.

---

## 8. Error Handling & Limits

### Error Layers

| Layer | Error Type | Handling |
|-------|-----------|---------|
| **LLM** | API timeout / rate limit / bad response | Auto retry 1x (exponential backoff); still fails → push `error` event |
| **Tool** | Execution failure (DB error, permission denied) | Return `{ success: false, error }` → feed to LLM → LLM explains to user |
| **Agent** | Infinite loop (N consecutive tool_calls with no text) | `maxIterations = 10` cutoff → push error + save context |
| **Confirmation** | User never confirms (pending action expires) | 30-min TTL, auto-clean; next message shows "unfinished action" prompt |

### Anti-Hallucination Guards

Each tool handler validates parameters internally:

```typescript
async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  // 1. Schema validation (zod)
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  // 2. Business validation (library exists, field names valid, etc.)
  const library = await findLibrary(ctx.supabase, ctx.projectId, parsed.data.libraryName);
  if (!library) {
    return { success: false, error: `Library "${parsed.data.libraryName}" not found. Available: ${availableList}` };
  }

  // 3. Permission check (reuse authorizationService)
  const hasPermission = await verifyEditorPermission(ctx.supabase, ctx.userId, ctx.projectId);
  if (!hasPermission) {
    return { success: false, error: "You do not have permission to modify data in this project." };
  }

  // 4. Execute
}
```

### Rate Limits

**v1 scope (honest):**
- `maxToolCallsPerTurn: 1` — enforced by `parallel_tool_calls: false` in LLM API call
- `maxIterations: 10` — enforced in ReAct loop (prevents infinite tool_call chains)

**Deferred to v2 (Future Work):**
- `maxTurnsPerMinute: 10` per user — requires `agent_usage_counters` table
- `maxTokensPerDay: 500_000` per user — same

Rationale: per-user rate limits need a dedicated counter table (not `agent_conversations.meta`, which is per-conversation and bypassable). Defer until usage justifies the complexity.

### Audit Traces

```sql
CREATE TABLE agent_traces (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES agent_conversations(id),
  user_id uuid REFERENCES auth.users(id),
  turn_id text NOT NULL,
  user_message text,
  llm_calls jsonb NOT NULL DEFAULT '[]',
  tool_calls jsonb NOT NULL DEFAULT '[]',
  confirmations jsonb NOT NULL DEFAULT '[]',
  total_latency_ms integer,
  token_usage jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```

- Retention: 90 days (configurable), then auto-archived
- PII: `user_message` and tool args may contain user content — access restricted to conversation owner + project admins

---

## 9. API Contract

### POST /api/agent-chat

**Request:**
```typescript
{
  conversationId?: string;   // Omit to create new conversation
  projectId: string;         // UUID
  message: string;           // User message text
  currentFolderId?: string;  // From page context
  currentLibraryId?: string; // From page context
}
```

**Response:** `text/event-stream` (SSE), events per §5 SSE Event Protocol

**Auth:** Cookie session OR `Authorization: Bearer <token>`

### POST /api/agent-chat/confirm

**Request:**
```typescript
{
  actionId: string;    // UUID from confirmation_request event
  decision: "approve" | "reject";
}
```

**Response:** `text/event-stream` (SSE), same protocol. Resumes the suspended ReAct loop.

### GET /api/agent-chat/conversations

**Request:** Query params: `projectId` (required)

**Response:**
```typescript
{
  conversations: Array<{
    id: string;
    meta: ConversationMeta;
    lastMessage?: string;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

### DELETE /api/agent-chat/conversations/:id

Deletes a conversation and its messages.

### GET /api/agent-chat/conversations/:id/messages

**Request:** Query params: `cursor?` (ISO timestamp), `limit?` (default 50, max 200)

**Response:**
```typescript
{
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "tool";
    content: unknown;    // Full message body
    createdAt: string;
  }>;
  nextCursor?: string;   // Omit if no more pages
}
```

Used when switching conversations in ChatPanel to load history.

---

## 10. Database Changes

### New Tables

```sql
-- Conversation metadata
CREATE TABLE agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Message history
CREATE TABLE agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Pending confirmations
CREATE TABLE agent_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversations(id),
  tool_name text NOT NULL,
  args jsonb NOT NULL,
  confirmation_mode text NOT NULL CHECK (confirmation_mode IN ('pre_execute', 'post_preview', 'meta')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  suspended_state jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '30 minutes'
);

-- Audit traces
CREATE TABLE agent_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES agent_conversations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  turn_id text NOT NULL,
  user_message text,
  llm_calls jsonb DEFAULT '[]',
  tool_calls jsonb DEFAULT '[]',
  confirmations jsonb DEFAULT '[]',
  total_latency_ms integer,
  token_usage jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_agent_conv_user ON agent_conversations(user_id, project_id);
CREATE INDEX idx_agent_msg_conv ON agent_messages(conversation_id, created_at);
CREATE INDEX idx_agent_pending_expires ON agent_pending_actions(expires_at) WHERE status = 'pending';
CREATE INDEX idx_agent_traces_user ON agent_traces(user_id, created_at);
```

### RLS Policies

```sql
-- Enable RLS on all tables
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_traces ENABLE ROW LEVEL SECURITY;

-- Helper: check user has access to project (owner or collaborator)
-- Inline subquery used in policies below:
--   project_id IN (SELECT project_id FROM projects WHERE owner_id = auth.uid())
--   OR project_id IN (SELECT project_id FROM project_collaborators WHERE user_id = auth.uid())

-- agent_conversations: user owns their conversations AND has access to the project
CREATE POLICY "Users can view own conversations" ON agent_conversations
  FOR SELECT USING (
    user_id = auth.uid()
    AND (
      project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
      OR project_id IN (SELECT project_id FROM project_collaborators WHERE user_id = auth.uid())
    )
  );
CREATE POLICY "Users can insert own conversations" ON agent_conversations
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
      OR project_id IN (SELECT project_id FROM project_collaborators WHERE user_id = auth.uid())
    )
  );
CREATE POLICY "Users can update own conversations" ON agent_conversations
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own conversations" ON agent_conversations
  FOR DELETE USING (user_id = auth.uid());

-- agent_messages: accessible through conversation ownership
CREATE POLICY "Users can view messages of own conversations" ON agent_messages
  FOR SELECT USING (
    conversation_id IN (SELECT id FROM agent_conversations WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert messages to own conversations" ON agent_messages
  FOR INSERT WITH CHECK (
    conversation_id IN (SELECT id FROM agent_conversations WHERE user_id = auth.uid())
  );

-- agent_pending_actions: same pattern
CREATE POLICY "Users can view own pending actions" ON agent_pending_actions
  FOR SELECT USING (
    conversation_id IN (SELECT id FROM agent_conversations WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert own pending actions" ON agent_pending_actions
  FOR INSERT WITH CHECK (
    conversation_id IN (SELECT id FROM agent_conversations WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can update own pending actions" ON agent_pending_actions
  FOR UPDATE USING (
    conversation_id IN (SELECT id FROM agent_conversations WHERE user_id = auth.uid())
  );

-- agent_traces: owner can view; project admins can view project traces
CREATE POLICY "Users can view own traces" ON agent_traces
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Project admins can view project traces" ON agent_traces
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM agent_conversations
      WHERE project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
    )
  );
```

---

## 11. File Structure

### New Files

```
src/lib/agent/
├── types.ts                    # AgentTool, ToolContext, ToolResult, SSEEvent, ConfirmationMode
├── core.ts                     # runAgentTurn — ReAct loop with streaming
├── llm-client.ts               # DeepSeek streaming API wrapper
├── confirmation.ts             # PendingAction DB operations + suspend/resume
├── conversation-store.ts       # Conversation + message history read/write
├── field-resolver.ts           # Field name → fieldId resolution for create/update_asset
├── permissions.ts              # Permission checks wrapping authorizationService
├── prompts.ts                  # System prompt template
├── index.ts                    # Public entry
└── tools/
    ├── index.ts                # Tool registry
    ├── query-assets.ts
    ├── query-script-lines.ts
    ├── create-asset.ts
    ├── update-asset.ts
    ├── delete-asset.ts
    ├── import-script.ts        # Two-phase: execute (non-mutating) + executeImport (mutating)
    └── set-conversation-option.ts

src/app/api/agent-chat/
├── route.ts                    # POST — SSE streaming response
├── confirm/
│   └── route.ts                # POST — Confirm/cancel, returns SSE
└── conversations/
    ├── route.ts                # GET — List conversations
    └── [id]/
        └── route.ts            # DELETE — Delete conversation

src/components/agent/
├── ChatPanel.tsx               # Main panel (collapsible sidebar)
├── ChatMessage.tsx             # Message rendering (text/tool_call/confirmation/error)
├── ChatInput.tsx               # Input box
├── ConfirmationCard.tsx        # Confirmation action card (pre_execute / meta)
├── ToolCallCard.tsx            # Tool call status card
├── ScriptPreviewCard.tsx       # import_script preview card (post_preview)
├── ConversationList.tsx        # Conversation history list
├── useAgentChat.ts             # SSE connection + message state hook
└── types.ts                    # Frontend message types

supabase/migrations/
└── XXX_add_agent_tables.sql    # Migration for 4 new tables + RLS
```

### Environment Variables

```bash
# .env.local additions
DEEPSEEK_API_URL=https://api.deepseek.com   # Or self-hosted proxy
DEEPSEEK_API_KEY=sk-xxx
```

---

## 12. Implementation Phases

4 phases, each independently verifiable:

| Phase | Content | Validation |
|-------|---------|-----------|
| **Phase 1: Skeleton** | Auth alignment, `maxDuration`, types, `llm-client.ts` (streaming), `core.ts` (ReAct loop, no tools), ChatPanel UI, SSE connection, conversation persistence, messages API | Type in ChatPanel → LLM streams reply. Auth works with both cookie and Bearer. `maxDuration = 60` confirmed. Conversation history loadable via GET /conversations/:id/messages. |
| **Phase 2: Read tools** | `query_assets` + `query_script_lines` + field-resolver + `displayHint: "table"` UI contract | "What characters are in this project?" returns real data in table format. Script line query: reads library rows via `getLibraryAssetsWithProperties` + `library_field_definitions` column mapping (reverse of import's `fieldIdsByColumn`), outputs structured `{ label, type, name, content, options, jump }` per line. Non-script library returns clear error. |
| **Phase 3: Write tools + confirmation** | `create_asset` + `update_asset` + `delete_asset` + `pre_execute` confirmation flow + `set_conversation_option` + cache invalidation + permission checks (Viewer read-only) + RLS migration | Create/update/delete through confirmation flow. Viewer gets error on write. skipConfirmation works. Multi-instance confirm tested. **UI refresh**: ideal path — write tool calls same Yjs transact + Realtime broadcast as `LibraryDataContext.createAsset`; fallback — ChatPanel shows "Data updated — please refresh". Verify ideal path works when library page is already open. |
| **Phase 4: Import script** | `import_script` tool + `post_preview` flow + ScriptPreviewCard + integration with ImportScriptModal + folderId handling + Edit-in-Modal handoff protocol | Paste prose → preview card → import success. Preview not skippable. Edit-in-modal: preview card dispatches `agent:open-import-modal` event → modal opens pre-filled → on success dispatches `agent:import-complete` → ChatPanel appends confirmation message. LLM retry on validation failure. |

Each phase follows TDD: write tests first, then implement.

---

## 13. Future Work (Out of Scope for v1)

- `query_table` with whitelist-based access (if query_assets + query_script_lines prove insufficient)
- `list_folders` tool (v1 relies on ToolContext.currentFolderId + UI fallback)
- Per-user rate limits (`maxTurnsPerMinute`, `maxTokensPerDay`) with `agent_usage_counters` table
- Streaming LLM tool call accumulation optimization (v1 accumulates full response before processing)
- Trace auto-archival cron job (90-day retention)
- Conversation search / export
- Multi-language system prompt
- Voice input
