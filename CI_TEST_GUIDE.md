# CI 测试指南 - GitHub Actions

## 📊 当前状态

✅ **本地测试成功**：
- `npx playwright test tests/e2e/specs/happy-path.spec.ts --headed` ✅
- `npx playwright test tests/e2e/specs/destructive.spec.ts --headed` ✅

## 🚨 发现的 CI 潜在问题

### 1. **测试执行顺序问题** ⚠️ CRITICAL

**问题**：
- `destructive.spec.ts` 依赖于 `happy-path.spec.ts` 创建的数据
- 之前配置 `fullyParallel: true` 可能导致测试乱序执行
- 两个测试使用同一个用户 `users.seedEmpty`，可能产生冲突

**修复**：
```typescript
// playwright.config.ts (已修复)
fullyParallel: false,  // 改为顺序执行
workers: 1,            // 只用 1 个 worker
```

**验证测试顺序**：
```bash
npx playwright test --list
# 应该显示：
# happy-path.spec.ts
# destructive.spec.ts
```

---

### 2. **slowMo 导致 CI 超时** 🐌

**问题**：
- 之前配置 `slowMo: 1000` 在所有环境生效
- 每个操作延迟 1 秒，会让测试非常慢
- 可能导致 CI 超时（60 分钟限制）

**修复**：
```typescript
// playwright.config.ts (已修复)
slowMo: process.env.CI ? 0 : 1000,  // 只在本地开发时减速
```

---

### 3. **数据清理时机** ⚠️

**当前流程**：
```yaml
# .github/workflows/playwright.yml
1. Seed test users (npm run seed:api)
2. Clean test data (npm run clean:test-data)  # 清理所有项目数据
3. Run tests (npm run test:e2e:sequential)    # happy-path 创建数据 → destructive 删除数据
```

这个流程是**正确的**：
- ✅ 先清理旧数据
- ✅ happy-path 创建新数据
- ✅ destructive 删除数据
- ✅ 下次运行前再次清理

---

## ✅ 已应用的修复

### 1. Playwright 配置优化

```typescript
// playwright.config.ts
export default defineConfig({
  fullyParallel: false,  // ✅ 顺序执行
  workers: 1,            // ✅ 单 worker
  use: {
    launchOptions: {
      slowMo: process.env.CI ? 0 : 1000,  // ✅ CI 中不减速
    },
  },
});
```

### 2. 新增测试脚本

```json
// package.json
{
  "scripts": {
    "test:e2e:sequential": "playwright test tests/e2e/specs/happy-path.spec.ts tests/e2e/specs/destructive.spec.ts",
    "test:happy": "playwright test tests/e2e/specs/happy-path.spec.ts",
    "test:destructive": "playwright test tests/e2e/specs/destructive.spec.ts"
  }
}
```

### 3. GitHub Actions 优化

```yaml
# .github/workflows/playwright.yml
- name: Run Playwright tests (sequential)
  run: npm run test:e2e:sequential  # ✅ 明确顺序执行
  continue-on-error: false          # ✅ 失败立即停止
```

---

## 🧪 测试验证步骤

### 本地验证

```bash
# 1. 清理数据
npm run clean:test-data

# 2. 运行顺序测试
npm run test:e2e:sequential

# 3. 或者分别运行
npm run test:happy
npm run test:destructive
```

### CI 验证

提交代码到 GitHub，GitHub Actions 会自动：

1. ✅ Seed 测试用户
2. ✅ 清理旧数据
3. ✅ 按顺序运行测试：
   - `happy-path.spec.ts` (创建数据)
   - `destructive.spec.ts` (删除数据)
4. ✅ 生成测试报告

---

## 📝 最佳实践建议

### 选项 A：继续使用当前方案（推荐）

**优点**：
- ✅ 简单直接
- ✅ 已经修复了主要问题
- ✅ 适合小型项目

**配置**：
```typescript
fullyParallel: false,
workers: 1,
```

### 选项 B：启用并行测试（未来优化）

如果想要更快的测试速度，可以让测试使用不同的用户：

```typescript
// happy-path.spec.ts
await loginPage.login(users.seedEmpty2);  // 改用 seedEmpty2

// destructive.spec.ts
await loginPage.login(users.seedEmpty3);  // 改用 seedEmpty3
```

然后启用并行：
```typescript
// playwright.config.ts
fullyParallel: true,
workers: process.env.CI ? 2 : undefined,
```

**优点**：
- ⚡ 测试速度快 50%
- ✅ 测试互不干扰

**缺点**：
- ❌ 需要更多测试账户
- ❌ 配置更复杂

---

## 🔍 监控和调试

### 查看 CI 测试结果

1. 前往 GitHub → Actions 标签页
2. 点击最新的 workflow 运行
3. 查看 "Run Playwright tests (sequential)" 步骤
4. 下载 playwright-report artifact 查看详细报告

### 常见 CI 失败原因

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| Timeout after 5000ms | 元素未找到 | 检查选择器是否正确 |
| Project not found | 测试顺序错误 | 确认 happy-path 先运行 |
| Auth failed | 环境变量未设置 | 检查 GitHub Secrets |
| Slow tests | slowMo 在 CI 中启用 | 已修复：`slowMo: process.env.CI ? 0 : 1000` |

---

## ✨ 总结

### 回答你的问题：会执行成功吗？

**答案：是的，现在应该可以成功！** ✅

已修复的关键问题：
1. ✅ 测试顺序：从并行改为顺序执行
2. ✅ 性能优化：CI 中移除 slowMo 延迟
3. ✅ 明确执行：使用专门的 `test:e2e:sequential` 脚本
4. ✅ 错误处理：移除 `continue-on-error`

### 下一步

```bash
# 1. 提交修改
git add .
git commit -m "fix: optimize CI test execution order and performance"
git push

# 2. 查看 GitHub Actions 运行结果
# 前往: https://github.com/[your-repo]/actions

# 3. 如果失败，下载 playwright-report 查看详情
```

### 预期 CI 执行时间

- **之前**（with slowMo）：~10-15 分钟
- **现在**（without slowMo）：~2-3 分钟 ⚡

---

## 📞 需要帮助？

如果 CI 测试仍然失败：

1. 检查 GitHub Actions 日志
2. 下载 playwright-report artifact
3. 检查环境变量是否正确设置
4. 验证 Supabase 凭据是否有效

祝测试顺利！🎉

