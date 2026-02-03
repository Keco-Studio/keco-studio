# Toast 使用情况总结

根据设计稿，Toast 有三种样式：
- **成功**：背景 `#38B3632E`，文字 `#0C8C57`
- **失败**：背景 `#FF000012`，文字 `#ED3838`
- **默认**：背景 `#0B99FF14`，文字 `#070707`

本文档扫描项目内所有 Toast/消息提示的使用位置，并标注建议使用的样式类型（成功 / 失败 / 默认），**不包含具体代码修改**，仅作整理与分类。

---

## 一、项目中的 Toast 实现

### 1. 自定义 Toast 工具（`src/lib/utils/toast.ts`）

- **API**：`showToast(options)`、`showSuccessToast`、`showErrorToast`、`showInfoToast`、`showWarningToast`
- **当前样式**：通过 `typeColors` 写死颜色（success/error/info/warning），白字 + 彩色背景，**与设计稿不一致**
- **设计稿映射**：
  - `success` → 设计稿「成功」样式
  - `error` → 设计稿「失败」样式
  - `info` / `warning` / 无明确成功失败语义 → 设计稿「默认」样式

### 2. TableToast（表格内反馈，`src/components/libraries/components/TableToast.tsx`）

- **用途**：Library 表格的剪贴板（复制/剪切/粘贴）和行操作（插入行）的即时反馈
- **数据来源**：`LibraryAssetsTable` 的 `toastMessage` state，由 `useClipboardOperations`、`useRowOperations` 通过 `setToastMessage` 设置
- **当前样式**：固定底部居中，深色背景 `#111827`、白字，**与设计稿不一致**
- **建议**：按消息语义区分成功 / 失败 / 默认，并统一为设计稿三种样式之一

### 3. Library 页内嵌 Restore Toast（`src/app/(dashboard)/[projectId]/[libraryId]/page.tsx`）

- **用途**：版本恢复成功后的提示 “Library restored”
- **实现**：内联 `createPortal` 的 div，样式与 TableToast 类似（深色背景）
- **建议**：视为「成功」类提示，统一为设计稿成功样式

### 4. Ant Design `message`（antd）

- **使用方式**：部分文件直接 `import { message } from 'antd'`，部分通过 `App.useApp()` 取得 `message`
- **当前**：使用 AntD 默认的 message 样式，**与设计稿不一致**
- **建议**：要么改为调用统一 Toast 工具并应用设计稿样式，要么通过 AntD ConfigProvider/静态方法配置成设计稿三种样式

---

## 二、按文件与语义分类（建议样式）

### A. 使用 `showSuccessToast`（自定义 Toast）

| 文件 | 场景 | 消息内容（或来源） | 建议样式 |
|------|------|--------------------|----------|
| `LibraryHeader.tsx` | 邀请协作者成功 | `InviteCollaboratorModal` 回调的 `message` | **成功** |
| `AssetHeader.tsx` | 邀请协作者成功 | 同上 | **成功** |
| `collaborators/page.tsx` | 邀请协作者成功 | 同上 | **成功** |
| `CollaboratorsContent.tsx` | 邀请协作者成功 | `handleInviteSuccess` 的 `msg` | **成功** |

以上均为「操作成功」反馈，保持 **成功** 样式即可。

---

### B. TableToast 消息（setToastMessage）

#### B1. useClipboardOperations.ts（剪贴板）

| 消息内容 | 建议样式 | 说明 |
|----------|----------|------|
| `'Content cut'` | **成功** | 剪切成功 |
| `'Content copied'` | **成功** | 复制成功 |
| `'Content pasted'` | **成功** | 粘贴成功 |
| `'No cells with supported types (string, int, float) selected'` | **默认** | 前置条件不满足，非错误 |
| `'No content to paste. Please copy or cut cells first.'` | **默认** | 提示用户先复制/剪切 |
| `'Please select cells to paste'` | **默认** | 操作前提提示 |
| `'type mismatch'` | **失败** | 粘贴类型不匹配 |
| `'Failed to paste: could not update cells'` | **失败** | 粘贴更新失败 |
| `'Failed to paste: could not create new rows'` | **失败** | 粘贴创建行失败 |

#### B2. useRowOperations.ts（行插入）

| 消息内容 | 建议样式 | 说明 |
|----------|----------|------|
| `'1 row inserted'` / `'N rows inserted'` | **成功** | 插入成功 |
| `'Failed to insert rows above'` | **失败** | 在上方插入失败 |
| `'Failed to insert rows below'` | **失败** | 在下方插入失败 |

---

### C. Library 页 Restore Toast

| 文件 | 场景 | 消息内容 | 建议样式 |
|------|------|----------|----------|
| `[projectId]/[libraryId]/page.tsx` | 版本恢复成功 | `'Library restored'` | **成功** |

---

### D. Ant Design `message` 使用处

#### D1. 成功 / 失败明确

| 文件 | 调用 | 建议样式 |
|------|------|----------|
| `VersionItemMenu.tsx` | `message.success('Library duplicated successfully')` | **成功** |
| `VersionItemMenu.tsx` | `message.error(...'Failed to duplicate library')` | **失败** |
| `DeleteConfirmModal.tsx` | `message.success('Version deleted successfully')` | **成功** |
| `DeleteConfirmModal.tsx` | `message.error(...'Failed to delete version')` | **失败** |
| `CollaboratorsContent.tsx` | `message.success('Role updated successfully')` | **成功** |
| `CollaboratorsContent.tsx` | `message.error(result.error \|\| 'Failed to update role')` | **失败** |
| `CollaboratorsContent.tsx` | `message.success('Collaborator removed')` | **成功** |
| `CollaboratorsContent.tsx` | `message.error(result.error \|\| 'Failed to remove collaborator')` | **失败** |
| `CollaboratorsContent.tsx` | `message.error('An unexpected error occurred')`（两处） | **失败** |
| `CollaboratorsContent.tsx` | `message.error('You must be logged in')`（两处） | **失败** |
| `predefine/page.tsx` | `message.success(\`Section "${sectionToDelete.name}" deleted successfully\`)` | **成功** |
| `predefine/page.tsx` | `message.error('Missing libraryId, cannot save')`（两处） | **失败** |
| `predefine/page.tsx` | `message.error(e?.message \|\| 'Failed to save')` | **失败** |
| `predefine/page.tsx` | `message.error('Missing libraryId, cannot delete')` | **失败** |
| `predefine/page.tsx` | `message.error('Section not found')` | **失败** |
| `predefine/page.tsx` | `message.error(e?.message \|\| 'Failed to delete section')` | **失败** |

#### D2. 警告/提示（无明确成功失败）

| 文件 | 调用 | 建议样式 |
|------|------|----------|
| `[projectId]/[libraryId]/page.tsx` | `message.warning('This library has been deleted')` | **默认**（或保留 warning 语义但视觉用默认样式） |

---

## 三、汇总统计

| 建议样式 | 使用场景数量（约） | 主要场景 |
|----------|--------------------|----------|
| **成功** | 约 15+ 处 | 邀请成功、复制/剪切/粘贴成功、行插入成功、库复制/恢复/删除版本/删除 Section、角色更新、移除协作者等 |
| **失败** | 约 18+ 处 | 粘贴失败、插入行失败、库复制/版本删除失败、角色更新/移除协作者失败、未登录、预定义保存/删除失败等 |
| **默认** | 约 5 处 | 无选中单元格、无内容可粘贴、请选择粘贴区域、类型不匹配前的提示、库已被删除的警告等 |

---

## 四、实现层面需要动到的位置（仅列清单，不写具体改法）

1. **`src/lib/utils/toast.ts`**  
   将 success/error/info/warning 的样式改为设计稿规定的背景色与文字色；如需支持「默认」样式，可增加 `type: 'default'` 或等价选项。

2. **`TableToast.tsx` + 调用方**  
   - TableToast 需支持按类型（success / error / default）切换样式。  
   - `useClipboardOperations.ts`、`useRowOperations.ts` 在调用 `setToastMessage` 时需传入类型（或改为调用统一 Toast 接口并传入类型），以便展示正确样式。

3. **`[projectId]/[libraryId]/page.tsx` 中的 Restore Toast**  
   改为使用统一 Toast 工具并传「成功」类型，或保留现有节点但应用设计稿成功样式。

4. **所有使用 AntD `message` 的页面/组件**  
   - 要么改为调用 `showToast` / `showSuccessToast` / `showErrorToast` 等统一工具；  
   - 要么在 AntD 的 `App`/`ConfigProvider` 中为 `message` 配置与设计稿一致的成功/失败/默认样式。

5. **样式统一**  
   确保全项目只存在设计稿的三种 Toast 样式（成功、失败、默认），无其它杂色或白字深底等与设计稿不符的表现。

---

## 五、设计稿颜色速查

| 类型 | 背景色 | 文字色 |
|------|--------|--------|
| 成功 | `#38B3632E` | `#0C8C57` |
| 失败 | `#FF000012` | `#ED3838` |
| 默认 | `#0B99FF14` | `#070707` |

以上为本次扫描与分类结果，未做任何代码修改，便于后续按「成功 / 失败 / 默认」统一改造 Toast 样式。
