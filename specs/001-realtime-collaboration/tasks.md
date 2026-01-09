# Tasks: Real-time Project Collaboration

**Feature Branch**: `001-realtime-collaboration`  
**Input**: Design documents from `/specs/001-realtime-collaboration/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story (US1-US5) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and environment configuration

- [x] T001 Install new dependencies (jose, resend, @react-email/components) per package.json
- [x] T002 [P] Create `.env.local` with required environment variables (RESEND_API_KEY, INVITATION_SECRET, etc.)
- [x] T003 [P] Generate INVITATION_SECRET using crypto.randomBytes(32)
- [x] T004 [P] Create collaboration types in src/lib/types/collaboration.ts
- [x] T005 [P] Create avatar color utility in src/lib/utils/avatarColors.ts with deterministic HSL generation

**Checkpoint**: Development environment ready for database and feature implementation

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema and core infrastructure that MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Database Migrations

- [x] T006 Create migration supabase/migrations/20260108000000_create_project_collaborators.sql
- [x] T007 Create migration supabase/migrations/20260108000001_create_collaboration_invitations.sql
- [x] T008 Create migration supabase/migrations/20260108000002_add_avatar_color_to_profiles.sql
- [x] T009 Create migration supabase/migrations/20260108000003_update_rls_for_collaboration.sql
- [x] T010 Create migration supabase/migrations/20260108000004_enable_realtime_for_collaboration.sql
- [x] T011 Create migration supabase/migrations/20260108000005_backfill_project_owners_as_admins.sql
- [x] T012 Run all migrations with supabase db push

### Core Services & Utilities

- [x] T013 [P] Create email service in src/lib/services/emailService.ts with Resend integration
- [x] T014 [P] Create JWT token utilities in src/lib/utils/invitationToken.ts (sign/verify with jose)
- [x] T015 [P] Create collaboration permissions hook in src/lib/hooks/useCollaboratorPermissions.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Invite Collaborators to Project (Priority: P1) 🎯 MVP

**Goal**: Enable project admins to invite team members via email with role assignment

**Independent Test**: Right-click project in sidebar → Select "Collaborators" → Click "Invite" → Fill email and role → Send invite → Verify email received with accept link

### Implementation for User Story 1

- [x] T016 [P] [US1] Create collaboration service in src/lib/services/collaborationService.ts with sendInvitation function
- [x] T017 [P] [US1] Create Server Action sendCollaborationInvitation in src/lib/actions/collaboration.ts
- [x] T018 [P] [US1] Create InviteCollaboratorModal component in src/components/collaboration/InviteCollaboratorModal.tsx
- [x] T019 [P] [US1] Create InviteCollaboratorModal styles in src/components/collaboration/InviteCollaboratorModal.module.css
- [x] T020 [P] [US1] Create email template in src/emails/invitation-email.tsx with React Email
- [x] T021 [US1] Create Collaborators page in src/app/(dashboard)/[projectId]/collaborators/page.tsx
- [x] T022 [US1] Add "Collaborators" option to project context menu in src/components/layout/Sidebar.tsx
- [x] T023 [US1] Implement role-based dropdown filtering (admin sees all, editor no admin, viewer only viewer)
- [x] T024 [US1] Add email validation and duplicate collaborator check in sendInvitation
- [x] T025 [US1] Add error handling for email send failures with user-facing messages
- [x] T026 [US1] Create invitation acceptance page in src/app/accept-invitation/page.tsx
- [x] T027 [US1] Implement JWT token validation and invitation acceptance flow
- [x] T028 [US1] Add invitation expiration check (7 days) and error handling

**Checkpoint**: Admins can invite collaborators, invitees receive emails and can accept to gain project access

---

## Phase 4: User Story 2 - Manage Collaborator Roles and Access (Priority: P1)

**Goal**: Enable admins to view, modify roles, and remove collaborators

**Independent Test**: Open Collaborators page → View list with roles → Change collaborator role → Confirm change propagates → Remove collaborator → Verify access revoked

### Implementation for User Story 2

- [x] T029 [P] [US2] Create CollaboratorsList component in src/components/collaboration/CollaboratorsList.tsx
- [x] T030 [P] [US2] Create CollaboratorsList styles in src/components/collaboration/CollaboratorsList.module.css
- [x] T031 [P] [US2] Create Server Action getProjectCollaborators in src/lib/actions/collaboration.ts
- [x] T032 [P] [US2] Create Server Action updateCollaboratorRole in src/lib/actions/collaboration.ts
- [x] T033 [P] [US2] Create Server Action removeCollaborator in src/lib/actions/collaboration.ts
- [x] T034 [US2] Integrate CollaboratorsList into Collaborators page (src/app/(dashboard)/[projectId]/collaborators/page.tsx)
- [x] T035 [US2] Implement role dropdown with admin-only edit permissions in CollaboratorsList
- [x] T036 [US2] Add delete collaborator button with two-step confirmation modal (admin-only)
- [x] T037 [US2] Hide edit/delete controls for editor/viewer roles (read-only view)
- [x] T038 [US2] Add validation to prevent self-role-change and last-admin removal
- [x] T039 [US2] Implement database change subscription to refresh list on collaborator updates
- [x] T040 [US2] Add optimistic updates for role changes with rollback on error

**Checkpoint**: Admins can manage collaborators (view, change roles, remove), non-admins have read-only view

---

## Phase 5: User Story 3 - Real-time Cell Editing (Priority: P2)

**Goal**: Enable multiple users to edit different cells simultaneously with instant synchronization

**Independent Test**: Open same library with two user accounts → Edit different cells → Verify changes appear in <500ms → Verify colored borders show editing user

### Implementation for User Story 3

- [x] T041 [P] [US3] Create realtime subscription hook in src/lib/hooks/useRealtimeSubscription.ts
- [x] T042 [P] [US3] Create cell update broadcast utilities in src/lib/services/realtimeService.ts
- [x] T043 [US3] Integrate useRealtimeSubscription hook into LibraryAssetsTable (src/components/libraries/LibraryAssetsTable.tsx)
- [x] T044 [US3] Implement broadcast channel subscription for library:{libraryId}:edits
- [x] T045 [US3] Add cell:update event handler with optimistic UI updates
- [x] T046 [US3] Add asset:create event handler to add rows in real-time
- [x] T047 [US3] Add asset:delete event handler to remove rows in real-time
- [x] T048 [US3] Implement cell edit broadcasting on save (send cell:update event)
- [x] T049 [US3] Add colored cell borders using editing user's avatarColor
- [x] T050 [US3] Implement conflict detection logic (compare local timestamp vs broadcast timestamp)
- [x] T051 [US3] Add conflict notification toast when remote update overwrites local change
- [x] T052 [US3] Implement optimistic update map for pending edits
- [x] T053 [US3] Add connection status indicator in library page header
- [x] T054 [US3] Implement reconnection logic with queued updates on connection restore

**Checkpoint**: Multiple users can edit simultaneously, see real-time updates, and resolve conflicts automatically

---

## Phase 6: User Story 4 - Display Active Collaborator Presence (Priority: P2)

**Goal**: Show which collaborators are currently viewing/editing the library with visual indicators

**Independent Test**: Open library with two users → See both avatars in header → Click cell → See avatar on that cell → Close one user's tab → Avatar disappears within 10s

### Implementation for User Story 4

- [x] T055 [P] [US4] Create presence tracking hook in src/lib/hooks/usePresenceTracking.ts
- [x] T056 [P] [US4] Create PresenceIndicators component in src/components/collaboration/PresenceIndicators.tsx
- [x] T057 [P] [US4] Create PresenceIndicators styles in src/components/collaboration/PresenceIndicators.module.css
- [x] T058 [US4] Implement Supabase Presence channel subscription for library:{libraryId}:presence
- [x] T059 [US4] Add presence tracking on library page mount with initial state
- [x] T060 [US4] Implement 30-second heartbeat to update lastActivity timestamp
- [x] T061 [US4] Add presence cleanup on page unmount (untrack)
- [x] T062 [US4] Integrate PresenceIndicators into library page header showing active user avatars
- [x] T063 [US4] Update presence state when user focuses on cell (track activeCell)
- [x] T064 [US4] Display user avatars on cells they are editing using activeCell data
- [x] T065 [US4] Add presence:join event handler with toast notification
- [x] T066 [US4] Add presence:leave event handler to remove indicators within 10s
- [x] T067 [US4] Implement avatar collapse for 10+ users (show "X others")

**Checkpoint**: Users see real-time presence of collaborators, know who's editing where, and receive join/leave notifications

---

## Phase 7: User Story 5 - Multi-User Same Cell Editing (Priority: P3)

**Goal**: Handle edge case when multiple users edit same cell with stacked avatars and conflict UI

**Independent Test**: Two users click same cell simultaneously → See stacked avatars → First user's color on border → Both save → Last save wins with notification

### Implementation for User Story 5

- [x] T068 [P] [US5] Create StackedAvatars component in src/components/collaboration/StackedAvatars.tsx
- [x] T069 [P] [US5] Create StackedAvatars styles in src/components/collaboration/StackedAvatars.module.css
- [x] T070 [US5] Integrate StackedAvatars into LibraryAssetsTable cells
- [x] T071 [US5] Implement first-user-priority border color logic (rightmost avatar = first)
- [x] T072 [US5] Add stacked avatar ordering (first user rightmost, subsequent left)
- [x] T073 [US5] Implement unsaved changes highlighting when conflict detected
- [x] T074 [US5] Add "Keep" / "Discard" buttons for conflicted cell content
- [x] T075 [US5] Display "Cell updated by [username]" notification on conflict
- [x] T076 [US5] Implement rollback logic when user chooses "Discard"

**Checkpoint**: Same-cell editing gracefully handled with visual feedback and conflict resolution UI

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements and refinements across all user stories

### Figma Implementation

- [ ] T077 [P] Extract Collaborators page design from Figma (node-id=551-48716) using F2C MCP
- [ ] T078 [P] Extract multi-user cell editing design from Figma (node-id=553-63891) using F2C MCP
- [ ] T079 Implement pixel-perfect Collaborators page styles matching Figma
- [ ] T080 Implement pixel-perfect cell editing indicators matching Figma
- [ ] T081 Verify responsive behavior for all collaboration components

### Error Handling & Edge Cases

- [x] T082 [P] Add offline state detection and queue pending changes locally
- [x] T083 [P] Implement sync on reconnection for queued changes
- [x] T084 [P] Add validation error for duplicate invitations to same email
- [ ] T085 [P] Add graceful disconnect for removed collaborator mid-session
- [x] T086 [P] Implement timezone-aware timestamp display using user's local timezone
- [ ] T087 Add rate limiting for invitation sending (10/hour per project)
- [x] T088 Add connection status indicator with reconnection attempts

### Performance Optimization

- [x] T089 [P] Throttle presence cursor updates to 10/second maximum
- [x] T090 [P] Debounce cell edit broadcasts to 500ms pause
- [x] T091 Optimize RLS policy performance with proper indexes
- [ ] T092 Add React Query caching for collaborator list (1 minute stale time)

### Documentation & Testing

- [ ] T093 [P] Verify all migrations applied successfully with no errors
- [ ] T094 [P] Test invitation workflow end-to-end with real email
- [ ] T095 [P] Test real-time editing with 2+ concurrent users in different browsers
- [ ] T096 [P] Test presence indicators with join/leave scenarios
- [ ] T097 [P] Test role permission enforcement (editor/viewer cannot manage collaborators)
- [ ] T098 Validate quickstart.md setup instructions work from clean environment
- [ ] T099 Run performance testing with 10 concurrent users editing same library
- [ ] T100 Verify all edge cases from spec.md are handled correctly

**Checkpoint**: Feature complete, polished, tested, and ready for production deployment

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) - Foundation for all collaboration
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) and US1 for collaborator data - Can start after US1 complete
- **User Story 3 (Phase 5)**: Depends on Foundational (Phase 2) - Independent of US1/US2, can start after foundation
- **User Story 4 (Phase 6)**: Depends on Foundational (Phase 2) and US3 for real-time infrastructure - Can start after US3 complete
- **User Story 5 (Phase 7)**: Depends on US3 and US4 for real-time and presence features - Requires both complete
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

```
Phase 1 (Setup)
     ↓
Phase 2 (Foundational) ← BLOCKS EVERYTHING
     ↓
     ├─→ Phase 3 (US1: Invitations) ← MVP
     │        ↓
     ├─→ Phase 4 (US2: Management) ← Extends US1
     │
     └─→ Phase 5 (US3: Real-time Editing) ← Independent
              ↓
         Phase 6 (US4: Presence) ← Builds on US3
              ↓
         Phase 7 (US5: Conflicts) ← Requires US3 + US4
              ↓
         Phase 8 (Polish)
```

### Critical Path (Sequential)

1. Phase 1: Setup (5 tasks, ~1 hour)
2. Phase 2: Foundational (10 tasks, ~3 hours) ⚠️ BLOCKS EVERYTHING
3. Phase 3: US1 Invitations (13 tasks, ~6 hours) 🎯 MVP DELIVERY
4. Phase 4: US2 Management (12 tasks, ~4 hours)
5. Phase 5: US3 Real-time (14 tasks, ~8 hours)
6. Phase 6: US4 Presence (13 tasks, ~6 hours)
7. Phase 7: US5 Conflicts (9 tasks, ~4 hours)
8. Phase 8: Polish (24 tasks, ~8 hours)

**Total Estimated Time**: ~40 hours sequential execution

### Parallel Opportunities

**Within Phase 2 (Foundational)**: All migration files (T006-T011) can be created in parallel, then run together (T012)

**Within Phase 3 (US1)**: 
- Parallel: T016, T017, T018, T019, T020 (different files, no dependencies)
- Sequential: T021-T028 (build on previous tasks)

**Within Phase 4 (US2)**:
- Parallel: T029, T030, T031, T032, T033 (different files, no dependencies)
- Sequential: T034-T040 (integration and refinement)

**Within Phase 5 (US3)**:
- Parallel: T041, T042 (hooks and services independent)
- Sequential: T043-T054 (integration requires hooks)

**Within Phase 6 (US4)**:
- Parallel: T055, T056, T057 (hook and component independent)
- Sequential: T058-T067 (integration and refinement)

**Within Phase 7 (US5)**:
- Parallel: T068, T069 (component and styles)
- Sequential: T070-T076 (integration and logic)

**Within Phase 8 (Polish)**:
- Parallel: T077-T078 (Figma extraction), T082-T086 (edge cases), T089-T092 (performance), T093-T100 (testing)
- Sequential: T079-T081 (Figma implementation after extraction)

**Across User Stories (After Foundational Complete)**:
- US1 and US3 can start in parallel (independent features)
- US2 requires US1 data, US4 requires US3, US5 requires US3+US4

---

## Parallel Example: Foundational Phase

```bash
# Create all migration files simultaneously:
Task T006: "Create migration 20260108000000_create_project_collaborators.sql"
Task T007: "Create migration 20260108000001_create_collaboration_invitations.sql"
Task T008: "Create migration 20260108000002_add_avatar_color_to_profiles.sql"
Task T009: "Create migration 20260108000003_update_rls_for_collaboration.sql"
Task T010: "Create migration 20260108000004_enable_realtime_for_collaboration.sql"
Task T011: "Create migration 20260108000005_backfill_project_owners_as_admins.sql"

# Also create services in parallel:
Task T013: "Create email service in src/lib/services/emailService.ts"
Task T014: "Create JWT token utilities in src/lib/utils/invitationToken.ts"
Task T015: "Create collaboration permissions hook in src/lib/hooks/useCollaboratorPermissions.ts"
```

---

## Parallel Example: User Story 1 (Invitations)

```bash
# Create all independent files simultaneously:
Task T016: "Create collaboration service in src/lib/services/collaborationService.ts"
Task T017: "Create Server Action in src/lib/actions/collaboration.ts"
Task T018: "Create InviteCollaboratorModal component"
Task T019: "Create InviteCollaboratorModal styles"
Task T020: "Create email template in src/emails/invitation-email.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

**Goal**: Deliver basic invitation system as quickly as possible

1. Complete Phase 1: Setup (~1 hour)
2. Complete Phase 2: Foundational (~3 hours) ⚠️ CRITICAL
3. Complete Phase 3: User Story 1 (~6 hours)
4. **STOP and VALIDATE**: 
   - Test invitation workflow end-to-end
   - Verify email sending works
   - Confirm RLS policies enforce permissions
   - Test with real users in different roles
5. Deploy/demo MVP - project admins can invite collaborators!

**MVP Delivers**: Foundation of collaboration - admins can build their team

### Incremental Delivery (Recommended)

**Milestone 1**: MVP (US1) - Invitations (~10 hours)
- Setup → Foundational → US1
- **Value**: Admins can invite team members to projects
- **Test**: Send invite, accept, verify access granted

**Milestone 2**: Complete P1 (US1 + US2) - Full Admin Experience (~14 hours)
- Add US2: Collaborator Management
- **Value**: Admins can manage team (roles, removal)
- **Test**: Change roles, remove access, verify permissions

**Milestone 3**: P2 Part 1 (US3) - Real-time Editing (~22 hours)
- Add US3: Real-time Cell Editing
- **Value**: Teams can collaborate on assets in real-time
- **Test**: Two users edit simultaneously, verify sync <500ms

**Milestone 4**: P2 Complete (US4) - Presence Awareness (~28 hours)
- Add US4: Active Collaborator Presence
- **Value**: Users see who's editing where
- **Test**: Open library with multiple users, see avatars

**Milestone 5**: P3 (US5) - Edge Cases (~32 hours)
- Add US5: Multi-User Same Cell
- **Value**: Graceful conflict resolution
- **Test**: Two users edit same cell, last save wins

**Milestone 6**: Production Ready (~40 hours)
- Complete Phase 8: Polish
- **Value**: Feature complete, pixel-perfect, tested
- **Test**: Full E2E validation, performance testing

### Parallel Team Strategy

**With 3 developers after Foundational phase**:

**Sprint 1** (Weeks 1-2): Foundation
- **All Team**: Phase 1 + Phase 2 together (~4 hours)
- **Checkpoint**: Database and services ready

**Sprint 2** (Weeks 2-3): MVP
- **All Team**: Phase 3 (US1) together (~6 hours)
- **Checkpoint**: Invitation system working

**Sprint 3** (Weeks 3-4): P1 Complete + P2 Start
- **Dev A**: Phase 4 (US2) - Collaborator Management
- **Dev B+C**: Phase 5 (US3) - Real-time Editing (paired)
- **Checkpoint**: Admin tools complete, real-time starting

**Sprint 4** (Weeks 4-5): P2 Complete
- **Dev A**: Finish US3 with Dev B
- **Dev C**: Phase 6 (US4) - Presence
- **Checkpoint**: Real-time collaboration fully functional

**Sprint 5** (Week 5-6): P3 + Polish
- **Dev A**: Phase 7 (US5) - Conflicts
- **Dev B**: Figma implementation (T077-T081)
- **Dev C**: Edge cases and error handling (T082-T088)
- **Checkpoint**: Feature complete

**Sprint 6** (Week 6): Testing & Launch
- **All Team**: Phase 8 testing and performance validation
- **Checkpoint**: Production ready

---

## Task Summary

**Total Tasks**: 100

**By Phase**:
- Phase 1 (Setup): 5 tasks
- Phase 2 (Foundational): 10 tasks ⚠️ BLOCKS ALL
- Phase 3 (US1 - Invitations): 13 tasks 🎯 MVP
- Phase 4 (US2 - Management): 12 tasks
- Phase 5 (US3 - Real-time): 14 tasks
- Phase 6 (US4 - Presence): 13 tasks
- Phase 7 (US5 - Conflicts): 9 tasks
- Phase 8 (Polish): 24 tasks

**Parallel Tasks**: 35 tasks marked [P] can run simultaneously within their phase

**Independent Tests**:
- US1: Right-click → Collaborators → Invite → Send → Accept
- US2: View collaborators → Change role → Remove → Verify access
- US3: Two users edit different cells → See updates <500ms
- US4: Multiple users in library → See avatars → Leave → Avatars disappear
- US5: Two users same cell → Stacked avatars → Last save wins

**MVP Scope**: Phase 1 + Phase 2 + Phase 3 (28 tasks, ~10 hours)

---

## Notes

- All [P] tasks = different files, can run in parallel
- [US#] label maps task to specific user story for traceability
- Each user story independently completable and testable
- Database migrations (Phase 2) MUST complete before any user story work
- Test each story independently before moving to next
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on MVP first (US1) for fastest time to value

