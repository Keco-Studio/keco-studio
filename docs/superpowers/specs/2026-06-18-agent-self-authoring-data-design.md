# Agent Self-Authoring Data — Schema-Aware Writes Design Spec

**Date:** 2026-06-18
**Status:** Draft
**Scope:** 让 Agent 在写入表格数据时"自己想得对、填得全"——把目标表的结构契约（列 / 必填 / enum 合法值 / 引用目标 / 值格式）提升为模型的一等输入，并用强校验把错误变成可读、可自我纠正的反馈。
**Related:** [2026-06-15-design-document-to-tables-design.md](./2026-06-15-design-document-to-tables-design.md), [2026-06-17-agent-auto-execute-design.md](./2026-06-17-agent-auto-execute-design.md), [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md)

---

## 1. Overview

### 1.1 Problem

用户上传策划文档让 Agent 自动建表 + 填数据时，反复出现"看起来在填、实际漏 / 错"的问题：

- 写入工具返回 `success`，但单元格为空（模型发了 `propertyValues: {}`）。
- enum 列写入自造值（如 `充值货币`，而合法值只有 `付费货币`），UI 显示空白。
- 主标签列（`规则名称` / `道具名称` 等）没填，行有数据但第一列空白，看起来像"没建成"。
- `string_array` 被包成 `[["a","b"]]`、值被包成 `{"item": ...}`。

这些已通过事后护栏（`isExplicitEmptyPropertyValues`、`validateEnumPropertyValues`、`flattenArrayCellValue`、`findPrimaryLabelField`）逐个兜住，但属于"写错了再纠正"，治标不治本。

### 1.2 Root Cause

**写入工具对模型是"盲写"。** 现状下 `create_asset` / `update_asset` / `update_row` 的 `propertyValues` 是完全自由的 `Record<string, unknown>`，其 tool schema 只说"按字段名写值"，**不包含目标表的任何契约**：

```12:18:src/lib/agent/field-resolver.ts
export interface FieldResolution {
  /** fieldId -> value, ready for createAsset/updateAsset propertyValues. */
  resolved: Record<string, unknown>;
  /** Semantic field names that could not be matched. */
  unresolved: string[];
  /** All available field labels for the library (for error feedback to the LLM). */
  availableFields: string[];
}
```

模型只能依赖"记忆"——它在 `setup_library` 时定义过字段，或调过 `list_field_types`（那只是**全局类型目录**，不是**这张具体表的契约**）。长对话冲刷上下文后，它就忘列、漏必填、猜 enum。

**缺口归纳：**

| 缺口 | 现状 | 影响 |
|------|------|------|
| 没有 per-library schema 工具 | 只有全局 `list_field_types` | 模型不知道"这张表"有哪些列、哪个必填、enum 选什么 |
| 写入工具 schema 无契约 | `propertyValues` 是自由 object | 模型靠记忆，长上下文后失准 |
| 校验是事后兜底 | empty/enum/array/name 都在写时拦截 | 错误反馈不结构化，模型难一次纠正到位 |
| 自由 JSON 结构脆弱 | MiniMax-M3 易产出 `{}` / 嵌套数组 / `{item}` | 需要逐个 normalize |

### 1.3 Decision

**把"表结构契约"做成 Agent 写数据前的标准输入，并把校验从"事后兜底"升级为"事前引导 + 结构化纠错闭环"。**

采用**分阶段**推进：

- **Phase 1（渐进增强 / 短期止血）**：在不动现有工具签名的前提下，新增 `get_library_schema` 读工具、把零散护栏收敛成统一的"schema 校验层"并返回结构化纠错信息、`setup_library` 成功后回传"填表备忘"、收敛 prompt。
- **Phase 2（工具重构 / 长期方向）**：从结构上减少模型出错空间——按当前活动库**动态生成写入工具的 JSON Schema**（`propertyValues` 精确列出字段 + enum 约束），可选引入分步原子写入工具。

校验严格度：**Strict（强校验）**——缺必填、enum 非法、引用非法一律报错并告诉模型"缺/错在哪、该怎么填"，逼模型补全，而不是静默成功。

### 1.4 Goals

| 目标 | 说明 |
|------|------|
| **G1** | 模型写一张表前，能用一次工具调用拿到该表完整契约（列 / dataType / required / enumOptions / referenceLibraries / valueFormat / 主标签列 / 当前行数） |
| **G2** | 写入校验为 Strict：缺必填 / enum 非法 / 引用非法 → 结构化错误，包含"缺哪些 + 每个字段合法格式" |
| **G3** | 校验失败的错误信息可被模型直接消费并在下一轮自我纠正（self-correction loop），无需用户介入 |
| **G4** | `setup_library` 成功后，结果里附带该表"填一行的范例 propertyValues"，减少"建完就忘" |
| **G5** | 现有事后护栏（empty/enum/array/name）整合进统一校验层，行为不回退 |
| **G6** | Phase 2 提供从结构上防错的路径（动态 schema / 原子工具），但与 Phase 1 解耦、可独立评估 |

### 1.5 Non-Goals

- 不替模型决定"该建哪些表、填什么业务内容"——业务推理仍由 LLM 完成（这正是"自己想"的部分，不写死）。
- Phase 1 不改 `create_asset` / `update_asset` / `update_row` 的对外参数签名。
- 不引入新的 LLM provider 或微调（属于另一条优化线）。
- 不做数据回滚 / 版本化（见 auto-execute spec 的 F5 心智）。

---

## 2. Core Idea — Contract Before Write

```
现状（盲写）:
  LLM ──记忆里的字段?── create_asset({任意字段: 任意值}) ──→ 静默成功/事后兜底

目标（契约驱动 + 自纠错）:
  LLM ──get_library_schema──→ 拿到该表完整契约
      ──create_asset(按契约填)──→ schema 校验
          ├─ 通过 → 写入
          └─ 不通过 → 结构化错误(缺X必填/enum非法/格式错 + 各字段合法格式)
                     ──→ LLM 下一轮自我纠正 ──→ 再写
```

关键转变：**让"表结构"在对话里随时可查、写入时强制对齐**，模型的"想"聚焦在业务内容，而"格式 / 契约"由系统保证可见、可纠正。

---

## 3. Phase 1 — Incremental (Short-Term)

### 3.1 T1：新增 `get_library_schema` 读工具

**目的**：给模型一个"这张具体表的契约"入口，弥补 `list_field_types`（全局）与 `query_assets`（数据，仅返回 `columns` 名称）之间的空白。

**位置**：`src/lib/agent/workflows/get-library-schema.ts`（read 工具，免确认，参照 `list-field-types.ts` 结构）。

**参数**：

```typescript
{
  libraryName?: string; // 省略则用 ctx.currentLibraryName
}
```

**返回**（基于现有 `getLibraryProperties` + `FIELD_TYPE_CATALOG`）：

```typescript
{
  libraryId: string;
  libraryName: string;
  rowCount: number;            // 当前非空行数（提示 create_asset 会复用空行）
  primaryLabelField: string;   // findPrimaryLabelField 结果（名称/规则名称/...）
  fields: Array<{
    label: string;             // 语义字段名（写 propertyValues 用这个 key）
    dataType: FieldDataType;
    required: boolean;
    valueFormat: string;       // 来自 FIELD_TYPE_CATALOG[dataType].valueFormat
    enumOptions?: string[];    // enum 列：合法值（模型必须从中选）
    referenceLibraries?: string[]; // reference 列：可引用的目标表
    isMedia?: boolean;         // 媒体列：建议留空待用户上传
  }>;
  writeExample: Record<string, unknown>; // 用真实字段拼的"填一行范例 propertyValues"
}
```

**说明**：
- `required` 需从 `library_field_definitions.required` 读出——`getLibraryProperties` 现未透出该字段，需在 `FieldDefinitionRow` / `PropertyConfig` 上补 `required`（见 §6）。
- `writeExample` 由各字段 `dataType` 的 `example` 推导，给模型一个"长这样"的锚点，降低 `{}` / 嵌套数组概率。
- 注册进 `src/lib/agent/tools/index.ts` 的工具表。

### 3.2 T2：统一 Schema 校验层（Strict）

把现有分散在 `field-resolver.ts` / `property-value-validation.ts` 的检查收敛为一个入口，并**新增 required 校验**与**结构化错误**。

**位置**：扩展 `src/lib/agent/property-value-validation.ts` 的 `prepareAgentPropertyValues`：

```typescript
// 现有
export function prepareAgentPropertyValues(
  resolved: Record<string, unknown>,
  properties: PropertyConfig[],
  options?: { assetName?: string }
): { values: Record<string, unknown> } | { error: string }
```

**升级为**（管线顺序固定）：

1. `mergeAssetNameIntoPropertyValues`（已有）— name → 主标签列
2. `flattenArrayValuesInMap`（已有）— 拆 `[[...]]`
3. `normalizeLlmPropertyValues`（已在 resolver 入口）— 拆 `{item}`
4. **`validateRequiredPropertyValues`（新增）** — 缺必填 → 结构化错误
5. `validateEnumPropertyValues`（已有）— enum 非法 → 结构化错误
6. （reference 由现有 `validateReferencePropertyValues` 负责，保持）

**Strict 规则**：
- **create_asset**：必填列缺失即报错（创建必须满足 required）。
- **update_asset / update_row**：只校验"本次提交的字段"里的 enum/格式；**不**强制补齐未提交的必填（局部更新允许只改一列）。required 校验仅在 create 路径开启。
- enum 非法、reference 非法：create / update 均报错。

> 取舍：update 路径不强制 required，避免"改一个字段却被要求填满整行"的反直觉行为；create 路径强制 required，保证新行不残缺。

### 3.3 T3：结构化纠错信息（Self-Correction Loop）

校验失败时返回的 `error` 必须**可机读、信息自足**，让模型一轮就能纠正。统一格式：

```
WRITE_VALIDATION_FAILED: <一句话原因>.
Missing required: 规则名称, 折扣力度.
Invalid enum: 货币类型="充值货币" (allowed: 免费货币, 半免费货币, 付费货币, 玩法积分).
Field formats: 规则名称=string; 折扣力度=number; 适用专区=reference([{assetId,fieldId}] from query_assets).
Re-issue the call with corrected propertyValues.
```

要点：
- 一次列全所有问题（不要只报第一个），减少往返轮数。
- 附"该表字段格式速查"，等价于把 §3.1 的契约摘要内联进错误，模型不必再调 `get_library_schema`。
- 这条信息进入 tool result，按现有 ReAct loop 回喂给 LLM（`core.ts` 已有把 `{ success:false, error }` 作为 tool 消息回喂的机制）。

### 3.4 T4：`setup_library` 回传"填表备忘"

`setup_library` 成功后，在其 tool result 的 `data` 里追加 `writeGuide`：该表字段契约 + `writeExample`（同 §3.1）。这样模型**建完表的同一上下文里**立刻拿到"怎么填"，无需额外 `get_library_schema`，直接缓解"建完就忘 → 发空 `{}`"。

**位置**：`src/lib/agent/workflows/setup-library.ts` 的 `executeImport` 返回值。

### 3.5 T5：Prompt 收敛

`src/lib/agent/prompts.ts`：

- 新增规则：**"填某张表数据前，若该表不是刚由 setup_library 创建，先调 get_library_schema 获取列 / 必填 / enum 合法值，再写。"**
- 强化：enum 值必须精确取自 enumOptions；create 必须满足必填列；`name` 会自动同步主标签列。
- 继续清理任何会诱导空 `{}` 的冗长 `propertyValues = {...}` JSON 范例（延续本周已做的收敛）。

### 3.6 Phase 1 受影响文件

| 文件 | 改动 |
|------|------|
| `src/lib/agent/workflows/get-library-schema.ts` | **新增** read 工具 |
| `src/lib/agent/tools/index.ts` | 注册新工具 |
| `src/lib/agent/data-access.ts` | `PropertyConfig` / `FieldDefinitionRow` 透出 `required` |
| `src/lib/types/libraryAssets.ts` | `PropertyConfig` 增 `required?: boolean` |
| `src/lib/agent/property-value-validation.ts` | 新增 `validateRequiredPropertyValues` + 结构化错误；扩展 `prepareAgentPropertyValues` |
| `src/lib/agent/tools/create-asset.ts` | 走统一校验（create：required 开启） |
| `src/lib/agent/tools/update-asset.ts` | 走统一校验（update：required 关闭） |
| `src/lib/agent/workflows/update-row.ts` | 同上 |
| `src/lib/agent/workflows/setup-library.ts` | 结果附 `writeGuide` |
| `src/lib/agent/prompts.ts` | 新增/收敛规则 |

---

## 4. Phase 2 — Structural (Long-Term)

目标：**从工具结构上消除"模型能填错"的空间**，而非靠校验回弹。两条可选路径（可二选一或组合）：

### 4.1 Option A：动态 Schema 注入（推荐长期）

按当前活动库，在每次请求时**动态生成写入工具的 JSON Schema**——把 `propertyValues` 从自由 object 变为精确列出该表字段的 object，enum 列用 JSON Schema `enum` 约束，必填列进 `required`。

```
getToolsForLlm() 现状：静态全局工具表
        ↓ 改造
getToolsForLlm(ctx): 当 ctx.currentLibraryId 存在时，
  create_asset.parameters.properties.propertyValues =
    { type:'object',
      properties: { "货币类型": {enum:[...]}, "名称": {type:'string'}, ... },
      required: [必填列] }
```

**收益**：兼容 OpenAI/MiniMax 的 function-call 约束机制，理论上让模型在生成阶段就难产出非法 enum / 漏必填。
**成本**：`getToolsForLlm` 需要 ctx 与一次 schema 查询；多库操作时只能注入"当前活动库"，跨库写仍需回退到 Phase 1 校验。
**关联**：`src/lib/agent/tools/index.ts`、`core.ts`（`streamLlm(..., { tools: getToolsForLlm(ctx) })`）。

### 4.2 Option B：分步原子写入工具

新增更原子的工具，降低单次 tool call 的 JSON 复杂度：

- `create_row({ libraryName, name })` — 只建行 + 主标签列。
- `set_cell({ libraryName, rowIndex, field, value })` — 一次写一格，参数极简，模型几乎无法发"空对象"。
- 保留 `create_asset` / `update_row` 的批量 `propertyValues` 作为"快捷路径"。

**收益**：结构最简单、最难出错，调试友好。
**成本**：批量填充时 tool call 次数显著增加（N 行 × M 列），与 auto-execute spec 的"单 SSE 多 tool"配合尚可，但 token / 延迟上升。

### 4.3 Phase 2 取舍建议

| 维度 | Option A 动态 schema | Option B 原子工具 |
|------|---------------------|-------------------|
| 防错力度 | 高（生成阶段约束） | 高（结构极简） |
| 改造面 | 中（工具生成 + core 传 ctx） | 中（新工具 + prompt 引导） |
| 批量效率 | 高（仍一次写整行） | 低（格数 = call 数） |
| 跨库场景 | 退化为 Phase 1 校验 | 天然支持 |
| 推荐 | **主选**（批量友好） | 备选 / 复杂表补充 |

> 建议：Phase 2 先做 Option A；若动态 schema 在 MiniMax 上约束力不足，再用 Option B 兜复杂表。

---

## 5. Data Structures

### 5.1 `PropertyConfig` 增字段（`src/lib/types/libraryAssets.ts`）

```typescript
export type PropertyConfig = {
  // ...现有字段
  required?: boolean; // 新增：来自 library_field_definitions.required
};
```

### 5.2 校验结果（`property-value-validation.ts`）

```typescript
type PrepareResult =
  | { values: Record<string, unknown> }
  | { error: string }; // 结构化 WRITE_VALIDATION_FAILED 文本（§3.3）

interface ValidationContext {
  requireAllRequired: boolean; // create=true, update=false
}
```

---

## 6. Error Feedback Contract (§3.3 normative)

校验错误文本是模型自纠错的唯一依据，约束如下：

- 必须以 `WRITE_VALIDATION_FAILED:` 前缀开头（便于模型/日志识别）。
- 必须聚合**所有**问题，分段：`Missing required`、`Invalid enum`、`Invalid format`。
- enum 错误必须带 `allowed: ...` 完整合法值。
- 末尾必须给行动指令 `Re-issue the call with corrected propertyValues.`
- 文本为英文（与现有 tool error 一致；面向 LLM，非终端用户）。

---

## 7. Testing

### 7.1 Unit (`tests/unit/agent/`)

| 用例 | 期望 |
|------|------|
| `get_library_schema` 返回字段含 enumOptions / required / referenceLibraries | 契约完整 |
| `get_library_schema` `writeExample` 用真实字段拼出 | 非空、键为字段 label |
| `validateRequiredPropertyValues` create 缺必填 | 返回结构化错误，列出缺失字段 |
| update 缺必填（未提交该列） | **不**报 required 错（局部更新允许） |
| enum 非法 | 报错且含 allowed 列表 |
| 错误文本格式符合 §6 契约 | 前缀 + 分段 + 行动指令 |
| `setup_library` 结果含 `writeGuide` | 字段契约 + writeExample |
| 既有护栏（empty/array/name）整合后行为不回退 | 现有测试全绿 |

### 7.2 复现回归

用 §1.1 的真实失败场景（货币表 enum 自造值、折扣规则主标签空）构造离线 fixture，断言新校验链能拦截并给出可纠正错误。

### 7.3 Manual / E2E

- 上传策划文档 → Agent 建表 → 填数据：抽查 enum 列、主标签列、引用列是否完整、合法。
- 故意让模型写非法 enum：确认它在下一轮根据错误自纠并写对（self-correction loop 生效）。

---

## 8. Implementation Plan

### Phase 1（短期止血，按依赖排序）

1. `PropertyConfig.required` 透出（types + data-access）。
2. `get_library_schema` 工具 + 注册 + 单测。
3. `validateRequiredPropertyValues` + 结构化错误 + 扩展 `prepareAgentPropertyValues`（create/update 区分）。
4. 三个写工具接入统一校验层。
5. `setup_library` 回传 `writeGuide`。
6. `prompts.ts` 收敛 + 新规则。
7. 单测 + 真实场景回归。

### Phase 2（长期，独立评估）

1. `getToolsForLlm(ctx)` 动态 schema（Option A）原型 + MiniMax 约束力验证。
2. 视效果决定是否引入 `create_row` / `set_cell`（Option B）。

---

## 9. Open Questions

| # | 问题 | 暂定 |
|---|------|------|
| Q1 | update 路径是否也强制 required？ | **No**：仅 create 强制；update 允许局部 |
| Q2 | `get_library_schema` 是否合并进 `query_assets`（加 `schemaOnly` 参数）而非独立工具？ | 倾向独立工具（语义清晰、read 免确认）；可在评审定 |
| Q3 | Phase 2 动态 schema 在 MiniMax-M3 上的 `enum` 约束是否真生效？ | 需原型验证；不达标则退 Option B |
| Q4 | 跨库批量写时 schema 注入只能覆盖活动库，是否够用？ | Phase 1 校验兜底，可接受 |
| Q5 | 错误文本英文 vs 中文？ | 英文（面向 LLM，与现有 tool error 一致） |

---

## 10. Success Criteria

- [ ] 模型可用 `get_library_schema` 一次拿到任意表的完整契约（列/必填/enum/引用/格式）。
- [ ] create 缺必填 / enum 非法 → 结构化错误（非静默成功），且模型能据此在下一轮自纠正。
- [ ] §1.1 的三类历史失败（空 `{}`、enum 自造、主标签空）在新链路下被拦截或自动补全。
- [ ] `setup_library` 后模型无需"猜"即可正确填首行数据。
- [ ] 现有单测与护栏行为不回退；新增校验有单测覆盖。
- [ ] Phase 2 路径有原型结论（动态 schema 是否足够），形成是否落地的决策记录。
