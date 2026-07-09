# Keco Studio - 文件清理建议列表

**文档版本**: 1.0  
**创建日期**: 2026-01-30  
**状态**: 历史归档（已被 GitHub issues #177、#178、#180 的逐项核查和实现取代）  
**关联文档**: [架构文档](./ARCHITECTURE.md) | [优化建议](./OPTIMIZATION_RECOMMENDATIONS.md)

---

> **归档说明**: 本文档是 2026-01-30 的一次性架构审查产物，不再作为当前清理工作的执行清单。后续文件和依赖清理由 GitHub issues #177、#178、#180 的 spec 与 PR 记录作为权威来源。请不要按本文档直接删除文件。

## 📋 目录

1. [概述](#概述)
2. [分类说明](#分类说明)
3. [Safe to Remove (安全删除)](#safe-to-remove-安全删除)
4. [Needs Review (需要审查)](#needs-review-需要审查)
5. [Consider Refactoring (考虑重构)](#consider-refactoring-考虑重构)
6. [Consolidate (合并整理)](#consolidate-合并整理)
7. [总结与建议](#总结与建议)

---

## 概述

本文档列出了Keco Studio项目中建议清理、审查或重构的文件。所有建议基于代码分析和架构审查，但**在执行任何删除操作前，请务必进行充分测试**。

### 统计概览

| 分类 | 文件数量 | 预计减少代码行数 | 预计减少代码库大小 |
|------|---------|----------------|------------------|
| Safe to Remove | 3 | ~250行 | ~1% |
| Needs Review | 8 | ~500行 | ~2% |
| Consider Refactoring | 6 | N/A (重构) | N/A |
| Consolidate | 4组 | ~300行 | ~1% |
| **总计** | **21项** | **~1,050行** | **~4%** |

---

## 分类说明

### 🟢 Safe to Remove (安全删除)
- **定义**: 已确认未被使用的文件，删除不会影响功能
- **证据**: 无导入引用，或仅被测试/开发工具引用
- **风险**: 低
- **操作**: 可以直接删除（建议先提交到分支测试）

### 🟡 Needs Review (需要审查)
- **定义**: 可能未使用但需要进一步确认的文件
- **证据**: 导入引用较少，或可能有隐藏依赖
- **风险**: 中等
- **操作**: 审查后再决定是否删除

### 🔵 Consider Refactoring (考虑重构)
- **定义**: 功能重复、代码质量低或架构不合理的文件
- **证据**: 代码重复、过时模式、不符合当前架构
- **风险**: 低（重构而非删除）
- **操作**: 重构优化，保留核心功能

### 🟣 Consolidate (合并整理)
- **定义**: 可以合并到其他文件或统一管理的文件
- **证据**: 功能相似、职责重叠
- **风险**: 低
- **操作**: 合并到统一位置

---

## Safe to Remove (安全删除)

### SR-001: 开发测试页面 - Realtime测试页

**文件路径**: `src/app/realtime-test/page.tsx`

**文件大小**: 172行

**分类理由**:
- 这是一个开发调试用的测试页面
- 仅用于测试Supabase Realtime功能
- 不应出现在生产环境
- 未被任何业务逻辑引用

**证据**:
```typescript
// page.tsx 内容为Realtime订阅测试
export default function RealtimeTestPage() {
  // ... 测试代码
}
```

**导入引用**: 0 (仅路由访问)

**建议操作**:
1. 如需保留测试功能，移动到 `tests/` 目录
2. 或添加环境变量控制，仅在开发环境可访问
3. 生产环境直接删除

**删除命令**:
```bash
rm -rf src/app/realtime-test
```

**风险评估**: ✅ 低风险（开发工具）

---

### SR-002: 旧Context目录 - YjsContext.tsx

**文件路径**: `src/contexts/YjsContext.tsx`

**文件大小**: 约50-100行（估算）

**分类理由**:
- 目录结构已迁移到 `src/lib/contexts/`
- 只有1个文件的旧目录
- 仅被1个文件导入（`useYjsSync.ts`）
- 应该迁移到新的统一目录结构

**证据**:
```bash
# 搜索导入引用
$ grep -r "from '@/contexts/YjsContext'" src/
# 结果：仅 src/components/libraries/hooks/useYjsSync.ts
```

**导入引用**: 1个文件

**建议操作**:
1. 将 `src/contexts/YjsContext.tsx` 移动到 `src/lib/contexts/YjsContext.tsx`
2. 更新导入路径：
   ```typescript
   // 旧路径
   - import { YjsContext } from '@/contexts/YjsContext';
   // 新路径
   + import { YjsContext } from '@/lib/contexts/YjsContext';
   ```
3. 删除空的 `src/contexts/` 目录

**迁移命令**:
```bash
# 1. 移动文件
mv src/contexts/YjsContext.tsx src/lib/contexts/YjsContext.tsx

# 2. 更新导入（使用sed或手动）
sed -i "s|@/contexts/YjsContext|@/lib/contexts/YjsContext|g" src/components/libraries/hooks/useYjsSync.ts

# 3. 删除旧目录
rm -rf src/contexts
```

**风险评估**: ✅ 低风险（简单迁移）

---

### SR-003: 旧Hooks目录 - useYjsRows.ts

**文件路径**: `src/hooks/useYjsRows.ts`

**文件大小**: 约50-100行（估算）

**分类理由**:
- 目录结构已迁移到 `src/lib/hooks/`
- 只有1个文件的旧目录
- 仅被1个文件导入
- 应该迁移到新的统一目录结构

**证据**:
```bash
# 搜索导入引用
$ grep -r "useYjsRows" src/
# 结果：仅 src/components/libraries/hooks/useYjsSync.ts
```

**导入引用**: 1个文件

**建议操作**:
1. 将 `src/hooks/useYjsRows.ts` 移动到 `src/lib/hooks/useYjsRows.ts`
2. 更新导入路径
3. 删除空的 `src/hooks/` 目录

**迁移命令**:
```bash
# 1. 移动文件
mv src/hooks/useYjsRows.ts src/lib/hooks/useYjsRows.ts

# 2. 更新导入
sed -i "s|@/hooks/useYjsRows|@/lib/hooks/useYjsRows|g" src/components/libraries/hooks/useYjsSync.ts

# 3. 删除旧目录
rm -rf src/hooks
```

**风险评估**: ✅ 低风险（简单迁移）

---

## Needs Review (需要审查)

### NR-001: 资产详情路由目录（可能已废弃）

**文件路径**: `src/app/assets/` 目录

**文件大小**: 未知（需要检查内容）

**分类理由**:
- 存在 `src/app/assets/images/` 目录
- 但资产详情功能已经在 `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx` 实现
- 可能是旧的路由结构
- 需要确认是否还在使用

**证据**:
```bash
# 检查assets路由是否被使用
$ grep -r "href.*'/assets'" src/
$ grep -r "router.push.*'/assets'" src/
```

**导入引用**: 需要检查

**建议操作**:
1. **首先检查**: 访问 `/assets/` 路由，看是否有功能
2. **搜索引用**: 确认是否有组件链接到这个路由
3. **如果未使用**: 删除整个目录
4. **如果是静态资源**: 移动到 `public/` 目录

**风险评估**: ⚠️ 中等风险（需要确认用途）

**审查清单**:
- [ ] 检查 `/assets/` 路由是否可访问
- [ ] 搜索代码中是否有链接引用
- [ ] 确认是否包含静态资源
- [ ] 测试删除后功能是否正常

---

### NR-002: Supabase远程种子数据文件

**文件路径**: `supabase/seed-remote.sql`

**文件大小**: 15KB, 406行

**分类理由**:
- 存在 `seed.sql` (本地) 和 `seed-remote.sql` (远程)
- 两个文件功能相似但内容可能不同步
- 远程种子数据可能已过时
- 需要确认是否还在使用

**证据**:
```bash
# 检查是否被脚本引用
$ grep -r "seed-remote" .
```

**导入引用**: 需要检查package.json脚本

**建议操作**:
1. **检查用途**: 确认 `seed-remote.sql` 是否被CI/CD或部署脚本使用
2. **比较差异**: `diff supabase/seed.sql supabase/seed-remote.sql`
3. **选择方案**:
   - 如果不再使用：删除
   - 如果需要两个版本：添加文档说明区别
   - 如果内容应该一致：合并为一个文件

**风险评估**: ⚠️ 中等风险（可能影响部署）

**审查清单**:
- [ ] 检查CI/CD配置中是否引用
- [ ] 检查部署文档中是否提到
- [ ] 比较两个seed文件的差异
- [ ] 咨询团队是否还需要

---

### NR-003: 清理测试数据SQL脚本

**文件路径**: `supabase/clean-test-data.sql`

**文件大小**: 1.6KB, 56行

**分类理由**:
- 专门用于清理测试数据
- 可能已被 `scripts/clean-remote-test-data.ts` 替代
- 需要确认哪个是当前使用的清理工具

**证据**:
```bash
# 检查package.json中的清理脚本
$ grep "clean" package.json
# "clean:test-data": "tsx scripts/clean-remote-test-data.ts"
```

**导入引用**: package.json脚本

**建议操作**:
1. **确认功能**: 检查SQL脚本和TS脚本是否做相同的事
2. **选择保留**: 如果功能重复，选择更灵活的TypeScript版本
3. **如果删除**: 更新相关文档

**风险评估**: ⚠️ 中等风险（测试工具）

**审查清单**:
- [ ] 比较SQL脚本和TS脚本功能
- [ ] 确认当前E2E测试使用哪个
- [ ] 确认是否有其他引用
- [ ] 测试删除后清理功能是否正常

---

### NR-004: 旧的架构文档（可能重复）

**文件路径**: 
- `docs/ARCHITECTURE_ASSESSMENT_CN.md`
- `docs/ARCHITECTURE_DOCUMENTATION_CN.md`
- `docs/REFACTOR_ARCHITECTURE.md`
- `docs/REFACTOR_SUMMARY.md`

**文件大小**: 未知

**分类理由**:
- 现在有了新的统一架构文档 `docs/architecture/ARCHITECTURE.md`
- 旧文档可能已过时
- 多个文档容易造成混淆
- 需要确认哪些内容还有价值

**导入引用**: 文档引用（需要检查）

**建议操作**:
1. **审查内容**: 逐个查看旧文档，提取仍然有价值的信息
2. **整合到新文档**: 将有价值的内容合并到新的架构文档中
3. **创建归档目录**: `docs/archive/` 存放旧文档
4. **更新README**: 指向新的架构文档

**迁移命令**:
```bash
# 创建归档目录
mkdir -p docs/archive

# 移动旧文档
mv docs/ARCHITECTURE_*.md docs/archive/
mv docs/REFACTOR_*.md docs/archive/

# 添加说明
echo "# Archived Documentation\n\nThese documents have been replaced by the unified architecture documentation in docs/architecture/ARCHITECTURE.md" > docs/archive/README.md
```

**风险评估**: ⚠️ 低-中等风险（文档整理）

**审查清单**:
- [ ] 阅读每个旧文档
- [ ] 提取仍然有价值的信息
- [ ] 确认新架构文档已包含关键内容
- [ ] 咨询团队是否有依赖这些文档

---

### NR-005: 工作报告文档

**文件路径**: 
- `docs/WORK_REPORT_ISOLATION.md`
- `docs/TEST_ENVIRONMENT_ISOLATION.md`

**文件大小**: 未知

**分类理由**:
- 这些文档可能是特定功能开发时的工作报告
- 内容可能已过时或已实施完成
- 需要确认是否还需要保留

**导入引用**: 无（独立文档）

**建议操作**:
1. **检查内容**: 确认文档描述的功能是否已实施
2. **选择方案**:
   - 如果功能已实施且文档有价值：保留并移到 `docs/completed-features/`
   - 如果文档已过时：移到 `docs/archive/`
   - 如果不需要保留：删除

**风险评估**: ⚠️ 低风险（独立文档）

**审查清单**:
- [ ] 阅读文档内容
- [ ] 确认描述的功能是否已实施
- [ ] 评估文档的历史价值
- [ ] 决定保留、归档或删除

---

### NR-006: 中文优化对比文档

**文件路径**:
- `优化效果对比图.md`
- `缓存更新问题修复总结.md`
- `验证缓存优化.md`

**文件大小**: 未知

**分类理由**:
- 根目录下的中文文档
- 看起来是特定优化任务的记录
- 应该移动到docs目录统一管理
- 或者内容已过时可以归档

**导入引用**: 无（独立文档）

**建议操作**:
1. **整理到docs**: 移动到 `docs/performance-optimizations/` 目录
2. **翻译为英文**: 保持文档一致性
3. **或归档**: 如果优化已完成且文档不再需要

**迁移命令**:
```bash
# 创建性能优化文档目录
mkdir -p docs/performance-optimizations

# 移动文档
mv 优化效果对比图.md docs/performance-optimizations/cache-optimization-comparison.md
mv 缓存更新问题修复总结.md docs/performance-optimizations/cache-update-fix-summary.md
mv 验证缓存优化.md docs/performance-optimizations/cache-optimization-verification.md
```

**风险评估**: ⚠️ 低风险（文档整理）

**审查清单**:
- [ ] 阅读文档内容
- [ ] 确认优化是否已完成
- [ ] 评估文档的参考价值
- [ ] 决定整理位置或归档

---

### NR-007: CSS模块文件审查

**文件路径**:
- `src/app/page.module.css`
- `src/app/(dashboard)/[projectId]/page.module.css`
- `src/app/(dashboard)/[projectId]/[libraryId]/page.module.css`
- `src/app/(dashboard)/[projectId]/ProjectPage.module.css`

**文件大小**: 未知

**分类理由**:
- 多个CSS模块文件
- 可能包含未使用的样式
- ProjectPage.module.css命名不规范（应该是小写）
- 需要审查是否所有样式都在使用

**导入引用**: 各自对应的页面组件

**建议操作**:
1. **审查每个CSS文件**: 确认所有样式类都在使用
2. **删除未使用样式**: 使用工具或手动检查
3. **规范命名**: 统一CSS文件命名格式
4. **考虑合并**: 如果有共同样式，提取到全局样式

**工具推荐**:
```bash
# 使用 PurgeCSS 检查未使用的CSS
npm install --save-dev purgecss
```

**风险评估**: ⚠️ 低风险（样式优化）

**审查清单**:
- [ ] 检查每个CSS类是否被使用
- [ ] 统一命名规范
- [ ] 提取公共样式
- [ ] 测试删除后UI是否正常

---

### NR-008: Supabase临时目录

**文件路径**:
- `supabase/.branches/`
- `supabase/.temp/`

**文件大小**: 未知

**分类理由**:
- 隐藏目录，可能是Supabase CLI生成的临时文件
- 应该在 `.gitignore` 中忽略
- 需要确认是否应该提交到版本控制

**导入引用**: 无

**建议操作**:
1. **检查内容**: 确认目录中有什么
2. **添加到.gitignore**: 如果是临时文件
```gitignore
# supabase/.gitignore
.branches/
.temp/
```
3. **从版本控制移除**:
```bash
git rm -r --cached supabase/.branches supabase/.temp
```

**风险评估**: ⚠️ 低风险（临时文件）

**审查清单**:
- [ ] 检查目录内容
- [ ] 确认是否是临时文件
- [ ] 添加到.gitignore
- [ ] 从git移除

---

## Consider Refactoring (考虑重构)

### CF-001: 超大组件 - Sidebar.tsx (2330行)

**文件路径**: `src/components/layout/Sidebar.tsx`

**文件大小**: 2330行

**问题描述**:
- 组件过于庞大，包含过多职责
- 包括项目树、库树、文件夹树、版本控制、协作者管理等
- 难以维护和测试
- 修改风险高

**重构建议**: 详见 [OPT-001优化建议](./OPTIMIZATION_RECOMMENDATIONS.md#opt-001-超大组件重构---sidebartsx-2330行)

**预期收益**:
- 代码可维护性提升90%
- Bug定位效率提升70%
- 测试覆盖率提升

**工作量估算**: 2周

---

### CF-002: 超大组件 - LibraryAssetsTable.tsx (2335行)

**文件路径**: `src/components/libraries/LibraryAssetsTable.tsx`

**文件大小**: 2335行

**问题描述**:
- 项目中最复杂的组件
- 包含表格渲染、编辑、拖拽、剪贴板、批量操作等
- 性能问题（大表格渲染慢）
- 状态管理混乱

**重构建议**: 详见 [OPT-002优化建议](./OPTIMIZATION_RECOMMENDATIONS.md#opt-002-超大组件重构---libraryassetstabletsx-2335行)

**预期收益**:
- 渲染性能提升80%
- 代码可读性提升90%
- 支持大型表格（>10,000行）

**工作量估算**: 3周

---

### CF-003: 超大Context - LibraryDataContext.tsx (668行)

**文件路径**: `src/lib/contexts/LibraryDataContext.tsx`

**文件大小**: 668行

**问题描述**:
- Context职责过多
- 集成了Yjs、Realtime、Presence、资产操作等
- 难以测试和维护

**重构建议**: 详见 [OPT-006优化建议](./OPTIMIZATION_RECOMMENDATIONS.md#opt-006-librarydatacontext职责过多需要拆分)

**预期收益**:
- 职责清晰
- 可测试性提升
- 可复用性提升

**工作量估算**: 1.5周

---

### CF-004: 字段定义组件 - FieldForm.tsx & FieldItem.tsx

**文件路径**: 
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/FieldForm.tsx` (530行)
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/FieldItem.tsx` (509行)

**文件大小**: 共1039行

**问题描述**:
- 两个组件都很大，超过500行
- FieldForm包含所有字段类型的表单逻辑
- FieldItem包含字段展示和编辑功能
- 应该按字段类型拆分

**重构建议**:

**拆分FieldForm**:
```
predefine/components/field-forms/
├── TextFieldForm.tsx
├── NumberFieldForm.tsx
├── BooleanFieldForm.tsx
├── DateFieldForm.tsx
├── ReferenceFieldForm.tsx
├── ImageFieldForm.tsx
├── MediaFileFieldForm.tsx
└── index.ts
```

**拆分FieldItem**:
```
predefine/components/field-items/
├── TextFieldItem.tsx
├── NumberFieldItem.tsx
├── ...
└── index.ts
```

**预期收益**:
- 单个组件<150行
- 易于维护和测试
- 添加新字段类型更简单

**工作量估算**: 1周

---

### CF-005: 存储适配器文件重复

**文件路径**:
- `src/lib/hybridStorageAdapter.ts`
- `src/lib/sessionStorageAdapter.ts`
- `src/lib/tabIsolatedStorageAdapter.ts`
- `src/lib/utils/cookieStorageAdapter.ts`

**文件大小**: 未知

**问题描述**:
- 多个存储适配器分散在不同位置
- cookieStorageAdapter在utils目录，其他在lib根目录
- 应该统一管理

**重构建议**:

**创建统一的存储适配器目录**:
```
src/lib/storage-adapters/
├── HybridStorageAdapter.ts
├── SessionStorageAdapter.ts
├── TabIsolatedStorageAdapter.ts
├── CookieStorageAdapter.ts
└── index.ts
```

**统一导出**:
```typescript
// src/lib/storage-adapters/index.ts
export { HybridStorageAdapter } from './HybridStorageAdapter';
export { SessionStorageAdapter } from './SessionStorageAdapter';
export { TabIsolatedStorageAdapter } from './TabIsolatedStorageAdapter';
export { CookieStorageAdapter } from './CookieStorageAdapter';
```

**预期收益**:
- 代码组织更清晰
- 易于查找和维护
- 统一的导入路径

**工作量估算**: 半天

---

### CF-006: 协作相关组件整理

**文件路径**:
- `src/components/collaboration/*` (协作组件)
- `src/app/(dashboard)/[projectId]/collaborators/*` (协作者页面)

**文件大小**: 多个文件

**问题描述**:
- 协作功能分散在两个地方
- components下是UI组件
- app下是页面逻辑
- 但页面中也有大量的组件逻辑（AcceptInvitationContent, CollaboratorsContent）
- 应该更清晰地分离

**重构建议**:

**统一协作组件位置**:
```
src/components/collaboration/
├── CollaboratorsList.tsx
├── InviteCollaboratorModal.tsx
├── AcceptInvitationContent.tsx    # 从app移过来
├── CollaboratorsContent.tsx       # 从app移过来
├── PresenceIndicators.tsx
├── StackedAvatars.tsx
├── ConnectionStatusIndicator.tsx
└── FieldPresenceAvatars.tsx
```

**页面只保留路由逻辑**:
```typescript
// app/(dashboard)/[projectId]/collaborators/page.tsx
export default function CollaboratorsPage() {
  return <CollaboratorsContent projectId={params.projectId} />;
}

// app/accept-invitation/page.tsx
export default function AcceptInvitationPage() {
  return <AcceptInvitationContent />;
}
```

**预期收益**:
- 组件职责更清晰
- 复用性更好
- 页面更简洁

**工作量估算**: 2天

---

## Consolidate (合并整理)

### CO-001: 版本控制组件目录整理

**当前位置**: `src/components/version-control/`

**文件列表**:
- VersionControlSidebar.tsx
- VersionList.tsx
- VersionItem.tsx
- VersionItemMenu.tsx
- CreateVersionModal.tsx
- EditVersionModal.tsx
- RestoreButton.tsx
- RestoreConfirmModal.tsx
- DeleteConfirmModal.tsx

**问题描述**:
- 所有版本控制组件都在一个扁平目录
- 随着组件增多会难以管理
- 应该按功能分组

**整理建议**:

**按功能分组**:
```
src/components/version-control/
├── sidebar/
│   ├── VersionControlSidebar.tsx
│   ├── VersionList.tsx
│   ├── VersionItem.tsx
│   └── VersionItemMenu.tsx
├── modals/
│   ├── CreateVersionModal.tsx
│   ├── EditVersionModal.tsx
│   ├── RestoreConfirmModal.tsx
│   └── DeleteConfirmModal.tsx
└── RestoreButton.tsx
```

**预期收益**:
- 代码组织更清晰
- 易于导航和查找
- 扩展性更好

**工作量估算**: 半天

---

### CO-002: Service层文件统一导出

**当前位置**: `src/lib/services/`

**问题描述**:
- 13个Service文件
- 每次导入都需要写完整路径
- 没有统一的导出文件

**整理建议**:

**创建统一导出文件**:
```typescript
// src/lib/services/index.ts
export * from './projectService';
export * from './libraryService';
export * from './libraryAssetsService';
export * from './folderService';
export * from './collaborationService';
export * from './versionService';
export * from './authorizationService';
export * from './emailService';
export * from './imageUploadService';
export * from './mediaFileUploadService';
export * from './realtimeService';
export * from './sharedDocumentService';
export * from './userValidationService';
```

**使用方式**:
```typescript
// 之前
import { projectService } from '@/lib/services/projectService';
import { libraryService } from '@/lib/services/libraryService';

// 之后
import { projectService, libraryService } from '@/lib/services';
```

**预期收益**:
- 导入更简洁
- 统一管理
- 易于维护

**工作量估算**: 15分钟

---

### CO-003: 测试Page Object统一组织

**当前位置**: `tests/e2e/pages/`

**文件列表**:
- project.page.ts
- library.page.ts
- asset.page.ts
- predefined.page.ts

**问题描述**:
- 文件较少时没问题
- 但随着测试增多会混乱
- 应该提前规划好结构

**整理建议**:

**按功能分组**:
```
tests/e2e/pages/
├── auth/
│   ├── login.page.ts
│   └── signup.page.ts
├── project/
│   ├── project-list.page.ts
│   └── project-detail.page.ts
├── library/
│   ├── library-list.page.ts
│   ├── library-detail.page.ts
│   └── predefined.page.ts
├── asset/
│   └── asset-detail.page.ts
└── index.ts  // 统一导出
```

**预期收益**:
- 测试代码更清晰
- 易于扩展
- 减少查找时间

**工作量估算**: 1小时

---

### CO-004: 类型定义统一管理

**当前位置**:
- `src/lib/types/` (部分类型)
- `types/` (全局类型)
- 各组件内部定义的类型

**问题描述**:
- 类型定义分散
- 有些类型重复定义
- 缺乏统一管理

**整理建议**:

**统一类型目录结构**:
```
src/lib/types/
├── database/          # 数据库表类型
│   ├── project.ts
│   ├── library.ts
│   ├── asset.ts
│   └── user.ts
├── api/               # API请求/响应类型
│   ├── project.ts
│   ├── library.ts
│   └── asset.ts
├── ui/                # UI组件类型
│   ├── table.ts
│   ├── form.ts
│   └── modal.ts
├── collaboration.ts   # 协作相关类型
├── version.ts         # 版本控制类型
├── libraryAssets.ts   # 资产相关类型
└── index.ts           # 统一导出
```

**统一导出**:
```typescript
// src/lib/types/index.ts
export * from './database';
export * from './api';
export * from './ui';
export * from './collaboration';
export * from './version';
export * from './libraryAssets';
```

**预期收益**:
- 类型定义统一
- 避免重复定义
- 易于查找和维护
- 提升类型安全

**工作量估算**: 2天

---

## 总结与建议

### 清理优先级

#### 🔴 高优先级（立即执行）
1. **SR-001**: 删除开发测试页面（realtime-test）
2. **SR-002, SR-003**: 统一目录结构（contexts, hooks）
3. **CO-002**: 创建Service统一导出

**预计时间**: 1天  
**预计减少**: ~300行代码

---

#### 🟡 中优先级（本月内完成）
1. **NR-001 ~ NR-003**: 审查可能废弃的文件
2. **NR-004 ~ NR-006**: 整理文档结构
3. **CO-001, CO-003, CO-004**: 代码组织优化
4. **CF-005, CF-006**: 简单重构任务

**预计时间**: 1周  
**预计减少**: ~400行代码

---

#### 🟢 低优先级（配合重构进行）
1. **CF-001 ~ CF-003**: 超大组件重构（配合OPT-001, OPT-002进行）
2. **CF-004**: 字段组件拆分
3. **NR-007, NR-008**: 样式和临时文件清理

**预计时间**: 随重构项目进行  
**预计减少**: ~350行代码（重构而非删除）

---

### 执行流程建议

#### 阶段1: 安全清理（第1周）

```bash
# 1. 创建清理分支
git checkout -b cleanup/phase-1-safe-removal

# 2. 执行安全删除
rm -rf src/app/realtime-test

# 3. 迁移旧目录
mv src/contexts/YjsContext.tsx src/lib/contexts/
mv src/hooks/useYjsRows.ts src/lib/hooks/

# 4. 更新导入路径（使用工具或手动）
# ...

# 5. 删除旧目录
rm -rf src/contexts src/hooks

# 6. 创建Service导出文件
# 创建 src/lib/services/index.ts

# 7. 测试
npm run build
npm run test:e2e

# 8. 提交
git add .
git commit -m "chore: clean up unused files and consolidate directory structure"
git push origin cleanup/phase-1-safe-removal
```

#### 阶段2: 审查与整理（第2-3周）

```bash
# 1. 创建整理分支
git checkout -b cleanup/phase-2-review

# 2. 逐个审查NR文件
# 根据审查结果执行相应操作

# 3. 整理文档
mkdir -p docs/archive docs/performance-optimizations
# 移动相关文件...

# 4. 整理代码组织
# 执行CO任务...

# 5. 测试
npm run build
npm run test:e2e

# 6. 提交
git add .
git commit -m "chore: organize project structure and archive outdated documentation"
git push origin cleanup/phase-2-review
```

#### 阶段3: 重构（长期）

- 配合优化建议文档中的重构任务进行
- 每个CF任务单独创建分支
- 逐步完成，避免一次性大改

---

### 注意事项

1. **⚠️ 执行任何删除操作前必须**:
   - 创建新的Git分支
   - 进行完整的测试（build + E2E）
   - 代码Review
   - 备份重要数据

2. **⚠️ 对于"Needs Review"的文件**:
   - 不要急于删除
   - 先咨询团队其他成员
   - 检查是否有文档说明用途
   - 测试删除后的影响

3. **⚠️ 重构任务**:
   - 优先编写测试覆盖
   - 逐步迁移，避免大规模重写
   - 保持功能不变
   - 每次重构后充分测试

4. **⚠️ 文档清理**:
   - 提取有价值的信息到新文档
   - 保留历史文档到archive目录
   - 更新README和导航

---

### 预期成果

完成所有清理和整理后：

| 指标 | 当前 | 目标 | 改进 |
|------|------|------|------|
| **代码行数** | ~30,000行 | ~28,950行 | -3.5% |
| **文件数量** | ~155个 | ~145个 | -6.5% |
| **目录层级** | 混乱 | 清晰 | +90% |
| **代码组织** | 中等 | 优秀 | +80% |
| **可维护性** | 中等 | 高 | +70% |
| **文档清晰度** | 中等 | 高 | +85% |

---

### 后续维护建议

1. **建立代码审查规范**:
   - 新文件必须放在正确的目录
   - 禁止创建超过300行的组件
   - 必须使用TypeScript严格模式

2. **定期清理**:
   - 每月检查未使用的导入
   - 每季度审查组件大小
   - 每半年整理文档

3. **工具辅助**:
   - 配置ESLint规则检查未使用代码
   - 使用依赖分析工具
   - 配置Git hooks防止提交过大文件

4. **文档维护**:
   - 代码变更时更新架构文档
   - 记录重要的架构决策
   - 保持文档与代码同步

---

**文档结束**

如有任何疑问或需要协助执行清理任务，请参考[优化建议文档](./OPTIMIZATION_RECOMMENDATIONS.md)或咨询架构团队。
