# GitHub Actions Workflows 说明

## 当前使用的工作流

### `playwright.yml` - 优化后的 Playwright 测试（已启用）✅

**特点**:
- ✅ npm 依赖缓存
- ✅ Playwright 浏览器缓存
- ✅ 只安装 chromium 浏览器
- ✅ 条件性安装（缓存命中时跳过浏览器下载）
- ✅ 串行测试执行（适合有依赖关系的测试）

**性能**:
- 首次运行: ~5-8 分钟
- 后续运行: ~3-5 分钟（节省 ~90-120 秒）

**适用场景**: 
- ✅ 当前项目（测试有依赖关系）
- ✅ 需要稳定可靠的测试执行
- ✅ 测试数量较少（< 50 个测试）

---

## 可选的工作流配置

### `playwright-advanced.yml.example` - 进阶优化版本

**额外特点**:
- Next.js 构建缓存
- 只在相关文件改变时运行测试（路径过滤）
- 减少报告保留时间（节省存储空间）
- 只在失败时上传报告

**性能提升**: 
- 额外节省 10-30 秒（Next.js 构建缓存）
- 减少不必要的 CI 运行

**使用方法**:
```bash
# 重命名文件以启用
mv .github/workflows/playwright-advanced.yml.example .github/workflows/playwright.yml
```

**适用场景**:
- 频繁提交的活跃项目
- 想要节省 CI 配额
- 需要最大化性能

---

### `playwright-parallel.yml.example` - 并行测试版本

**特点**:
- 使用测试分片（4 个并行任务）
- 自动合并测试报告
- 所有优化措施

**性能提升**: 
- 理论上可减少 **50-75%** 测试时间
- 4 个分片并行运行

**⚠️ 限制**:
- **需要重构测试以支持并行运行**
- 目前项目测试是串行的，不能直接使用
- 需要更多 CI 配额（4 个并行任务）

**使用方法**:
1. 首先重构测试（参考 `docs/PLAYWRIGHT_CI_OPTIMIZATION.md`）
2. 确认测试可以并行运行
3. 重命名文件以启用：
```bash
mv .github/workflows/playwright-parallel.yml.example .github/workflows/playwright.yml
```

**适用场景**:
- 测试已重构支持并行
- 测试数量较多（> 50 个测试）
- 有足够的 CI 配额

---

## 性能对比

| 配置 | 首次运行 | 后续运行 | 适用场景 |
|------|----------|----------|----------|
| **原始配置** | ~8-10 分钟 | ~6-8 分钟 | 基础配置 |
| **playwright.yml (当前)** | ~5-8 分钟 | ~3-5 分钟 | ✅ 推荐 |
| **playwright-advanced.yml** | ~5-7 分钟 | ~2.5-4 分钟 | 高级优化 |
| **playwright-parallel.yml** | ~3-4 分钟 | ~1-2 分钟 | 需重构测试 |

---

## 快速开始

### 场景 1: 保持当前配置（推荐）
什么都不用做！`playwright.yml` 已经优化完成。

### 场景 2: 启用进阶优化
```bash
# 备份当前配置
cp .github/workflows/playwright.yml .github/workflows/playwright.yml.backup

# 启用进阶配置
mv .github/workflows/playwright-advanced.yml.example .github/workflows/playwright.yml
```

### 场景 3: 启用并行测试（需要重构）
```bash
# 1. 首先阅读优化指南
cat docs/PLAYWRIGHT_CI_OPTIMIZATION.md

# 2. 重构测试以支持并行运行

# 3. 启用并行配置
mv .github/workflows/playwright-parallel.yml.example .github/workflows/playwright.yml
```

---

## 监控和调试

### 查看运行时间
1. 访问 GitHub 仓库的 **Actions** 标签页
2. 点击任意工作流运行
3. 查看每个步骤的执行时间

### 常见问题

**Q: 为什么第一次运行还是很慢？**
A: 第一次运行需要下载并缓存依赖和浏览器，这是正常的。后续运行会快很多。

**Q: 缓存多久会过期？**
A: 
- npm 缓存: 7 天不使用会自动清理
- Playwright 浏览器缓存: 当版本改变时会失效

**Q: 如何清除缓存？**
A: 在 GitHub 仓库设置中：Settings > Actions > Caches > 删除特定缓存

**Q: 并行测试失败怎么办？**
A: 检查测试是否有依赖关系或共享状态，需要重构测试使其独立。

---

## 更多信息

- 详细优化指南: `docs/PLAYWRIGHT_CI_OPTIMIZATION.md`
- CI 测试指南: `CI_TEST_GUIDE.md`
- Playwright 文档: https://playwright.dev/docs/ci
- GitHub Actions 缓存: https://docs.github.com/actions/using-workflows/caching-dependencies-to-speed-up-workflows

