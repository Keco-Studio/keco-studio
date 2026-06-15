# Design Document → Agent Auto Config Tables

**Date**: 2026-06-15
**Status**: Approved
**Scope**: keco-studio 用户上传设计方案文档，Agent 自主推理并创建表格+填充数据

---

## 1. Overview

用户在 keco-studio 中上传一份设计方案文档（世界观、角色设定、战斗系统等），Agent 分析文档内容后自主推理出需要哪些表格（library）、规划字段（field）、提取实体数据并填充到表格中。

**核心效果**：用户上传一段世界观描述（如"在一个架空的幻想大陆上，有三大势力..."），Agent 分析后自动创建"角色""势力""地点"等表格，规划字段，并从文档中提取提到的实体填入数据行。

**支持格式**：`.txt` `.md` `.docx`（旧版 `.doc` 不支持）
**文档大小**：先支持中小文档（<50 页，建议 <10MB）

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  keco-studio UI                                                  │
│                                                                  │
│  ┌─────────────────────┐     ┌──────────────────────────────┐   │
│  │  上传页面（新增）     │     │  聊天页（已有）               │   │
│  │  /project/[id]/     │     │  /project/[id]/               │   │
│  │  design-upload      │     │  chat                         │   │
│  │                     │     │                               │   │
│  │  1. 选择文件         │     │  3. 接收解析后的文本消息       │   │
│  │  2. 可选填指令说明   │     │  4. Agent 自主推理配表        │   │
│  │  3. 点击"开始配表"  │────→│  5. setup_library 建表        │   │
│  │  4. 前端解析文档     │     │  6. create_asset 填数据       │   │
│  │  5. 跳转聊天页       │     │  7. 确认 → 执行               │   │
│  └─────────────────────┘     └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │ /api/agent-chat     │  (已有)
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Agent Core         │  (已有)
                          │  LLM + ReAct loop   │
                          │  tools: setup_library│
                          │  create_asset, etc. │
                          └─────────────────────┘
```

### 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 文档解析位置 | 前端（JS） | 减少服务端复杂度，JS 库已成熟 |
| Agent tool/skill | 复用现有 | setup_library 等已能完成建表+填充 |
| 消息传递 | sessionStorage | 文档文本可能很长，URL 有长度限制 |
| 图片处理 | 忽略 | MiniMax M2.7 不支持原生图片输入 |

### 数据流

1. 用户在上传页选择文件 + 可选填指令
2. 前端 JS 解析文档为纯文本（mammoth.js 处理 docx，直接读取 text/md）
3. 拼接消息：系统指令 + 附加指令 + 文档全文
4. 写入 sessionStorage，跳转到聊天页
5. 聊天页检测 pending message，自动发送给 Agent
6. Agent 根据系统提示词理解这是"设计方案配表"请求
7. Agent 调用 `setup_library` 创建表格，`create_asset`/`update_row` 填充数据
8. 复用现有 confirmation 机制让用户确认

---

## 3. Frontend — 上传页面

### 页面路径

`/project/[projectId]/design-upload`

### 页面布局

- 标题和说明文字
- 文件上传区域（拖拽/点击）
- 附加指令 textarea（可选）
- 图片处理提示信息
- "开始配表" 按钮

### 组件

| 组件 | 职责 |
|------|------|
| `DesignUploadPage` | 页面组件 |
| `DocumentDropZone` | 拖拽/点击上传区域（基于 antd Upload） |

### 文档解析逻辑

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
      throw new Error('不支持旧版 .doc 格式，请转换为 .docx 或 .txt');

    default:
      throw new Error(`不支持的文件格式: .${ext}`);
  }
}
```

### 消息拼接模板

```typescript
function buildDesignMessage(params: {
  fileName: string;
  documentText: string;
  additionalInstructions?: string;
}): string {
  const parts: string[] = [];

  parts.push(`[系统指令]`);
  parts.push(`用户上传了一份设计文档「${params.fileName}」，请分析文档内容，自主推理出需要创建哪些表格（library），规划每个表格的字段（field），并从文档中提取相关实体数据填充到表格中。`);

  if (params.additionalInstructions?.trim()) {
    parts.push(`用户的额外要求：${params.additionalInstructions.trim()}`);
  }

  parts.push(``);
  parts.push(`[文档内容]`);
  parts.push(params.documentText);

  return parts.join('\n');
}
```

### sessionStorage 传递

```typescript
// 写入（上传页）
const key = `design-upload:${projectId}:pending-message`;
sessionStorage.setItem(key, JSON.stringify({
  message: string;        // 拼接好的完整消息
  fileName: string;       // 原始文件名
  timestamp: number;      // 时间戳
}));

// 读取（聊天页 ChatPanel 挂载时）
const pending = sessionStorage.getItem(key);
if (pending) {
  // 自动发送消息，清除 sessionStorage
  sessionStorage.removeItem(key);
}
```

### 文件校验

| 校验项 | 规则 | 处理 |
|--------|------|------|
| 文件格式 | `.txt` `.md` `.docx` | 拒绝其他格式 |
| 文件大小 | ≤ 10MB | 拒绝过大文件 |
| .doc 格式 | 不支持 | 提示转换 |
| 空文件 | 内容为空 | 拒绝 |
| 超长文本 | > 100KB | 警告但仍允许 |

---

## 4. Agent Prompt 增强

### 系统提示词新增规则

在 `prompts.ts` 的 `buildSystemPrompt` 中追加：

```
27. When the user uploads a design document and asks to "配表" or "create tables from design":
    - Analyze the document content thoroughly
    - Infer what tables (libraries) are needed based on the content (e.g., characters, locations, items, factions, skills)
    - For each table, design appropriate fields (columns) with correct data types
    - Extract entities from the document and fill data rows
    - Use setup_library to create each table with all fields
    - Use update_row / create_asset to fill initial data
    - Present a summary of all planned tables before executing
    - If the document is in Chinese, all table names, field names, and data should be in Chinese
```

### Agent 处理流程

1. 收到消息，理解"设计方案配表"请求
2. 分析文档，推理出需要的表格列表
3. 先输出表格规划摘要（让用户了解即将创建什么）
4. 对每个表格：调用 `setup_library`（`post_preview` 确认 → 用户确认 → `executeImport` 创建）
5. 对每个表格的数据：调用 `update_row` 或 `create_asset` 填充（`pre_execute` 确认）
6. 所有操作完成后，输出总结

---

## 5. 依赖

| 依赖 | 用途 | 安装 |
|------|------|------|
| `mammoth` | docx 文本提取 | `npm install mammoth` |

---

## 6. 边界情况与错误处理

| 场景 | 处理方式 |
|------|---------|
| 文件 >10MB | 上传页拒绝，提示"文件过大" |
| 非支持格式 | 上传页拒绝，提示"仅支持 .txt .md .docx" |
| .doc 格式 | 上传页提示"不支持旧版 .doc，请转换为 .docx 或 .txt" |
| 空文件 | 上传页提示"文件内容为空" |
| docx 解析失败 | 上传页提示"文件解析失败，请检查文件格式" |
| 超长文本（>100KB） | 上传页显示警告"文档较长，Agent 处理可能需要较长时间"，允许继续 |
| 网络断开 | 聊天页 SSE 连接失败，显示重试按钮 |
| Agent tool call 失败 | 聊天中展示错误，Agent 给出建议 |
| 用户在 Agent 处理中刷新页面 | 聊天页恢复上次对话（已有机制） |
| 图片 | 忽略，UI 上提示用户"文档中的图片不会被处理" |

---

## 7. 安全考虑

- 前端解析，文档不上传到服务器 → 无服务端存储安全问题
- sessionStorage 中的文本在同源策略保护下
- 文件大小限制在前端校验
- Agent tool call 受权限控制（`requiredPermission: 'editor'`）

---

## 8. 测试策略

| 测试类型 | 覆盖范围 | 工具 |
|---------|---------|------|
| 单元测试 | `parseDocument` 函数（text/md/docx → 纯文本） | Jest |
| 单元测试 | `buildDesignMessage` 消息拼接函数 | Jest |
| E2E 测试 | 上传页 → 解析 → 跳转聊天 → Agent 处理全流程 | Playwright |
| 手动测试 | 不同类型的真实设计文档 | — |

---

## 9. 未来增强

- 支持更多文档格式（PDF, Notion 导出等）
- 大文档分块处理（>50 页）
- 多模态 LLM 支持（图片理解）
- 配表模板预设（常见游戏类型快速配表）
