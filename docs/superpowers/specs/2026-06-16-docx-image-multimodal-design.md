# Design Document → Tables with Multimodal Image Understanding (MiniMax-M3)

**Date**: 2026-06-16
**Status**: Approved (pending development)
**Integrates / Supersedes**:
- `2026-06-15-design-document-to-tables-design.md` (docx upload table-setup pipeline — that spec's Section 9 decision "ignore images" is overturned by this spec)
- Reuses `2026-06-15-design-document-to-tables-skill.md` (field type catalog / `list_field_types`; this spec does not modify that system)

**Scope**: Enable the "upload design document to auto-create tables" Agent to **see images embedded in docx files**, leveraging MiniMax-M3's multimodal capability to understand charts/diagrams/character art and other visual information, thereby inferring table structures and data more accurately.

---

## 1. Background and Problem

The previous version (`2026-06-15-design-document-to-tables-design.md`) shipped the full pipeline:

> Upload page (or ChatInput attachment) → browser-side `parseDocument` (mammoth) → `buildDesignMessage` assembles plain text → sessionStorage handoff → ChatPanel auto-`send` → `POST /api/agent-chat` → Agent ReAct loop calls `setup_library` / `update_row` to set up tables.

**Hard constraint at the time**: the model in use, **MiniMax-M2.7, does not support native image input**, therefore:

- `document-parser.ts` used `mammoth.extractRawText`, so docx-embedded images were **discarded** at the parsing stage;
- The upload page explicitly stated "Images inside the document are ignored";
- Throughout the pipeline, `ChatMessage.content` was `string | null`, with no multimodal content parts.

**Observed problem in practice**: many design documents put key information in **images** — system architecture diagrams, screenshots of stat tables, character art, UI sketches, relationship diagrams. After plain-text parsing drops these, the Agent cannot see the design the user actually intends, limiting table-setup quality and making it impossible to "analyze user instructions based on image information".

**Root cause**: neither the model nor the pipeline supported images. It is now confirmed that **MiniMax-M3 (what users call minimax3.0) natively supports multimodality**, accepting `image_url` content parts via the OpenAI-compatible `/v1/chat/completions`, so the image-understanding pipeline can be built.

---

## 2. Goals

1. **Extract images at the parsing layer**: when parsing docx, extract embedded images (buffer + contentType) while keeping the plain text.
2. **Images accessible to the external model**: reuse the existing `uploadMediaFile` to upload images to `library-media-files` (public bucket), yielding permanent URLs.
3. **Multimodal message pipeline**: `ChatMessage.content` supports `string | ContentPart[]`, sending image URLs as `image_url` parts with the user message to MiniMax-M3.
4. **Model switch**: change the default `LLM_MODEL` from `MiniMax-M2.7` to `MiniMax-M3`.
5. **Do not break the plain-text scenario**: with no images, behavior is exactly as it is today; if image processing fails, **degrade to plain text** and continue table setup.

### Non-goals

- Do not let the Agent auto-**fill media columns**: the Agent cannot upload files; during document-based table setup, media columns are still **created empty only** (following the media-column principle of the `list_field_types` skill). Images are for **understanding** only.
- No video support (`video_url`) — MiniMax-M3 supports it, but YAGNI for this iteration.
- No direct paste/upload of individual images in the chat box (docx-embedded images only). Future enhancement.
- No changes to the field type catalog / `list_field_types` system.
- No new database migrations (the `library-media-files` bucket already exists and is public).

---

## 3. Key Design Decisions

| Decision | Choice | Rationale |
|------|------|------|
| Image purpose | **Understanding aid only** (no DB writes, no media column filling) | The Agent cannot upload files; images are for "comprehending" the design to set up tables |
| Image transport | **Upload to Supabase Storage, send URL** (not inline base64) | sessionStorage cannot hold base64; DB conversation history is resent each turn, URLs save tokens vs base64 and are persistable |
| Upload infrastructure | Reuse `uploadMediaFile` + `library-media-files` (public, permanent URLs) | Consistent with MediaCell; the external MiniMax can GET public URLs directly |
| Image retention in context | **Resend images every turn** (no "drop after first turn" optimization) | User's choice: the Agent can always see the images; simpler implementation; higher token cost accepted |
| Count/cost control | Filter small decorative images + cap count + cap per-image size | Controls request body size and vision token cost |
| Covered entry points | Design document upload page **+** ChatInput attachment (both share `parseDocument`/`buildDesignMessage`) | Both entry points share the pipeline; upgrade both |
| Model | `MiniMax-M3` (env `LLM_MODEL`) | M2.x standard chat endpoint does not support images; M3 is natively multimodal |

### Confirmed MiniMax-M3 multimodal facts (from official MiniMax API docs)

- OpenAI-compatible `/v1/chat/completions`, `content` is a parts array, images use `{"type":"image_url","image_url":{"url": <public URL or base64 DataURL>, "detail":"low|default|high"}}`.
- Images support JPEG / PNG / GIF / WEBP, single image ≤ 10MB, request body ≤ 64MB.
- This iteration uses the **public URL** form (not base64), with `detail` at the default value `default`.

---

## 4. Architecture and Data Flow

```
docx (upload page / ChatInput attachment)
 │
 ▼ ① Parsing layer  src/lib/document-parser.ts ★
 ├─ mammoth.extractRawText           → text (same as today)
 └─ mammoth.convertToHtml + images.imgElement
       → collect embedded images { data, contentType } (discard HTML, keep images as a side effect only)
       → filter: png/jpeg/gif/webp only; skip < MIN_IMAGE_BYTES (small decorative images);
                single image ≤ 5MB; at most MAX_DOC_IMAGES images
 │  returns ParsedDocument { text, images }
 │
 ▼ ② Upload layer (browser-side, logged in)  src/lib/services/documentImageUpload.ts ★
 └─ uploadDocumentImages(supabase, images, userId)
       → wrap each into a File → uploadMediaFile → public URL
       → returns string[] (failed images are skipped without blocking)
 │
 ▼ ③ Message/handoff ★
 ├─ buildDesignMessage(...) still produces plain text (instructions + [Document content] body)
 └─ additionally carries imageUrls: string[]
       ├─ Upload page: saveDesignHandoff({ message, fileName, imageUrls })
       └─ ChatInput: onSend(message, { imageUrls })
 │
 ▼ ④ Send  ChatPanel / useAgentChat ★
 └─ POST /api/agent-chat { message, imageUrls, ...context }
 │
 ▼ ⑤ API  src/app/api/agent-chat/route.ts ★
 └─ validate imageUrls (array / count cap / must be http(s) and from our storage origin)
       → runAgentTurn({ userMessage, imageUrls, ... })
 │
 ▼ ⑥ Agent core  src/lib/agent/core.ts ★
 └─ build the user ChatMessage:
       content = imageUrls?.length
         ? [ {type:'text', text: llmUserMessage},
             ...imageUrls.map(url => ({type:'image_url', image_url:{url}})) ]
         : llmUserMessage (plain text, fallback)
       → persisted into the DB (parts → JSON), resent every turn
 │
 ▼ ⑦ LLM  src/lib/agent/llm-client.ts ★
 └─ messages passed through; LLM_MODEL defaults to MiniMax-M3
 │
 ▼ MiniMax-M3 /v1/chat/completions (multimodal)
```

★ = changes made by this spec. Everything else (sessionStorage handoff timing, ReAct loop, confirmation mechanism, `list_field_types`/catalog, empty-media-column principle) stays as is.

---

## 5. Type Layer: `src/lib/agent/types.ts`

```typescript
export interface ChatTextPart {
  type: 'text';
  text: string;
}

export interface ChatImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'default' | 'high' };
}

export type ChatContentPart = ChatTextPart | ChatImagePart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null; // was: string | null
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
```

New helpers (same file or `content-parts.ts`):

```typescript
/** Read the concatenated text of a message regardless of string/parts shape. */
export function getMessageText(content: ChatMessage['content']): string;
/** Map only the text portion, preserving image parts and ordering. */
export function mapMessageText(
  content: ChatMessage['content'],
  fn: (text: string) => string,
): ChatMessage['content'];
```

These two helpers let `context-message.ts` / `core.ts` read/modify user text without breaking image parts.

---

## 6. Parsing Layer: `src/lib/document-parser.ts`

### 6.1 Return value change (breaking; update both call sites)

```typescript
export interface ExtractedImage {
  data: ArrayBuffer;
  contentType: string; // e.g. 'image/png'
}

export interface ParsedDocument {
  text: string;
  images: ExtractedImage[];
}

export async function parseDocument(file: File): Promise<ParsedDocument>;
```

- `txt` / `md`: `{ text: await file.text(), images: [] }`.
- `docx`:
  - `text` is still obtained via `mammoth.extractRawText({ arrayBuffer })` (clean text, better than HTML).
  - `images` are collected via one `mammoth.convertToHtml({ arrayBuffer }, { convertImage })` pass — the `convertImage` handler pushes `image.readAsArrayBuffer()` + `image.contentType` into an array (the HTML result is discarded).
- `doc` / others: keep the existing errors.

### 6.2 Filtering and limits (constants centralized at the top of the file)

```typescript
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MIN_IMAGE_BYTES = 5 * 1024;        // skip small decorative images (icons/bullets/dividers)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // per-image cap (consistent with uploadMediaFile)
const MAX_DOC_IMAGES = 20;               // count cap (controls token cost and request body)
```

Filter order: contentType in allowlist → `MIN_IMAGE_BYTES ≤ size ≤ MAX_IMAGE_BYTES` → take the first `MAX_DOC_IMAGES` in order of appearance. Word's common `image/x-emf`/`image/x-wmf` vector images are not in the allowlist and are skipped directly.

---

## 7. Upload Layer: `src/lib/services/documentImageUpload.ts` (new)

```typescript
export async function uploadDocumentImages(
  supabase: SupabaseClient,
  images: ExtractedImage[],
  userId: string,
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ext = extFromContentType(img.contentType); // png/jpg/gif/webp
    const file = new File([img.data], `design-${Date.now()}-${i}.${ext}`, {
      type: img.contentType,
    });
    try {
      const meta = await uploadMediaFile(supabase, file, userId);
      urls.push(meta.url);
    } catch {
      // best-effort: skip this image, keep configuring tables with the rest
    }
  }
  return urls;
}
```

- Reuses `uploadMediaFile` (bucket `library-media-files`, returns a permanent public URL).
- Called browser-side in a logged-in context (`useSupabase()` + `getCurrentUserId()`, same pattern as `MediaFileUpload`).
- A single failure does not throw; the whole flow degrades gracefully.

---

## 8. Message / Handoff / Send Layer

### 8.1 Handoff: `src/lib/design-upload-handoff.ts`

`DesignUploadHandoff` gains an optional `imageUrls?: string[]`; `saveDesignHandoff` / `takeDesignHandoff` pass it through.

### 8.2 Upload page: `src/app/(dashboard)/[projectId]/design-upload/page.tsx`

`handleSubmit` adjustments:

```typescript
const { text, images } = await parseDocument(file);
const documentText = text.trim();
// ...empty-text validation same as today...
let imageUrls: string[] = [];
if (images.length > 0) {
  const userId = await getCurrentUserId(supabase);
  imageUrls = await uploadDocumentImages(supabase, images, userId);
  if (imageUrls.length < images.length) {
    showInfoToast(`${images.length - imageUrls.length} image(s) could not be processed and were skipped.`);
  }
}
const message = buildDesignMessage({ fileName: file.name, documentText, additionalInstructions: instructions });
saveDesignHandoff(projectId, { message, fileName: file.name, imageUrls });
```

Notice copy: change "Images inside the document are ignored and will not be processed." to state that images **will be analyzed** (e.g. "Images in the document will be analyzed by the agent to better understand your design.").

### 8.3 ChatInput: `src/components/agent/ChatInput.tsx`

Likewise `parseDocument` → `uploadDocumentImages` → `onSend(message, { imageUrls })`.

### 8.4 ChatPanel / useAgentChat

- `ChatPanel.consumeDesignHandoff`: `void send(handoff.message, { imageUrls: handoff.imageUrls })`.
- `useAgentChat.send(message, opts?: { imageUrls?: string[] })`: POST body gains `imageUrls`.

```typescript
body: JSON.stringify({
  conversationId, projectId: ctx.projectId, message,
  imageUrls: opts?.imageUrls,
  currentFolderId, /* ...rest of the context same as today... */
}),
```

---

## 9. API Layer: `src/app/api/agent-chat/route.ts`

- Request body gains `imageUrls?: string[]`.
- Validation: must be an array; elements are `http(s)` strings; count ≤ `MAX_DOC_IMAGES`; URL origin must match this project's Supabase storage domain (`NEXT_PUBLIC_SUPABASE_URL` prefix), filtering out non-matching entries to prevent arbitrary external link injection.
- Passed through to `runAgentTurn({ ..., imageUrls })`.

---

## 10. Agent Core: `src/lib/agent/core.ts`

### 10.1 Build the user message as multimodal parts

```typescript
const llmUserMessage = augmentUserMessageForLlm(input.userMessage, toolContext);
const userContent: ChatMessage['content'] =
  input.imageUrls && input.imageUrls.length > 0
    ? [
        { type: 'text', text: llmUserMessage },
        ...input.imageUrls.map((url) => ({ type: 'image_url', image_url: { url } } as ChatImagePart)),
      ]
    : llmUserMessage;

const messages: ChatMessage[] = [systemMessage, ...history, { role: 'user', content: userContent }];
await saveMessage(toolContext.supabase, conversationId, { role: 'user', content: userContent });
```

> Note: the persisted user message now carries images (per the "resend images every turn" decision), and the DB stores structured content; UI display still goes through `deriveUserDisplay` (which parses the `[Design document]` text, unaffected by image parts).

### 10.2 Adapt `augmentUserMessageForLlm` / `refreshLastUserContext` / `stripContextAugmentation` for parts

- `context-message.ts`: use `mapMessageText` to add/remove the context prefix on the text segment only, preserving image part order.
- `refreshLastUserContext`: relax the `typeof msg.content !== 'string'` restriction to a "user message containing readable text" check (process the first text part among the parts).

---

## 11. Persistence: `src/lib/agent/conversation-store.ts`

- `saveMessage`: when content is parts, `JSON.stringify` into the text column (a non-string fallback already exists; make the parts shape explicit).
- `loadConversationHistory`: on read, if the text column is JSON of `ChatContentPart[]` (starts with `[` and each parsed item has `type`), restore as parts; otherwise treat as a plain string (backward compatible with historical conversations).

---

## 12. Preprocessing: `src/lib/agent/tool-result-for-llm.ts`

`prepareMessagesForLlm` (window truncation / `sanitizeMessagesForLlm` / tool-result compaction) must handle array content:

- Wherever the window/pairing logic checks whether content is "empty/has content", use `getMessageText(content)` or `Array.isArray(content)` so image-bearing user messages are not misjudged as empty.
- Compaction logic only targets tool message JSON; user image parts are kept as-is.

---

## 13. LLM Client / Model: `src/lib/agent/llm-client.ts`

```typescript
const LLM_MODEL = process.env.LLM_MODEL || 'MiniMax-M3'; // was 'MiniMax-M2.7'
```

- The request body already passes `JSON.stringify(messages)` through; once types are widened, parts are sent automatically.
- Keep `stream: true`, `tool_choice: 'auto'`, `parallel_tool_calls: false` unchanged.
- `.env` / deployment config: `LLM_MODEL=MiniMax-M3` (documented; secrets not committed).
- Note: `max_tokens` stays as-is; if M3 reports a parameter-name issue, evaluate switching to `max_completion_tokens` then (no preemptive change this iteration).

---

## 14. Prompt: `src/lib/agent/prompts.ts`, Additions to Rule 28

Add a note about "visible images" to the existing rule 28 (DESIGN DOCUMENT → TABLES):

```
- The design document may include ATTACHED IMAGES (diagrams, structure charts,
  table screenshots, character art, UI mockups). You can SEE them. Use the images
  together with the text to understand the design and infer tables/fields/data
  (e.g. read a relationship diagram to decide reference fields, or a stats table
  screenshot to decide columns and rows).
- Images are for UNDERSTANDING ONLY. You still cannot upload files, so media
  columns (image/file/multimedia/audio) must be created but left EMPTY — never
  put the attached image URLs into cells or invent media values.
```

The empty-media-column principle stays consistent with the `list_field_types` skill.

---

## 15. Affected Files

| File | Action |
|------|------|
| `src/lib/agent/types.ts` | `ChatMessage.content` becomes a union type; add `ChatContentPart` and the `getMessageText`/`mapMessageText` helpers |
| `src/lib/document-parser.ts` | Return `ParsedDocument{text,images}`; docx image extraction + filtering/limits |
| `src/lib/services/documentImageUpload.ts` | New `uploadDocumentImages` (reuses `uploadMediaFile`) |
| `src/lib/design-upload-handoff.ts` | Handoff payload gains `imageUrls?` |
| `src/app/(dashboard)/[projectId]/design-upload/page.tsx` | Parse → upload images → pass imageUrls; update notice copy |
| `src/components/agent/ChatInput.tsx` | Add image upload to the same pipeline |
| `src/components/agent/ChatPanel.tsx` | `send` carries imageUrls |
| `src/components/agent/useAgentChat.ts` | `send` signature + POST body gain imageUrls |
| `src/app/api/agent-chat/route.ts` | Parse + validate imageUrls, pass through to runAgentTurn |
| `src/lib/agent/core.ts` | `input.imageUrls` → build parts; adapt augment/refresh/strip |
| `src/lib/agent/context-message.ts` | Context injection on the text segment of parts |
| `src/lib/agent/conversation-store.ts` | Store/load content parts (JSON round-trip, backward compatible) |
| `src/lib/agent/tool-result-for-llm.ts` | window/sanitize/compact handle array content |
| `src/lib/agent/llm-client.ts` | Default model `MiniMax-M3` |
| `src/lib/agent/prompts.ts` | Rule 28 gains the "visible images" additions |
| `src/lib/design-message.ts` | (Optional) hint at the end of the body: "N image(s) attached" |

---

## 16. Edge Cases and Fault Tolerance

| Scenario | Handling |
|------|------|
| docx with no embedded images | `images: []`, pipeline identical to today (plain text) |
| Unsupported image type (emf/wmf etc.) | Skipped at the parsing layer, not counted in imageUrls |
| Image too small (decorative icon) | Skipped if `< MIN_IMAGE_BYTES` |
| Image too large (> 5MB) | Skipped at the parsing layer, user notified |
| Image count > cap | Take the first `MAX_DOC_IMAGES` |
| Single upload failure | Skip that image, continue with the rest; toast reports the skipped count |
| All uploads fail / not logged in | Degrade to plain-text table setup, no blocking |
| Historical conversations (no parts) | `loadConversationHistory` restores as plain strings, backward compatible |
| Model not switched to M3 / not multimodal | Plain text still works; images are ignored by the model (no error) |
| route receives invalid/external imageUrls | Filter out URLs not from our storage origin |

---

## 17. Security Considerations

- Images land in `library-media-files` (public bucket, path `{userId}/...`, RLS requires writes to match the logged-in user), same model as the existing MediaCell.
- The API side validates that imageUrls come from this project's Supabase storage origin, preventing the Agent from being lured into fetching arbitrary external links (SSRF / injection surface).
- Public URLs are permanently readable: consistent with existing media, acceptable (design assets are meant to be displayed anyway).
- Neither the document body nor the images are parsed or persisted long-term on the server (parsing happens in the browser; images go into storage treated the same as regular media).

---

## 18. Testing Strategy (TDD)

| Test | Coverage | Tool |
|------|------|------|
| Unit | `parseDocument(docx)` returns `{text, images}`: extracts embedded images; filters small/oversized/unsupported types; caps at `MAX_DOC_IMAGES` | Jest |
| Unit | `parseDocument(txt/md)` returns `images: []` with correct text | Jest |
| Unit | `uploadDocumentImages` wraps buffers into Files, calls `uploadMediaFile`, returns URLs; single failures are skipped (mock supabase) | Jest |
| Unit | core: with imageUrls, user content is `[text, image_url...]`; without images, it is a plain string | Jest |
| Unit | `conversation-store` content parts store → load round-trip; legacy plain strings backward compatible | Jest |
| Unit | `augmentUserMessageForLlm`/`refreshLastUserContext` modify only text in parts, preserve image parts | Jest |
| Unit | route validation: filters URLs not from our storage origin, truncates over-limit, rejects non-arrays | Jest |
| Unit | `getMessageText`/`mapMessageText` behavior | Jest |
| Manual | Real docx with diagrams/screenshots → M3 → Agent can reference image content for table setup, media columns left empty | — |

---

## 19. Risks and Regressions

- **Medium**: `ChatMessage.content` changes from string to a union type, touching core / persistence / preprocessing in multiple places; the plain-text path must behave identically (backed by existing caller unit tests + new parts unit tests).
- **Low**: the parsing layer return-value change is breaking, but there are only 2 call sites (upload page, ChatInput), locatable by the compiler.
- **Cost**: multimodality + resending images every turn increases vision token consumption; controlled via filtering/limits (≤20 images, ≥5KB, ≤5MB); a "drop images after the first turn" optimization can be added later (see future enhancements).
- **Model switch**: M2.7 → M3 affects all Agent conversations (not just table setup). M3 is OpenAI-compatible and more capable, so risk is low; the `LLM_MODEL` env allows quick rollback.

---

## 20. Future Enhancements

- Cost optimization: after the model "sees" the images in the first turn, strip image parts from history in subsequent ReAct turns, keeping only URL text references.
- Paste/upload individual images directly to the Agent in the chat box (beyond the docx scenario).
- Video understanding (`video_url`, already supported by M3).
- Large-document chunking + image deduplication (the same image appearing multiple times is sent only once).
- Let the Agent fill media columns with "suggested artwork" references (requires solving Agent-side upload capability first).
