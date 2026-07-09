# Keco Studio - 项目架构文档

**文档版本**: 1.0  
**创建日期**: 2026-01-30  
**项目**: Keco Studio - 协作式资产管理平台  
**技术栈**: Next.js 16 + Supabase + Yjs + React 19

---

## 📋 目录

1. [项目概述](#项目概述)
2. [系统架构](#系统架构)
3. [技术栈详解](#技术栈详解)
4. [目录结构](#目录结构)
5. [核心模块](#核心模块)
6. [数据库架构](#数据库架构)
7. [关键数据流](#关键数据流)
8. [实时协作架构](#实时协作架构)
9. [认证与授权](#认证与授权)
10. [API 路由](#api-路由)
11. [状态管理](#状态管理)
12. [文件上传与存储](#文件上传与存储)
13. [版本控制](#版本控制)
14. [测试架构](#测试架构)
15. [部署架构](#部署架构)
16. [已知痛点](#已知痛点)

---

## 项目概述

### 项目简介

Keco Studio 是一个**多人实时协作的资产管理平台**，允许团队创建项目、定义资产库（Libraries）、管理资产（Assets）及其自定义字段，并支持实时多人编辑、版本控制、权限管理等功能。

### 核心功能

1. **项目管理**: 创建、编辑、删除项目
2. **资产库管理**: 在项目下创建多个资产库，每个库可自定义字段结构
3. **资产管理**: 在库中创建资产，填写自定义字段值，支持多种数据类型
4. **实时协作**: 多用户同时编辑，支持 presence tracking（显示谁在编辑什么）
5. **版本控制**: 为资产库创建版本快照，支持恢复到历史版本
6. **权限管理**: 基于角色的访问控制（Admin/Editor/Viewer）
7. **文件上传**: 支持图片和媒体文件上传
8. **文件夹组织**: 支持文件夹层级结构组织资产库

### 目标用户

- 游戏开发团队（管理游戏资产）
- 内容创作团队（管理媒体资源）
- 产品团队（管理产品需求和规格）

---

## 系统架构

### 高层架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Next.js 16 App Router (React 19)               │   │
│  │  • Server Components (RSC)                                │   │
│  │  • Client Components ('use client')                       │   │
│  │  • API Routes (/app/api/*)                                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                    State & Collaboration Layer                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ React Query  │  │  Yjs (CRDT)  │  │  Supabase Realtime   │  │
│  │ (Data Cache) │  │  (Local Doc) │  │  (Presence/Updates)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │          Context Providers                                │   │
│  │  • AuthContext  • LibraryDataContext                      │   │
│  │  • PresenceContext  • NavigationContext                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                      Backend & Data Layer                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Supabase Backend                        │   │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────────┐   │   │
│  │  │ PostgreSQL │  │   Auth     │  │   Storage        │   │   │
│  │  │   (RLS)    │  │  (JWT)     │  │  (S3-compatible) │   │   │
│  │  └────────────┘  └────────────┘  └──────────────────┘   │   │
│  │  ┌────────────┐  ┌────────────┐                          │   │
│  │  │  Realtime  │  │  Functions │                          │   │
│  │  │ (Presence) │  │  (SQL)     │                          │   │
│  │  └────────────┘  └────────────┘                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                      Persistence Layer                           │
│  ┌──────────────────┐  ┌──────────────────────────────────┐    │
│  │ Supabase DB      │  │  Browser Session Storage         │    │
│  │ + Storage        │  │  (Auth Runtime State)            │    │
│  └──────────────────┘  └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 架构分层说明

#### 1. Client Layer (客户端层)
- **Next.js App Router**: 使用 Next.js 16 的 App Router 架构
- **Server Components**: 用于初始数据加载和SEO优化
- **Client Components**: 用于交互式UI和实时更新
- **API Routes**: 处理服务器端业务逻辑

#### 2. State & Collaboration Layer (状态与协作层)
- **React Query (@tanstack/react-query)**: 数据获取和缓存管理
- **Yjs**: CRDT (Conflict-free Replicated Data Type) 用于本地文档状态
- **Supabase Realtime**: 实时数据库订阅和presence tracking
- **Context Providers**: React Context 用于全局状态管理

#### 3. Backend & Data Layer (后端与数据层)
- **Supabase**: BaaS (Backend as a Service)
  - PostgreSQL 数据库（带Row Level Security）
  - Authentication (JWT-based)
  - Storage (文件存储)
  - Realtime (WebSocket连接)
  - Database Functions (存储过程)

#### 4. Persistence Layer (持久化层)
- **Supabase PostgreSQL**: 资产库、资产、字段值、权限和版本快照的持久数据源
- **Supabase Storage**: 图片和媒体文件的持久存储
- **Browser Session Storage**: Supabase SSR/browser client 的会话运行状态；Yjs 文档不使用本地持久化层

---

## 技术栈详解

### 前端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Next.js** | 16.2.10 | React 框架，App Router，SSR/SSG |
| **React** | 19.2.7 | UI 库 |
| **React DOM** | 19.2.7 | React 渲染 |
| **TypeScript** | 5.9.3 | 类型安全 |
| **Ant Design** | 5.22.2 | UI 组件库 |
| **@tanstack/react-query** | 5.90.16 | 数据获取和缓存 |
| **Yjs** | 13.6.29 | CRDT 实时协作 |
| **@dnd-kit** | 6.3.1 | 拖拽功能 |
| **Zod** | 3.22.4 | Schema 验证 |

### 后端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Supabase** | 2.87.1 | BaaS 平台 |
| **@supabase/ssr** | 0.8.0 | Next.js SSR 集成 |
| **PostgreSQL** | (Supabase管理) | 关系型数据库 |
| **Resend** | 6.17.1 | 邮件发送服务 |
| **Jose** | 6.1.3 | JWT 处理 |

### 开发与测试工具

| 技术 | 版本 | 用途 |
|------|------|------|
| **Playwright** | 1.57.0 | E2E 测试 |
| **ESLint** | 9.0.0 | 代码检查 |
| **Autoprefixer** | 10.4.22 | CSS 自动前缀 |
| **PostCSS** | 8.5.6 | CSS 处理 |

---

## 目录结构

### 项目根目录

```
keco-studio/
├── src/                    # 源代码目录
│   ├── app/                # Next.js App Router 页面和路由
│   ├── components/         # React 组件
│   ├── lib/                # 核心库和工具
│   ├── assets/             # 静态导入资源
│   ├── emails/             # 邮件模板
│   └── middleware.ts       # Next.js 中间件（认证检查）
├── supabase/               # Supabase 配置和迁移
│   ├── migrations/         # 数据库迁移文件（40+ 个迁移）
│   ├── config.toml         # Supabase 配置
│   ├── seed.sql            # 本地开发种子数据
│   └── seed-remote.sql     # 远程数据库种子数据
├── tests/                  # Playwright E2E 测试
│   └── e2e/
│       ├── pages/          # Page Object Model
│       ├── specs/          # 测试规格
│       └── fixtures/       # 测试固定装置
├── docs/                   # 文档目录
│   ├── architecture/       # 架构文档（本文档）
│   ├── CI_SETUP.md         # CI/CD 设置指南
│   └── ENVIRONMENT_SETUP.md # 环境配置指南
├── specs/                  # 功能规格（使用 speckit）
├── scripts/                # 构建和工具脚本
├── public/                 # 静态资源
├── types/                  # 全局 TypeScript 类型定义
├── package.json            # 依赖配置
├── tsconfig.json           # TypeScript 配置
├── playwright.config.ts    # Playwright 配置
└── next.config.mjs         # Next.js 配置
```

### src/ 目录详细结构

```
src/
├── app/                              # Next.js 16 App Router
│   ├── (dashboard)/                  # 路由组（共享布局）
│   │   ├── layout.tsx                # Dashboard 布局
│   │   ├── page.tsx                  # Dashboard 首页（重定向到 /projects）
│   │   ├── projects/
│   │   │   └── page.tsx              # 项目列表页
│   │   └── [projectId]/              # 动态路由：项目详情
│   │       ├── page.tsx              # 项目详情页
│   │       ├── collaborators/
│   │       │   └── page.tsx          # 协作者管理页
│   │       ├── folder/
│   │       │   └── [folderId]/
│   │       │       └── page.tsx      # 文件夹详情页
│   │       └── [libraryId]/          # 动态路由：资产库
│   │           ├── layout.tsx        # 库布局（带侧边栏）
│   │           ├── page.tsx          # 库主页（资产表格）
│   │           ├── predefine/        # 字段定义页面
│   │           │   ├── page.tsx
│   │           │   ├── components/   # 字段定义组件
│   │           │   ├── hooks/        # 字段定义 hooks
│   │           │   ├── types.ts
│   │           │   ├── utils.ts
│   │           │   └── validation.ts
│   │           └── [assetId]/        # 动态路由：资产详情
│   │               └── page.tsx
│   ├── api/                          # API 路由
│   │   ├── projects/
│   │   │   ├── route.ts              # POST /api/projects (创建项目)
│   │   │   └── [projectId]/
│   │   │       ├── libraries/
│   │   │       │   └── route.ts      # POST 创建库
│   │   │       ├── folders/
│   │   │       │   └── route.ts      # POST 创建文件夹
│   │   │       ├── role/
│   │   │       │   └── route.ts      # GET 获取用户角色
│   │   │       └── delete/
│   │   │           └── route.ts      # DELETE 删除项目
│   │   ├── libraries/
│   │   │   └── [libraryId]/
│   │   │       └── route.ts          # PUT/DELETE 库操作
│   │   ├── collaborators/
│   │   │   ├── route.ts              # GET 获取协作者
│   │   │   └── [collaboratorId]/
│   │   │       └── route.ts          # DELETE 删除协作者
│   │   └── invitations/
│   │       ├── route.ts              # POST 发送邀请
│   │       ├── accept/
│   │       │   └── route.ts          # POST 接受邀请
│   │       └── decline/
│   │           └── route.ts          # POST 拒绝邀请
│   ├── auth/
│   │   ├── callback/                 # Supabase 认证回调
│   │   │   └── page.tsx
│   │   └── reset-password/           # 重置密码页
│   │       └── page.tsx
│   ├── accept-invitation/            # 接受邀请页
│   │   ├── page.tsx
│   │   └── AcceptInvitationContent.tsx
│   ├── decline-invitation/           # 拒绝邀请页
│   │   └── page.tsx
│   ├── forgot-password/              # 忘记密码页
│   │   └── page.tsx
│   ├── assets/                       # 资产详情（可能已废弃）
│   ├── realtime-test/                # Realtime 测试页（开发用）
│   ├── layout.tsx                    # 全局布局
│   ├── page.tsx                      # 首页（登录页）
│   └── globals.css                   # 全局样式
├── components/                       # 可复用组件
│   ├── layout/                       # 布局组件
│   │   ├── Sidebar.tsx               # 侧边栏（2330行，复杂组件）
│   │   ├── TopBar.tsx                # 顶部导航栏
│   │   ├── DashboardLayout.tsx       # Dashboard 布局容器
│   │   └── ContextMenu.tsx           # 右键菜单
│   ├── projects/                     # 项目相关组件
│   │   ├── NewProjectModal.tsx
│   │   └── EditProjectModal.tsx
│   ├── libraries/                    # 资产库组件（核心模块）
│   │   ├── LibraryAssetsTable.tsx    # 主表格组件（2335行）
│   │   ├── LibraryAssetsTableAdapter.tsx  # 表格适配器
│   │   ├── LibraryAssetsTableModals.tsx   # 表格相关弹窗
│   │   ├── LibraryHeader.tsx         # 库头部
│   │   ├── NewLibraryModal.tsx
│   │   ├── EditLibraryModal.tsx
│   │   ├── AddLibraryMenu.tsx
│   │   ├── components/               # 库子组件
│   │   │   ├── CellEditor.tsx        # 单元格编辑器
│   │   │   ├── ReferenceField.tsx    # 引用字段
│   │   │   ├── TableHeader.tsx       # 表头
│   │   │   ├── RowContextMenu.tsx    # 行右键菜单
│   │   │   ├── CellPresenceAvatars.tsx  # 协作头像
│   │   │   ├── AssetCardPanel.tsx    # 资产卡片面板
│   │   │   ├── TableToast.tsx        # 表格提示
│   │   │   ├── BatchEditMenu.tsx     # 批量编辑菜单
│   │   │   └── EmptyState.tsx        # 空状态
│   │   ├── hooks/                    # 表格专用 hooks（关键模块）
│   │   │   ├── useTableDataManager.ts  # 表格数据管理
│   │   │   ├── useRowOperations.ts   # 行操作
│   │   │   ├── useCellEditing.ts     # 单元格编辑
│   │   │   ├── useCellSelection.ts   # 单元格选择
│   │   │   ├── useClipboardOperations.ts  # 剪贴板操作
│   │   │   ├── useClipboardShortcuts.ts   # 剪贴板快捷键
│   │   │   ├── useBatchFill.ts       # 批量填充
│   │   │   ├── useAddRow.ts          # 添加行
│   │   │   ├── useReferenceModal.ts  # 引用弹窗
│   │   │   ├── useYjsSync.ts         # Yjs 同步
│   │   │   ├── useResolvedRows.ts    # 解析行数据
│   │   │   ├── useClickOutsideAutoSave.ts  # 点击外部自动保存
│   │   │   ├── useOptimisticCleanup.ts     # 乐观更新清理
│   │   │   ├── useUserRole.ts        # 用户角色
│   │   │   ├── useTableMenuPosition.ts     # 表格菜单位置
│   │   │   ├── useCloseOnDocumentClick.ts  # 点击关闭
│   │   │   └── useAssetHover.ts      # 资产悬停
│   │   └── utils/
│   │       └── libraryAssetUtils.ts  # 资产工具函数
│   ├── asset/                        # 资产详情组件
│   │   ├── AssetHeader.tsx
│   │   ├── EditAssetModal.tsx
│   │   ├── AssetReferenceSelector.tsx
│   │   └── AssetReferenceModal.tsx
│   ├── folders/                      # 文件夹组件
│   │   ├── LibraryCard.tsx
│   │   ├── FolderCard.tsx
│   │   ├── LibraryListView.tsx
│   │   ├── LibraryToolbar.tsx
│   │   ├── NewFolderModal.tsx
│   │   └── EditFolderModal.tsx
│   ├── collaboration/                # 协作组件
│   │   ├── CollaboratorsList.tsx
│   │   ├── InviteCollaboratorModal.tsx
│   │   ├── StackedAvatars.tsx
│   │   ├── ConnectionStatusIndicator.tsx
│   │   └── FieldPresenceAvatars.tsx
│   ├── version-control/              # 版本控制组件
│   │   ├── VersionControlSidebar.tsx
│   │   ├── VersionList.tsx
│   │   ├── VersionItem.tsx
│   │   ├── VersionItemMenu.tsx
│   │   ├── CreateVersionModal.tsx
│   │   ├── EditVersionModal.tsx
│   │   ├── RestoreButton.tsx
│   │   ├── RestoreConfirmModal.tsx
│   │   └── DeleteConfirmModal.tsx
│   ├── media/                        # 媒体上传组件
│   │   └── MediaFileUpload.tsx
│   └── authform/                     # 认证表单
│       └── AuthForm.tsx
├── lib/                              # 核心库（重要模块）
│   ├── contexts/                     # React Context（全局状态）
│   │   ├── AuthContext.tsx           # 认证上下文
│   │   ├── LibraryDataContext.tsx    # 库数据上下文（668行，核心）
│   │   ├── PresenceContext.tsx       # Presence 上下文
│   │   └── NavigationContext.tsx     # 导航上下文
│   ├── services/                     # 业务逻辑服务层
│   │   ├── projectService.ts         # 项目服务
│   │   ├── libraryService.ts         # 库服务
│   │   ├── libraryAssetsService.ts   # 资产服务
│   │   ├── folderService.ts          # 文件夹服务
│   │   ├── collaborationService.ts   # 协作服务
│   │   ├── versionService.ts         # 版本控制服务
│   │   ├── authorizationService.ts   # 授权服务
│   │   ├── emailService.ts           # 邮件服务
│   │   ├── documentImageUpload.ts    # 文档图片上传服务
│   │   ├── importService.ts          # 导入服务
│   │   ├── mediaFileUploadService.ts # 媒体文件上传服务
│   │   ├── referenceSyncService.ts   # 引用同步服务
│   │   ├── realtimeService.ts        # Realtime 服务
│   │   ├── scriptConversionService.ts # 剧本转换服务
│   │   └── scriptImportService.ts    # 剧本导入服务
│   ├── hooks/                        # 全局自定义 Hooks
│   │   ├── useRealtimeSubscription.ts  # Realtime 订阅
│   │   ├── usePresenceTracking.ts    # Presence 追踪
│   │   ├── useYjsRows.ts             # Yjs 行读取
│   │   └── useCacheMutations.ts      # 缓存变更
│   ├── actions/                      # Server Actions
│   │   └── collaboration.ts
│   ├── types/                        # TypeScript 类型定义
│   │   ├── libraryAssets.ts
│   │   ├── collaboration.ts
│   │   ├── user.ts
│   │   └── version.ts
│   ├── utils/                        # 工具函数
│   │   ├── queryKeys.ts              # React Query keys
│   │   ├── avatarColors.ts           # 头像颜色生成
│   │   ├── dateTime.ts               # 日期时间工具
│   │   ├── nameValidation.ts         # 名称验证
│   │   ├── invitationToken.ts        # 邀请令牌生成
│   │   ├── routeParams.ts            # 路由参数工具
│   │   ├── workbook.ts               # Excel workbook 工具
│   │   └── cacheDebugger.ts          # 缓存调试工具
│   ├── providers/                    # Provider 组件
│   │   └── QueryProvider.tsx         # React Query Provider
│   ├── supabase.ts                   # Supabase 客户端（客户端）
│   ├── createSupabaseServerClient.ts # Supabase 服务端客户端
│   ├── SupabaseContext.tsx           # Supabase Context
│   └── queryInvalidation.ts          # Query invalidation 工具
├── emails/                           # 邮件模板
│   └── invitation-email.tsx
└── middleware.ts                     # Next.js 中间件（路由保护）
```

---

## 核心模块

### 1. 认证与授权模块

**位置**: `src/lib/contexts/AuthContext.tsx`, `src/middleware.ts`, `src/lib/services/authorizationService.ts`

**职责**:
- 用户登录、注册、登出
- JWT Token 管理
- 路由保护（中间件）
- 基于角色的权限检查

**关键组件**:
- `AuthContext`: 提供用户认证状态
- `middleware.ts`: Next.js 中间件，拦截未认证请求
- `authorizationService.ts`: 权限验证逻辑

**数据流**:
```
用户登录 → Supabase Auth → JWT Token → Cookie/Session Storage
         ↓
    AuthContext 存储用户信息
         ↓
    中间件检查认证状态 → 未认证重定向到登录页
         ↓
    业务逻辑使用 authorizationService 检查权限
```

---

### 2. 项目与资产库管理模块

**位置**: `src/lib/services/projectService.ts`, `src/lib/services/libraryService.ts`, `src/components/projects/*`, `src/components/libraries/*`

**职责**:
- 创建、编辑、删除项目
- 创建、编辑、删除资产库
- 文件夹层级管理

**关键组件**:
- `projectService.ts`: 项目CRUD操作
- `libraryService.ts`: 资产库CRUD操作
- `folderService.ts`: 文件夹CRUD操作
- `NewProjectModal`, `EditProjectModal`: 项目弹窗
- `NewLibraryModal`, `EditLibraryModal`: 库弹窗

**数据库表**:
- `projects`: 项目表
- `libraries`: 资产库表
- `folders`: 文件夹表

---

### 3. 资产管理与实时协作模块（核心）

**位置**: `src/components/libraries/LibraryAssetsTable.tsx`, `src/lib/contexts/LibraryDataContext.tsx`, `src/components/libraries/hooks/*`

**职责**:
- 资产（Assets）的CRUD操作
- 资产字段值的编辑
- 多人实时协作编辑
- Presence Tracking（显示谁在编辑什么）
- 乐观更新和冲突解决

**关键组件**:
- `LibraryDataContext`: **核心上下文**，管理库数据和实时协作
- `LibraryAssetsTable`: **主表格组件**（2335行），展示和编辑资产
- `useTableDataManager`: 表格数据管理 Hook
- `useCellEditing`: 单元格编辑逻辑
- `useYjsSync`: Yjs CRDT 同步逻辑

**技术栈**:
- **Yjs**: CRDT数据结构，本地状态管理
- **Supabase Realtime**: 实时数据库订阅
- **React Query**: 数据缓存和服务端状态

**数据流**:
```
1. 初始加载:
   Supabase DB → React Query → LibraryDataContext → Yjs Doc
                                      ↓
                              LibraryAssetsTable 渲染

2. 用户编辑（本地用户）:
   用户输入 → useCellEditing → LibraryDataContext.updateAssetField()
                                      ↓
                  Yjs Doc 更新（触发 observe 事件）
                                      ↓
              组件重新渲染 → Supabase DB 更新（异步）
                                      ↓
                    Realtime 广播给其他用户

3. 远程更新（其他用户编辑）:
   Supabase Realtime → LibraryDataContext 收到事件
                                      ↓
                    Yjs Doc 更新（如果不冲突）
                                      ↓
                组件重新渲染（乐观更新）
```

---

### 4. 字段定义模块

**位置**: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/*`

**职责**:
- 定义资产库的字段结构（Schema）
- 支持多种数据类型：Text, Number, Boolean, Date, Image, MediaFile, Reference等
- 字段的拖拽排序
- 字段分组（Sections）

**关键组件**:
- `predefine/page.tsx`: 字段定义页面
- `predefine/components/FieldsList.tsx`: 字段列表
- `predefine/components/FieldForm.tsx`: 字段表单（530行）
- `predefine/components/FieldItem.tsx`: 字段项（509行）
- `predefine/components/NewSectionForm.tsx`: 新建分组表单
- `predefine/hooks/useSchemaData.ts`: Schema 数据管理
- `predefine/hooks/useSchemaSave.ts`: Schema 保存逻辑

**数据库表**:
- `library_field_definitions`: 字段定义表

---

### 5. 协作与权限模块

**位置**: `src/lib/services/collaborationService.ts`, `src/lib/services/authorizationService.ts`, `src/components/collaboration/*`

**职责**:
- 邀请协作者（发送邀请邮件）
- 管理协作者角色（Admin/Editor/Viewer）
- 实时显示协作者状态
- Presence Tracking（谁在线，谁在编辑什么）

**关键组件**:
- `collaborationService.ts`: 协作相关业务逻辑
- `authorizationService.ts`: 角色和权限检查
- `CollaboratorsList.tsx`: 协作者列表
- `InviteCollaboratorModal.tsx`: 邀请弹窗
- `ConnectionStatusIndicator.tsx`: 连接状态指示器
- `FieldPresenceAvatars.tsx`: 字段编辑 presence 头像

**数据库表**:
- `project_collaborators`: 协作者表
- `collaboration_invitations`: 邀请表

**权限模型**:
```
Admin:
  - 完全访问权限
  - 可以管理协作者
  - 可以删除项目

Editor:
  - 读写权限
  - 可以编辑资产和字段
  - 不能管理协作者

Viewer:
  - 只读权限
  - 不能修改任何内容
```

---

### 6. 版本控制模块

**位置**: `src/lib/services/versionService.ts`, `src/components/version-control/*`

**职责**:
- 创建库的版本快照
- 恢复到历史版本
- 版本对比（未实现）

**关键组件**:
- `versionService.ts`: 版本CRUD操作
- `VersionControlSidebar.tsx`: 版本侧边栏
- `VersionList.tsx`: 版本列表
- `CreateVersionModal.tsx`: 创建版本弹窗
- `RestoreConfirmModal.tsx`: 恢复确认弹窗

**数据库表**:
- `library_versions`: 版本表

**版本类型**:
- `manual`: 用户手动创建
- `backup`: 恢复前的备份
- `restore`: 从其他版本恢复

---

### 7. 文件上传与存储模块

**位置**: `src/lib/services/documentImageUpload.ts`, `src/lib/services/mediaFileUploadService.ts`, `src/components/media/*`

**职责**:
- 上传图片文件（Image字段类型）
- 上传媒体文件（MediaFile字段类型）
- 文件类型验证
- 文件大小限制

**关键组件**:
- `documentImageUpload.ts`: 文档图片上传逻辑
- `mediaFileUploadService.ts`: 媒体文件上传逻辑
- `MediaFileUpload.tsx`: 上传组件

**Supabase Storage Buckets**:
- `tiptap-images`: 存储Tiptap编辑器中的图片
- `library-media-files`: 存储库中的媒体文件

---

### 8. 状态管理与缓存模块

**位置**: `src/lib/providers/QueryProvider.tsx`, `src/lib/hooks/useCacheMutations.ts`, `src/lib/utils/queryKeys.ts`

**职责**:
- React Query 配置和管理
- 缓存失效策略
- 乐观更新
- 请求去重

**关键组件**:
- `QueryProvider.tsx`: React Query Provider
- `useCacheMutations.ts`: 缓存变更 Hook
- `lib/utils/queryKeys.ts`: 查询键定义

---

## 数据库架构

### 数据库ER图

```
┌──────────────┐
│   profiles   │ (用户表)
│──────────────│
│ id (PK)      │◄─┐
│ email        │  │
│ display_name │  │
│ avatar_color │  │
└──────────────┘  │
                  │
                  │ owner_id
┌──────────────────┐
│     projects     │ (项目表)
│──────────────────│
│ id (PK)          │◄─┐
│ owner_id (FK)    │  │
│ name             │  │
│ description      │  │
│ created_at       │  │
│ updated_at       │  │
└──────────────────┘  │
                      │
            ┌─────────┴────────┐
            │                  │ project_id
┌──────────────────────┐   ┌──────────────────────┐
│ project_collaborators│   │      libraries       │ (资产库表)
│──────────────────────│   │──────────────────────│
│ id (PK)              │   │ id (PK)              │◄─┐
│ user_id (FK)         │   │ project_id (FK)      │  │
│ project_id (FK)      │   │ folder_id (FK)       │  │
│ role (admin/editor/  │   │ name                 │  │
│       viewer)        │   │ description          │  │
│ invited_by (FK)      │   │ created_at           │  │
│ accepted_at          │   │ updated_at           │  │
└──────────────────────┘   │ updated_by (FK)      │  │
                           └──────────────────────┘  │
┌──────────────────────┐                            │
│collaboration_invitations│                          │
│──────────────────────│                            │ library_id
│ id (PK)              │                            │
│ project_id (FK)      │   ┌────────────────────────┴───────┐
│ email                │   │                                │
│ role                 │   │                                │
│ invited_by (FK)      │   │                                │
│ token                │   │                                │
│ expires_at           │   │                                │
└──────────────────────┘   │                                │
                           │                                │
        ┌──────────────────┴──────────┐                    │
        │                              │                    │
┌──────────────────────┐   ┌──────────────────────┐        │
│ library_field_       │   │  library_assets      │        │
│ definitions          │   │──────────────────────│        │
│──────────────────────│   │ id (PK)              │◄───┐   │
│ id (PK)              │◄─┐│ library_id (FK)      │    │   │
│ library_id (FK)      │  ││ name                 │    │   │
│ field_name           │  ││ created_at           │    │   │
│ data_type            │  ││ updated_by (FK)      │    │   │
│ is_required          │  │└──────────────────────┘    │   │
│ default_value        │  │                            │   │
│ display_order        │  │                            │   │
│ section_id           │  │ asset_id              asset_id│
│ field_properties     │  └──────────┬─────────────────┘   │
│ reference_libraries  │             │                     │
└──────────────────────┘             │                     │
                                     │                     │
                        ┌────────────▼────────────┐        │
                        │ library_asset_values    │        │
                        │─────────────────────────│        │
                        │ asset_id (PK, FK)       │        │
                        │ field_id (PK, FK) ──────┘        │
                        │ value_json              │        │
                        └─────────────────────────┘        │
                                                            │
┌──────────────────────┐                                   │
│   folders            │                                   │
│──────────────────────│                                   │
│ id (PK)              │                                   │
│ project_id (FK)      │                                   │
│ parent_folder_id (FK)│ (自引用)                          │
│ name                 │                                   │
│ created_at           │                                   │
│ updated_at           │                                   │
│ updated_by (FK)      │                                   │
└──────────────────────┘                                   │
                                                            │
┌──────────────────────┐                                   │
│  library_versions    │                                   │
│──────────────────────│                                   │
│ id (PK)              │                                   │
│ library_id (FK) ─────┴───────────────────────────────────┘
│ version_name         │
│ version_type         │ (manual/backup/restore)
│ snapshot_data        │ (JSONB，存储完整快照)
│ created_by (FK)      │
│ created_at           │
│ is_current           │
│ parent_version_id (FK)│ (自引用)
│ restore_from_version_id (FK)│
└──────────────────────┘
```

### 核心表详解

#### 1. profiles（用户表）
- Supabase Auth的扩展表
- 存储用户显示名称和头像颜色

#### 2. projects（项目表）
- 项目的基本信息
- 每个项目有一个owner（创建者）
- 支持协作者通过`project_collaborators`表

#### 3. libraries（资产库表）
- 属于某个项目
- 可以在文件夹中组织
- 每个库有自己的字段定义

#### 4. library_field_definitions（字段定义表）
- 定义库的Schema
- 支持多种数据类型
- 支持字段分组（sections）
- `reference_libraries`: 引用类型字段可以关联其他库

#### 5. library_assets（资产表）
- 资产的基本信息（ID和名称）
- 属于某个库

#### 6. library_asset_values（资产字段值表）
- 存储资产的字段值
- 使用JSONB类型存储灵活的数据结构
- 通过`asset_id`和`field_id`联合主键

#### 7. project_collaborators（协作者表）
- 项目的协作者关系
- 支持三种角色：admin, editor, viewer
- `accepted_at`为NULL表示待接受的邀请

#### 8. library_versions（版本表）
- 存储库的完整快照
- 支持恢复到历史版本
- `is_current`标记当前版本

---

## 关键数据流

### 1. 用户认证流程

```
┌─────────────┐
│ 用户访问页面 │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│ middleware.ts    │ (检查认证状态)
│ 检查 Cookie 中的 │
│ Auth Token       │
└──────┬───────────┘
       │
       ├─────► 未认证 ─────► 重定向到 /（登录页）
       │
       ▼ 已认证
┌──────────────────┐
│ 加载 Dashboard    │
│ AuthContext 提供 │
│ 用户信息         │
└──────────────────┘
```

### 2. 创建项目流程

```
用户点击"New Project"
       │
       ▼
┌────────────────────┐
│ NewProjectModal    │ (用户输入项目名称和描述)
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ POST /api/projects │ (API Route)
└────────┬───────────┘
         │
         ▼
┌────────────────────────┐
│ projectService.ts      │
│ createProject()        │
│ 调用 Supabase 函数:    │
│ create_project_with_   │
│ default_resource()     │
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ PostgreSQL 事务:       │
│ 1. 插入 projects 表    │
│ 2. 插入 libraries 表   │
│    (默认"Resource"库)  │
│ 3. 插入 project_       │
│    collaborators 表    │
│    (owner as admin)    │
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ React Query 缓存失效   │
│ 重新获取项目列表       │
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ UI 更新，显示新项目    │
└────────────────────────┘
```

### 3. 实时协作编辑流程（最复杂）

```
用户 A 编辑单元格
       │
       ▼
┌────────────────────────────┐
│ CellEditor 组件            │
│ onChange 触发              │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ useCellEditing Hook        │
│ handleCellChange()         │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ LibraryDataContext         │
│ updateAssetField()         │
└────────┬───────────────────┘
         │
         ├──────► 1. 更新 Yjs Doc (本地 CRDT)
         │        Y.Map.set(assetId, fieldId, value)
         │
         ├──────► 2. 触发 Yjs observe 事件
         │        → 组件重新渲染（乐观更新）
         │
         └──────► 3. 异步更新 Supabase
                  libraryAssetsService.updateAssetValue()
                  │
                  ▼
         ┌────────────────────────────┐
         │ Supabase Realtime 广播     │
         │ UPDATE 事件到其他客户端    │
         └────────┬───────────────────┘
                  │
                  ▼
         ┌────────────────────────────┐
         │ 用户 B 的客户端            │
         │ useRealtimeSubscription    │
         │ 收到 UPDATE 事件           │
         └────────┬───────────────────┘
                  │
                  ▼
         ┌────────────────────────────┐
         │ LibraryDataContext         │
         │ 处理远程更新               │
         │ → 更新 Yjs Doc             │
         │ → 触发组件重新渲染         │
         └────────────────────────────┘
                  │
                  ▼
         ┌────────────────────────────┐
         │ 用户 B 看到用户 A 的修改   │
         └────────────────────────────┘
```

### 4. Presence Tracking 流程

```
用户 A 点击编辑某个单元格
       │
       ▼
┌────────────────────────────┐
│ useCellEditing             │
│ setActiveField()           │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ LibraryDataContext         │
│ setActiveField(assetId,    │
│                fieldId)    │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ usePresenceTracking        │
│ 更新 Presence State        │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Supabase Realtime          │
│ .track() 发送 Presence     │
│ 数据到 Channel             │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ 其他用户收到 Presence      │
│ presence-track 事件        │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ CellPresenceAvatars 组件   │
│ 显示用户 A 的头像在该单元格│
└────────────────────────────┘
```

---

## 实时协作架构

### Yjs + Supabase Realtime 双层架构

Keco Studio 使用了一个**在线双层实时协作架构**：

1. **本地层（Yjs）**: CRDT数据结构，保证当前会话内的即时响应和冲突合并
2. **远程层（Supabase Realtime）**: 数据库实时订阅，保证跨客户端的最终一致性

```
┌─────────────────────────────────────────────────────────────┐
│                        Client A                              │
│  ┌───────────────┐    ┌──────────────┐                      │
│  │  UI Component │───►│   Yjs Doc    │                      │
│  │  (React)      │◄───│   (CRDT)     │                      │
│  └───────────────┘    └──────┬───────┘                      │
│                               │                              │
│                               ▼                              │
│                    ┌──────────────────────┐                 │
│                    │ Supabase Realtime    │                 │
│                    │ WebSocket Connection │                 │
│                    └──────────┬───────────┘                 │
└───────────────────────────────┼──────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Supabase Backend     │
                    │  PostgreSQL + Realtime│
                    └───────────┬───────────┘
                                │
┌───────────────────────────────┼──────────────────────────────┐
│                        Client B                              │
│                    ┌──────────▼───────────┐                 │
│                    │ Supabase Realtime    │                 │
│                    │ WebSocket Connection │                 │
│                    └──────────┬───────────┘                 │
│                               │                              │
│  ┌───────────────┐    ┌──────▼───────┐                     │
│  │  UI Component │───►│   Yjs Doc    │                     │
│  │  (React)      │◄───│   (CRDT)     │                     │
│  └───────────────┘    └──────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

### 优点

1. **即时响应**: Yjs CRDT保证本地修改立即生效，无需等待网络
2. **冲突解决**: CRDT自动解决并发编辑冲突
3. **在线广播**: Supabase Realtime 将数据库变更推送到其他在线客户端
4. **最终一致性**: Supabase PostgreSQL 是持久数据源，Realtime 保证跨客户端的数据一致性

### 缺点（已知痛点）

1. **双重真相源**: Yjs和Supabase DB可能不同步
2. **复杂性高**: 需要同时管理Yjs和数据库状态
3. **调试困难**: 状态同步问题难以定位

---

## 认证与授权

### 认证流程

1. **Supabase Auth**: 基于JWT的认证系统
2. **Cookie存储**: Token存储在HTTPOnly Cookie中
3. **中间件保护**: `middleware.ts`拦截未认证请求

### 授权模型

#### 数据库级别（Row Level Security）

所有表都启用了RLS策略：

```sql
-- 项目表：只能看到自己创建的或被邀请的项目
CREATE POLICY projects_select_policy ON projects
  FOR SELECT USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT project_id FROM project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );
```

#### 应用级别（authorizationService）

```typescript
// 检查用户是否是项目的Admin
export async function isProjectAdmin(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<boolean> {
  // 检查是否是owner或admin协作者
}

// 检查用户是否可以编辑
export async function canEditProject(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<boolean> {
  // 检查是否是owner, admin或editor
}
```

---

## API 路由

### API 路由列表

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/projects` | POST | 创建项目 |
| `/api/projects/[projectId]/libraries` | POST | 创建库 |
| `/api/projects/[projectId]/folders` | POST | 创建文件夹 |
| `/api/projects/[projectId]/role` | GET | 获取用户在项目中的角色 |
| `/api/projects/[projectId]/delete` | DELETE | 删除项目 |
| `/api/libraries/[libraryId]` | PUT | 更新库信息 |
| `/api/libraries/[libraryId]` | DELETE | 删除库 |
| `/api/collaborators` | GET | 获取项目协作者列表 |
| `/api/collaborators/[collaboratorId]` | DELETE | 删除协作者 |
| `/api/invitations` | POST | 发送协作邀请 |
| `/api/invitations/accept` | POST | 接受邀请 |
| `/api/invitations/decline` | POST | 拒绝邀请 |

### API 设计模式

所有API路由遵循以下模式：

1. **认证检查**: 从Cookie中获取Supabase session
2. **权限验证**: 调用`authorizationService`检查权限
3. **业务逻辑**: 调用相应的Service层函数
4. **错误处理**: 统一的错误响应格式

示例：

```typescript
// app/api/projects/route.ts
export async function POST(request: Request) {
  // 1. 创建Supabase客户端（自动读取Cookie）
  const supabase = createSupabaseServerClient();
  
  // 2. 检查认证
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // 3. 解析请求体
  const { name, description } = await request.json();
  
  // 4. 调用Service层
  const project = await projectService.createProject(supabase, {
    name,
    description,
    owner_id: user.id
  });
  
  // 5. 返回结果
  return NextResponse.json(project);
}
```

---

## 状态管理

### 状态管理架构

Keco Studio 使用多层状态管理架构：

```
┌─────────────────────────────────────────────────────────┐
│                     组件本地状态                         │
│                   (useState, useReducer)                 │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  React Context                           │
│  • AuthContext (用户认证状态)                           │
│  • LibraryDataContext (库数据和实时协作)                │
│  • PresenceContext (在线状态)                           │
│  • NavigationContext (导航状态)                         │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│               React Query (Server State)                 │
│  • 项目列表                                             │
│  • 库列表                                               │
│  • 协作者列表                                           │
│  • 版本列表                                             │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Yjs Doc (CRDT State)                     │
│  • 资产数据 (assets)                                    │
│  • 字段值 (asset values)                                │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Supabase (Database State)                   │
│  • PostgreSQL (持久化数据)                              │
│  • Realtime (实时订阅)                                  │
└─────────────────────────────────────────────────────────┘
```

### Context Providers 层级

```typescript
// app/layout.tsx
<QueryProvider>  {/* React Query */}
  <AuthContext>  {/* 认证 */}
    <NavigationContext>  {/* 导航 */}
      {children}
    </NavigationContext>
  </AuthContext>
</QueryProvider>

// app/(dashboard)/[projectId]/[libraryId]/layout.tsx
<LibraryDataContext libraryId={libraryId} projectId={projectId}>
  <PresenceContext>
    {children}
  </PresenceContext>
</LibraryDataContext>
```

---

## 文件上传与存储

### Storage Buckets

| Bucket Name | 用途 | 安全策略 |
|-------------|------|----------|
| `tiptap-images` | Tiptap编辑器图片 | 认证用户可上传，公开读取 |
| `library-media-files` | 库媒体文件 | 认证用户可上传，公开读取 |

### 上传流程

```
用户选择文件
       │
       ▼
┌────────────────────────────┐
│ 前端验证                   │
│ • 文件类型                 │
│ • 文件大小（<10MB）        │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ documentImageUpload/       │
│ mediaFileUploadService     │
│ uploadFile()               │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Supabase Storage           │
│ .upload()                  │
│ 返回公开URL                │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ 保存URL到                  │
│ library_asset_values       │
│ (value_json字段)           │
└────────────────────────────┘
```

---

## 版本控制

### 版本创建流程

```
用户点击"Create Version"
       │
       ▼
┌────────────────────────────┐
│ CreateVersionModal         │
│ 输入版本名称               │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ versionService.ts          │
│ createVersion()            │
└────────┬───────────────────┘
         │
         ├──────► 1. 获取库的所有数据
         │        • library_field_definitions
         │        • library_assets
         │        • library_asset_values
         │
         ├──────► 2. 序列化为JSON快照
         │        snapshot_data = {
         │          fields: [...],
         │          assets: [...]
         │        }
         │
         └──────► 3. 插入 library_versions 表
                  {
                    library_id,
                    version_name,
                    version_type: 'manual',
                    snapshot_data,
                    created_by: user.id,
                    is_current: false
                  }
```

### 版本恢复流程

```
用户点击"Restore Version"
       │
       ▼
┌────────────────────────────┐
│ RestoreConfirmModal        │
│ 确认恢复                   │
│ 可选：备份当前版本         │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ versionService.ts          │
│ restoreVersion()           │
└────────┬───────────────────┘
         │
         ├──────► 1. (可选)创建备份版本
         │        version_type: 'backup'
         │
         ├──────► 2. 读取目标版本的snapshot_data
         │
         ├──────► 3. 清空当前库数据
         │        • DELETE library_asset_values
         │        • DELETE library_assets
         │        • DELETE library_field_definitions
         │
         ├──────► 4. 恢复快照数据
         │        • INSERT field definitions
         │        • INSERT assets
         │        • INSERT asset values
         │
         ├──────► 5. 创建恢复记录
         │        version_type: 'restore',
         │        restore_from_version_id: 目标版本ID
         │
         └──────► 6. 标记为当前版本
                  is_current: true
```

---

## 测试架构

### 测试工具

- **Playwright**: E2E测试框架
- **测试模式**: Page Object Model (POM)

### 测试目录结构

```
tests/
└── e2e/
    ├── pages/              # Page Object Model
    │   ├── project.page.ts
    │   ├── library.page.ts
    │   ├── asset.page.ts
    │   └── predefined.page.ts
    ├── specs/              # 测试规格
    │   ├── auth.spec.ts              # 认证测试
    │   ├── happy-path.spec.ts        # 主流程测试
    │   ├── security.spec.ts          # 安全测试
    │   ├── file-upload-security.spec.ts  # 文件上传安全测试
    │   ├── destructive.spec.ts       # 破坏性测试（删除操作）
    │   ├── version-control.spec.ts   # 版本控制测试
    │   ├── name-validation.spec.ts   # 名称验证测试
    │   └── library-description-tooltip.spec.ts
    └── fixtures/           # 测试固定装置
        └── users.ts
```

### 测试脚本

```json
{
  "test:e2e": "playwright test",
  "test:e2e:parallel": "playwright test --workers=50%",
  "test:e2e:clean": "tsx scripts/clean-remote-test-data.ts && playwright test",
  "test:e2e:sequential": "playwright test ... (按顺序)",
  "test:auth": "playwright test tests/e2e/specs/auth.spec.ts",
  "test:happy": "playwright test tests/e2e/specs/happy-path.spec.ts"
}
```

### 测试覆盖范围

1. **认证测试** (`auth.spec.ts`)
   - 登录/注册
   - 登出
   - 密码重置

2. **主流程测试** (`happy-path.spec.ts`)
   - 创建项目
   - 创建库
   - 创建资产
   - 编辑字段

3. **安全测试** (`security.spec.ts`)
   - XSS防护
   - SQL注入防护
   - 权限验证

4. **版本控制测试** (`version-control.spec.ts`)
   - 创建版本
   - 恢复版本
   - 版本列表

---

## 部署架构

### 本地开发环境

```
┌──────────────────────────────────────────┐
│          开发者机器                       │
│                                          │
│  ┌────────────────┐  ┌────────────────┐ │
│  │  Next.js Dev   │  │ Docker Desktop │ │
│  │  Server        │  │                │ │
│  │  (Port 3000)   │  │  Supabase      │ │
│  │                │  │  Local Stack   │ │
│  │  • Hot Reload  │  │  • PostgreSQL  │ │
│  │  • Fast Refresh│  │  • Auth        │ │
│  └────────────────┘  │  • Storage     │ │
│                      │  • Realtime    │ │
│                      └────────────────┘ │
└──────────────────────────────────────────┘
```

启动流程：

```bash
# 1. 启动本地Supabase
supabase start

# 2. 配置环境变量 (.env.local)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>

# 3. 安装依赖
npm install

# 4. 启动Next.js开发服务器
npm run dev
```

### 生产环境（推测）

```
┌──────────────────────────────────────────┐
│             Vercel                        │
│  ┌────────────────────────────────────┐  │
│  │  Next.js Production Build          │  │
│  │  • Server Components (SSR)         │  │
│  │  • API Routes                      │  │
│  │  • Static Assets (CDN)             │  │
│  └────────────────────────────────────┘  │
└───────────────┬──────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────┐
│        Supabase Cloud                     │
│  ┌────────────────────────────────────┐  │
│  │  PostgreSQL (Managed)              │  │
│  │  Auth (JWT)                        │  │
│  │  Storage (S3)                      │  │
│  │  Realtime (WebSocket)              │  │
│  │  Edge Functions                    │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

---

## 已知痛点

根据项目现状和代码分析，以下是已识别的架构和代码痛点：

### 1. 复杂度过高

**问题**:
- **Sidebar.tsx (2330行)**: 侧边栏组件过于庞大，包含了版本控制、协作者管理、文件夹树等多个功能
- **LibraryAssetsTable.tsx (2335行)**: 表格组件过于复杂，难以维护和测试
- **LibraryDataContext.tsx (668行)**: Context组件职责过多，集成了数据管理、实时协作、Presence tracking等

**影响**:
- 修改bug时容易引入新问题
- 难以定位问题
- 新开发者理解困难

**建议**: 参见"优化建议文档"

### 2. 目录结构混乱

**问题**:
- `src/contexts/` 和 `src/lib/contexts/` 并存
- `src/hooks/` 和 `src/lib/hooks/` 并存
- 组件内部的hooks分散在不同位置

**影响**:
- 代码难以查找
- 导入路径混乱
- 容易产生重复代码

### 3. 相对导入路径过多

**问题**:
- 86个文件使用`../`相对导入
- 导入路径难以理解和维护

**示例**:
```typescript
import { something } from '../../../../lib/services/...'
```

**建议**:
- 统一使用`@/`别名导入

### 4. 双重真相源（Yjs + Supabase）

**问题**:
- Yjs本地状态和Supabase DB状态可能不一致
- 网络中断时可能产生数据不同步
- 调试困难，难以确定是Yjs问题还是Realtime问题

**影响**:
- 数据一致性问题
- 用户体验问题（偶尔看到旧数据）

### 5. 缺乏统一的错误处理

**问题**:
- API路由的错误处理不统一
- 客户端错误处理分散在各个组件

**影响**:
- 用户体验不一致
- 难以追踪错误

### 6. 类型安全不足

**问题**:
- `tsconfig.json`中`strict: false`
- 很多`any`类型

**影响**:
- 运行时错误
- IDE提示不准确

### 7. 测试覆盖不足

**问题**:
- 只有E2E测试，缺少单元测试
- 核心业务逻辑（如Services）没有测试覆盖

**影响**:
- 重构风险高
- 难以保证代码质量

### 8. 性能问题

**问题**:
- 大型表格（>1000行）渲染缓慢
- 频繁的Realtime订阅可能导致性能问题
- 缺少虚拟化渲染

**影响**:
- 用户体验差
- 浏览器可能卡顿

### 9. 缺乏文档

**问题**:
- 代码注释不足
- 缺少架构文档（本文档填补了这个空白）
- 缺少API文档

**影响**:
- 新开发者难以上手
- 维护困难

---

## 总结

### 项目优点

1. ✅ **功能完整**: 实现了完整的协作式资产管理平台
2. ✅ **技术先进**: 使用Next.js 16, Supabase, Yjs等现代技术
3. ✅ **实时协作**: 完整的多人实时编辑和Presence tracking
4. ✅ **权限管理**: 基于角色的访问控制
5. ✅ **版本控制**: 支持库的版本快照和恢复
6. ✅ **测试覆盖**: 有完整的E2E测试套件

### 改进空间

1. 📌 **代码组织**: 重构超大组件，统一目录结构
2. 📌 **类型安全**: 启用TypeScript严格模式
3. 📌 **性能优化**: 虚拟化渲染，优化Realtime订阅
4. 📌 **测试完善**: 增加单元测试和集成测试
5. 📌 **文档完善**: 增加代码注释和API文档
6. 📌 **错误处理**: 统一错误处理策略

---

## 附录

### 关键指标

- **代码行数**: ~30,000+ 行（估算）
- **组件数量**: 82 个 .tsx 文件
- **Service数量**: 13 个服务层文件
- **数据库表**: 15+ 个核心表
- **数据库迁移**: 40+ 个迁移文件
- **E2E测试**: 10+ 个测试规格
- **依赖包**: 30+ 个生产依赖

### 技术债务估算

| 类别 | 严重程度 | 估算工作量 |
|------|---------|-----------|
| 超大组件重构 | 高 | 2-3周 |
| 目录结构整理 | 中 | 1周 |
| TypeScript严格模式 | 高 | 2周 |
| 单元测试补充 | 中 | 3-4周 |
| 性能优化 | 高 | 2周 |
| 文档完善 | 低 | 1周 |

**总计**: 约11-13周的重构和优化工作

---

**文档结束**
