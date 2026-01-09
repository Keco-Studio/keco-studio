# Data Model: Real-time Project Collaboration

**Feature**: Real-time Project Collaboration  
**Date**: 2026-01-08  
**Purpose**: Database schema design for collaboration entities

## Overview

This document defines the database schema for implementing real-time project collaboration with role-based access control. All tables follow PostgreSQL conventions with UUID primary keys, timestamps, and Row Level Security (RLS) policies.

## Entity Relationship Diagram

```
┌──────────────┐        ┌─────────────────────────┐        ┌──────────────┐
│   profiles   │◄───────│  project_collaborators  │───────►│   projects   │
│              │        │                         │        │              │
│  - id        │        │  - id                   │        │  - id        │
│  - email     │        │  - user_id (FK)         │        │  - owner_id  │
│  - name      │        │  - project_id (FK)      │        │  - name      │
│  - avatar_   │        │  - role                 │        │  - ...       │
│    color*    │        │  - invited_by (FK)      │        │              │
│  - ...       │        │  - invited_at           │        └──────────────┘
│              │        │  - accepted_at          │
└──────────────┘        │  - created_at           │        ┌──────────────┐
                        │  - updated_at           │        │  libraries   │
                        └─────────────────────────┘        │              │
                                                           │  - id        │
                                                           │  - project   │
┌──────────────────────────────┐                          │    _id (FK)  │
│  collaboration_invitations   │                          │  - name      │
│                              │                          │  - ...       │
│  - id                        │                          └──────────────┘
│  - project_id (FK)           │                                 │
│  - recipient_email           │                                 │
│  - role                      │                                 ▼
│  - invited_by (FK)           │                          ┌──────────────────┐
│  - invitation_token          │                          │  library_assets  │
│  - sent_at                   │                          │                  │
│  - expires_at                │                          │  - id            │
│  - accepted_at               │                          │  - library_id    │
│  - created_at                │                          │  - name          │
│  - updated_at                │                          │  - ...           │
└──────────────────────────────┘                          └──────────────────┘

* New field added to existing table
```

## Table Definitions

### 1. profiles (Modified)

**Purpose**: User profile information extended with avatar color for presence indicators.

**Modifications**:
- Add `avatar_color` column for consistent color assignment across sessions

```sql
-- Migration: Add avatar_color to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_color TEXT DEFAULT NULL;

-- Backfill existing users with generated colors
UPDATE public.profiles
SET avatar_color = public.generate_avatar_color(id)
WHERE avatar_color IS NULL;

-- Helper function for color generation
CREATE OR REPLACE FUNCTION public.generate_avatar_color(user_id UUID)
RETURNS TEXT AS $$
DECLARE
  hash INTEGER;
  hue INTEGER;
BEGIN
  -- Simple hash of UUID to get consistent color
  hash := ABS(('x' || SUBSTRING(user_id::TEXT, 1, 8))::BIT(32)::INTEGER);
  hue := (hash % 12) * 30; -- 0, 30, 60, ..., 330
  RETURN 'hsl(' || hue || ', 70%, 60%)';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-generate color for new users
CREATE OR REPLACE FUNCTION public.set_avatar_color_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.avatar_color IS NULL THEN
    NEW.avatar_color := public.generate_avatar_color(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_set_avatar_color
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_avatar_color_on_insert();
```

**Indexes**: Existing indexes sufficient (primary key on `id`).

**RLS Policies**: No changes (existing policies allow users to view profiles).

---

### 2. project_collaborators (New Table)

**Purpose**: Junction table representing user-project relationships with role-based permissions.

**Schema**:

```sql
CREATE TABLE IF NOT EXISTS public.project_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE (user_id, project_id),
  CHECK (user_id != invited_by) -- Can't invite yourself
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id 
  ON public.project_collaborators(user_id);
  
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id 
  ON public.project_collaborators(project_id);
  
CREATE INDEX IF NOT EXISTS idx_project_collaborators_role 
  ON public.project_collaborators(project_id, role) 
  WHERE accepted_at IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER project_collaborators_updated_at
  BEFORE UPDATE ON public.project_collaborators
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
```

**Field Descriptions**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Reference to user being invited/added |
| `project_id` | UUID | Reference to project |
| `role` | TEXT | Permission level: 'admin', 'editor', or 'viewer' |
| `invited_by` | UUID | User who sent invitation (NULL if project owner/auto-added) |
| `invited_at` | TIMESTAMPTZ | When invitation was sent |
| `accepted_at` | TIMESTAMPTZ | When user accepted (NULL = pending) |
| `created_at` | TIMESTAMPTZ | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp |

**Business Rules**:
- Project owner automatically added as admin when project created
- Pending invitations have `accepted_at = NULL`
- Active collaborators have `accepted_at IS NOT NULL`
- Unique constraint prevents duplicate collaborator entries
- Role can be changed by admins after acceptance

**RLS Policies**:

```sql
-- Enable RLS
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- View: Any collaborator can see other collaborators in same project
CREATE POLICY "collaborators_select_policy"
  ON public.project_collaborators FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- Insert: Only admins can add new collaborators
CREATE POLICY "collaborators_insert_policy"
  ON public.project_collaborators FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_collaborators
      WHERE project_id = project_collaborators.project_id
        AND user_id = auth.uid()
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Update: Only admins can modify roles or other fields
CREATE POLICY "collaborators_update_policy"
  ON public.project_collaborators FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_collaborators
      WHERE project_id = project_collaborators.project_id
        AND user_id = auth.uid()
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Delete: Only admins can remove collaborators
CREATE POLICY "collaborators_delete_policy"
  ON public.project_collaborators FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc2
      WHERE pc2.project_id = project_collaborators.project_id
        AND pc2.user_id = auth.uid()
        AND pc2.role = 'admin'
        AND pc2.accepted_at IS NOT NULL
    )
  );
```

---

### 3. collaboration_invitations (New Table)

**Purpose**: Track pending and historical invitation records with secure tokens.

**Schema**:

```sql
CREATE TABLE IF NOT EXISTS public.collaboration_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitation_token TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ DEFAULT NULL,
  accepted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CHECK (accepted_at IS NULL OR accepted_at <= NOW()),
  CHECK (expires_at > sent_at)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_token 
  ON public.collaboration_invitations(invitation_token) 
  WHERE accepted_at IS NULL;
  
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_email 
  ON public.collaboration_invitations(recipient_email, project_id);
  
CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_project 
  ON public.collaboration_invitations(project_id);

-- Trigger for updated_at
CREATE TRIGGER collaboration_invitations_updated_at
  BEFORE UPDATE ON public.collaboration_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
```

**Field Descriptions**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `project_id` | UUID | Reference to project |
| `recipient_email` | TEXT | Email address of invitee |
| `role` | TEXT | Assigned role for this invitation |
| `invited_by` | UUID | User who sent invitation |
| `invitation_token` | TEXT | Secure JWT token for acceptance link |
| `sent_at` | TIMESTAMPTZ | Email sent timestamp |
| `expires_at` | TIMESTAMPTZ | Token expiration (7 days from sent_at) |
| `accepted_at` | TIMESTAMPTZ | When invitation accepted (NULL = pending) |
| `accepted_by` | UUID | User who accepted (may differ from email if email forwarded) |
| `created_at` | TIMESTAMPTZ | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp |

**Business Rules**:
- Invitation tokens are JWT signed with server secret (see research.md)
- Tokens expire after 7 days (configurable via `expires_at`)
- One-time use: `accepted_at` set when used, subsequent attempts rejected
- Multiple invitations to same email+project allowed (resend scenario)
- Token validation must check both `expires_at` and `accepted_at`

**RLS Policies**:

```sql
-- Enable RLS
ALTER TABLE public.collaboration_invitations ENABLE ROW LEVEL SECURITY;

-- View: Admins can see all invitations for their projects
CREATE POLICY "invitations_select_policy"
  ON public.collaboration_invitations FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Insert: Only admins can create invitations
CREATE POLICY "invitations_insert_policy"
  ON public.collaboration_invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_collaborators
      WHERE project_id = collaboration_invitations.project_id
        AND user_id = auth.uid()
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
  );

-- Update: Only system can update (via Server Action for acceptance)
-- Users don't update directly; Server Action validates and updates
CREATE POLICY "invitations_update_policy"
  ON public.collaboration_invitations FOR UPDATE
  USING (false); -- Block user updates; use service role for acceptance

-- Delete: Admins can revoke pending invitations
CREATE POLICY "invitations_delete_policy"
  ON public.collaboration_invitations FOR DELETE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role = 'admin'
        AND accepted_at IS NOT NULL
    )
    AND accepted_at IS NULL -- Can only delete pending invitations
  );
```

---

### 4. projects (Modified)

**Purpose**: Update RLS policies to work with collaboration system.

**Modifications**:
- Update existing RLS policies to check `project_collaborators` table
- Maintain backward compatibility with `owner_id` column

```sql
-- Drop existing policies
DROP POLICY IF EXISTS projects_select_policy ON public.projects;
DROP POLICY IF EXISTS projects_update_policy ON public.projects;
DROP POLICY IF EXISTS projects_delete_policy ON public.projects;

-- New policies supporting collaboration
CREATE POLICY "projects_select_policy"
  ON public.projects FOR SELECT
  USING (
    owner_id = auth.uid() -- Owner can always see
    OR
    id IN ( -- Collaborators with accepted invitations can see
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "projects_update_policy"
  ON public.projects FOR UPDATE
  USING (
    id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor') -- Editors can update project metadata
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "projects_delete_policy"
  ON public.projects FOR DELETE
  USING (
    owner_id = auth.uid() -- Only owner can delete entire project
  );

-- Insert policy unchanged (owner creates project)
```

**Data Migration**:
When deploying, automatically create admin collaborator records for existing project owners:

```sql
-- Backfill project_collaborators for existing projects
INSERT INTO public.project_collaborators (user_id, project_id, role, invited_by, accepted_at)
SELECT 
  owner_id AS user_id,
  id AS project_id,
  'admin' AS role,
  NULL AS invited_by, -- Self-added
  created_at AS accepted_at -- Retroactive acceptance
FROM public.projects
ON CONFLICT (user_id, project_id) DO NOTHING;
```

---

### 5. libraries (Modified)

**Purpose**: Update RLS policies to respect collaborator permissions.

**Modifications**:
- Update SELECT policy to allow all collaborators
- Update INSERT/UPDATE/DELETE policies to allow admins and editors

```sql
-- Drop existing policies
DROP POLICY IF EXISTS libraries_select_policy ON public.libraries;
DROP POLICY IF EXISTS libraries_insert_policy ON public.libraries;
DROP POLICY IF EXISTS libraries_update_policy ON public.libraries;
DROP POLICY IF EXISTS libraries_delete_policy ON public.libraries;

-- New policies with collaboration support
CREATE POLICY "libraries_select_policy"
  ON public.libraries FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "libraries_insert_policy"
  ON public.libraries FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "libraries_update_policy"
  ON public.libraries FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "libraries_delete_policy"
  ON public.libraries FOR DELETE
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() 
        AND role IN ('admin', 'editor')
        AND accepted_at IS NOT NULL
    )
  );
```

---

### 6. library_assets & library_asset_values (Modified)

**Purpose**: Update RLS policies to enforce editor-only modifications.

**Modifications**:
- Allow viewers to SELECT
- Restrict INSERT/UPDATE/DELETE to editors and admins

```sql
-- library_assets policies
DROP POLICY IF EXISTS la_select_auth ON public.library_assets;
DROP POLICY IF EXISTS la_insert_auth ON public.library_assets;
DROP POLICY IF EXISTS la_update_auth ON public.library_assets;
DROP POLICY IF EXISTS la_delete_auth ON public.library_assets;

CREATE POLICY "library_assets_select_policy"
  ON public.library_assets FOR SELECT
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_assets_insert_policy"
  ON public.library_assets FOR INSERT
  WITH CHECK (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_assets_update_policy"
  ON public.library_assets FOR UPDATE
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_assets_delete_policy"
  ON public.library_assets FOR DELETE
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

-- library_asset_values policies (similar pattern)
DROP POLICY IF EXISTS lav_select_auth ON public.library_asset_values;
DROP POLICY IF EXISTS lav_insert_auth ON public.library_asset_values;
DROP POLICY IF EXISTS lav_update_auth ON public.library_asset_values;
DROP POLICY IF EXISTS lav_delete_auth ON public.library_asset_values;

CREATE POLICY "library_asset_values_select_policy"
  ON public.library_asset_values FOR SELECT
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_asset_values_insert_policy"
  ON public.library_asset_values FOR INSERT
  WITH CHECK (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_asset_values_update_policy"
  ON public.library_asset_values FOR UPDATE
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "library_asset_values_delete_policy"
  ON public.library_asset_values FOR DELETE
  USING (
    asset_id IN (
      SELECT la.id 
      FROM public.library_assets la
      JOIN public.libraries l ON la.library_id = l.id
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.role IN ('admin', 'editor')
        AND pc.accepted_at IS NOT NULL
    )
  );
```

---

## Realtime Configuration

Enable Supabase Realtime for collaboration tables:

```sql
-- Enable realtime for collaboration tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_collaborators;
ALTER PUBLICATION supabase_realtime ADD TABLE public.library_assets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.library_asset_values;
```

**Note**: Presence data (cursor position, active cell) is **not** stored in database. It's ephemeral state managed by Supabase Realtime Presence API (see research.md section 4).

---

## Migration Sequence

Execute migrations in this order:

1. `20260108000000_create_project_collaborators.sql`
2. `20260108000001_create_collaboration_invitations.sql`
3. `20260108000002_add_avatar_color_to_profiles.sql`
4. `20260108000003_update_rls_for_collaboration.sql`
5. `20260108000004_enable_realtime_for_collaboration.sql`
6. `20260108000005_backfill_project_owners_as_admins.sql`

---

## Performance Considerations

### Query Optimization

1. **Collaborator checks**: Indexed on `(user_id, project_id, accepted_at)` for fast permission lookups
2. **Role filtering**: Partial index on `(project_id, role) WHERE accepted_at IS NOT NULL` for admin queries
3. **Invitation lookups**: Unique index on `invitation_token` for O(1) token validation

### Expected Query Patterns

- **Most frequent**: Permission checks in RLS policies (every request)
- **Moderate frequency**: Presence updates (every 30s per active user)
- **Low frequency**: Invitation CRUD (typically <10/day per project)

### Caching Strategy

- User role per project: Cache in React Query (5 minute stale time)
- Active collaborators list: Cache in React Query (1 minute stale time)
- Presence state: Ephemeral in Realtime (no caching needed)

---

## Data Retention

- **Active collaborators**: Retained indefinitely while user has access
- **Removed collaborators**: Soft delete (set `accepted_at = NULL`) or hard delete based on policy
- **Invitations**: Keep for 90 days for audit trail, then delete
- **Presence data**: Never persisted (Realtime only)

---

## Summary

This data model provides:
- ✅ Role-based access control (Admin/Editor/Viewer)
- ✅ Secure invitation system with JWT tokens
- ✅ RLS enforcement at database level
- ✅ Real-time subscription support
- ✅ Backward compatibility with existing projects
- ✅ Performance optimization with appropriate indexes
- ✅ Audit trail via timestamps and relationships

