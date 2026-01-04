/**
 * Clean test data from remote Supabase database
 * 
 * This script deletes all projects, libraries, folders, and assets
 * created by test users before running E2E tests.
 * 
 * Usage:
 *   tsx scripts/clean-remote-test-data.ts
 * 
 * Environment variables required:
 *   NEXT_PUBLIC_SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (has admin access)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env and .env.local
// .env.local will override .env (same as Next.js and Playwright config)
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ 
  path: path.resolve(__dirname, '../.env.local'), 
  override: true // Allow .env.local variables to override .env
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing required environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_USER_EMAILS = [
  'seed-empty@mailinator.com',
  'seed-empty-2@mailinator.com',
  'seed-empty-3@mailinator.com',
  'seed-empty-4@mailinator.com',
  'seed-project@mailinator.com',
  'seed-library@mailinator.com',
];

async function cleanTestData() {
  console.log('🧹 Cleaning test data from remote Supabase...');

  try {
    // Get test user IDs
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('id, email')
      .in('email', TEST_USER_EMAILS);

    if (usersError) {
      console.error('❌ Error fetching test users:', usersError);
      process.exit(1);
    }

    if (!users || users.length === 0) {
      console.log('⚠️  No test users found. Make sure seed-remote.sql has been run.');
      return;
    }

    const userIds = users.map(u => u.id);
    console.log(`📋 Found ${users.length} test users`);

    // Delete all projects owned by test users
    // Cascading deletes will handle related records (folders, libraries, assets, etc.)
    const { error: deleteError, count } = await supabase
      .from('projects')
      .delete()
      .in('owner_id', userIds)
      .select();

    if (deleteError) {
      console.error('❌ Error deleting projects:', deleteError);
      process.exit(1);
    }

    console.log(`✅ Deleted ${count || 0} projects and all related data`);

    // Verify cleanup
    const { count: remainingCount, error: verifyError } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .in('owner_id', userIds);

    if (verifyError) {
      console.warn('⚠️  Could not verify cleanup:', verifyError);
    } else {
      console.log(`📊 Projects remaining for test users: ${remainingCount || 0}`);
    }

    console.log('✨ Test data cleaned successfully');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

cleanTestData();

