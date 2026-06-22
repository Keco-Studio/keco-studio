#!/usr/bin/env npx tsx
/**
 * One-shot backfill of embedding chunks for a project (library cells + conversations).
 *
 * Usage:
 *   npx tsx scripts/reindex-project-embeddings.ts <projectId>
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */

import { createClient } from '@supabase/supabase-js';
import {
  reindexProjectConversations,
  reindexProjectLibraryEmbeddings,
} from '../src/lib/agent/embedding-index';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: npx tsx scripts/reindex-project-embeddings.ts <projectId>');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  console.info(`Reindexing project ${projectId}...`);

  const library = await reindexProjectLibraryEmbeddings(supabase, projectId);
  console.info(
    `Library: cells=${library.cells.indexed}/${library.cells.skipped} ` +
      `rows=${library.rows.indexed}/${library.rows.skipped} ` +
      `schemas=${library.schemas.indexed}/${library.schemas.skipped}`
  );

  const chats = await reindexProjectConversations(supabase, projectId);
  console.info(`Conversations: ${chats.conversations}`);

  console.info('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
