# Yjs 快速开始指南

## 📦 第一步：安装包

```bash
cd /home/coco/pro/keco-studio
npm install yjs y-indexeddb
```

**说明**：
- `yjs`：核心库（必需）
- `y-indexeddb`：本地持久化（推荐，支持离线编辑）

**费用**：完全免费，MIT 开源许可证

**账户**：不需要注册任何账户

## ✅ 验证安装

安装完成后，TypeScript 类型错误应该消失。如果还有错误，重启 VS Code 或运行：

```bash
npm run build
```

## 🚀 第二步：使用

### 1. 在父组件中包裹 YjsProvider

找到使用 `LibraryAssetsTable` 的父组件，添加 `YjsProvider`：

```typescript
import { YjsProvider } from '@/contexts/YjsContext';

// 在你的页面组件中
<YjsProvider libraryId={libraryId}>
  <LibraryAssetsTable {...props} />
</YjsProvider>
```

### 2. 在 LibraryAssetsTable 中使用

```typescript
import { useYjs } from '@/contexts/YjsContext';
import { useYjsRows } from '@/hooks/useYjsRows';

export function LibraryAssetsTable({ ... }) {
  const { yRows } = useYjs();
  const yjsRows = useYjsRows(yRows);
  
  // 使用 yjsRows 替代原来的 rows
  // ...
}
```

## 📚 详细文档

- **完整指南**：查看 `docs/YJS_INTEGRATION_GUIDE.md`
- **代码示例**：查看 `docs/YJS_INTEGRATION_EXAMPLE.md`

## ❓ 常见问题

### Q: 安装后还有类型错误？

**A**: 重启 TypeScript 服务器（VS Code: `Cmd/Ctrl + Shift + P` -> "TypeScript: Restart TS Server"）

### Q: 需要配置什么吗？

**A**: 不需要，安装后即可使用。本地持久化会自动使用 IndexedDB。

### Q: 如何测试多人协作？

**A**: 
1. 打开两个浏览器窗口
2. 访问同一个表格页面
3. 在一个窗口中操作，另一个窗口应该立即看到变化

### Q: 需要服务器支持吗？

**A**: 目前使用本地持久化（IndexedDB），不需要服务器。后续可以集成 Supabase Realtime 实现真正的多人同步。

## 🎯 下一步

1. ✅ 安装包
2. ✅ 阅读完整指南
3. ✅ 按照示例修改代码
4. ✅ 测试功能

---

**预计时间**：安装 2 分钟，集成 1-2 天

