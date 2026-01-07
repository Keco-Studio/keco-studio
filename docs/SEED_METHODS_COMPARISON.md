# Seed 方法对比说明

## 📋 概述

本项目有两种创建测试数据的方法，它们适用于不同的场景。

## 🔧 两种 Seed 方法

### 1️⃣ SQL Seed (`supabase/seed.sql`)

**适用场景：本地 Supabase**

```bash
# 启动本地 Supabase 时自动运行
supabase start
```

**特点：**
- ✅ **直接数据库操作**：通过 SQL 直接插入 `auth.users` 表
- ✅ **无需密钥**：数据库层面操作，不需要 API 密钥
- ✅ **速度快**：一次性批量插入，非常高效
- ✅ **完全控制**：可以设置所有字段，包括 `encrypted_password`
- ✅ **自动执行**：`supabase start` 时根据 `config.toml` 配置自动运行
- ✅ **幂等性**：本地环境每次都是全新容器，无需考虑重复执行

**实现方式：**
```sql
-- 使用 bcrypt 加密密码
with u as (
  select gen_random_uuid() as id,
         crypt('Password123!', gen_salt('bf')) as enc_pwd
)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, aud, role,
  email_confirmed_at, ...
)
select u.id, '00000000-0000-0000-0000-000000000000',
       'seed-empty@mailinator.com', u.enc_pwd, ...
from u;
```

**配置：**
```toml
# supabase/config.toml
[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

---

### 2️⃣ API Seed (`scripts/seed-via-api.ts`)

**适用场景：远程 Supabase**

```bash
# 需要环境变量
export NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."

# 手动运行
npm run seed:api
```

**特点：**
- ✅ **使用 Admin API**：通过 `supabase.auth.admin.createUser()` 创建用户
- ✅ **适合远程环境**：无需直接访问数据库
- ✅ **处理冲突**：自动检测用户是否已存在
- ✅ **幂等性好**：可以安全地重复运行
- ⚠️ **需要密钥**：必须有 `SUPABASE_SERVICE_ROLE_KEY`
- ⚠️ **速度较慢**：需要多次 API 调用
- ⚠️ **网络依赖**：需要网络连接到远程 Supabase

**实现方式：**
```typescript
const { data: newUser, error } = await supabase.auth.admin.createUser({
  email: user.email,
  password: user.password,
  email_confirm: true,
  user_metadata: {
    username: user.username,
  },
});

// 然后创建项目、库等数据
await supabase.from('projects').insert({ ... });
```

---

## 📊 对比表格

| 特性 | SQL Seed | API Seed |
|------|----------|----------|
| **适用环境** | 本地 Supabase | 远程 Supabase |
| **执行方式** | `supabase start` 自动 | `npm run seed:api` 手动 |
| **需要密钥** | ❌ 不需要 | ✅ 需要 service_role_key |
| **速度** | ⚡ 非常快（批量 SQL） | 🐌 较慢（多次 API 调用） |
| **网络依赖** | ❌ 不需要 | ✅ 需要 |
| **幂等性** | ⚠️ 本地重启即清空 | ✅ 自动检测重复 |
| **错误处理** | ⚠️ SQL 错误会中断 | ✅ 友好的错误提示 |
| **数据完整性** | ✅ 事务保证 | ⚠️ 多步骤可能部分失败 |
| **维护难度** | 中等（SQL 语法） | 低（TypeScript） |

---

## 🎯 使用建议

### 本地开发
```bash
# 推荐：使用 SQL Seed
supabase start  # 自动运行 seed.sql
npm run test:e2e
supabase stop
```

### 本地 CI（GitHub Actions）
```bash
# 推荐：使用 SQL Seed
supabase start  # 自动运行 seed.sql
npx playwright test
supabase stop
```

**为什么？**
- 本地 Supabase 每次都是全新容器
- 无需处理数据清理和冲突
- 速度更快，配置更简单

### 远程 Supabase CI（已弃用）
```bash
# 之前的方案：使用 API Seed
npm run clean:test-data  # 清理旧数据
npm run seed:api         # 通过 API 创建用户
npx playwright test
```

**为什么需要？**
- 远程数据库是持久化的，需要清理旧数据
- 无法直接访问数据库，必须通过 API
- 需要处理用户已存在的情况

---

## 🔄 从远程切换到本地后的变化

### 之前（远程 Supabase）

```yaml
# .github/workflows/playwright.yml
steps:
  - name: Clean test data
    run: npm run clean:test-data  # 清理远程数据库
  
  - name: Seed test users
    run: npm run seed:api  # 通过 API 创建用户
  
  - name: Run tests
    run: npx playwright test
```

**需要的环境变量：**
- `NEXT_PUBLIC_SUPABASE_URL` (GitHub Secret)
- `SUPABASE_SERVICE_ROLE_KEY` (GitHub Secret)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (GitHub Secret)

### 现在（本地 Supabase）

```yaml
# .github/workflows/playwright.yml
steps:
  - name: Install Supabase CLI
    run: npm install -g supabase@latest
  
  - name: Start Supabase
    run: supabase start  # 自动运行 seed.sql
  
  - name: Set environment variables
    run: |
      echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status --output json | jq -r '.anon_key')" >> $GITHUB_ENV
      echo "SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output json | jq -r '.service_role_key')" >> $GITHUB_ENV
  
  # 无需 clean:test-data
  # 无需 seed:api
  
  - name: Run tests
    run: npx playwright test
  
  - name: Stop Supabase
    if: always()
    run: supabase stop
```

**需要的环境变量：** 
- ✅ 无需任何 GitHub Secrets！
- ✅ 所有密钥由本地 Supabase 自动生成

---

## 📝 文件说明

### `supabase/seed.sql`
- **用途**：本地 Supabase 的 seed 数据
- **包含**：7 个测试用户 + 完整数据结构
- **执行时机**：`supabase start` 时自动运行
- **幂等性**：无需考虑（每次都是新容器）

### `supabase/seed-remote.sql`
- **用途**：远程 Supabase 的 SQL seed（备用方案）
- **包含**：与 `seed.sql` 相同的数据，但有重复检测逻辑
- **执行方式**：需要手动通过 Supabase CLI 或 Dashboard 执行
- **幂等性**：检查用户是否存在，更新密码

### `scripts/seed-via-api.ts`
- **用途**：通过 Admin API 创建用户（远程环境）
- **适用于**：
  - 远程 Supabase CI/CD
  - 无法直接访问数据库的环境
  - 需要通过 API 管理用户的场景
- **当前状态**：本地 CI 已不需要，但保留用于远程环境

### `scripts/clean-remote-test-data.ts`
- **用途**：清理远程 Supabase 的测试数据
- **适用于**：远程 Supabase 环境
- **当前状态**：本地 CI 已不需要，但保留用于手动清理

---

## ✅ 最佳实践总结

### 本地开发和 CI（当前方案）

1. **Seed 数据**：使用 `supabase/seed.sql`
   - ✅ 自动执行，无需手动操作
   - ✅ 速度快，配置简单
   - ✅ 无需任何密钥

2. **测试流程**：
   ```bash
   supabase start   # 自动 seed
   npm run test:e2e # 运行测试
   supabase stop    # 清理
   ```

### 远程 Supabase（如需要）

1. **Seed 数据**：使用 `scripts/seed-via-api.ts`
   - 需要 `SUPABASE_SERVICE_ROLE_KEY`
   - 处理用户重复创建
   - 适合持久化数据库

2. **测试流程**：
   ```bash
   npm run clean:test-data  # 清理旧数据
   npm run seed:api         # 创建用户
   npm run test:e2e         # 运行测试
   ```

---

## 🤔 常见问题

### Q: 为什么不在本地 CI 中使用 `seed-via-api.ts`？

A: 因为：
1. 本地 Supabase 每次都是全新容器，`seed.sql` 已经创建了所有用户
2. 无需额外的 API 调用，减少复杂度
3. 速度更快（SQL 批量插入 vs 多次 API 调用）
4. 不需要等待环境变量设置（service_role_key）

### Q: `seed-via-api.ts` 还有用吗？

A: 有用！它适用于：
- 远程 Supabase 环境
- 生产环境的测试数据管理
- 需要动态创建用户的场景
- 无法直接访问数据库的环境

### Q: 如果我想在本地测试远程 Supabase 怎么办？

A: 设置环境变量并使用 API seed：
```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# 运行
npm run clean:test-data
npm run seed:api
npm run test:e2e
```

### Q: 两个 seed 文件的数据一致吗？

A: 是的！`seed.sql` 和 `seed-via-api.ts` 创建的用户和数据结构完全一致：
- 相同的邮箱和密码
- 相同的项目、库、资产结构
- 确保测试在不同环境中的一致性

---

**最后更新**: 2026-01-07  
**维护者**: Development Team

