# Design Document → Tables, as a Field-Type-Aware Skill

**Date**: 2026-06-15
**Status**: Draft (待审阅)
**Supersedes (partially)**: `2026-06-15-design-document-to-tables-design.md` 的第 4 节（Agent Prompt 增强）
**Scope**: 让"上传设计文档自动配表"的 Agent 真正了解 keco-studio 的字段属性体系，并把这套能力封装成一个可复用的 skill

---

## 1. 背景与问题

上一版已实现完整链路：上传页 → 前端解析（mammoth）→ sessionStorage 交接 → ChatPanel 自动发送一条"带文档全文"的 user 消息 → Agent 调 `setup_library` / `update_row` 配表。

**实测问题**：Agent **不清楚 keco-studio 支持哪些字段属性（dataType）以及每种属性的使用约束**。它在设计字段时容易：

- 猜测不存在的类型（例如 `text` / `number` 虽有别名能兜底，但 `link`、`color`、`json` 等会直接失败）
- 不知道 `enum` 必须配 `enumOptions`、`reference` 必须配 `referenceLibraries`、`formula` 必须配 `formulaExpression`
- 不知道数组类型（`*_array`）、`multimedia` / `audio` 的存在与适用场景
- 不知道引用字段（`reference`）能把表与表关联起来，从而把本应是"引用"的关系拍平成字符串

根因：字段类型知识只零散存在于 `setup_library` / `add_field` 的 `dataType` 参数描述里（一行逗号分隔的名字，无语义、无约束、无示例），Agent 在"从零设计一整套表"时缺少权威、结构化的能力清单。

---

## 2. 目标

1. **单一事实来源**：把 keco-studio 全部字段类型（名称、语义、数据写入格式、配置项要求、示例、适用场景）集中到一个 catalog 模块。
2. **让 Agent 主动获取能力清单**：新增一个 read 类 skill `list_field_types`，Agent 在配表前调用即可拿到完整目录（执行即返回，无需确认）。
3. **把"从文档配表"固化为有纪律的流程**：强化提示词规则，要求 Agent 先 `list_project_structure` + `list_field_types`，再设计字段、给摘要、建表填数。
4. **不破坏现有功能**：`setup_library` / `add_field` / `update_row` 接口不变，只让它们的 dataType 描述与 catalog 对齐。

### 非目标

- 不把"文档推理→建表"做成代码编排的确定性工具（这一步本质是 LLM 推理，无法去 LLM 化）。
- 不改文档解析、上传页、sessionStorage 交接（已实现且工作正常）。
- 不新增数据库迁移、不改字段类型本身。

---

## 3. 关于 "skill" 的定义对齐

keco-studio 在代码中已有 "skill" 概念：`src/lib/agent/workflows/index.ts` 的注释为 *"Skill registry"*，现有 skill 为 `setup_library`、`update_row`、`set_reference`，它们都是注册进 `allTools` 的 `AgentTool`。

因此本 spec 的 "skill" = **注册到 `workflows/` 的 `AgentTool`**，与现有体系一致。

> 设计取舍：现有 skill 多为 `post_preview`（execute 出预览 → 确认 → executeImport 写库）。本次的 `list_field_types` 是**只读知识型 skill**，用 `category: 'read'`，按 Agent Core 现有逻辑会"立即执行、无需确认、结果回灌给 LLM"（见 `core.ts` 的 `needsConfirmation`：read 工具永远直接执行）。这是把"能力知识"喂给 Agent 的最干净方式。

---

## 4. 架构

```
┌────────────────────────────────────────────────────────────┐
│ field-type-catalog.ts  (单一事实来源 / SSOT)                  │
│  - 每种 dataType: 名称 + 别名 + 语义 + 数据格式 + 配置项 +      │
│    示例 + 适用场景                                            │
└───────────────┬───────────────────────┬────────────────────┘
                │                        │
    derive      │                        │  consume
 ┌──────────────▼─────────┐   ┌──────────▼───────────────────┐
 │ field-data-type.ts     │   │ list_field_types (read skill) │
 │  normalizeFieldDataType│   │  execute() → 返回完整 catalog  │
 │  SUPPORTED_FIELD_...   │   └──────────┬───────────────────┘
 └────────────────────────┘              │ in-context 知识
                                          ▼
                              ┌───────────────────────────┐
                              │ Agent (ReAct loop)        │
                              │ 1 list_project_structure  │
                              │ 2 list_field_types        │
                              │ 3 设计字段(仅用合法类型)   │
                              │ 4 输出表格规划摘要         │
                              │ 5 setup_library (建表)     │
                              │ 6 update_row/create_asset  │
                              └───────────────────────────┘
        ▲
        │ dataType 参数描述与 catalog 对齐
 ┌──────┴───────────────────────────┐
 │ setup_library / add_field         │
 └───────────────────────────────────┘
```

---

## 5. 字段类型目录（SSOT）

### 5.1 新文件 `src/lib/agent/field-type-catalog.ts`

定义一份结构化目录，作为类型系统的唯一来源。结构示意：

```typescript
export interface FieldTypeSpec {
  /** Canonical dataType used by PropertyConfig. */
  dataType: PropertyConfig['dataType'];
  /** Human label shown to the agent. */
  title: string;
  /** What this type is for. */
  description: string;
  /** How a cell value must be written via create_asset / update_row. */
  valueFormat: string;
  /** Extra config keys required by this type (for setup_library / add_field). */
  requiredConfig?: ('enumOptions' | 'referenceLibraries' | 'formulaExpression')[];
  /** Media types: agent may create the column but must leave cells empty. */
  isMedia?: boolean;
  /** When the agent should pick this type. */
  whenToUse: string;
  /** A short concrete example. */
  example: string;
  /** Accepted aliases (incl. Chinese) that normalize to this type. */
  aliases?: string[];
}

export const FIELD_TYPE_CATALOG: FieldTypeSpec[] = [ /* ...15 entries... */ ];
```

### 5.2 目录内容（15 种规范类型）

`isMedia` 标记的类型在"文档配表"场景下**只建空列、不填数据**（Agent 无法上传文件，文档内图片被忽略）。

| dataType | 语义 | 数据写入格式 | 必需配置 | isMedia | 何时使用 |
|----------|------|--------------|----------|:---:|----------|
| `string` | 文本 | 字符串 | — | | 名称、描述等任意文本 |
| `string_array` | 文本数组 | 字符串数组 | — | | 标签、别名列表 |
| `int` | 整数 | 整数 | — | | 数量、等级、ID 类数字 |
| `int_array` | 整数数组 | 整数数组 | — | | 多个整数（如多段数值） |
| `float` | 浮点数 | 数字 | — | | 价格、概率、系数 |
| `float_array` | 浮点数组 | 数字数组 | — | | 多个小数 |
| `boolean` | 布尔 | true/false | — | | 是否启用、开关 |
| `enum` | 枚举 | 取自 enumOptions 的字符串 | `enumOptions` | | 固定可选项（类型、稀有度） |
| `date` | 日期 | 日期字符串 | — | | 时间、版本日期 |
| `reference` | 引用其他表 | 引用目标（assetId+fieldId） | `referenceLibraries` | | 表与表关联（角色→势力） |
| `formula` | 公式 | 由表达式计算 | `formulaExpression` | | 派生值（总价=单价×数量） |
| `image` | 图片 | 媒体资源（上传） | — | ✅ | 立绘、头像、图标 |
| `file` | 任意文件 | 媒体资源（上传） | — | ✅ | 附件、资源文件 |
| `multimedia` | 图片/视频 | 媒体资源（上传） | — | ✅ | 多媒体素材 |
| `audio` | 音频 | 媒体资源（上传） | — | ✅ | 配音、音效 |

> **媒体列设计原则**：`image`/`file`/`multimedia`/`audio` 是合法且应当存在的列类型——设计文档里出现"立绘""头像""图标"等概念时，Agent **应该创建对应的 `image` 列**（其它媒体同理）。只是这些列的**单元格数据**需要用户后续手动上传，Agent 在文档配表阶段**只建列、留空**，不得编造媒体值或文件路径。
>
> 实现说明：`field-data-type.ts` 的 `CANONICAL_DATA_TYPES` 当前未含 `image`/`file`，本次需将其补入（这两个值本就属于 `PropertyConfig.dataType`，且 predefine 手动建表 UI 的 `FIELD_TYPE_OPTIONS` 已提供 Image/File 选项，`MediaCell` 也已按 `'image' | 'file' | 'multimedia' | 'audio'` 渲染）。同时为其补充中文别名（如 图片/图像 → image，文件 → file）。

### 5.3 `field-data-type.ts` 重构

- `SUPPORTED_FIELD_DATA_TYPES` 改为从 `FIELD_TYPE_CATALOG` 派生（`catalog.map(c => c.dataType)`），消除两份清单漂移。
- 别名表（中文/英文）合并进 catalog 的 `aliases`，`normalizeFieldDataType` 从 catalog 构建别名映射。
- 行为保持不变（同样的输入→同样的规范类型），仅来源单一化。

---

## 6. 新 skill：`list_field_types`

### 6.1 文件 `src/lib/agent/workflows/list-field-types.ts`

```typescript
export const listFieldTypes: AgentTool = {
  name: 'list_field_types',
  description:
    'List all field (column) data types supported by keco-studio, including each ' +
    'type\'s meaning, how to write its cell value, required config (enumOptions / ' +
    'referenceLibraries / formulaExpression), and when to use it. Call this BEFORE ' +
    'designing tables/fields (e.g. when building tables from a design document) so ' +
    'you only use real, valid field types. No parameters.',
  category: 'read',
  confirmationMode: 'pre_execute', // read → 实际会立即执行、无需确认
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => ({
    success: true,
    displayHint: 'list',
    data: { fieldTypes: FIELD_TYPE_CATALOG },
  }),
};
```

### 6.2 注册

- `workflows/index.ts`：加入 `listFieldTypes` 到 `allSkills`。
- 无需改 `tools/index.ts`（它已 `...allSkills`）和 ReAct loop。

---

## 7. 现有工具描述对齐

把 `setup_library` 与 `add_field` 的 `dataType` 参数描述，从 catalog 生成一段**简明但完整**的字符串（含每种类型一句话语义 + 配置项提示），替换当前"逗号分隔类型名"的写法。例如：

```
Field data type. One of:
  string(text) | string_array | int | int_array | float | float_array |
  boolean | enum(needs enumOptions) | date |
  reference(needs referenceLibraries) | formula(needs formulaExpression) |
  multimedia(image/video) | audio.
Call list_field_types for full semantics and examples.
```

抽一个 helper（如 `buildDataTypeParamDescription()` 放在 catalog 模块）供两处复用，避免再次漂移。

---

## 8. 提示词规则更新（替换上一版第 28 条）

把现有第 28 条改写为强调"先取能力清单、只用合法类型"的版本：

```
28. DESIGN DOCUMENT -> TABLES: When the user uploads a design document
    (message starts with "[Design document]") and asks to build tables:
    - FIRST call list_project_structure (existing layout) AND list_field_types
      (supported field types + their config + how to write values).
    - Design fields using ONLY the dataTypes returned by list_field_types.
    - Use reference (with referenceLibraries) to link related tables instead of
      flattening relations into strings; use enum (with enumOptions) for fixed
      option sets; use formula (with formulaExpression) for derived values;
      use *_array for multi-valued cells.
    - For visual/asset concepts in the document (立绘/头像/图标/附件/配音 etc.),
      DO create the matching media column (image / file / multimedia / audio),
      but leave its cells EMPTY — the user uploads media later. Never invent
      media values, URLs, or file paths.
    - Present a concise summary of all planned tables and their fields BEFORE
      creating anything.
    - Create each table with setup_library, then fill non-media rows with
      update_row / create_asset.
    - Match the document language for all table/field/data names.
```

`buildDesignMessage`（上一版已存在）可加一句提示，引导 Agent 走该流程（可选，提示词规则已是主力）。

---

## 9. 涉及文件清单

| 文件 | 操作 |
|------|------|
| `src/lib/agent/field-type-catalog.ts` | 新增（SSOT + helper；含 image/file/multimedia/audio，标 isMedia） |
| `src/lib/agent/field-data-type.ts` | 重构为从 catalog 派生；`CANONICAL_DATA_TYPES` 补入 image/file + 中文别名 |
| `src/lib/agent/workflows/list-field-types.ts` | 新增 read skill |
| `src/lib/agent/workflows/index.ts` | 注册 `listFieldTypes` |
| `src/lib/agent/tools/add-field.ts` | dataType 描述对齐 catalog |
| `src/lib/agent/workflows/setup-library.ts` | dataType 描述对齐 catalog |
| `src/lib/agent/prompts.ts` | 第 28 条改写 |
| `src/lib/design-message.ts` | （可选）补一句流程引导 |
| `src/app/(dashboard)/[projectId]/[libraryId]/predefine/validation.ts` | 顺手修理：补全 dataType 枚举（见 §10） |

---

## 10. 顺手修理：predefine/validation.ts 类型枚举不全

现状：`fieldSchema.dataType` 的 zod 枚举只含 `string/int/float/boolean/enum/date/image/file/reference` 9 种，
漏掉 `multimedia/audio/int_array/float_array/string_array/formula`。

补充事实：`sectionSchema` / `fieldSchema` 当前在 `page.tsx`、`NewSectionForm.tsx` 中**仅被 import、从未调用**
（保存实际走 `saveSchemaIncremental`），因此这份校验运行时未生效——这正是类型不全未引发线上问题的原因。

修理方案：
- 把 `fieldSchema.dataType` 的枚举改为从单一来源 `SUPPORTED_FIELD_DATA_TYPES`（catalog 派生、含 image/file）构建，
  例如 `z.enum(SUPPORTED_FIELD_DATA_TYPES as [string, ...string[]])`，消除清单漂移。
- **不改动调用方式**（不新增 `.parse()` 调用），避免给 predefine 保存路径引入未经验证的拦截，控制回归面。
- 该 import 方向为 UI → `lib/agent/field-data-type`（纯领域工具、无 agent 运行时依赖），可接受。

测试：单元测试断言 `fieldSchema` 接受全部 `SUPPORTED_FIELD_DATA_TYPES`、拒绝未知类型。

---

## 11. 测试策略（TDD）

| 测试 | 覆盖 | 工具 |
|------|------|------|
| 单元 | `FIELD_TYPE_CATALOG` 覆盖且仅覆盖 `CANONICAL_DATA_TYPES`（含 image/file，无遗漏/多余） | Jest |
| 单元 | `normalizeFieldDataType` 重构后行为不变；新增 image/file + 别名（图片/图像/文件）解析正确 | Jest |
| 单元 | `setup_library` 能接受 image/file 作为合法 dataType（不再报 unsupported） | Jest |
| 单元 | `list_field_types.execute()` 返回全部类型，媒体类型带 isMedia 标记 | Jest |
| 单元 | `buildDataTypeParamDescription()` 含所有规范类型名 | Jest |
| 手动 | 用真实设计文档跑一遍，确认 Agent 先调 list_field_types 再合理选型（含 reference/enum） | — |

---

## 12. 风险与回归

- **低**：`field-data-type.ts` 重构需保证 `normalizeFieldDataType` / `SUPPORTED_FIELD_DATA_TYPES` 行为完全一致，用现有调用方（`setup_library`、`add_field`）的既有单测兜底。
- 新增 read skill 不触发确认、不写库，无副作用。
- 工具描述变更只影响传给 LLM 的 schema 文本，不改运行时校验逻辑。
- 提示词条数仍为 28（替换非新增），不影响其它规则编号。

---

## 13. 未来增强

- catalog 增加"每种类型在 create_asset/update_row 的取值示例 JSON"，进一步降低填数出错率。
- 让 `list_field_types` 可选返回"当前项目已存在库"以便 reference 选型（或继续由 `list_project_structure` 承担）。
- 配表模板预设（常见游戏类型）。
