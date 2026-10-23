#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

import { runRealtimePreflight } from './lib/realtimePreflight';

async function createPrivateTopic(
  supabaseUrl: string,
  serviceRoleKey: string,
  senderUserId: string,
  receiverUserId: string,
) {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: project, error: projectError } = await admin
    .from('projects')
    .insert({
      owner_id: senderUserId,
      name: `Realtime preflight ${Date.now()}`,
      description: 'Temporary CI Realtime authorization probe',
    })
    .select('id')
    .single();
  if (projectError || !project) throw projectError ?? new Error('Failed to create Realtime preflight project');

  const projectId = project.id;
  const now = new Date().toISOString();
  const { error: collaboratorsError } = await admin
    .from('project_collaborators')
    .upsert([
      {
        project_id: projectId,
        user_id: senderUserId,
        role: 'admin',
        invited_by: null,
        invited_at: now,
        accepted_at: now,
        updated_at: now,
      },
      {
        project_id: projectId,
        user_id: receiverUserId,
        role: 'editor',
        invited_by: senderUserId,
        invited_at: now,
        accepted_at: now,
        updated_at: now,
      },
    ], { onConflict: 'user_id,project_id' });
  if (collaboratorsError) {
    await admin.from('projects').delete().eq('id', projectId);
    throw collaboratorsError;
  }

  return {
    topic: `folders:project:${projectId}`,
    cleanup: async () => {
      const { error } = await admin.from('projects').delete().eq('id', projectId);
      if (error) throw error;
    },
  };
}

async function main(): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const result = await runRealtimePreflight({
    env: process.env,
    createClient: (url, anonKey) => createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    createPrivateTopic: (senderUserId, receiverUserId) => createPrivateTopic(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      serviceRoleKey,
      senderUserId,
      receiverUserId,
    ),
    timeoutMs: 20_000,
  });

  console.info(
    `Realtime preflight passed: ${result.authenticatedClients} authenticated clients exchanged a broadcast.`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Realtime preflight failed');
  process.exitCode = 1;
});
