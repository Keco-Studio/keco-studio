# Keco Studio - Project Architecture Document

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Project**: Keco Studio - Collaborative Asset Management Platform  
**Tech Stack**: Next.js 16 + Supabase + Yjs + React 19

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Tech Stack Details](#tech-stack-details)
4. [Directory Structure](#directory-structure)
5. [Core Modules](#core-modules)
6. [Database Architecture](#database-architecture)
7. [Key Data Flows](#key-data-flows)
8. [Real-Time Collaboration Architecture](#real-time-collaboration-architecture)
9. [Authentication & Authorization](#authentication--authorization)
10. [API Routes](#api-routes)
11. [State Management](#state-management)
12. [File Upload & Storage](#file-upload--storage)
13. [Version Control](#version-control)
14. [Testing Architecture](#testing-architecture)
15. [Deployment Architecture](#deployment-architecture)
16. [Known Pain Points](#known-pain-points)

---

## Project Overview

### Introduction

Keco Studio is a **multi-user, real-time collaborative asset management platform** that allows teams to create projects, define asset libraries (Libraries), manage assets (Assets) and their custom fields, with support for real-time multi-user editing, version control, permission management, and more.

### Core Features

1. **Project Management**: Create, edit, and delete projects
2. **Library Management**: Create multiple asset libraries under a project, each with a customizable field structure
3. **Asset Management**: Create assets in a library and fill in custom field values, supporting multiple data types
4. **Real-Time Collaboration**: Multiple users editing simultaneously, with presence tracking (showing who is editing what)
5. **Version Control**: Create version snapshots for libraries, with support for restoring to historical versions
6. **Permission Management**: Role-based access control (Admin/Editor/Viewer)
7. **File Upload**: Support for image and media file uploads
8. **Folder Organization**: Support for organizing libraries in a folder hierarchy

### Target Users

- Game development teams (managing game assets)
- Content creation teams (managing media resources)
- Product teams (managing product requirements and specifications)

---

## System Architecture

### High-Level Architecture Diagram

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

### Architecture Layers Explained

#### 1. Client Layer
- **Next.js App Router**: Uses the Next.js 16 App Router architecture
- **Server Components**: Used for initial data loading and SEO optimization
- **Client Components**: Used for interactive UI and real-time updates
- **API Routes**: Handle server-side business logic

#### 2. State & Collaboration Layer
- **React Query (@tanstack/react-query)**: Data fetching and cache management
- **Yjs**: CRDT (Conflict-free Replicated Data Type) for local document state
- **Supabase Realtime**: Real-time database subscriptions and presence tracking
- **Context Providers**: React Context for global state management

#### 3. Backend & Data Layer
- **Supabase**: BaaS (Backend as a Service)
  - PostgreSQL database (with Row Level Security)
  - Authentication (JWT-based)
  - Storage (file storage)
  - Realtime (WebSocket connections)
  - Database Functions (stored procedures)

#### 4. Persistence Layer
- **Supabase PostgreSQL**: Persistent data source for libraries, assets, field values, permissions, and version snapshots
- **Supabase Storage**: Persistent storage for images and media files
- **Browser Session Storage**: Session runtime state for the Supabase SSR/browser client; Yjs documents do not use a local persistence layer

---

## Tech Stack Details

### Frontend Technologies

| Technology | Version | Purpose |
|------|------|------|
| **Next.js** | 16.2.10 | React framework, App Router, SSR/SSG |
| **React** | 19.2.7 | UI library |
| **React DOM** | 19.2.7 | React rendering |
| **TypeScript** | 5.9.3 | Type safety |
| **Ant Design** | 5.22.2 | UI component library |
| **@tanstack/react-query** | 5.90.16 | Data fetching and caching |
| **Yjs** | 13.6.29 | CRDT real-time collaboration |
| **@dnd-kit** | 6.3.1 | Drag-and-drop functionality |
| **Zod** | 3.22.4 | Schema validation |

### Backend Technologies

| Technology | Version | Purpose |
|------|------|------|
| **Supabase** | 2.87.1 | BaaS platform |
| **@supabase/ssr** | 0.8.0 | Next.js SSR integration |
| **PostgreSQL** | (managed by Supabase) | Relational database |
| **Resend** | 6.17.1 | Email delivery service |
| **Jose** | 6.1.3 | JWT handling |

### Development & Testing Tools

| Technology | Version | Purpose |
|------|------|------|
| **Playwright** | 1.57.0 | E2E testing |
| **ESLint** | 9.0.0 | Code linting |
| **Autoprefixer** | 10.4.22 | Automatic CSS prefixing |
| **PostCSS** | 8.5.6 | CSS processing |

---

## Directory Structure

### Project Root Directory

```
keco-studio/
├── src/                    # Source code directory
│   ├── app/                # Next.js App Router pages and routes
│   ├── components/         # React components
│   ├── lib/                # Core libraries and utilities
│   ├── assets/             # Statically imported resources
│   ├── emails/             # Email templates
│   └── middleware.ts       # Next.js middleware (auth checks)
├── supabase/               # Supabase configuration and migrations
│   ├── migrations/         # Database migration files (40+ migrations)
│   ├── config.toml         # Supabase configuration
│   ├── seed.sql            # Local development seed data
│   └── seed-remote.sql     # Remote database seed data
├── tests/                  # Playwright E2E tests
│   └── e2e/
│       ├── pages/          # Page Object Model
│       ├── specs/          # Test specs
│       └── fixtures/       # Test fixtures
├── docs/                   # Documentation directory
│   ├── architecture/       # Architecture docs (this document)
│   ├── CI_SETUP.md         # CI/CD setup guide
│   └── ENVIRONMENT_SETUP.md # Environment configuration guide
├── specs/                  # Feature specifications (using speckit)
├── scripts/                # Build and utility scripts
├── public/                 # Static assets
├── types/                  # Global TypeScript type definitions
├── package.json            # Dependency configuration
├── tsconfig.json           # TypeScript configuration
├── playwright.config.ts    # Playwright configuration
└── next.config.mjs         # Next.js configuration
```

### Detailed src/ Directory Structure

```
src/
├── app/                              # Next.js 16 App Router
│   ├── (dashboard)/                  # Route group (shared layout)
│   │   ├── layout.tsx                # Dashboard layout
│   │   ├── page.tsx                  # Dashboard home (redirects to /projects)
│   │   ├── projects/
│   │   │   └── page.tsx              # Project list page
│   │   └── [projectId]/              # Dynamic route: project details
│   │       ├── page.tsx              # Project detail page
│   │       ├── collaborators/
│   │       │   └── page.tsx          # Collaborator management page
│   │       ├── folder/
│   │       │   └── [folderId]/
│   │       │       └── page.tsx      # Folder detail page
│   │       └── [libraryId]/          # Dynamic route: library
│   │           ├── layout.tsx        # Library layout (with sidebar)
│   │           ├── page.tsx          # Library main page (assets table)
│   │           ├── predefine/        # Field definition pages
│   │           │   ├── page.tsx
│   │           │   ├── components/   # Field definition components
│   │           │   ├── hooks/        # Field definition hooks
│   │           │   ├── types.ts
│   │           │   ├── utils.ts
│   │           │   └── validation.ts
│   │           └── [assetId]/        # Dynamic route: asset details
│   │               └── page.tsx
│   ├── api/                          # API routes
│   │   ├── projects/
│   │   │   ├── route.ts              # POST /api/projects (create project)
│   │   │   └── [projectId]/
│   │   │       ├── libraries/
│   │   │       │   └── route.ts      # POST create library
│   │   │       ├── folders/
│   │   │       │   └── route.ts      # POST create folder
│   │   │       ├── role/
│   │   │       │   └── route.ts      # GET fetch user role
│   │   │       └── delete/
│   │   │           └── route.ts      # DELETE delete project
│   │   ├── libraries/
│   │   │   └── [libraryId]/
│   │   │       └── route.ts          # PUT/DELETE library operations
│   │   ├── collaborators/
│   │   │   ├── route.ts              # GET fetch collaborators
│   │   │   └── [collaboratorId]/
│   │   │       └── route.ts          # DELETE remove collaborator
│   │   └── invitations/
│   │       ├── route.ts              # POST send invitation
│   │       ├── accept/
│   │       │   └── route.ts          # POST accept invitation
│   │       └── decline/
│   │           └── route.ts          # POST decline invitation
│   ├── auth/
│   │   ├── callback/                 # Supabase auth callback
│   │   │   └── page.tsx
│   │   └── reset-password/           # Reset password page
│   │       └── page.tsx
│   ├── accept-invitation/            # Accept invitation page
│   │   ├── page.tsx
│   │   └── AcceptInvitationContent.tsx
│   ├── decline-invitation/           # Decline invitation page
│   │   └── page.tsx
│   ├── forgot-password/              # Forgot password page
│   │   └── page.tsx
│   ├── assets/                       # Asset details (possibly deprecated)
│   ├── realtime-test/                # Realtime test page (for development)
│   ├── layout.tsx                    # Global layout
│   ├── page.tsx                      # Home page (login page)
│   └── globals.css                   # Global styles
├── components/                       # Reusable components
│   ├── layout/                       # Layout components
│   │   ├── Sidebar.tsx               # Sidebar (2330 lines, complex component)
│   │   ├── TopBar.tsx                # Top navigation bar
│   │   ├── DashboardLayout.tsx       # Dashboard layout container
│   │   └── ContextMenu.tsx           # Context menu
│   ├── projects/                     # Project-related components
│   │   ├── NewProjectModal.tsx
│   │   └── EditProjectModal.tsx
│   ├── libraries/                    # Library components (core module)
│   │   ├── LibraryAssetsTable.tsx    # Main table component (2335 lines)
│   │   ├── LibraryAssetsTableAdapter.tsx  # Table adapter
│   │   ├── LibraryAssetsTableModals.tsx   # Table-related modals
│   │   ├── LibraryHeader.tsx         # Library header
│   │   ├── NewLibraryModal.tsx
│   │   ├── EditLibraryModal.tsx
│   │   ├── AddLibraryMenu.tsx
│   │   ├── components/               # Library subcomponents
│   │   │   ├── CellEditor.tsx        # Cell editor
│   │   │   ├── ReferenceField.tsx    # Reference field
│   │   │   ├── TableHeader.tsx       # Table header
│   │   │   ├── RowContextMenu.tsx    # Row context menu
│   │   │   ├── CellPresenceAvatars.tsx  # Collaboration avatars
│   │   │   ├── AssetCardPanel.tsx    # Asset card panel
│   │   │   ├── TableToast.tsx        # Table toast
│   │   │   ├── BatchEditMenu.tsx     # Batch edit menu
│   │   │   └── EmptyState.tsx        # Empty state
│   │   ├── hooks/                    # Table-specific hooks (key module)
│   │   │   ├── useTableDataManager.ts  # Table data management
│   │   │   ├── useRowOperations.ts   # Row operations
│   │   │   ├── useCellEditing.ts     # Cell editing
│   │   │   ├── useCellSelection.ts   # Cell selection
│   │   │   ├── useClipboardOperations.ts  # Clipboard operations
│   │   │   ├── useClipboardShortcuts.ts   # Clipboard shortcuts
│   │   │   ├── useBatchFill.ts       # Batch fill
│   │   │   ├── useAddRow.ts          # Add row
│   │   │   ├── useReferenceModal.ts  # Reference modal
│   │   │   ├── useYjsSync.ts         # Yjs sync
│   │   │   ├── useResolvedRows.ts    # Resolved row data
│   │   │   ├── useClickOutsideAutoSave.ts  # Click-outside auto-save
│   │   │   ├── useOptimisticCleanup.ts     # Optimistic update cleanup
│   │   │   ├── useUserRole.ts        # User role
│   │   │   ├── useTableMenuPosition.ts     # Table menu positioning
│   │   │   ├── useCloseOnDocumentClick.ts  # Close on click
│   │   │   └── useAssetHover.ts      # Asset hover
│   │   └── utils/
│   │       └── libraryAssetUtils.ts  # Asset utility functions
│   ├── asset/                        # Asset detail components
│   │   ├── AssetHeader.tsx
│   │   ├── EditAssetModal.tsx
│   │   ├── AssetReferenceSelector.tsx
│   │   └── AssetReferenceModal.tsx
│   ├── folders/                      # Folder components
│   │   ├── LibraryCard.tsx
│   │   ├── FolderCard.tsx
│   │   ├── LibraryListView.tsx
│   │   ├── LibraryToolbar.tsx
│   │   ├── NewFolderModal.tsx
│   │   └── EditFolderModal.tsx
│   ├── collaboration/                # Collaboration components
│   │   ├── CollaboratorsList.tsx
│   │   ├── InviteCollaboratorModal.tsx
│   │   ├── StackedAvatars.tsx
│   │   ├── ConnectionStatusIndicator.tsx
│   │   └── FieldPresenceAvatars.tsx
│   ├── version-control/              # Version control components
│   │   ├── VersionControlSidebar.tsx
│   │   ├── VersionList.tsx
│   │   ├── VersionItem.tsx
│   │   ├── VersionItemMenu.tsx
│   │   ├── CreateVersionModal.tsx
│   │   ├── EditVersionModal.tsx
│   │   ├── RestoreButton.tsx
│   │   ├── RestoreConfirmModal.tsx
│   │   └── DeleteConfirmModal.tsx
│   ├── media/                        # Media upload components
│   │   └── MediaFileUpload.tsx
│   └── authform/                     # Auth form
│       └── AuthForm.tsx
├── lib/                              # Core library (important module)
│   ├── contexts/                     # React Context (global state)
│   │   ├── AuthContext.tsx           # Auth context
│   │   ├── LibraryDataContext.tsx    # Library data context (668 lines, core)
│   │   ├── PresenceContext.tsx       # Presence context
│   │   └── NavigationContext.tsx     # Navigation context
│   ├── services/                     # Business logic service layer
│   │   ├── projectService.ts         # Project service
│   │   ├── libraryService.ts         # Library service
│   │   ├── libraryAssetsService.ts   # Asset service
│   │   ├── folderService.ts          # Folder service
│   │   ├── collaborationService.ts   # Collaboration service
│   │   ├── versionService.ts         # Version control service
│   │   ├── authorizationService.ts   # Authorization service
│   │   ├── emailService.ts           # Email service
│   │   ├── documentImageUpload.ts    # Document image upload service
│   │   ├── importService.ts          # Import service
│   │   ├── mediaFileUploadService.ts # Media file upload service
│   │   ├── referenceSyncService.ts   # Reference sync service
│   │   ├── realtimeService.ts        # Realtime service
│   │   ├── scriptConversionService.ts # Script conversion service
│   │   └── scriptImportService.ts    # Script import service
│   ├── hooks/                        # Global custom hooks
│   │   ├── useRealtimeSubscription.ts  # Realtime subscription
│   │   ├── usePresenceTracking.ts    # Presence tracking
│   │   ├── useYjsRows.ts             # Yjs row reads
│   │   └── useCacheMutations.ts      # Cache mutations
│   ├── actions/                      # Server Actions
│   │   └── collaboration.ts
│   ├── types/                        # TypeScript type definitions
│   │   ├── libraryAssets.ts
│   │   ├── collaboration.ts
│   │   ├── user.ts
│   │   └── version.ts
│   ├── utils/                        # Utility functions
│   │   ├── queryKeys.ts              # React Query keys
│   │   ├── avatarColors.ts           # Avatar color generation
│   │   ├── dateTime.ts               # Date/time utilities
│   │   ├── nameValidation.ts         # Name validation
│   │   ├── invitationToken.ts        # Invitation token generation
│   │   ├── routeParams.ts            # Route parameter utilities
│   │   ├── workbook.ts               # Excel workbook utilities
│   │   └── cacheDebugger.ts          # Cache debugging utilities
│   ├── providers/                    # Provider components
│   │   └── QueryProvider.tsx         # React Query Provider
│   ├── supabase.ts                   # Supabase client (client-side)
│   ├── createSupabaseServerClient.ts # Supabase server-side client
│   ├── SupabaseContext.tsx           # Supabase Context
│   └── queryInvalidation.ts          # Query invalidation utilities
├── emails/                           # Email templates
│   └── invitation-email.tsx
└── middleware.ts                     # Next.js middleware (route protection)
```

---

## Core Modules

### 1. Authentication & Authorization Module

**Location**: `src/lib/contexts/AuthContext.tsx`, `src/middleware.ts`, `src/lib/services/authorizationService.ts`

**Responsibilities**:
- User login, sign-up, logout
- JWT token management
- Route protection (middleware)
- Role-based permission checks

**Key Components**:
- `AuthContext`: Provides user authentication state
- `middleware.ts`: Next.js middleware, intercepts unauthenticated requests
- `authorizationService.ts`: Permission validation logic

**Data Flow**:
```
User login → Supabase Auth → JWT Token → Cookie/Session Storage
         ↓
    AuthContext stores user info
         ↓
    Middleware checks auth state → unauthenticated users redirected to login page
         ↓
    Business logic uses authorizationService to check permissions
```

---

### 2. Project & Library Management Module

**Location**: `src/lib/services/projectService.ts`, `src/lib/services/libraryService.ts`, `src/components/projects/*`, `src/components/libraries/*`

**Responsibilities**:
- Create, edit, and delete projects
- Create, edit, and delete libraries
- Folder hierarchy management

**Key Components**:
- `projectService.ts`: Project CRUD operations
- `libraryService.ts`: Library CRUD operations
- `folderService.ts`: Folder CRUD operations
- `NewProjectModal`, `EditProjectModal`: Project modals
- `NewLibraryModal`, `EditLibraryModal`: Library modals

**Database Tables**:
- `projects`: Projects table
- `libraries`: Libraries table
- `folders`: Folders table

---

### 3. Asset Management & Real-Time Collaboration Module (Core)

**Location**: `src/components/libraries/LibraryAssetsTable.tsx`, `src/lib/contexts/LibraryDataContext.tsx`, `src/components/libraries/hooks/*`

**Responsibilities**:
- CRUD operations for assets
- Editing asset field values
- Real-time multi-user collaborative editing
- Presence tracking (showing who is editing what)
- Optimistic updates and conflict resolution

**Key Components**:
- `LibraryDataContext`: **Core context** managing library data and real-time collaboration
- `LibraryAssetsTable`: **Main table component** (2335 lines) for displaying and editing assets
- `useTableDataManager`: Table data management hook
- `useCellEditing`: Cell editing logic
- `useYjsSync`: Yjs CRDT sync logic

**Tech Stack**:
- **Yjs**: CRDT data structures, local state management
- **Supabase Realtime**: Real-time database subscriptions
- **React Query**: Data caching and server state

**Data Flow**:
```
1. Initial load:
   Supabase DB → React Query → LibraryDataContext → Yjs Doc
                                      ↓
                              LibraryAssetsTable renders

2. User edit (local user):
   User input → useCellEditing → LibraryDataContext.updateAssetField()
                                      ↓
                  Yjs Doc update (fires observe events)
                                      ↓
              Component re-renders → Supabase DB update (async)
                                      ↓
                    Realtime broadcasts to other users

3. Remote update (edits from other users):
   Supabase Realtime → LibraryDataContext receives event
                                      ↓
                    Yjs Doc update (if no conflict)
                                      ↓
                Component re-renders (optimistic update)
```

---

### 4. Field Definition Module

**Location**: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/*`

**Responsibilities**:
- Define a library's field structure (schema)
- Support multiple data types: Text, Number, Boolean, Date, Image, MediaFile, Reference, etc.
- Drag-and-drop field ordering
- Field grouping (sections)

**Key Components**:
- `predefine/page.tsx`: Field definition page
- `predefine/components/FieldsList.tsx`: Field list
- `predefine/components/FieldForm.tsx`: Field form (530 lines)
- `predefine/components/FieldItem.tsx`: Field item (509 lines)
- `predefine/components/NewSectionForm.tsx`: New section form
- `predefine/hooks/useSchemaData.ts`: Schema data management
- `predefine/hooks/useSchemaSave.ts`: Schema save logic

**Database Tables**:
- `library_field_definitions`: Field definitions table

---

### 5. Collaboration & Permissions Module

**Location**: `src/lib/services/collaborationService.ts`, `src/lib/services/authorizationService.ts`, `src/components/collaboration/*`

**Responsibilities**:
- Invite collaborators (send invitation emails)
- Manage collaborator roles (Admin/Editor/Viewer)
- Display collaborator status in real time
- Presence tracking (who is online, who is editing what)

**Key Components**:
- `collaborationService.ts`: Collaboration business logic
- `authorizationService.ts`: Role and permission checks
- `CollaboratorsList.tsx`: Collaborator list
- `InviteCollaboratorModal.tsx`: Invitation modal
- `ConnectionStatusIndicator.tsx`: Connection status indicator
- `FieldPresenceAvatars.tsx`: Field editing presence avatars

**Database Tables**:
- `project_collaborators`: Collaborators table
- `collaboration_invitations`: Invitations table

**Permission Model**:
```
Admin:
  - Full access
  - Can manage collaborators
  - Can delete projects

Editor:
  - Read/write access
  - Can edit assets and fields
  - Cannot manage collaborators

Viewer:
  - Read-only access
  - Cannot modify anything
```

---

### 6. Version Control Module

**Location**: `src/lib/services/versionService.ts`, `src/components/version-control/*`

**Responsibilities**:
- Create version snapshots of a library
- Restore to historical versions
- Version comparison (not implemented)

**Key Components**:
- `versionService.ts`: Version CRUD operations
- `VersionControlSidebar.tsx`: Version sidebar
- `VersionList.tsx`: Version list
- `CreateVersionModal.tsx`: Create version modal
- `RestoreConfirmModal.tsx`: Restore confirmation modal

**Database Tables**:
- `library_versions`: Versions table

**Version Types**:
- `manual`: Manually created by the user
- `backup`: Backup taken before a restore
- `restore`: Restored from another version

---

### 7. File Upload & Storage Module

**Location**: `src/lib/services/documentImageUpload.ts`, `src/lib/services/mediaFileUploadService.ts`, `src/components/media/*`

**Responsibilities**:
- Upload image files (Image field type)
- Upload media files (MediaFile field type)
- File type validation
- File size limits

**Key Components**:
- `documentImageUpload.ts`: Document image upload logic
- `mediaFileUploadService.ts`: Media file upload logic
- `MediaFileUpload.tsx`: Upload component

**Supabase Storage Buckets**:
- `tiptap-images`: Stores images from the Tiptap editor
- `library-media-files`: Stores media files for libraries

---

### 8. State Management & Caching Module

**Location**: `src/lib/providers/QueryProvider.tsx`, `src/lib/hooks/useCacheMutations.ts`, `src/lib/utils/queryKeys.ts`

**Responsibilities**:
- React Query configuration and management
- Cache invalidation strategy
- Optimistic updates
- Request deduplication

**Key Components**:
- `QueryProvider.tsx`: React Query Provider
- `useCacheMutations.ts`: Cache mutation hook
- `lib/utils/queryKeys.ts`: Query key definitions

---

## Database Architecture

### Database ER Diagram

```
┌──────────────┐
│   profiles   │ (users table)
│──────────────│
│ id (PK)      │◄─┐
│ email        │  │
│ display_name │  │
│ avatar_color │  │
└──────────────┘  │
                  │
                  │ owner_id
┌──────────────────┐
│     projects     │ (projects table)
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
│ project_collaborators│   │      libraries       │ (libraries table)
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
│collaboration_invitations│                          │ library_id
│──────────────────────│                            │
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
│ parent_folder_id (FK)│ (self-referencing)                │
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
│ snapshot_data        │ (JSONB, stores the full snapshot)
│ created_by (FK)      │
│ created_at           │
│ is_current           │
│ parent_version_id (FK)│ (self-referencing)
│ restore_from_version_id (FK)│
└──────────────────────┘
```

### Core Tables Explained

#### 1. profiles (users table)
- Extension table for Supabase Auth
- Stores the user's display name and avatar color

#### 2. projects (projects table)
- Basic project information
- Each project has an owner (creator)
- Supports collaborators via the `project_collaborators` table

#### 3. libraries (libraries table)
- Belongs to a project
- Can be organized into folders
- Each library has its own field definitions

#### 4. library_field_definitions (field definitions table)
- Defines the library's schema
- Supports multiple data types
- Supports field grouping (sections)
- `reference_libraries`: Reference-type fields can link to other libraries

#### 5. library_assets (assets table)
- Basic asset information (ID and name)
- Belongs to a library

#### 6. library_asset_values (asset field values table)
- Stores asset field values
- Uses the JSONB type for flexible data structures
- Composite primary key of `asset_id` and `field_id`

#### 7. project_collaborators (collaborators table)
- Collaborator relationships for a project
- Supports three roles: admin, editor, viewer
- A NULL `accepted_at` indicates a pending invitation

#### 8. library_versions (versions table)
- Stores complete snapshots of a library
- Supports restoring to historical versions
- `is_current` marks the current version

---

## Key Data Flows

### 1. User Authentication Flow

```
┌─────────────────┐
│ User visits page │
└──────┬──────────┘
       │
       ▼
┌──────────────────┐
│ middleware.ts    │ (checks auth state)
│ Checks the Auth  │
│ Token in cookies │
└──────┬───────────┘
       │
       ├─────► Not authenticated ─────► Redirect to / (login page)
       │
       ▼ Authenticated
┌──────────────────┐
│ Load Dashboard   │
│ AuthContext      │
│ provides user info │
└──────────────────┘
```

### 2. Project Creation Flow

```
User clicks "New Project"
       │
       ▼
┌────────────────────┐
│ NewProjectModal    │ (user enters project name and description)
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
│ Calls Supabase function: │
│ create_project_with_   │
│ default_resource()     │
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ PostgreSQL transaction: │
│ 1. Insert into projects │
│ 2. Insert into libraries│
│    (default "Resource"  │
│    library)             │
│ 3. Insert into project_ │
│    collaborators        │
│    (owner as admin)     │
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ React Query cache      │
│ invalidation; refetch  │
│ project list           │
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ UI updates, showing    │
│ the new project        │
└────────────────────────┘
```

### 3. Real-Time Collaborative Editing Flow (Most Complex)

```
User A edits a cell
       │
       ▼
┌────────────────────────────┐
│ CellEditor component       │
│ onChange fires             │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ useCellEditing hook        │
│ handleCellChange()         │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ LibraryDataContext         │
│ updateAssetField()         │
└────────┬───────────────────┘
         │
         ├──────► 1. Update Yjs Doc (local CRDT)
         │        Y.Map.set(assetId, fieldId, value)
         │
         ├──────► 2. Fire Yjs observe events
         │        → component re-renders (optimistic update)
         │
         └──────► 3. Update Supabase asynchronously
                  libraryAssetsService.updateAssetValue()
                  │
                  ▼
         ┌────────────────────────────┐
         │ Supabase Realtime broadcasts│
         │ UPDATE event to other clients│
         └────────┬───────────────────┘
                  │
                  ▼
         ┌────────────────────────────┐
         │ User B's client            │
         │ useRealtimeSubscription    │
         │ receives the UPDATE event  │
         └────────┬───────────────────┘
                  │
                  ▼
         ┌────────────────────────────┐
         │ LibraryDataContext         │
         │ handles the remote update  │
         │ → updates the Yjs Doc      │
         │ → triggers component re-render │
         └────────────────────────────┘
                  │
                  ▼
         ┌────────────────────────────┐
         │ User B sees User A's change │
         └────────────────────────────┘
```

### 4. Presence Tracking Flow

```
User A clicks to edit a cell
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
│ Updates presence state     │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Supabase Realtime          │
│ .track() sends presence    │
│ data to the channel        │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Other users receive the    │
│ presence-track event       │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ CellPresenceAvatars component │
│ shows User A's avatar on that cell │
└────────────────────────────┘
```

---

## Real-Time Collaboration Architecture

### Yjs + Supabase Realtime Dual-Layer Architecture

Keco Studio uses an **online dual-layer real-time collaboration architecture**:

1. **Local layer (Yjs)**: CRDT data structures ensuring instant responsiveness and conflict merging within the current session
2. **Remote layer (Supabase Realtime)**: Real-time database subscriptions ensuring eventual consistency across clients

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

### Advantages

1. **Instant responsiveness**: Yjs CRDT ensures local changes take effect immediately without waiting on the network
2. **Conflict resolution**: The CRDT automatically resolves concurrent editing conflicts
3. **Online broadcasting**: Supabase Realtime pushes database changes to other online clients
4. **Eventual consistency**: Supabase PostgreSQL is the persistent data source, and Realtime ensures data consistency across clients

### Disadvantages (Known Pain Points)

1. **Dual sources of truth**: Yjs and the Supabase DB may get out of sync
2. **High complexity**: Both Yjs and database state must be managed simultaneously
3. **Hard to debug**: State synchronization issues are difficult to pinpoint

---

## Authentication & Authorization

### Authentication Flow

1. **Supabase Auth**: JWT-based authentication system
2. **Cookie storage**: Tokens are stored in HTTPOnly cookies
3. **Middleware protection**: `middleware.ts` intercepts unauthenticated requests

### Authorization Model

#### Database Level (Row Level Security)

RLS policies are enabled on all tables:

```sql
-- Projects table: users can only see projects they created or were invited to
CREATE POLICY projects_select_policy ON projects
  FOR SELECT USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT project_id FROM project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );
```

#### Application Level (authorizationService)

```typescript
// Check whether the user is an Admin of the project
export async function isProjectAdmin(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<boolean> {
  // Check whether the user is the owner or an admin collaborator
}

// Check whether the user can edit
export async function canEditProject(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<boolean> {
  // Check whether the user is the owner, an admin, or an editor
}
```

---

## API Routes

### API Route List

| Route | Method | Function |
|------|------|------|
| `/api/projects` | POST | Create project |
| `/api/projects/[projectId]/libraries` | POST | Create library |
| `/api/projects/[projectId]/folders` | POST | Create folder |
| `/api/projects/[projectId]/role` | GET | Get the user's role in the project |
| `/api/projects/[projectId]/delete` | DELETE | Delete project |
| `/api/libraries/[libraryId]` | PUT | Update library info |
| `/api/libraries/[libraryId]` | DELETE | Delete library |
| `/api/collaborators` | GET | Get project collaborator list |
| `/api/collaborators/[collaboratorId]` | DELETE | Remove collaborator |
| `/api/invitations` | POST | Send collaboration invitation |
| `/api/invitations/accept` | POST | Accept invitation |
| `/api/invitations/decline` | POST | Decline invitation |

### API Design Pattern

All API routes follow this pattern:

1. **Authentication check**: Retrieve the Supabase session from cookies
2. **Permission validation**: Call `authorizationService` to check permissions
3. **Business logic**: Call the corresponding service-layer function
4. **Error handling**: Unified error response format

Example:

```typescript
// app/api/projects/route.ts
export async function POST(request: Request) {
  // 1. Create the Supabase client (automatically reads cookies)
  const supabase = createSupabaseServerClient();
  
  // 2. Check authentication
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // 3. Parse the request body
  const { name, description } = await request.json();
  
  // 4. Call the service layer
  const project = await projectService.createProject(supabase, {
    name,
    description,
    owner_id: user.id
  });
  
  // 5. Return the result
  return NextResponse.json(project);
}
```

---

## State Management

### State Management Architecture

Keco Studio uses a multi-layer state management architecture:

```
┌─────────────────────────────────────────────────────────┐
│                 Component-Local State                    │
│                   (useState, useReducer)                 │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  React Context                           │
│  • AuthContext (user authentication state)              │
│  • LibraryDataContext (library data and real-time collaboration) │
│  • PresenceContext (online status)                      │
│  • NavigationContext (navigation state)                 │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│               React Query (Server State)                 │
│  • Project list                                         │
│  • Library list                                         │
│  • Collaborator list                                    │
│  • Version list                                         │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Yjs Doc (CRDT State)                     │
│  • Asset data (assets)                                  │
│  • Field values (asset values)                          │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Supabase (Database State)                   │
│  • PostgreSQL (persisted data)                          │
│  • Realtime (real-time subscriptions)                   │
└─────────────────────────────────────────────────────────┘
```

### Context Provider Hierarchy

```typescript
// app/layout.tsx
<QueryProvider>  {/* React Query */}
  <AuthContext>  {/* Authentication */}
    <NavigationContext>  {/* Navigation */}
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

## File Upload & Storage

### Storage Buckets

| Bucket Name | Purpose | Security Policy |
|-------------|------|----------|
| `tiptap-images` | Tiptap editor images | Authenticated users can upload; public read |
| `library-media-files` | Library media files | Authenticated users can upload; public read |

### Upload Flow

```
User selects a file
       │
       ▼
┌────────────────────────────┐
│ Frontend validation        │
│ • File type                │
│ • File size (<10MB)        │
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
│ Returns a public URL       │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Save the URL to            │
│ library_asset_values       │
│ (value_json column)        │
└────────────────────────────┘
```

---

## Version Control

### Version Creation Flow

```
User clicks "Create Version"
       │
       ▼
┌────────────────────────────┐
│ CreateVersionModal         │
│ Enter the version name     │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ versionService.ts          │
│ createVersion()            │
└────────┬───────────────────┘
         │
         ├──────► 1. Fetch all library data
         │        • library_field_definitions
         │        • library_assets
         │        • library_asset_values
         │
         ├──────► 2. Serialize into a JSON snapshot
         │        snapshot_data = {
         │          fields: [...],
         │          assets: [...]
         │        }
         │
         └──────► 3. Insert into the library_versions table
                  {
                    library_id,
                    version_name,
                    version_type: 'manual',
                    snapshot_data,
                    created_by: user.id,
                    is_current: false
                  }
```

### Version Restore Flow

```
User clicks "Restore Version"
       │
       ▼
┌────────────────────────────┐
│ RestoreConfirmModal        │
│ Confirm the restore        │
│ Optional: back up current version │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ versionService.ts          │
│ restoreVersion()           │
└────────┬───────────────────┘
         │
         ├──────► 1. (Optional) Create a backup version
         │        version_type: 'backup'
         │
         ├──────► 2. Read the target version's snapshot_data
         │
         ├──────► 3. Clear the current library data
         │        • DELETE library_asset_values
         │        • DELETE library_assets
         │        • DELETE library_field_definitions
         │
         ├──────► 4. Restore the snapshot data
         │        • INSERT field definitions
         │        • INSERT assets
         │        • INSERT asset values
         │
         ├──────► 5. Create a restore record
         │        version_type: 'restore',
         │        restore_from_version_id: target version ID
         │
         └──────► 6. Mark as the current version
                  is_current: true
```

---

## Testing Architecture

### Testing Tools

- **Playwright**: E2E testing framework
- **Testing pattern**: Page Object Model (POM)

### Test Directory Structure

```
tests/
└── e2e/
    ├── pages/              # Page Object Model
    │   ├── project.page.ts
    │   ├── library.page.ts
    │   ├── asset.page.ts
    │   └── predefined.page.ts
    ├── specs/              # Test specs
    │   ├── auth.spec.ts              # Authentication tests
    │   ├── happy-path.spec.ts        # Happy-path tests
    │   ├── security.spec.ts          # Security tests
    │   ├── file-upload-security.spec.ts  # File upload security tests
    │   ├── destructive.spec.ts       # Destructive tests (delete operations)
    │   ├── version-control.spec.ts   # Version control tests
    │   ├── name-validation.spec.ts   # Name validation tests
    │   └── library-description-tooltip.spec.ts
    └── fixtures/           # Test fixtures
        └── users.ts
```

### Test Scripts

```json
{
  "test:e2e": "playwright test",
  "test:e2e:parallel": "playwright test --workers=50%",
  "test:e2e:clean": "tsx scripts/clean-remote-test-data.ts && playwright test",
  "test:e2e:sequential": "playwright test ... (in sequence)",
  "test:auth": "playwright test tests/e2e/specs/auth.spec.ts",
  "test:happy": "playwright test tests/e2e/specs/happy-path.spec.ts"
}
```

### Test Coverage

1. **Authentication tests** (`auth.spec.ts`)
   - Login/sign-up
   - Logout
   - Password reset

2. **Happy-path tests** (`happy-path.spec.ts`)
   - Create a project
   - Create a library
   - Create an asset
   - Edit fields

3. **Security tests** (`security.spec.ts`)
   - XSS protection
   - SQL injection protection
   - Permission validation

4. **Version control tests** (`version-control.spec.ts`)
   - Create a version
   - Restore a version
   - Version list

---

## Deployment Architecture

### Local Development Environment

```
┌──────────────────────────────────────────┐
│          Developer Machine               │
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

Startup steps:

```bash
# 1. Start local Supabase
supabase start

# 2. Configure environment variables (.env.local)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>

# 3. Install dependencies
npm install

# 4. Start the Next.js dev server
npm run dev
```

### Production Environment (Assumed)

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

## Known Pain Points

Based on the project's current state and code analysis, the following architecture and code pain points have been identified:

### 1. Excessive Complexity

**Problem**:
- **Sidebar.tsx (2330 lines)**: The sidebar component is far too large, containing version control, collaborator management, folder tree, and other features
- **LibraryAssetsTable.tsx (2335 lines)**: The table component is overly complex and hard to maintain and test
- **LibraryDataContext.tsx (668 lines)**: The context component has too many responsibilities, integrating data management, real-time collaboration, presence tracking, and more

**Impact**:
- Fixing bugs easily introduces new problems
- Hard to pinpoint issues
- Difficult for new developers to understand

**Recommendation**: See the "Optimization Recommendations Document"

### 2. Messy Directory Structure

**Problem**:
- `src/contexts/` and `src/lib/contexts/` coexist
- `src/hooks/` and `src/lib/hooks/` coexist
- Component-internal hooks are scattered across different locations

**Impact**:
- Code is hard to find
- Import paths are confusing
- Duplicate code is easily introduced

### 3. Too Many Relative Import Paths

**Problem**:
- 86 files use `../` relative imports
- Import paths are hard to understand and maintain

**Example**:
```typescript
import { something } from '../../../../lib/services/...'
```

**Recommendation**:
- Consistently use `@/` alias imports

### 4. Dual Sources of Truth (Yjs + Supabase)

**Problem**:
- Yjs local state and Supabase DB state can become inconsistent
- Network interruptions can cause data desynchronization
- Hard to debug — difficult to tell whether an issue is in Yjs or Realtime

**Impact**:
- Data consistency issues
- User experience issues (occasionally seeing stale data)

### 5. Lack of Unified Error Handling

**Problem**:
- Error handling in API routes is inconsistent
- Client-side error handling is scattered across components

**Impact**:
- Inconsistent user experience
- Hard to trace errors

### 6. Insufficient Type Safety

**Problem**:
- `strict: false` in `tsconfig.json`
- Many `any` types

**Impact**:
- Runtime errors
- Inaccurate IDE hints

### 7. Insufficient Test Coverage

**Problem**:
- Only E2E tests exist; unit tests are missing
- Core business logic (e.g., services) has no test coverage

**Impact**:
- High refactoring risk
- Hard to guarantee code quality

### 8. Performance Issues

**Problem**:
- Large tables (>1000 rows) render slowly
- Frequent Realtime subscriptions can cause performance issues
- No virtualized rendering

**Impact**:
- Poor user experience
- Possible browser jank

### 9. Lack of Documentation

**Problem**:
- Insufficient code comments
- Missing architecture documentation (this document fills that gap)
- Missing API documentation

**Impact**:
- Hard for new developers to get up to speed
- Difficult to maintain

---

## Summary

### Project Strengths

1. ✅ **Feature-complete**: Implements a full collaborative asset management platform
2. ✅ **Modern technology**: Uses modern technologies such as Next.js 16, Supabase, and Yjs
3. ✅ **Real-time collaboration**: Complete multi-user real-time editing and presence tracking
4. ✅ **Permission management**: Role-based access control
5. ✅ **Version control**: Supports library version snapshots and restores
6. ✅ **Test coverage**: Comprehensive E2E test suite

### Room for Improvement

1. 📌 **Code organization**: Refactor oversized components and unify the directory structure
2. 📌 **Type safety**: Enable TypeScript strict mode
3. 📌 **Performance optimization**: Virtualized rendering, optimized Realtime subscriptions
4. 📌 **Better testing**: Add unit tests and integration tests
5. 📌 **Better documentation**: Add code comments and API documentation
6. 📌 **Error handling**: Unify the error handling strategy

---

## Appendix

### Key Metrics

- **Lines of code**: ~30,000+ lines (estimated)
- **Component count**: 82 .tsx files
- **Service count**: 13 service-layer files
- **Database tables**: 15+ core tables
- **Database migrations**: 40+ migration files
- **E2E tests**: 10+ test specs
- **Dependencies**: 30+ production dependencies

### Technical Debt Estimate

| Category | Severity | Estimated Effort |
|------|---------|-----------|
| Oversized component refactoring | High | 2-3 weeks |
| Directory structure cleanup | Medium | 1 week |
| TypeScript strict mode | High | 2 weeks |
| Adding unit tests | Medium | 3-4 weeks |
| Performance optimization | High | 2 weeks |
| Documentation improvements | Low | 1 week |

**Total**: Approximately 11-13 weeks of refactoring and optimization work

---

**End of Document**
