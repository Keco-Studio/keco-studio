#!/usr/bin/env tsx
/**
 * Seed test users via Supabase Admin API
 * 
 * This script creates test users using Supabase's Admin API instead of direct database connection.
 * This approach is more reliable in CI environments and bypasses IPv6 connection issues.
 * 
 * Requirements:
 * - NEXT_PUBLIC_SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Your Supabase service role key (with admin privileges)
 * 
 * Usage:
 *   npm run seed:api
 *   or
 *   npx tsx scripts/seed-via-api.ts
 */

import { createClient } from '@supabase/supabase-js';

interface TestUser {
  email: string;
  password: string;
  username: string;
  emailConfirm?: boolean;
}

interface TestUserWithData extends TestUser {
  projectName?: string;
  projectDescription?: string;
  libraryName?: string;
  libraryDescription?: string;
}

// Test users configuration
// Using mailinator.com domain which allows disposable emails for testing
// Alternative: you can use your own domain or .test domain
const TEST_USERS: TestUserWithData[] = [
  // Empty users for parallel testing
  {
    email: 'seed-empty@mailinator.com',
    password: 'Password123!',
    username: 'seed-empty',
    emailConfirm: true,
  },
  {
    email: 'seed-empty-2@mailinator.com',
    password: 'Password123!',
    username: 'seed-empty-2',
    emailConfirm: true,
  },
  {
    email: 'seed-empty-3@mailinator.com',
    password: 'Password123!',
    username: 'seed-empty-3',
    emailConfirm: true,
  },
  {
    email: 'seed-empty-4@mailinator.com',
    password: 'Password123!',
    username: 'seed-empty-4',
    emailConfirm: true,
  },
  // User with project
  {
    email: 'seed-project@mailinator.com',
    password: 'Password123!',
    username: 'seed-project',
    emailConfirm: true,
    projectName: 'Seed Project A',
    projectDescription: 'Empty project for seeds',
  },
  // User with project and library
  {
    email: 'seed-library@mailinator.com',
    password: 'Password123!',
    username: 'seed-library',
    emailConfirm: true,
    projectName: 'Seed Project B',
    projectDescription: 'Project with one empty library',
    libraryName: 'Seed Library B1',
    libraryDescription: 'Empty library',
  },
  // Happy path test user (for destructive tests)
  {
    email: 'seed-happy-path@mailinator.com',
    password: 'Password123!',
    username: 'seed-happy-path',
    emailConfirm: true,
    projectName: 'Livestock Management Project',
    projectDescription: 'End-to-end test project for livestock asset management',
    libraryName: 'Breed Library',
    libraryDescription: 'Reference library for livestock breeds',
  },
];

async function main() {
  // Check environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing required environment variables:');
    if (!supabaseUrl) console.error('  - NEXT_PUBLIC_SUPABASE_URL');
    if (!serviceRoleKey) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('🌱 Starting seed process via Supabase Admin API...');
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`👥 Creating ${TEST_USERS.length} test users...\n`);

  // Create Supabase admin client
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const user of TEST_USERS) {
    try {
      console.log(`\n📧 Processing: ${user.email}`);

      // Check if user already exists
      const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
      
      if (listError) {
        console.error(`  ❌ Error checking existing users: ${listError.message}`);
        errorCount++;
        continue;
      }

      const existingUser = existingUsers?.users?.find((u: any) => u.email === user.email);

      let userId: string;

      if (existingUser) {
        console.log(`  ⏭️  User already exists, skipping creation`);
        userId = existingUser.id;
        skipCount++;
      } else {
        // Create user via Admin API
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: user.emailConfirm ?? true,
          user_metadata: {
            username: user.username,
          },
        });

        if (createError) {
          console.error(`  ❌ Error creating user: ${createError.message}`);
          errorCount++;
          continue;
        }

        if (!newUser.user) {
          console.error(`  ❌ User creation failed: no user returned`);
          errorCount++;
          continue;
        }

        userId = newUser.user.id;
        console.log(`  ✅ User created successfully (ID: ${userId})`);
        successCount++;
      }

      // Create project if specified
      if (user.projectName) {
        console.log(`  📁 Creating project: ${user.projectName}`);
        
        // Check if project already exists
        const { data: existingProjects, error: projectCheckError } = await supabase
          .from('projects')
          .select('id, name')
          .eq('owner_id', userId)
          .eq('name', user.projectName);

        if (projectCheckError) {
          console.error(`    ⚠️  Error checking existing project: ${projectCheckError.message}`);
        } else if (existingProjects && existingProjects.length > 0) {
          console.log(`    ⏭️  Project already exists, skipping`);
          
          // Create library if specified and project exists
          if (user.libraryName && existingProjects[0].id) {
            await createLibrary(supabase, existingProjects[0].id, user);
          }
        } else {
          // Create new project
          const { data: newProject, error: projectError } = await supabase
            .from('projects')
            .insert({
              owner_id: userId,
              name: user.projectName,
              description: user.projectDescription,
            })
            .select()
            .single();

          if (projectError) {
            console.error(`    ⚠️  Error creating project: ${projectError.message}`);
          } else {
            console.log(`    ✅ Project created successfully`);

            // Create library if specified
            if (user.libraryName && newProject?.id) {
              await createLibrary(supabase, newProject.id, user);
            }
          }
        }
      }
    } catch (error) {
      console.error(`  ❌ Unexpected error: ${error}`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 Seed process completed!');
  console.log(`✅ Created: ${successCount} users`);
  console.log(`⏭️  Skipped: ${skipCount} users (already exist)`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log('='.repeat(60));

  if (errorCount > 0) {
    process.exit(1);
  }
}

async function createLibrary(
  supabase: any,
  projectId: string,
  user: TestUserWithData
) {
  if (!user.libraryName) return;

  console.log(`    📚 Creating library: ${user.libraryName}`);

  // Check if library already exists
  const { data: existingLibraries, error: libraryCheckError } = await supabase
    .from('libraries')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', user.libraryName);

  if (libraryCheckError) {
    console.error(`      ⚠️  Error checking existing library: ${libraryCheckError.message}`);
    return;
  }

  if (existingLibraries && existingLibraries.length > 0) {
    console.log(`      ⏭️  Library already exists, skipping`);
    return;
  }

  const { error: libraryError } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      name: user.libraryName,
      description: user.libraryDescription,
    });

  if (libraryError) {
    console.error(`      ⚠️  Error creating library: ${libraryError.message}`);
  } else {
    console.log(`      ✅ Library created successfully`);
  }
}

// Run the script
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

