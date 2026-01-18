# Version Control 功能开发技术方案

## 一、需求概述

实现一个完整的版本控制系统，允许用户对Library进行版本管理，包括创建版本、恢复版本、编辑版本信息、复制为新Library以及删除版本等功能。

## 二、功能模块拆解

### 2.1 功能入口模块
- **位置**：右上角"时钟"按钮
- **功能**：展开/收起Version Control侧边栏

### 2.2 版本创建模块
- **入口**：侧边栏"+"按钮
- **功能**：弹窗创建新版本，填写Version Name并保存

### 2.3 版本列表展示模块
- **展示内容**：Version Name、added by xxx、保存时间
- **排序规则**：按时间倒序（最新的在前）
- **样式区分**：当前版本与历史版本通过图标、字体大小、颜色区分

### 2.4 版本恢复模块（Restore）
- **入口**：历史版本右侧的Restore按钮
- **功能流程**：
  1. 显示确认弹窗
  2. 支持开启"backup the current version"
  3. 开启备份时需要填写Version Name（必填）
  4. 执行恢复后新增两版记录
  5. 显示成功Toast提示
  6. 版本记录高亮闪烁1-2s

### 2.5 版本菜单模块
- **入口**：历史版本右侧的菜单按钮或右键菜单
- **菜单项**：
  1. Edit version info（编辑版本信息）
  2. Duplicate as a new library（复制为新Library）
  3. Delete（删除版本）

### 2.6 版本删除模块
- **流程**：二次确认弹窗 → 确认删除

## 三、数据结构设计

### 3.1 数据库Schema设计

#### 3.1.1 Library Versions表
```sql
CREATE TABLE library_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  version_name TEXT NOT NULL,
  version_type TEXT NOT NULL, -- 'manual' | 'restore' | 'current'
  parent_version_id UUID REFERENCES library_versions(id), -- 用于restore时指向原版本
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  snapshot_data JSONB, -- 版本快照数据
  restore_from_version_id UUID, -- restore时指向被恢复的版本
  restored_by UUID REFERENCES users(id),
  restored_at TIMESTAMP WITH TIME ZONE,
  is_current BOOLEAN DEFAULT FALSE, -- 标记是否为当前版本
  metadata JSONB -- 存储额外元数据
);

-- 索引
CREATE INDEX idx_library_versions_library_id ON library_versions(library_id);
CREATE INDEX idx_library_versions_created_at ON library_versions(created_at DESC);
CREATE INDEX idx_library_versions_is_current ON library_versions(is_current) WHERE is_current = TRUE;
```

#### 3.1.2 数据关系说明
- **一个Library可以有多个Versions**
- **每个Version记录完整的Library数据快照**
- **Restore版本需要记录两个关联**：
  - `parent_version_id`: 指向备份的版本（如果开启了备份）
  - `restore_from_version_id`: 指向被恢复的版本

### 3.2 前端TypeScript类型定义

```typescript
// src/types/version.ts

export type VersionType = 'manual' | 'restore' | 'current';

export interface LibraryVersion {
  id: string;
  libraryId: string;
  versionName: string;
  versionType: VersionType;
  parentVersionId?: string;
  createdBy: {
    id: string;
    name: string;
    avatar?: string;
  };
  createdAt: Date;
  snapshotData: any; // Library的完整数据快照
  restoreFromVersionId?: string; // restore时指向被恢复的版本
  restoredBy?: {
    id: string;
    name: string;
    avatar?: string;
  };
  restoredAt?: Date;
  isCurrent: boolean;
  metadata?: Record<string, any>;
}

export interface RestoreRequest {
  versionId: string;
  backupCurrent: boolean;
  backupVersionName?: string; // 当backupCurrent为true时必填
}

export interface CreateVersionRequest {
  libraryId: string;
  versionName: string;
}

export interface EditVersionRequest {
  versionId: string;
  versionName: string;
}

export interface DuplicateVersionRequest {
  versionId: string;
  // 新library名称由后端生成：libraryName (copy)
}
```

## 四、技术架构设计

### 4.1 前端架构

#### 4.1.1 组件结构
```
src/components/version-control/
├── VersionControlSidebar.tsx       # 主侧边栏组件
├── VersionList.tsx                  # 版本列表组件
├── VersionItem.tsx                  # 单个版本项组件
├── CreateVersionModal.tsx           # 创建版本弹窗
├── RestoreConfirmModal.tsx          # Restore确认弹窗
├── EditVersionModal.tsx             # 编辑版本信息弹窗
├── DeleteConfirmModal.tsx           # 删除确认弹窗
└── VersionItemMenu.tsx              # 版本项菜单组件
```

#### 4.1.2 状态管理
- **全局状态**：使用Context API或状态管理库（如Zustand/Redux）
- **本地状态**：使用React Hooks（useState, useReducer）
- **服务端状态**：使用React Query或SWR进行数据获取和缓存

#### 4.1.3 组件层级关系
```
App Layout
└── LibraryDetailPage
    ├── LibraryHeader (包含时钟按钮)
    ├── MainContent (Library主内容)
    └── VersionControlSidebar (条件渲染，通过时钟按钮控制)
        └── VersionList
            └── VersionItem[] (循环渲染)
                ├── VersionItemMenu (菜单按钮)
                └── RestoreButton
```

### 4.2 后端架构

#### 4.2.1 API路由设计
```
/api/versions/
├── POST   /create                    # 创建新版本
├── GET    /list/:libraryId          # 获取版本列表
├── POST   /restore                  # 恢复版本
├── PUT    /:versionId/edit          # 编辑版本信息
├── POST   /:versionId/duplicate     # 复制为新Library
└── DELETE /:versionId                # 删除版本
```

#### 4.2.2 服务层设计
```
src/services/versionService.ts
├── createVersion(libraryId, versionName)
├── getVersionsByLibrary(libraryId)
├── restoreVersion(versionId, backupOptions)
├── editVersion(versionId, versionName)
├── duplicateVersion(versionId)
└── deleteVersion(versionId)
```

## 五、详细实施方案

### 5.1 阶段一：基础架构搭建

#### 步骤1.1：数据库表创建
1. 在Supabase数据库中创建`library_versions`表
2. 设置外键约束和索引
3. 创建Row Level Security (RLS)策略
4. 编写数据库迁移脚本

**技术要点**：
- 使用Supabase Migration或直接SQL脚本
- RLS策略确保用户只能访问有权限的版本

#### 步骤1.2：后端API开发
1. 创建版本服务类（VersionService）
2. 实现版本CRUD操作
3. 实现版本快照存储逻辑
4. 实现版本恢复逻辑

**关键技术点**：
- **版本快照存储**：将Library的完整数据（包括所有字段和关联数据）序列化为JSONB存储
- **事务处理**：Restore操作需要在事务中完成，确保数据一致性
- **权限校验**：每次操作前校验用户权限

#### 步骤1.3：前端类型定义
1. 创建`src/types/version.ts`文件
2. 定义所有相关的TypeScript类型
3. 导出类型供组件使用

### 5.2 阶段二：UI组件开发

#### 步骤2.1：版本控制侧边栏组件
**文件**：`src/components/version-control/VersionControlSidebar.tsx`

**功能实现**：
1. 接收`libraryId`和`isOpen`状态
2. 使用React Query获取版本列表
3. 实现侧边栏打开/收起动画
4. 渲染版本列表
5. 实现"+"按钮触发创建弹窗

**关键代码结构**：
```typescript
interface VersionControlSidebarProps {
  libraryId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const VersionControlSidebar: React.FC<VersionControlSidebarProps> = ({
  libraryId,
  isOpen,
  onClose
}) => {
  const { data: versions, isLoading } = useVersions(libraryId);
  
  return (
    <Sidebar isOpen={isOpen} onClose={onClose}>
      <SidebarHeader>
        <Title>VERSION HISTORY</Title>
        <Button onClick={handleCreateVersion}>+</Button>
      </SidebarHeader>
      <VersionList versions={versions} />
    </Sidebar>
  );
};
```

#### 步骤2.2：版本列表组件
**文件**：`src/components/version-control/VersionList.tsx`

**功能实现**：
1. 接收版本数组
2. 按`createdAt`倒序排列
3. 区分当前版本和历史版本
4. 渲染版本项列表

**排序逻辑**：
```typescript
const sortedVersions = useMemo(() => {
  return [...versions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}, [versions]);
```

#### 步骤2.3：版本项组件
**文件**：`src/components/version-control/VersionItem.tsx`

**功能实现**：
1. 显示版本信息（名称、创建者、时间）
2. 区分当前版本和历史版本的样式
3. 历史版本显示Restore按钮和菜单按钮
4. 实现高亮闪烁动画（restore后）

**样式区分逻辑**：
```typescript
const getVersionStyle = (version: LibraryVersion) => {
  if (version.isCurrent) {
    return {
      icon: <CurrentVersionIcon color="pink" />,
      textColor: 'pink',
      fontSize: 'larger'
    };
  }
  return {
    icon: <HistoryVersionIcon color="gray" />,
    textColor: 'gray',
    fontSize: 'normal'
  };
};
```

**高亮闪烁动画**：
```typescript
const [isHighlighting, setIsHighlighting] = useState(false);

useEffect(() => {
  if (justRestored) {
    setIsHighlighting(true);
    const timer = setTimeout(() => setIsHighlighting(false), 2000);
    return () => clearTimeout(timer);
  }
}, [justRestored]);

// 使用CSS动画或Tailwind动画类
<div className={cn(
  "version-item",
  isHighlighting && "animate-pulse bg-yellow-200"
)}>
```

### 5.3 阶段三：核心功能开发

#### 步骤3.1：创建版本功能
**文件**：`src/components/version-control/CreateVersionModal.tsx`

**实现步骤**：
1. 创建Modal组件
2. 实现表单验证（Version Name必填）
3. 调用API创建版本
4. 成功后刷新版本列表
5. 显示成功提示

**API调用示例**：
```typescript
const createVersionMutation = useMutation({
  mutationFn: (data: CreateVersionRequest) => 
    versionService.createVersion(data.libraryId, data.versionName),
  onSuccess: () => {
    queryClient.invalidateQueries(['versions', libraryId]);
    toast.success('Version created successfully');
    onClose();
  }
});
```

#### 步骤3.2：恢复版本功能（核心复杂逻辑）
**文件**：`src/components/version-control/RestoreConfirmModal.tsx`

**实现步骤**：

1. **弹窗展示**
   - 显示确认信息
   - "backup the current version"开关
   - 条件渲染版本名称输入框（当开关打开时）

2. **表单逻辑**
   ```typescript
   const [backupEnabled, setBackupEnabled] = useState(false);
   const [backupVersionName, setBackupVersionName] = useState('');
   
   const handleRestore = () => {
     if (backupEnabled && !backupVersionName.trim()) {
       toast.error('Version name is required when backup is enabled');
       return;
     }
     
     restoreVersionMutation.mutate({
       versionId: selectedVersion.id,
       backupCurrent: backupEnabled,
       backupVersionName: backupEnabled ? backupVersionName : undefined
     });
   };
   ```

3. **后端恢复逻辑**（关键）
   ```typescript
   // 伪代码示例
   async function restoreVersion(versionId: string, backupOptions: RestoreOptions) {
     await db.transaction(async (tx) => {
       // 1. 如果需要备份，先创建当前版本的备份
       if (backupOptions.backupCurrent) {
         const currentVersion = await getCurrentVersion(libraryId);
         await createBackupVersion(currentVersion, backupOptions.backupVersionName);
       }
       
       // 2. 获取要恢复的版本数据
       const targetVersion = await getVersion(versionId);
       
       // 3. 恢复数据到Library
       await updateLibraryData(libraryId, targetVersion.snapshotData);
       
       // 4. 创建restore版本记录
       await createRestoreVersionRecord({
         libraryId,
         restoreFromVersionId: versionId,
         versionName: generateRestoreVersionName(targetVersion),
         snapshotData: targetVersion.snapshotData,
         restoredBy: currentUser.id
       });
       
       // 5. 更新当前版本标记
       await updateCurrentVersion(libraryId, newRestoreVersionId);
     });
   }
   ```

4. **Restore版本名称生成逻辑**
   ```typescript
   function generateRestoreVersionName(originalVersion: LibraryVersion): string {
     const originalDate = new Date(originalVersion.createdAt);
     const formattedDate = format(originalDate, 'yyyy.MM.dd');
     return `${originalVersion.versionName} (${formattedDate})`;
   }
   ```

5. **成功后的处理**
   - 显示Toast提示："Library restored"
   - 高亮闪烁对应的版本记录
   - 刷新版本列表
   - 刷新主内容区域的Library数据

#### 步骤3.3：编辑版本信息功能
**文件**：`src/components/version-control/EditVersionModal.tsx`

**实现步骤**：
1. 弹窗预填充当前版本名称
2. 表单验证
3. 调用API更新版本名称
4. 刷新版本列表

**注意点**：
- 版本名称修改**仅影响侧边栏显示**
- **不修改**主页面和左侧栏的Library名称

#### 步骤3.4：复制为新Library功能
**文件**：`src/components/version-control/DuplicateVersionModal.tsx`（可选，也可以直接在菜单中确认）

**实现步骤**：

1. **后端复制逻辑**
   ```typescript
   async function duplicateVersionAsLibrary(versionId: string) {
     // 1. 获取原版本数据
     const version = await getVersion(versionId);
     const originalLibrary = await getLibrary(version.libraryId);
     
     // 2. 确定目标位置（父级folder或project）
     const parentId = originalLibrary.parentId || originalLibrary.projectId;
     const parentType = originalLibrary.parentId ? 'folder' : 'project';
     
     // 3. 创建新Library
     const newLibrary = await createLibrary({
       name: `${originalLibrary.name} (copy)`,
       parentId,
       parentType,
       data: version.snapshotData
     });
     
     // 4. 创建新Library的初始版本记录
     await createVersionRecord({
       libraryId: newLibrary.id,
       versionName: `${originalLibrary.name} duplicated from (${version.versionName})`,
       versionType: 'manual',
       snapshotData: version.snapshotData,
       createdBy: currentUser.id
     });
     
     return newLibrary;
   }
   ```

2. **前端处理**
   - 显示加载状态
   - 成功后刷新左侧栏Library列表
   - 可选：跳转到新创建的Library

#### 步骤3.5：删除版本功能
**文件**：`src/components/version-control/DeleteConfirmModal.tsx`

**实现步骤**：
1. 显示二次确认弹窗
2. 校验：不能删除当前版本（如果需要）
3. 调用API删除
4. 刷新版本列表

**后端删除逻辑**：
```typescript
async function deleteVersion(versionId: string) {
  const version = await getVersion(versionId);
  
  // 校验：不能删除当前版本
  if (version.isCurrent) {
    throw new Error('Cannot delete current version');
  }
  
  await db.delete('library_versions').where('id', versionId);
}
```

### 5.4 阶段四：集成与优化

#### 步骤4.1：集成到LibraryHeader
**文件**：`src/components/libraries/LibraryHeader.tsx`

**修改内容**：
1. 添加"时钟"图标按钮
2. 管理侧边栏打开/收起状态
3. 传递`libraryId`给侧边栏组件

```typescript
const [isVersionControlOpen, setIsVersionControlOpen] = useState(false);

<Button 
  icon={<ClockIcon />}
  onClick={() => setIsVersionControlOpen(!isVersionControlOpen)}
/>
<VersionControlSidebar 
  libraryId={libraryId}
  isOpen={isVersionControlOpen}
  onClose={() => setIsVersionControlOpen(false)}
/>
```

#### 步骤4.2：版本菜单实现
**文件**：`src/components/version-control/VersionItemMenu.tsx`

**实现方式**：
- 使用Radix UI的Dropdown Menu或自定义Menu组件
- 支持点击菜单按钮和右键两种触发方式

```typescript
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <MenuButton />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={handleEdit}>Edit version info</DropdownMenuItem>
    <DropdownMenuItem onClick={handleDuplicate}>Duplicate as a new library</DropdownMenuItem>
    <DropdownMenuItem onClick={handleDelete} className="text-red-500">
      Delete
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

#### 步骤4.3：数据同步
**关键点**：
- Restore操作后需要同步更新主内容区域
- 使用React Query的`invalidateQueries`确保数据刷新

```typescript
const restoreMutation = useMutation({
  mutationFn: restoreVersion,
  onSuccess: () => {
    // 刷新版本列表
    queryClient.invalidateQueries(['versions', libraryId]);
    // 刷新Library主数据
    queryClient.invalidateQueries(['library', libraryId]);
    toast.success('Library restored');
  }
});
```

#### 步骤4.4：Toast提示实现
- 使用现有的Toast组件或集成react-hot-toast/toast库
- Restore成功时显示："Library restored"

### 5.5 阶段五：样式与交互优化

#### 步骤5.1：样式实现
1. **当前版本样式**：
   - 图标：粉色圆形图标
   - 文字：粉色、较大字号

2. **历史版本样式**：
   - 图标：灰色圆形图标
   - 文字：灰色、正常字号

3. **高亮闪烁动画**：
   - 使用Tailwind CSS的`animate-pulse`或自定义CSS动画
   - 持续1-2秒

#### 步骤5.2：交互优化
1. **Restore按钮Hover提示**：
   ```typescript
   <Tooltip content="Restore">
     <RestoreButton onMouseEnter={...} />
   </Tooltip>
   ```

2. **加载状态**：
   - API调用时显示加载指示器
   - 禁用相关按钮防止重复提交

3. **错误处理**：
   - API错误时显示错误Toast
   - 表单验证错误显示内联提示

## 六、关键技术点详解

### 6.1 版本快照机制

**目的**：保存Library在某个时间点的完整状态

**实现方式**：
1. 创建版本时，获取Library的完整数据
2. 包括所有字段、关联数据、配置等
3. 序列化为JSONB存储到`snapshot_data`字段

```typescript
async function createSnapshot(libraryId: string) {
  const library = await getLibraryWithAllData(libraryId);
  // 包括：基本字段、字段定义、数据行等所有内容
  return JSON.stringify(library);
}
```

### 6.2 Restore后的版本记录生成

**需求**：Restore后新增两版记录

1. **Restore版本记录**：
   - `version_name`: 原版本名 + (原版本时间)，如"test demo 222 (2025.12.27)"
   - `version_type`: 'restore'
   - `restore_from_version_id`: 指向被恢复的版本ID
   - `created_at`: restore执行时间

2. **Current Version更新**：
   - 原Current Version的`is_current`设为`false`
   - Restore版本的`is_current`设为`true`

3. **如果开启了备份**：
   - 额外创建一条备份版本记录
   - `version_name`: 用户输入的名称
   - `version_type`: 'manual'

### 6.3 版本列表排序

**规则**：按时间倒序，最近的在前

**实现**：
```typescript
// 数据库查询时
SELECT * FROM library_versions 
WHERE library_id = $1 
ORDER BY created_at DESC;

// 或在前端排序
const sortedVersions = versions.sort((a, b) => 
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
);
```

### 6.4 权限控制

**RLS策略示例**：
```sql
-- 用户只能查看自己项目下的版本
CREATE POLICY "Users can view versions of libraries they have access to"
ON library_versions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM libraries
    WHERE libraries.id = library_versions.library_id
    AND (
      libraries.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM library_members
        WHERE library_members.library_id = libraries.id
        AND library_members.user_id = auth.uid()
      )
    )
  )
);
```

## 七、测试策略

### 7.1 单元测试
- 版本名称生成逻辑
- 版本排序逻辑
- 表单验证逻辑

### 7.2 集成测试
- API端点测试
- 数据库事务测试（特别是Restore操作）

### 7.3 E2E测试
- 完整流程测试：创建 → 恢复 → 编辑 → 删除
- UI交互测试：侧边栏打开/收起、弹窗操作

## 八、实施顺序建议

### 第一阶段（基础功能）
1. ✅ 数据库表创建
2. ✅ 后端API：创建版本、获取版本列表
3. ✅ 前端：侧边栏组件、版本列表展示

### 第二阶段（核心功能）
4. ✅ 后端API：恢复版本
5. ✅ 前端：Restore功能完整实现

### 第三阶段（辅助功能）
6. ✅ 编辑版本信息
7. ✅ 删除版本
8. ✅ 复制为新Library

### 第四阶段（优化）
9. ✅ UI/UX优化（动画、提示等）
10. ✅ 错误处理与边界情况
11. ✅ 性能优化

## 九、注意事项

1. **数据一致性**：
   - Restore操作必须使用数据库事务
   - 确保版本快照的完整性

2. **性能考虑**：
   - 版本列表使用分页（如果需要）
   - 版本快照数据较大时考虑压缩存储

3. **用户体验**：
   - 所有异步操作都要有加载状态
   - 重要操作（Restore、Delete）必须有确认步骤

4. **命名规范**：
   - Restore版本名称格式：`原版本名 (YYYY.MM.DD)`
   - 复制Library名称格式：`原Library名 (copy)`

5. **版本名称修改**：
   - 只影响侧边栏显示
   - 不影响Library本身的名称

## 十、后续扩展考虑

1. **版本对比功能**：对比两个版本的差异
2. **版本标签**：给版本添加标签方便查找
3. **自动保存版本**：定期自动创建版本
4. **版本回滚策略**：更复杂的回滚规则

---

**文档版本**：v1.0  
**创建日期**：2025-01-09  
**最后更新**：2025-01-09

