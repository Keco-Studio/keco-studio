# Script 保存、复用与局部复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付项目内云端 Script 模板，以及同项目内完整/局部复制、独立创建和插入复用。

**Architecture:** 用可校验的版本化内容快照保存完整数据，以稳定内部 ID 表达内容及连接，FlowGraph 仍由内容派生。服务端生成快照并验证权限；扩展现有文档原子替换路径，在同一事务中保存 Script、源文档、lineage 与 plot plan。

**Tech Stack:** Next.js、React、TypeScript、Zod、Supabase/PostgreSQL、现有 Yjs 文档编解码、Jest、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-03-script-reuse-design.md`（用户已于 2026-11-03 确认）。

## Global Constraints

- 项目内云端模板，以及同项目内局部复制粘贴。
- 普通选中文字仍执行文本复制；结构化 Script 选择以完整对白块为单位。
- 文本与流程图完整双向编辑、镜头模板、场景动画属于后续阶段。
- 快照不得降级到旧三选项格式；不能用 FlowGraph 替代完整内容。
- 未知/不兼容列在预览中报错，不静默舍弃。
- 资源保留同项目引用，不复制二进制文件。
- 保留旧本地结构模板作为只读参考，明确标记“仅结构参考”。
- 写入失败全部回滚；重试不重复插入；协作冲突要求刷新预览。
- 本版不提供模板内容覆盖、版本历史、跨标签页结构化剪贴板或整批粘贴撤销。
- 不对生产数据库迁移或部署；仅本地验证。沿用产品现有英文 UI 文案风格。

## Review Focus

- 非连续选区不得因行拼接意外产生顺序连接：Task 1/2 用中间未选场景的案例验证。
- 同项目并不意味着所有嵌套资源都可读取：Task 3/4 验证删除资源及篡改资源归属。
- 请求已提交但响应丢失不能重复插入：Task 4 用相同 requestId 重试和变更负载验证。
- 旧模板和新版云端模板并存不能误导用户：Task 6 验证结构参考没有应用入口。
- 当前输入草稿、协作更新和重新生成可能覆盖副本：Task 4/6/7 验证保存失败中止、版本冲突、重开与重新生成。

## 文件与边界

新增纯数据模块置于 `src/lib/script-system/reuse/`；不要继续扩大 ScriptSplitView。新增持久化协调服务置于 `src/lib/server/scriptReuseService.ts`，HTTP 边界放在 `src/app/api/script-templates/` 和 `src/app/api/script-reuse/`。选择与模板 UI 分拆为小组件和 hook；现有对白组件仅增加必要的选择属性。

数据库使用新迁移，不修改历史迁移。对文档状态网关和转换入口的扩展保持向后兼容。已有 `replace_document_with_markdown_and_sync_origin_script` 的版本、锁和权限模式是实现参考，不直接用逐条 insert 模拟事务。

## Task 1: 快照、字段与选区契约

**Files**
- Create: `src/lib/script-system/reuse/schema.ts`
- Create: `src/lib/script-system/reuse/snapshot.ts`
- Test: `src/lib/script-system/reuse/snapshot.test.ts`
- Reference: `scriptDialogueBlocks.ts`, `buildScriptFlowGraph.ts`, `src/lib/story-ir/tableFormat.ts`

**Interfaces**
- `ScriptReuseSelection = {kind:'all'} | {kind:'rows';rowIds:string[]} | {kind:'nodes';nodeIds:string[]}`。
- `ScriptReuseSource`：projectId、libraryId、fingerprint、字段定义、完整有序行、对白块与验证后的节点分组。字段带 semanticKey、valueType 和 schema 配置；行值按 semanticKey 存储。
- `ScriptReuseSnapshot`：version=1、projectId、fields、rows（localId/values）、blocks（localId/rowIds）、nodes（localId/title/rowIds）、edges（fromRowId/toRowId 或 externalTarget，kind=sequence/jump/option，optionIndex）、entryRowIds、resourceRefs、variableNames、provenance。所有引用使用 localId，不用 rowIndex。
- `parseScriptReuseSnapshot(input:unknown): ScriptReuseSnapshot`。
- `captureScriptReuseSnapshot(source:ScriptReuseSource,selection:ScriptReuseSelection): ScriptReuseSnapshot`。
- 默认限制由本计划确定：1 MiB UTF-8 JSON、5,000 行、名称 1–80 个字符、描述最多 2,000 个字符；SQL、API、客户端使用同一限制。超限明确报错，不能截断内容。

- [ ] 写失败测试：all 捕获超过 3 个选项及 If/Commands/资源列；图选区与对应行选区语义等价；动作/对白自动扩展为完整块；非连续选择保留 external sequence 出口；非法 ID、重复 Label、缺失引用、超限与未来 version 拒绝。
- [ ] 运行 `npx jest --runInBand src/lib/script-system/reuse/snapshot.test.ts`，确认缺失实现导致失败。
- [ ] 实现严格 schema 和快照。读服务端权威行顺序，规范化完整块并去重，不修改源对象。明确识别所有动态 OptionN 三元组，不套用旧 ScriptLine。
- [ ] 重跑测试，要求全部通过；提交此任务的代码与测试。

## Task 2: 重映射与粘贴预览

**Files**
- Create: `src/lib/script-system/reuse/placement.ts`
- Create: `src/lib/script-system/reuse/materialize.ts`
- Test: `src/lib/script-system/reuse/materialize.test.ts`

**Interfaces**
- `ScriptReusePlacement`：entryRowId；mode='new'|'insert'|'disconnected'；insert 时指定 anchorRowId 与具体 outlet（sequence/jump/option+index）；exits 按快照出口 ID 映射为 `{kind:'target';rowId:string}` 或 `{kind:'end'}`。
- `ScriptReuseTarget`：projectId、libraryId、fingerprint、现有字段/行/连接与已占用标签。
- `ScriptReusePreview`：rowCount、nodeCount、requiredExits、variableNames、issues（code/message/blocking）、目标 fingerprint。
- `previewScriptReuse(snapshot:ScriptReuseSnapshot,target:ScriptReuseTarget|null,placement:Partial<ScriptReusePlacement>):ScriptReusePreview`。
- `materializeScriptReuse(snapshot:ScriptReuseSnapshot,target:ScriptReuseTarget|null,placement:ScriptReusePlacement,allocateId:()=>string):ScriptReuseMaterialization`。
- `ScriptReuseMaterialization`：新字段/行/块、旧到新 ID 与 Label 映射、明确控制流、更新后的 plot plan、目标锚点变更、sourceBlocks 与 createdRowIds。这里是内存数据，不执行数据库写入。

- [ ] 写失败测试：连续两次复制的标识独立；正文包含 `O1` 不被替换；第 4 个选项保留；未知命令保留但无法安全重写时阻止；每个外部出口必须处理；选项 End 保留按钮并连到新终止目标；非连续片段不串线；分支锚点只改接指定选项；不兼容字段报错。
- [ ] 运行 `npx jest --runInBand src/lib/script-system/reuse/materialize.test.ts`，确认失败。
- [ ] 实现字段匹配、控制流 token 级重写和稳定顺序。若断开隐式路径，在编译行中显式写入 Jump/End；独立片段不得被相邻物理行顺序执行。未选中的入边只作预览提示。
- [ ] 重跑 Task 1/2 测试，通过后提交。

## Task 3: 云端模板与权限接口

**Files**
- Create: `supabase/migrations/20261103090000_script_reuse_templates.sql`
- Create: `src/lib/server/scriptReuseSourceService.ts`
- Create: `src/lib/server/scriptTemplateService.ts`
- Create: `src/app/api/script-templates/[projectId]/route.ts`
- Create: `src/app/api/script-templates/[projectId]/[templateId]/route.ts`
- Create: `src/app/api/script-reuse/capture/route.ts`
- Test: `tests/unit/api/script-templates-route.test.ts`
- Test: `tests/unit/database/script-reuse-templates.test.ts`

**Interfaces**
- `readScriptReuseSource({supabase,actorUserId,projectId,libraryId,expectedFingerprint?}):Promise<ScriptReuseSource>`：一致读取字段、行、节点映射并签发 fingerprint；参考现有 origin fingerprint，扩展覆盖字段和 plot plan，锁策略与应用共用。
- GET `/api/script-templates/:projectId` 返回分页元信息；GET `/:templateId` 返回快照。
- POST 集合接收 `{name,description,libraryId,selection,expectedFingerprint,requestId}`，从服务器源生成快照。
- PATCH 单项接收 `{name,description,expectedUpdatedAt}`；DELETE 接收 expectedUpdatedAt。
- POST `/api/script-reuse/capture` 接收 `{projectId,libraryId,selection,expectedFingerprint}`，返回完整临时快照和来源 fingerprint。
- 模板表字段按 spec，source IDs 仅作说明，不设源库级联删除。list 不返回大快照；更新只允许名称/描述。

- [ ] 写失败 API/DB 测试：owner、accepted admin/editor 可写；viewer 只读；未接受邀请与非成员不可读；伪造 projectId/createdBy/来源 ID 被拒绝；原 Script 删除后模板可读；修改模板内容的 PATCH 被拒绝；超过 payload 限制报错。
- [ ] 运行对应 Jest 测试并记录失败；真实 DB 测试必须明确需要本地 Supabase，不能用跳过标记代替成功。
- [ ] 实现表、RLS、限额、索引及服务。错误统一为 400/403/404/409/413，鉴权不能信任客户端 actor。服务角色 RPC 只允许服务调用并重新验证真实 actor 的项目角色。
- [ ] 运行 API 测试与本地数据库门禁，验证通过后提交。

## Task 4: 原子应用、源文档与重新生成保真

**Files**
- Create: `supabase/migrations/20261103091000_atomic_script_reuse.sql`
- Create: `src/lib/server/scriptReuseService.ts`
- Create: `src/lib/script-system/reuse/sourceProjection.ts`
- Modify: `src/lib/server/documentAgentEditService.ts`
- Modify: `src/lib/services/scriptConversionService.ts`
- Modify: `src/lib/services/scriptImportService.ts`
- Create: `src/app/api/script-reuse/preview/route.ts`
- Create: `src/app/api/script-reuse/apply/route.ts`
- Test: `tests/unit/script-reuse-service.test.ts`
- Test: `tests/unit/database/script-reuse-apply.test.ts`
- Test: `src/lib/script-system/reuse/sourceProjection.test.ts`

**Interfaces**
- `ScriptReuseOrigin = {kind:'template';templateId:string;expectedUpdatedAt:string} | {kind:'clipboard';snapshot:ScriptReuseSnapshot}`。
- `prepareScriptReuse({supabase,actorUserId,projectId,origin,targetLibraryId?,placement}):Promise<{preview:ScriptReusePreview;previewToken:string}>`。
- `applyScriptReuse({supabase,actorUserId,projectId,previewToken,requestId}):Promise<{libraryId:string;documentId:string;createdRowIds:string[]}>`。
- POST preview 接收 origin、projectId、目标库或新建名称、placement。返回服务端验证后、与源/目标版本及 actor 绑定的短期签名 token。
- POST apply 只接收 projectId、previewToken、requestId；从服务端重读来源并重算 materialization，不信任预览中的写入数据。
- 新 RPC `apply_script_reuse`：服务角色调用，显式 actor，输入预期指纹/文档 token/update tail、新 Yjs/Markdown、materialization 与 requestId；验证后以单事务完成文档、字段、行、plot plan、lineage、工作区归属及请求结果。

- [ ] 写失败测试：来源模板删除/更新与权限变化、资源跨项目/删除、请求重放同 payload 返回同结果、同 requestId 不同 payload 拒绝；注入最后一步失败后所有写入回滚；目标字段或 Yjs update tail 变化返回 409；插入后重读/重新生成保留所有列、选项和边界。
- [ ] 运行上述三个测试文件，记录失败。
- [ ] 复用 `documentContentCodec` 和现有 `replace_document_with_markdown_and_sync_origin_script` 的权限、CAS、备份与广播路径，新增批量应用分支，避免用客户端多请求补偿事务。锁定项目/文档/库时统一排序，事务再次校验 fingerprint。
- [ ] 实现 `buildScriptReuseSourceProjection(materialization,currentDocument):{markdown,sourceBlocks,lineage}`：生成独立合法文档块并复用已有 block identity 机制。为新 Script 创建独立源文档和 workspace membership，保证 `/script-system/:projectId/script/:libraryId` 可打开。
- [ ] 在源块 identity 对应的服务端 metadata 中保存结构化复制内容及源文本摘要；转换入口先确定性读取这些受控块，未修改块直接重建完整数据，编辑过的块通过已有对白同步更新 metadata。普通文档继续原转换路径。禁止把自定义列/资源仅存为自然语言后交给 LLM 猜测还原，也不将旧源文档 ID 写入副本。元数据必须版本化并纳入原子事务及冲突检查。
- [ ] 协调其他同源派生表的更新，使用现有映射判定；映射歧义时返回 409 并保留原数据，不能只改 Script 而留下过时源文档。持久模板应用不校验原库是否存在；临时剪贴板应用校验来源仍可访问。
- [ ] 运行服务单元测试及真实数据库门禁，要求无跳过的权限/回滚/重放测试通过；提交。

## Task 5: 双视图选择与项目剪贴板

**Files**
- Create: `src/components/script-system/useScriptReuseSelection.ts`
- Create: `src/components/script-system/ScriptReuseClipboardProvider.tsx`
- Create: `src/components/script-system/ScriptSelectionToolbar.tsx`
- Modify: `src/components/script-system/ScriptShell.tsx`
- Modify: `src/components/script-system/FlowChartPanel.tsx`
- Modify: `src/components/libraries/components/VisualNovelScriptView.tsx`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Test: `src/components/script-system/ScriptReuseSelection.test.tsx`

**Interfaces**
- `useScriptReuseSelection({libraryId,rows,blocks,graph})` 返回 selection、toggleNode、toggleBlock、clear、selectedRowIds。选区独立于当前浏览节点；选择消失的行时自动清理。
- 剪贴板 Provider 挂在 ScriptShell，以 projectId 隔离内存内容，提供 copy(snapshot)、read(projectId)、clear；卸载/刷新清空，换项目不可粘贴旧项目内容。
- FlowChartPanel 可选增加 selectedNodeIds/onToggleNode；VisualNovelScriptView 可选增加 selectionMode/selectedBlockIds/onToggleBlock。旧调用不改变行为。

- [ ] 写失败组件测试：Ctrl/Cmd 点击可增减选中；查看节点不清空选区；动作和台词成组；离开再返回同项目其他 Script 仍可粘贴；切换项目不可粘贴；文本输入和普通浏览器复制不被拦截；键盘可操作块复选框。
- [ ] 运行 `npx jest --runInBand src/components/script-system/ScriptReuseSelection.test.tsx`，确认失败。
- [ ] 实现显式选择模式及“Copy selection / Save selection as template”，复制前 await 当前编辑草稿提交，再调用 capture。复制失败不覆盖已有剪贴板；旧结构参考模式禁用内容复制。
- [ ] 重跑选择、FlowChartPanel 和 ScriptSplitView 既有测试，通过后提交。

## Task 6: 模板管理与粘贴预览 UI

**Files**
- Create: `src/lib/script-system/reuse/client.ts`
- Create: `src/components/script-system/useScriptTemplates.ts`
- Create: `src/components/script-system/ScriptReusePreviewModal.tsx`
- Modify: `src/components/script-system/ScriptTemplateModal.tsx`
- Modify: `src/components/script-system/ScriptWorkspaceToolbar.tsx`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/script-system/ScriptTemplateModal.module.css`
- Test: `src/components/script-system/ScriptReuseUI.test.tsx`

**Interfaces**
- client 包装 Task 3/4 API，错误保持 code/status。React Query key 使用 `['script-templates',projectId]`，项目切换不显示旧项目数据。
- `ScriptReusePreviewModal` 接收 origin、projectId、targetLibraryId?、initialPlacement、onApplied(result)、onClose；使用 Task 4 的服务端预览结果。
- 模板库提供完整/片段标识，名称/说明/创建者/时间/统计，preview、rename、delete、create new、insert actions；旧 localStorage 模板单独列为 Structure reference，只允许参考和删除旧个人条目。

- [ ] 写失败测试：草稿提交失败不保存模板；未处理出口禁止应用；每条选项保留文本；共享变量提示；错误/冲突保留选区及剪贴板；只读角色看不到写操作；重复点击仅一次请求；失效资源阻止；新建后导航和插入后选中新增片段。
- [ ] 运行 `npx jest --runInBand src/components/script-system/ScriptReuseUI.test.tsx`，确认失败。
- [ ] 实现非阻塞加载、空态、预览与重试；执行时禁用提交按钮。删除通过确认框，取消不写入。网络超时重试保持原 requestId；刷新预览后生成新 requestId。
- [ ] 成功后失效 library/schema/assets/document state/workspace/template 对应缓存；新 Script 进入独立源文档的侧栏分组。插入后更新 plot plan，清理不能表示此次批量操作的旧逐块撤销状态。
- [ ] 运行 Task 5/6 组件测试及既有 ScriptWorkspaceChrome/ScriptSplitView 测试，通过后提交。

## Task 7: 完整流程验收与交付

**Files**
- Create: `tests/e2e/specs/script-reuse.spec.ts`
- Create: `tests/fixtures/script-reuse/branching-script.json`
- Update: 本实施计划执行状态及验收证据。

- [ ] 建立固定夹具：2 个角色、动作与对白配对、4 个选项、合流、数值命令、资源引用、非连续选区、外部出口。使用本地测试资源，避免真实生成服务付费调用。
- [ ] E2E 依次验证保存模板→刷新→另一成员查看→创建副本→编辑不影响源→图选局部复制→另一个 Script 插入→再次粘贴→选项试玩→重开→重新生成。另测 viewer 禁写和无权限项目不可访问。
- [ ] 在执行开始时读取 using-git-worktrees、executing-plans（或用户选择的 subagent-driven-development）、test-driven-development 技能；创建 `codex/keco-1173-script-reuse` 隔离分支，将已确认设计和计划带入。运行环境检查并安装锁文件依赖，不修改全局代理或重置现有数据库。
- [ ] 执行针对性 Jest、`npm run typecheck`、`npm run typecheck:api`、`npm run lint`；按仓库门禁执行 `npm run validate`（数据库与 bash 依赖在本地配置齐全后）及 `npx playwright test tests/e2e/specs/script-reuse.spec.ts`。记录真实结果，环境阻塞不算通过。
- [ ] 用浏览器检查真实编辑/预览/导航流程及窄屏布局；验证焦点、键盘选择和模态框交互。读取 verification-before-completion 和 requesting-code-review 技能，进行最终代码审阅、修复实质问题并重跑受影响检查。
- [ ] 提交任务相关代码，交付变更概览、测试证据与迁移说明；不修改 Jira 状态或发送评论，不自动推送/部署。

## 执行顺序与自审

依赖顺序：1 → 2 → 3 → 4 → 5 → 6 → 7。隔离分支和环境检查是执行前置步骤，Task 7 中列出是为了统一记录验收环境，不应等实现完成才创建。

规格覆盖：保存/权限→3；完整快照/动态字段→1；复制边界和重映射→2；原子应用/独立源文档/重新生成→4；图与块多选→5；模板管理/草稿/预览→6；整体试玩和跨成员验证→7。

本计划决定了保真所需的受控源块 metadata，因此 Task 4 是主要风险和工作量来源。任务完成前，不能用仅前端缓存、单纯复制 library 或 LLM 重生成替代其验收条件。
