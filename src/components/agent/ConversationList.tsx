'use client';

import { useEffect, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import type { AgentWorkspace } from '@/lib/agent/types';
import styles from './ChatPanel.module.css';

interface ConversationScopeView {
  level: 'global' | 'project' | 'folder' | 'table';
  folderName?: string;
  libraryName?: string;
}

interface ConversationItem {
  id: string;
  projectId: string | null;
  projectName?: string;
  workspace: AgentWorkspace;
  scope?: ConversationScopeView;
  title: string | null;
  updatedAt: string;
}

interface Props {
  projectId?: string;
  workspace: AgentWorkspace;
  enabled: boolean;
  activeId?: string;
  onSelect: (id: string) => void;
}

function summarizeConversationTitle(raw?: string | null): string {
  const source = (raw || 'New chat').trim();
  const oneLine = source.replace(/\s+/g, ' ');
  return oneLine.length > 18 ? `${oneLine.slice(0, 18)}...` : oneLine;
}

function formatHistoryDate(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const workspaceLabels: Record<AgentWorkspace, string> = {
  projects: 'Projects',
  studio: 'Studio',
  script: 'Script',
  'create-map': 'Create Map',
  'game-design-systems': 'Game Design Systems',
};

export function conversationHistoryLabel(item: Pick<ConversationItem, 'projectId' | 'projectName' | 'workspace'>): string {
  return item.projectId ? (item.projectName || 'Unknown project') : workspaceLabels[item.workspace];
}

export function ConversationList({ projectId, workspace, enabled, activeId, onSelect }: Props) {
  const supabase = useSupabase();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = async () => {
      setConversations([]);
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        const params = new URLSearchParams({ workspace });
        if (projectId) params.set('projectId', projectId);
        const token = data?.session?.access_token;
        const res = await fetch(`/api/agent-chat/conversations?${params}`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { conversations: ConversationItem[] };
        if (!controller.signal.aborted) setConversations(json.conversations ?? []);
      } catch {
        // The empty state is shown for a failed request.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [enabled, projectId, workspace, supabase]);

  return (
    <section
      className={styles.convList}
      data-testid="agent-conversation-list"
      aria-label="Chat history"
    >
      {loading ? (
        <div className={styles.convMessage}>
          Loading…
        </div>
      ) : conversations.length === 0 ? (
        <div className={styles.convMessage}>
          No conversations yet.
        </div>
      ) : (
        conversations.map((c) => (
          <div
            key={c.id}
            className={`${styles.convItem} ${c.id === activeId ? styles.convItemActive : ''}`}
            data-testid={`agent-conversation-${c.id}`}
          >
            <button
              type="button"
              className={styles.convSelect}
              onClick={() => onSelect(c.id)}
            >
              <span className={styles.convTitle}>{summarizeConversationTitle(c.title)}</span>
              <span className={styles.convMeta}>
                <span>{conversationHistoryLabel(c)}</span>
                <span className={styles.convDate}>{formatHistoryDate(c.updatedAt)}</span>
              </span>
            </button>
          </div>
        ))
      )}
    </section>
  );
}

export default ConversationList;
