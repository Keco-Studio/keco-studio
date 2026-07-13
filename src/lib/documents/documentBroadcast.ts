/**
 * Document realtime broadcast helpers.
 *
 * Documents are intentionally NOT part of the supabase_realtime publication
 * (GitHub #208), so there are no postgres_changes for them. Instead, after a
 * successful save/rename/move/delete the client emits a lightweight broadcast
 * so other collaborators can refresh their sidebar and detect a stale open copy.
 *
 * To avoid adding a sixth realtime channel to the sidebar (GitHub #216), the
 * broadcast piggybacks on the topic the sidebar already subscribes to for the
 * project's folders. Both the sender (document editor) and the receiver
 * (useSidebarRealtime) reference this shared topic constant.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const DOCUMENT_UPDATED_EVENT = 'document-updated';

/** Shared realtime topic for a project's sidebar (also carries folder changes). */
export function projectSidebarTopic(projectId: string): string {
  return `folders:project:${projectId}`;
}

export type DocumentUpdatedPayload = {
  documentId: string;
  projectId: string;
  /** Present for content saves so open copies can detect a newer version. */
  updatedAt?: string;
  /** Present for rename so the sidebar can reflect the new name immediately. */
  name?: string;
  /** What happened, so receivers can react appropriately. */
  action: 'save' | 'rename' | 'move' | 'create' | 'delete';
};

/**
 * Best-effort broadcast of a document change on the shared project topic.
 * Failures are swallowed: realtime notification is an enhancement, not a
 * correctness requirement (the durable write already succeeded).
 */
export async function broadcastDocumentUpdated(
  supabase: SupabaseClient,
  payload: DocumentUpdatedPayload
): Promise<void> {
  try {
    const channel = supabase.channel(projectSidebarTopic(payload.projectId));
    await channel.subscribe();
    await channel.send({
      type: 'broadcast',
      event: DOCUMENT_UPDATED_EVENT,
      payload,
    });
    // Give the message a tick to flush before tearing the channel down.
    setTimeout(() => {
      void supabase.removeChannel(channel);
    }, 1000);
  } catch {
    // Ignore: broadcast is best-effort.
  }
}
