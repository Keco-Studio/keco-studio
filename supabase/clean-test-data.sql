-- Clean test data for E2E testing
-- This script removes all projects, libraries, folders, and assets
-- created by test users (seed-empty, seed-empty-2, seed-empty-3, seed-empty-4)
-- 
-- Usage (remote):
-- Run this before each test run to ensure clean state
--
-- Note: This keeps the users themselves (created by seed-remote.sql)
-- but deletes all their data

begin;

-- Delete all data for test users
-- The cascading deletes will handle related records

-- Get test user IDs
with test_users as (
  select id from auth.users
  where email in (
    'seed-empty@mailinator.com',
    'seed-empty-2@mailinator.com',
    'seed-empty-3@mailinator.com',
    'seed-empty-4@mailinator.com',
    'seed-project@mailinator.com',
    'seed-library@mailinator.com',
    'seed-happy-path@mailinator.com'
  )
)
-- Delete all projects owned by test users
-- Cascading deletes will remove:
-- - folders (via ON DELETE CASCADE)
-- - libraries (via ON DELETE CASCADE)
-- - library_assets (via libraries ON DELETE CASCADE)
-- - library_field_definitions (via libraries ON DELETE CASCADE)
-- - library_asset_field_values (via library_assets ON DELETE CASCADE)
delete from public.projects
where owner_id in (select id from test_users);

commit;

-- Verify cleanup
select 
  'Projects remaining for test users: ' || count(*)::text as status
from public.projects p
join auth.users u on p.owner_id = u.id
where u.email in (
  'seed-empty@mailinator.com',
  'seed-empty-2@mailinator.com',
  'seed-empty-3@mailinator.com',
  'seed-empty-4@mailinator.com',
  'seed-project@mailinator.com',
  'seed-library@mailinator.com',
  'seed-happy-path@mailinator.com'
);

