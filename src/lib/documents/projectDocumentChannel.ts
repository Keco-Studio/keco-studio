import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  sendDocumentUpdated,
  type DocumentUpdatedPayload,
} from './documentBroadcast';

type DocumentUpdateListener = (payload: DocumentUpdatedPayload) => void;

const channels = new Map<string, RealtimeChannel>();
const listeners = new Set<DocumentUpdateListener>();

export function registerProjectDocumentChannel(
  projectId: string,
  channel: RealtimeChannel
): () => void {
  channels.set(projectId, channel);
  return () => {
    if (channels.get(projectId) === channel) {
      channels.delete(projectId);
    }
  };
}

/** Best-effort notification; durable writes remain authoritative. */
export async function broadcastProjectDocumentUpdate(
  payload: DocumentUpdatedPayload
): Promise<boolean> {
  const channel = channels.get(payload.projectId);
  if (!channel) return false;
  try {
    await sendDocumentUpdated(channel, payload);
    return true;
  } catch {
    return false;
  }
}

export function subscribeToProjectDocumentUpdates(
  listener: DocumentUpdateListener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyProjectDocumentUpdate(
  payload: DocumentUpdatedPayload
): void {
  listeners.forEach((listener) => listener(payload));
}
