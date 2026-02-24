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
  // For happy-path user: create complete test data
  createDirectFolder?: boolean;
  createDirectLibrary?: boolean;
  createBreedAsset?: boolean;
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
  // Happy path test user (for destructive tests) - with complete data
    {
      email: 'seed-happy-path-remote@mailinator.com',
      password: 'Password123!',
      username: 'seed-happy-path-remote',
    emailConfirm: true,
    projectName: 'Livestock Management Project',
    projectDescription: 'End-to-end test project for livestock asset management',
    libraryName: 'Breed Library',
    libraryDescription: 'Reference library for livestock breeds',
    createDirectFolder: true,
    createDirectLibrary: true,
    createBreedAsset: true,
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

      let userId: string;
      let userExists = false;

      // Try to create user directly (more reliable than listing all users)
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: user.emailConfirm ?? true,
        user_metadata: {
          username: user.username,
        },
      });

      if (createError) {
        // Check if error is because user already exists
        if (createError.message.includes('already been registered') || 
            createError.message.includes('already exists')) {
          console.log(`  ⏭️  User already exists, getting user ID via sign in...`);
          userExists = true;
          
          // Try to sign in to get user ID (more reliable than listUsers with pagination)
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: user.password,
          });
          
          if (signInError || !signInData.user) {
            // Password might be wrong, try to get user from listUsers
            console.log(`    ⚠️  Sign in failed (${signInError?.message}), trying listUsers...`);
            
            const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
            
            if (listError) {
              console.error(`    ⚠️  Could not fetch user ID: ${listError.message}`);
              console.log(`    ℹ️  Skipping data creation for this user`);
              skipCount++;
              continue;
            }

            const existingUser = existingUsers?.users?.find((u: any) => u.email === user.email);
            
            if (!existingUser) {
              console.error(`    ⚠️  User exists but could not find ID (pagination issue)`);
              console.log(`    ℹ️  Skipping data creation for this user`);
              skipCount++;
              continue;
            }
            
            userId = existingUser.id;
            
            // Update password to ensure it's correct for next time
            const { error: updateError } = await supabase.auth.admin.updateUserById(
              userId,
              { password: user.password }
            );
            
            if (updateError) {
              console.log(`    ⚠️  Could not update password: ${updateError.message}`);
            } else {
              console.log(`    ✅ Password updated`);
            }
          } else {
            // Sign in successful, got user ID
            userId = signInData.user.id;
            console.log(`    ✅ User ID obtained via sign in (${userId.substring(0, 8)}...)`);
            
            // Sign out immediately
            await supabase.auth.signOut();
          }
          
          skipCount++;
        } else {
          // Real error, not just "already exists"
          console.error(`  ❌ Error creating user: ${createError.message}`);
          errorCount++;
          continue;
        }
      } else if (!newUser?.user) {
        console.error(`  ❌ User creation failed: no user returned`);
        errorCount++;
        continue;
      } else {
        // User created successfully
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
          console.log(`    ⏭️  Project already exists, checking related data...`);
          
          const existingProjectId = existingProjects[0].id;
          
          // Create library if specified and project exists
          if (user.libraryName) {
            await createLibrary(supabase, existingProjectId, user);
          }
          
          // Create additional data for happy-path user
          if (user.createDirectFolder) {
            await createDirectFolder(supabase, existingProjectId);
          }
          if (user.createDirectLibrary) {
            await createDirectLibrary(supabase, existingProjectId);
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

            // Create additional data for happy-path user
            if (newProject?.id) {
              if (user.createDirectFolder) {
                await createDirectFolder(supabase, newProject.id);
              }
              if (user.createDirectLibrary) {
                await createDirectLibrary(supabase, newProject.id);
              }
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
    console.log(`      ⏭️  Library already exists, checking for breed asset...`);
    
    // If this is Breed Library and createBreedAsset is true, create the asset
    if (user.createBreedAsset && user.libraryName === 'Breed Library') {
      await createBreedLibraryData(supabase, existingLibraries[0].id);
    }
    return;
  }

  const { data: newLibrary, error: libraryError } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      name: user.libraryName,
      description: user.libraryDescription,
    })
    .select()
    .single();

  if (libraryError) {
    console.error(`      ⚠️  Error creating library: ${libraryError.message}`);
  } else {
    console.log(`      ✅ Library created successfully`);
    
    // If this is Breed Library and createBreedAsset is true, create field defs and asset
    if (user.createBreedAsset && user.libraryName === 'Breed Library' && newLibrary?.id) {
      await createBreedLibraryData(supabase, newLibrary.id);
    }
  }
}

async function createBreedLibraryData(supabase: any, libraryId: string) {
  console.log(`      🧬 Checking breed library field definitions and asset...`);
  
  // Check if field definitions already exist
  let fieldDefs: any[] = [];
  const { data: existingFieldDefs, error: fieldCheckError } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId)
    .in('label', ['name', 'Origin']);

  if (fieldCheckError) {
    console.error(`        ⚠️  Error checking field definitions: ${fieldCheckError.message}`);
    return;
  }

  if (existingFieldDefs && existingFieldDefs.length === 2) {
    console.log(`        ⏭️  Field definitions already exist (${existingFieldDefs.length} fields)`);
    fieldDefs = existingFieldDefs;
  } else {
    // Create field definitions: name and Origin
    const { data: newFieldDefs, error: fieldDefError } = await supabase
      .from('library_field_definitions')
      .insert([
        {
          library_id: libraryId,
          label: 'name',
          data_type: 'string',
          section: 'Basic Information',
          order_index: 0,
          required: true,
        },
        {
          library_id: libraryId,
          label: 'Origin',
          data_type: 'string',
          section: 'Basic Information',
          order_index: 1,
          required: false,
        },
      ])
      .select();

    if (fieldDefError) {
      console.error(`        ⚠️  Error creating field definitions: ${fieldDefError.message}`);
      return;
    }

    console.log(`        ✅ Field definitions created`);
    fieldDefs = newFieldDefs || [];
  }

  // Check if breed asset already exists
  let asset: any = null;
  const { data: existingAsset, error: assetCheckError } = await supabase
    .from('library_assets')
    .select('*')
    .eq('library_id', libraryId)
    .eq('name', 'Black Goat Breed')
    .maybeSingle();

  if (assetCheckError) {
    console.error(`        ⚠️  Error checking breed asset: ${assetCheckError.message}`);
    return;
  }

  if (existingAsset) {
    console.log(`        ⏭️  Breed asset "Black Goat Breed" already exists`);
    asset = existingAsset;
  } else {
    // Create breed asset: Black Goat Breed
    console.log(`        🐐 Creating breed asset "Black Goat Breed"...`);
    const { data: newAsset, error: assetError } = await supabase
      .from('library_assets')
      .insert({
        library_id: libraryId,
        name: 'Black Goat Breed',
      })
      .select()
      .single();

    if (assetError) {
      console.error(`        ⚠️  Error creating breed asset: ${assetError.message}`);
      return;
    }

    console.log(`        ✅ Breed asset created`);
    asset = newAsset;
  }

  // Check and create asset values
  if (fieldDefs && fieldDefs.length === 2 && asset?.id) {
    const nameField = fieldDefs.find((f: any) => f.label === 'name');
    const originField = fieldDefs.find((f: any) => f.label === 'Origin');

    if (!nameField || !originField) {
      console.error(`        ⚠️  Could not find required field definitions`);
      return;
    }

    // Check if asset values already exist
    const { data: existingValues, error: valuesCheckError } = await supabase
      .from('library_asset_values')
      .select('field_id')
      .eq('asset_id', asset.id);

    if (valuesCheckError) {
      console.error(`        ⚠️  Error checking asset values: ${valuesCheckError.message}`);
      return;
    }

    if (existingValues && existingValues.length > 0) {
      console.log(`        ⏭️  Asset values already exist (${existingValues.length} values)`);
    } else {
      // Create asset values
      const { error: valuesError } = await supabase
        .from('library_asset_values')
        .insert([
          {
            asset_id: asset.id,
            field_id: nameField.id,
            value_json: 'Black Goat Breed',
          },
          {
            asset_id: asset.id,
            field_id: originField.id,
            value_json: 'African Highlands',
          },
        ]);

      if (valuesError) {
        console.error(`        ⚠️  Error creating asset values: ${valuesError.message}`);
      } else {
        console.log(`        ✅ Asset values created`);
      }
    }
  }
}

async function createDirectFolder(supabase: any, projectId: string) {
  console.log(`    📁 Creating Direct Folder...`);

  // Check if folder already exists
  const { data: existing, error: checkError } = await supabase
    .from('folders')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', 'Direct Folder');

  if (checkError) {
    console.error(`      ⚠️  Error checking existing folder: ${checkError.message}`);
    return;
  }

  if (existing && existing.length > 0) {
    console.log(`      ⏭️  Direct Folder already exists, skipping`);
    return;
  }

  const { error } = await supabase
    .from('folders')
    .insert({
      project_id: projectId,
      name: 'Direct Folder',
      description: 'Folder created directly under project',
    });

  if (error) {
    console.error(`      ⚠️  Error creating folder: ${error.message}`);
  } else {
    console.log(`      ✅ Direct Folder created`);
  }
}

async function createDirectLibrary(supabase: any, projectId: string) {
  console.log(`    📚 Creating Direct Library...`);

  // Check if library already exists
  const { data: existing, error: checkError } = await supabase
    .from('libraries')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', 'Direct Library');

  if (checkError) {
    console.error(`      ⚠️  Error checking existing library: ${checkError.message}`);
    return;
  }

  if (existing && existing.length > 0) {
    console.log(`      ⏭️  Direct Library already exists, skipping`);
    return;
  }

  const { error } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      name: 'Direct Library',
      description: 'Library created directly under project',
    });

  if (error) {
    console.error(`      ⚠️  Error creating library: ${error.message}`);
  } else {
    console.log(`      ✅ Direct Library created`);
  }
}

// Run the script
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

