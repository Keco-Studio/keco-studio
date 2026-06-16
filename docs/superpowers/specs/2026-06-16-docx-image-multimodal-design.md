# Design Document → Tables with Multimodal Image Understanding (MiniMax-M3)

**Date**: 2026-06-16
**Status**: Approved (待开发)
**Integrates / Supersedes**:
- `2026-06-15-design-document-to-tables-design.md`（docx 上传配表链路 —— 本 spec 第 9 节决策「图片忽略」被本 spec 推翻）
- 复用 `2026-06-15-design-document-to-tables-skill.md`（字段类型 catalog / `list_field_types`，本 spec 不改动该体系）

**Scope**: 让"上传设计文档自动配表"的 Agent 能**看见 docx 内嵌图片**，借助 MiniMax-M3 的多模态能力理解图表/示意图/立绘等视觉信息，从而更准确地推理表结构与数据。

---

## 1. 背景与问题

上一版（`2026-06-15-design-document-to-tables-design.md`）已落地完整链路：

> 上传页（或 ChatInput 附件）→ 浏览器端 `parseDocument`（mammoth）→ `buildDesignMessage` 拼成纯文本 → sessionStorage handoff → ChatPanel 自动 `send` → `POST /api/agent-chat` → Agent ReAct loop 调 `setup_library` / `update_row` 配表。

**当时的硬约束**：所用模型 **MiniMax-M2.7 不支持原生图片输入**，因此：

- `document-parser.ts` 用 `mammoth.extractRawText`，docx 内嵌图片在解析阶段即被**丢弃**；
- 上传页明示 "Images inside the document are ignored"；
- 整条链路 `ChatMessage.content` 为 `string | null`，无多模态 content parts。

**实测问题**：很多设计文档把关键信息放在**图片**里——系统结构图、数值表截图、角色立绘、UI 草图、关系图。纯文本解析丢掉这些后，Agent 看不到用户真正想表达的设计，配表质量受限，也无法"根据图片信息分析用户指令"。

**根因**：模型与链路都不支持图片。现已确认 **MiniMax-M3（即用户口中的 minimax3.0）原生支持多模态**，可经 OpenAI 兼容 `/v1/chat/completions` 接收 `image_url` content parts，故可打通图片理解链路。

---

## 2. 目标

1. **解析层提图**：docx 解析时在保留纯文本的同时，提取内嵌图片（buffer + contentType）。
2. **图片可被外部模型访问**：复用现有 `uploadMediaFile` 把图片上传到 `library-media-files`（public bucket），得到永久 URL。
3. **多模态消息链路**：`ChatMessage.content` 支持 `string | ContentPart[]`，把图片 URL 以 `image_url` part 形式随 user 消息发给 MiniMax-M3。
4. **模型切换**：默认 `LLM_MODEL` 由 `MiniMax-M2.7` 改为 `MiniMax-M3`。
5. **不破坏纯文本场景**：无图片时行为与今天完全一致；图片处理失败时**降级为纯文本**继续配表。

### 非目标

- 不让 Agent 自动**填充媒体列**：Agent 无法上传文件，文档配表阶段媒体列仍**只建空列**（沿用 `list_field_types` skill 的媒体列原则）。图片仅用于**理解**。
- 不支持视频（`video_url`）—— MiniMax-M3 支持，但本期 YAGNI。
- 不在聊天框支持直接粘贴/上传单张图片（仅 docx 内嵌图片场景）。未来增强。
- 不改字段类型 catalog / `list_field_types` 体系。
- 不新增数据库迁移（`library-media-files` bucket 已存在且为 public）。

---

## 3. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 图片用途 | **仅辅助理解**（不写库、不填媒体列） | Agent 无法上传文件；图片用于"看懂"设计来配表 |
| 图片传输 | **上传 Supabase Storage 传 URL**（非 base64 内联） | sessionStorage 装不下 base64；DB 会话历史每轮重发，URL 比 base64 省 token、可持久化 |
| 上传基建 | 复用 `uploadMediaFile` + `library-media-files`（public，永久 URL） | 与 MediaCell 一致；public URL 外部 MiniMax 可直接 GET |
| 图片在上下文留存 | **每轮都重发图片**（不做"首轮后剔除"优化） | 用户选定：Agent 始终能看图，简化实现，接受较高 token 成本 |
| 数量/成本控制 | 过滤装饰小图 + 限额 + 限单图大小 | 控制请求体大小与 vision token 成本 |
| 覆盖入口 | 设计文档上传页 **+** ChatInput 附件（两者共用 `parseDocument`/`buildDesignMessage`） | 两入口同链路，一并改造 |
| 模型 | `MiniMax-M3`（env `LLM_MODEL`） | M2.x 标准 chat 端点不支持图片；M3 原生多模态 |

### 已确认的 MiniMax-M3 多模态事实（来自 MiniMax 官方 API 文档）

- OpenAI 兼容 `/v1/chat/completions`，`content` 为 parts 数组，图片用 `{"type":"image_url","image_url":{"url": <公网URL或base64 DataURL>, "detail":"low|default|high"}}`。
- 图片支持 JPEG / PNG / GIF / WEBP，单图 ≤ 10MB，请求体 ≤ 64MB。
- 本期采用 **public URL** 形式（非 base64），`detail` 用默认值 `default`。

---

## 4. 架构与数据流

```
docx (上传页 / ChatInput 附件)
 │
 ▼ ① 解析层  src/lib/document-parser.ts ★
 ├─ mammoth.extractRawText           → text（同今天）
 └─ mammoth.convertToHtml + images.imgElement
       → 收集内嵌图片 { data, contentType }（丢弃 HTML，仅取副作用图片）
       → 过滤：仅 png/jpeg/gif/webp；跳过 < MIN_IMAGE_BYTES（装饰小图）；
                单图 ≤ 5MB；最多 MAX_DOC_IMAGES 张
 │  返回 ParsedDocument { text, images }
 │
 ▼ ② 上传层（浏览器端，已登录）  src/lib/services/documentImageUpload.ts ★
 └─ uploadDocumentImages(supabase, images, userId)
       → 每张包成 File → uploadMediaFile → public URL
       → 返回 string[]（失败的单张跳过，不阻断）
 │
 ▼ ③ 消息/handoff ★
 ├─ buildDesignMessage(...) 仍产出纯文本（指令 + [Document content] 正文）
 └─ 额外携带 imageUrls: string[]
       ├─ 上传页：saveDesignHandoff({ message, fileName, imageUrls })
       └─ ChatInput：onSend(message, { imageUrls })
 │
 ▼ ④ 发送  ChatPanel / useAgentChat ★
 └─ POST /api/agent-chat { message, imageUrls, ...context }
 │
 ▼ ⑤ API  src/app/api/agent-chat/route.ts ★
 └─ 校验 imageUrls（数组 / 数量上限 / 必须是 http(s) 且来自我们的 storage 源）
       → runAgentTurn({ userMessage, imageUrls, ... })
 │
 ▼ ⑥ Agent core  src/lib/agent/core.ts ★
 └─ 构造 user ChatMessage：
       content = imageUrls?.length
         ? [ {type:'text', text: llmUserMessage},
             ...imageUrls.map(url => ({type:'image_url', image_url:{url}})) ]
         : llmUserMessage（纯文本，回退）
       → 持久化进 DB（parts → JSON），每轮重发
 │
 ▼ ⑦ LLM  src/lib/agent/llm-client.ts ★
 └─ messages 透传；LLM_MODEL 默认 MiniMax-M3
 │
 ▼ MiniMax-M3 /v1/chat/completions（多模态）
```

★ = 本 spec 的改造点。其余（sessionStorage handoff 时序、ReAct loop、确认机制、`list_field_types`/catalog、媒体列留空原则）均沿用现状。

---

## 5. 类型层：`src/lib/agent/types.ts`

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

新增 helper（同文件或 `content-parts.ts`）：

```typescript
/** Read the concatenated text of a message regardless of string/parts shape. */
export function getMessageText(content: ChatMessage['content']): string;
/** Map only the text portion, preserving image parts and ordering. */
export function mapMessageText(
  content: ChatMessage['content'],
  fn: (text: string) => string,
): ChatMessage['content'];
```

这两个 helper 用于 `context-message.ts` / `core.ts` 在不破坏图片 part 的前提下读/改 user 文本。

---

## 6. 解析层：`src/lib/document-parser.ts`

### 6.1 返回值变更（破坏性，更新两处调用方）

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

- `txt` / `md`：`{ text: await file.text(), images: [] }`。
- `docx`：
  - `text` 仍由 `mammoth.extractRawText({ arrayBuffer })` 得到（干净文本，优于 HTML）。
  - `images` 通过一次 `mammoth.convertToHtml({ arrayBuffer }, { convertImage })` 收集——`convertImage` handler 把 `image.readAsArrayBuffer()` + `image.contentType` 推入数组（HTML 结果丢弃）。
- `doc` / 其他：维持现有报错。

### 6.2 过滤与限额（常量集中在文件顶部）

```typescript
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MIN_IMAGE_BYTES = 5 * 1024;        // 跳过装饰性小图（图标/项目符号/分隔线）
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 单图上限（与 uploadMediaFile 一致）
const MAX_DOC_IMAGES = 20;               // 数量上限（控制 token 成本与请求体）
```

过滤顺序：contentType 在白名单 → `MIN_IMAGE_BYTES ≤ size ≤ MAX_IMAGE_BYTES` → 按出现顺序取前 `MAX_DOC_IMAGES` 张。Word 常见的 `image/x-emf`/`image/x-wmf` 矢量图不在白名单，直接跳过。

---

## 7. 上传层：`src/lib/services/documentImageUpload.ts`（新）

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

- 复用 `uploadMediaFile`（bucket `library-media-files`，返回永久 public URL）。
- 浏览器端、已登录上下文调用（`useSupabase()` + `getCurrentUserId()`，与 `MediaFileUpload` 同模式）。
- 单张失败不抛出，整体降级。

---

## 8. 消息 / handoff / 发送层

### 8.1 handoff：`src/lib/design-upload-handoff.ts`

`DesignUploadHandoff` 增加可选 `imageUrls?: string[]`；`saveDesignHandoff` / `takeDesignHandoff` 透传。

### 8.2 上传页：`src/app/(dashboard)/[projectId]/design-upload/page.tsx`

`handleSubmit` 调整：

```typescript
const { text, images } = await parseDocument(file);
const documentText = text.trim();
// ...空文本校验同今天...
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

提示文案：将 "Images inside the document are ignored and will not be processed." 改为说明图片**会被分析**（如 "Images in the document will be analyzed by the agent to better understand your design."）。

### 8.3 ChatInput：`src/components/agent/ChatInput.tsx`

同样 `parseDocument` → `uploadDocumentImages` → `onSend(message, { imageUrls })`。

### 8.4 ChatPanel / useAgentChat

- `ChatPanel.consumeDesignHandoff`：`void send(handoff.message, { imageUrls: handoff.imageUrls })`。
- `useAgentChat.send(message, opts?: { imageUrls?: string[] })`：POST body 增加 `imageUrls`。

```typescript
body: JSON.stringify({
  conversationId, projectId: ctx.projectId, message,
  imageUrls: opts?.imageUrls,
  currentFolderId, /* ...其余 context 同今天... */
}),
```

---

## 9. API 层：`src/app/api/agent-chat/route.ts`

- 请求体增加 `imageUrls?: string[]`。
- 校验：必须是数组；元素是 `http(s)` 字符串；数量 ≤ `MAX_DOC_IMAGES`；URL 源应匹配本项目 Supabase storage 域（`NEXT_PUBLIC_SUPABASE_URL` 前缀），过滤掉不匹配项以防被注入任意外链。
- 透传给 `runAgentTurn({ ..., imageUrls })`。

---

## 10. Agent core：`src/lib/agent/core.ts`

### 10.1 构造 user 消息为多模态 parts

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

> 注意：持久化的 user 消息现在带图（按决策"每轮重发图片"），DB 存结构化 content；UI 展示仍走 `deriveUserDisplay`（解析 `[Design document]` 文本，不受图片 part 影响）。

### 10.2 `augmentUserMessageForLlm` / `refreshLastUserContext` / `stripContextAugmentation` 适配 parts

- `context-message.ts`：用 `mapMessageText` 只对 text 段加/去上下文前缀，保留 image part 顺序。
- `refreshLastUserContext`：放宽 `typeof msg.content !== 'string'` 限制，改为"含可读 text 的 user 消息"判定（parts 中取首个 text part 处理）。

---

## 11. 持久化：`src/lib/agent/conversation-store.ts`

- `saveMessage`：content 为 parts 时 `JSON.stringify` 存入文本列（现已有非 string 兜底，明确为 parts 形态）。
- `loadConversationHistory`：读取时若文本列是 `ChatContentPart[]` 的 JSON（以 `[` 开头且解析后每项含 `type`），还原为 parts；否则按纯字符串处理（向后兼容历史会话）。

---

## 12. 预处理：`src/lib/agent/tool-result-for-llm.ts`

`prepareMessagesForLlm`（window 截断 / `sanitizeMessagesForLlm` / 压缩 tool 结果）需兼容数组 content：

- 窗口/配对逻辑里凡判断 content 是否"为空/有内容"处，用 `getMessageText(content)` 或 `Array.isArray(content)` 判定，避免把带图 user 消息误判为空。
- 压缩逻辑只针对 tool 消息 JSON，user 的 image parts 原样保留。

---

## 13. LLM 客户端 / 模型：`src/lib/agent/llm-client.ts`

```typescript
const LLM_MODEL = process.env.LLM_MODEL || 'MiniMax-M3'; // was 'MiniMax-M2.7'
```

- 请求体已 `JSON.stringify(messages)` 透传，类型放开后 parts 自动随发。
- 保持 `stream: true`、`tool_choice: 'auto'`、`parallel_tool_calls: false` 不变。
- `.env` / 部署配置：`LLM_MODEL=MiniMax-M3`（文档说明；密钥不提交）。
- 注：`max_tokens` 维持现状；若 M3 报参数名问题再评估切 `max_completion_tokens`（本期不预改）。

---

## 14. 提示词：`src/lib/agent/prompts.ts` 第 28 条增补

在现有第 28 条（DESIGN DOCUMENT → TABLES）中加入对"可见图片"的说明：

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

媒体列留空原则与 `list_field_types` skill 保持一致。

---

## 15. 涉及文件清单

| 文件 | 操作 |
|------|------|
| `src/lib/agent/types.ts` | `ChatMessage.content` 改联合类型；新增 `ChatContentPart` 及 `getMessageText`/`mapMessageText` helper |
| `src/lib/document-parser.ts` | 返回 `ParsedDocument{text,images}`；docx 提图 + 过滤/限额 |
| `src/lib/services/documentImageUpload.ts` | 新增 `uploadDocumentImages`（复用 `uploadMediaFile`） |
| `src/lib/design-upload-handoff.ts` | handoff payload 加 `imageUrls?` |
| `src/app/(dashboard)/[projectId]/design-upload/page.tsx` | 解析→上传图→传 imageUrls；提示文案改 |
| `src/components/agent/ChatInput.tsx` | 同链路加图片上传 |
| `src/components/agent/ChatPanel.tsx` | `send` 带 imageUrls |
| `src/components/agent/useAgentChat.ts` | `send` 签名 + POST body 加 imageUrls |
| `src/app/api/agent-chat/route.ts` | 解析+校验 imageUrls，透传 runAgentTurn |
| `src/lib/agent/core.ts` | `input.imageUrls`→构造 parts；augment/refresh/strip 适配 |
| `src/lib/agent/context-message.ts` | 对 parts 的 text 段做上下文注入 |
| `src/lib/agent/conversation-store.ts` | content parts 存/取（JSON 往返，向后兼容） |
| `src/lib/agent/tool-result-for-llm.ts` | window/sanitize/compact 兼容数组 content |
| `src/lib/agent/llm-client.ts` | 默认模型 `MiniMax-M3` |
| `src/lib/agent/prompts.ts` | 第 28 条增补"可见图片"规则 |
| `src/lib/design-message.ts` | （可选）正文末尾提示"已附带 N 张图片" |

---

## 16. 边界情况与容错

| 场景 | 处理 |
|------|------|
| docx 无内嵌图片 | `images: []`，链路与今天完全一致（纯文本） |
| 图片为不支持类型（emf/wmf 等） | 解析层跳过，不计入 imageUrls |
| 图片过小（装饰图标） | `< MIN_IMAGE_BYTES` 跳过 |
| 图片过大（> 5MB） | 解析层跳过，提示用户 |
| 图片数 > 上限 | 取前 `MAX_DOC_IMAGES` 张 |
| 单张上传失败 | 跳过该张，其余继续；toast 告知跳过数 |
| 全部上传失败 / 未登录 | 降级为纯文本配表，不阻断 |
| 历史会话（无 parts） | `loadConversationHistory` 按纯字符串还原，向后兼容 |
| 模型未切到 M3 / 非多模态 | 纯文本仍正常；图片被模型忽略（不报错） |
| route 收到非法/外部 imageUrls | 过滤非本 storage 源的 URL |

---

## 17. 安全考虑

- 图片落 `library-media-files`（public bucket，路径 `{userId}/...`，RLS 写入需匹配登录用户），与现有 MediaCell 同模型。
- API 侧校验 imageUrls 必须来自本项目 Supabase storage 源，避免 Agent 被诱导拉取任意外链（SSRF / 注入面）。
- public URL 永久可读：与现有媒体一致，可接受（设计素材本就要展示）。
- 文档正文与图片均不在服务端长期落盘解析（解析在浏览器端，图片入 storage 与普通媒体同等对待）。

---

## 18. 测试策略（TDD）

| 测试 | 覆盖 | 工具 |
|------|------|------|
| 单元 | `parseDocument(docx)` 返回 `{text, images}`：提取内嵌图；过滤小图/超大图/不支持类型；限额 `MAX_DOC_IMAGES` | Jest |
| 单元 | `parseDocument(txt/md)` 返回 `images: []` 且 text 正确 | Jest |
| 单元 | `uploadDocumentImages` 把 buffer 包成 File 调 `uploadMediaFile`，返回 URL；单张失败被跳过（mock supabase） | Jest |
| 单元 | core：有 imageUrls 时 user content 为 `[text, image_url...]`；无图时为纯字符串 | Jest |
| 单元 | `conversation-store` content parts 存→取往返；旧纯字符串向后兼容 | Jest |
| 单元 | `augmentUserMessageForLlm`/`refreshLastUserContext` 对 parts 仅改 text、保留 image part | Jest |
| 单元 | route 校验：过滤非本 storage 源 URL、超量截断、非数组拒绝 | Jest |
| 单元 | `getMessageText`/`mapMessageText` 行为 | Jest |
| 手动 | 带图表/截图的真实 docx → M3 → Agent 能引用图片内容做配表，媒体列留空 | — |

---

## 19. 风险与回归

- **中**：`ChatMessage.content` 由 string 变联合类型，触及 core / 持久化 / 预处理多处，需保证纯文本路径行为不变（用现有调用方单测兜底 + 新增 parts 单测）。
- **低**：解析层返回值变更是破坏性，但调用方仅 2 处（上传页、ChatInput），编译器可定位。
- **成本**：多模态 + 每轮重发图片会增加 vision token 消耗；通过过滤/限额（≤20 张、≥5KB、≤5MB）控制；后续可增"首轮后剔除图片"优化（见未来增强）。
- **模型切换**：M2.7→M3 影响所有 Agent 对话（非仅配表）。M3 为 OpenAI 兼容、能力更强，风险低；保留 `LLM_MODEL` env 可快速回滚。

---

## 20. 未来增强

- 成本优化：首轮模型"看图"后，后续 ReAct 轮次从历史中剔除 image parts，仅留 URL 文本引用。
- 聊天框直接粘贴/上传单张图片给 Agent（脱离 docx 场景）。
- 视频理解（`video_url`，M3 已支持）。
- 大文档分块 + 图片去重（同图多次出现只传一次）。
- 让 Agent 在媒体列填入"建议配图"的引用（需先解决 Agent 侧上传能力）。
