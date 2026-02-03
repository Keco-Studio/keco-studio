# E2E 测试

## 环境要求

- Node.js 与项目依赖已安装
- 本地或远程 Supabase 已配置（`.env.local`）
- 开发服务可启动：`npm run dev`

## 浏览器依赖（WSL / 精简 Linux）

在 WSL 或缺少图形库的 Linux 下，Playwright 自带的 Chromium 可能因缺少系统库无法启动，例如：

```text
error while loading shared libraries: libnspr4.so: cannot open shared object file
```

**处理方式：安装系统依赖后再跑测试：**

```bash
# 安装 Playwright 所需系统依赖（需 sudo）
sudo npx playwright install-deps

# 若未安装过浏览器，再执行
npx playwright install chromium
```

然后再执行：

```bash
npx playwright test tests/e2e/specs/edit-info.spec.ts --headed
```

## 运行编辑框相关测试

```bash
# 带界面运行编辑信息测试
npm run test:e2e:edit-info

# 或直接使用 playwright
npx playwright test tests/e2e/specs/edit-info.spec.ts --headed
```

测试账号需为项目 **admin**（如 `seed-empty@mailinator.com`），才能看到并操作「Library info / Project info / Rename」等菜单。

## 登录失败 / 点击 Login 超时

若测试卡在「点击 Login 按钮」超时，或登录后等待跳转超时，请确认：

1. **测试账号已存在**：`edit-info` 等用例使用 `seed-empty@mailinator.com` / `Password123!`，需在 Supabase 中已有该用户（可用 seed 脚本或手动注册）。
2. **环境变量正确**：`.env.local` 中 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 指向要测试的 Supabase 项目。
3. **网络可达**：本机能访问 Supabase（无代理/防火墙拦截）。
