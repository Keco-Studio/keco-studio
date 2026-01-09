# Release 和 Main 分支测试环境隔离说明（工作日报版）

## 测试环境隔离机制

Release 分支（`release/v0.1.0`）和 Main 分支的测试环境通过**三层隔离机制**实现完全隔离：

### 1. Git 分支隔离（代码层面）
- Release 分支是 Main 分支在创建时的**快照**
- 两个分支的代码和 migration 文件**完全独立**
- Main 分支后续新增的 migration 文件**不会出现在** Release 分支

### 2. CI 环境隔离（执行层面）
- GitHub Actions 为每个分支创建**独立的虚拟环境**（Ubuntu 容器）
- 每个 CI 运行在**全新的容器**中，容器之间完全隔离
- 两个分支的 CI 可以**同时运行**，互不干扰

### 3. 本地 Supabase 实例隔离（数据库层面）
- 每个 CI 运行时启动**独立的本地 Supabase 实例**（Docker 容器）
- 每个容器有**独立的数据库**
- Main 分支的 CI 运行所有 migrations，Release 分支的 CI 只运行创建时的 migrations
- 数据库 schema 由各自分支的 migrations 决定，**完全隔离**

## 隔离效果

✅ **Main 分支修改表结构不会影响 Release 分支**
- Main 分支新增 migration → 只影响 Main 分支的数据库
- Release 分支的数据库保持创建时的 schema（稳定）

✅ **两个分支的 CI 可以同时全绿**
- 每个分支使用独立的测试环境
- 互不影响，可以并行运行

✅ **Release 分支保持稳定**
- 不受 Main 分支后续开发影响
- 确保发布版本的稳定性

---

**技术实现**：
- 使用本地 Supabase（避免远程连接问题）
- 通过 Git 分支管理不同版本的 migrations
- GitHub Actions 独立容器环境
- Docker 隔离的数据库实例

