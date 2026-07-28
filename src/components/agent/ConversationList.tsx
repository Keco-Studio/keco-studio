'use client';

import { useEffect, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import styles from './ChatPanel.module.css';

interface ConversationScopeView {
  level: 'global' | 'project' | 'folder' | 'table';
  folderName?: string;
  libraryName?: string;
}

interface ConversationItem {
  id: string;
  projectId: string;
  projectName: string;
  scope?: ConversationScopeView;
  title: string | null;
  updatedAt: string;
}

interface Props {
  projectId: string;
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

export function ConversationList({ projectId, activeId, onSelect }: Props) {
  const supabase = useSupabase();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!projectId) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    const res = await fetch(`/api/agent-chat/conversations?projectId=${encodeURIComponent(projectId)}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const json = (await res.json()) as { conversations: ConversationItem[] };
    setConversations(json.conversations ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

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
