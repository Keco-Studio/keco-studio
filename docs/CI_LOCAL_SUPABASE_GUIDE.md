# CI 本地 Supabase 配置指南

## 📋 概述

本指南说明如何在 GitHub Actions CI 环境中使用**本地 Supabase**（而非远程 Supabase）运行 Playwright E2E 测试。

## 🎯 为什么使用本地 Supabase？

### ✅ 优势
- **隔离性**：每次 CI 运行都有完全独立的数据库
- **速度快**：无需清理远程数据，本地 Docker 容器启动即可
- **成本低**：无需消耗远程 Supabase 配额
- **一致性**：每次测试都从相同的干净状态开始
- **无需配置 GitHub Secrets**：不再需要设置远程 Supabase 凭据

### ⚠️ 注意事项
- CI 运行时间会增加（启动 Supabase 约需 30-60 秒）
- 需要 Docker 支持（GitHub Actions Ubuntu runners 已预装）
- 测试数据不持久化（这通常是我们想要的）

## 🔄 主要变化

### 1. GitHub Actions Workflow 变化

**之前（远程 Supabase）：**
```yaml
env:
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

steps:
  - name: Clean test data before seeding
    run: npm run clean:test-data
  - name: Seed test users
    run: npm run seed:api
  - name: Run tests
    run: npx playwright test
```

**现在（本地 Supabase）：**
```yaml
env:
  NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '' # 动态设置
  SUPABASE_SERVICE_ROLE_KEY: '' # 动态设置

steps:
  - name: Install Supabase CLI
    run: npm install -g supabase@latest
  
  - name: Start Supabase
    run: supabase start  # 自动运行 migrations 和 seed.sql
  
  - name: Set Supabase environment variables
    run: |
      echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status --output json | jq -r '.anon_key')" >> $GITHUB_ENV
      echo "SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output json | jq -r '.service_role_key')" >> $GITHUB_ENV
  
  # 无需运行 seed:api - seed.sql 已自动执行
  
  - name: Run tests
    run: npx playwright test
  
  - name: Stop Supabase
    if: always()
    run: supabase stop
```

### 2. 关键改进

#### a) 无需 GitHub Secrets
之前需要在 GitHub 仓库设置以下 Secrets：
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

现在这些都由本地 Supabase 自动生成。

#### b) 自动数据库初始化
本地 Supabase 启动时会自动：
1. 运行所有 migrations（`supabase/migrations/*.sql`）
2. 运行 seed 文件（`supabase/seed.sql`）- 创建所有测试用户和数据

所以：
- ✅ 无需手动清理数据（`clean:test-data`）
- ✅ 无需通过 API 创建用户（`seed:api`）- `seed.sql` 直接在数据库层面创建

#### c) 完全隔离
每次 `supabase start` 都会创建新的 Docker 容器，确保测试环境完全干净。

## 🚀 使用方法

### 本地测试（模拟 CI 环境）

```bash
# 1. 启动本地 Supabase（会自动运行 supabase/seed.sql）
supabase start

# 2. 运行测试
npx playwright test

# 3. 停止 Supabase
supabase stop
```

**注意**：
- `supabase start` 会自动运行 `supabase/seed.sql`，创建所有测试用户和数据
- 无需手动运行 `npm run seed:api`（那是为远程 Supabase 设计的）
- 无需手动设置环境变量（Playwright 配置会从 `supabase status` 获取）

### CI 测试

直接推送代码到 GitHub，GitHub Actions 会自动：
1. ✅ 启动本地 Supabase（自动运行 migrations 和 seed.sql）
2. ✅ 设置环境变量（从 `supabase status` 获取密钥）
3. ✅ 运行 Playwright 测试（4 个并行分片）
4. ✅ 停止 Supabase（清理 Docker 容器）

## 📊 性能对比

| 指标 | 远程 Supabase | 本地 Supabase |
|------|--------------|--------------|
| **启动时间** | ~5 秒 | ~30-60 秒 |
| **清理数据** | 需要（~10 秒） | 不需要 |
| **测试运行** | ~2-3 分钟 | ~2-3 分钟 |
| **总时间** | ~2.5-3.5 分钟 | ~2.5-4 分钟 |
| **配置复杂度** | 高（需要 Secrets） | 低 |
| **数据隔离** | 中等 | 完美 |

## 🔧 故障排除

### 问题 1: `supabase start` 失败

**错误信息：**
```
Error: Docker is not running
```

**解决方案：**
GitHub Actions Ubuntu runners 已预装 Docker，通常不会出现此问题。如果出现，检查 workflow 配置。

### 问题 2: 环境变量未设置

**错误信息：**
```
❌ Missing required environment variables: SUPABASE_SERVICE_ROLE_KEY
```

**解决方案：**
确保在 "Set Supabase environment variables" 步骤之后运行测试脚本。

### 问题 3: 端口冲突

**错误信息：**
```
Error: Port 54321 is already in use
```

**解决方案：**
确保在 workflow 结束时执行 `supabase stop`（使用 `if: always()`）。

### 问题 4: Migrations 失败

**错误信息：**
```
Error: migration 20240101000000_init.sql failed
```

**解决方案：**
检查 `supabase/migrations/` 中的 SQL 文件是否有语法错误。本地测试：
```bash
supabase db reset
```

## 📝 配置文件

### supabase/config.toml

本地 Supabase 的配置已经在 `supabase/config.toml` 中设置好：

```toml
[api]
port = 54321  # API 端口

[db]
port = 54322  # PostgreSQL 端口

[studio]
port = 54323  # Supabase Studio 端口

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]  # 自动运行 seed
```

### supabase/seed.sql

本地 Supabase 使用 `seed.sql` 文件创建测试数据：
- 直接通过 SQL 插入到 `auth.users` 表（绕过 API）
- 创建完整的测试数据结构（项目、库、资产等）
- 比通过 API 创建更快、更可靠
- 无需 `service_role_key`（因为是数据库层面的操作）

**对比**：
- **远程 Supabase**：使用 `seed-via-api.ts` 通过 Admin API 创建用户（需要 service_role_key）
- **本地 Supabase**：使用 `seed.sql` 直接在数据库层面创建用户（无需任何密钥）

### playwright.config.ts

Playwright 配置无需修改，仍然使用 `http://localhost:3000` 作为 baseURL。

## 🔐 安全性

### 本地 Supabase 凭据
本地 Supabase 使用默认的开发凭据：
- **Anon Key**: 每次启动相同（用于前端）
- **Service Role Key**: 每次启动相同（仅用于测试 seed）
- **Database Password**: `postgres`（仅本地访问）

这些凭据：
- ✅ **安全**：仅在本地 Docker 容器中有效
- ✅ **不持久化**：容器停止后立即失效
- ✅ **无需保密**：不连接任何生产数据

### 生产环境凭据
生产环境继续使用 Vercel 环境变量中的远程 Supabase 凭据（在 Vercel 项目设置中配置）。

## 🆚 远程 vs 本地 Supabase

### 何时使用远程 Supabase？
- 测试需要持久化数据
- 需要测试与远程 Supabase 的集成
- 需要测试 RLS（Row Level Security）策略
- 需要测试 Edge Functions

### 何时使用本地 Supabase？
- E2E 测试（当前场景）✅
- 开发环境测试 ✅
- 快速迭代 ✅
- CI/CD 流水线 ✅

## 📚 相关文档

- [Seed 方法对比说明](./SEED_METHODS_COMPARISON.md) - 详细对比 SQL Seed vs API Seed
- [Supabase CLI 文档](https://supabase.com/docs/guides/cli)
- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
- [GitHub Actions Docker](https://docs.github.com/en/actions/using-containerized-services/about-service-containers)

## ✅ 迁移检查清单

- [x] 更新 `.github/workflows/playwright.yml`
- [x] 移除 GitHub Secrets 依赖（可选保留用于其他用途）
- [x] 验证 `supabase/config.toml` 配置
- [x] 测试本地 Supabase 启动（`supabase start`）
- [x] 验证 seed 脚本兼容性
- [ ] 在 CI 中运行一次完整测试
- [ ] 更新团队文档

## 🎉 总结

通过切换到本地 Supabase，我们实现了：
1. ✅ **简化配置**：无需管理 GitHub Secrets
2. ✅ **提高隔离性**：每次测试完全独立
3. ✅ **降低成本**：不消耗远程 Supabase 配额
4. ✅ **改善可维护性**：测试环境更可预测

CI 测试时间略有增加（+30-60 秒），但带来的好处远超过这点开销。

---

**最后更新**: 2026-01-07  
**维护者**: Development Team

