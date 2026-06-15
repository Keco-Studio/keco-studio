'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { getActiveSectionName } from '@/lib/agent/page-context';
import { useAgentChat } from './useAgentChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ConversationList } from './ConversationList';
import { AgentActivityBar } from './AgentActivityBar';
import { clearLastConversationById } from './agentChatStorage';
import styles from './ChatPanel.module.css';

export function ChatPanel() {
  const { userProfile } = useAuth();
  const {
    currentProjectId,
    currentLibraryId,
    currentLibraryName,
    currentFolderId,
    currentFolderName,
  } = useNavigation();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [currentSectionName, setCurrentSectionName] = useState<string | undefined>(undefined);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Active section tab lives in LibraryAssetsTable state, not the URL.
  useEffect(() => {
    if (!currentLibraryId) {
      setCurrentSectionName(undefined);
      return;
    }
    setCurrentSectionName(getActiveSectionName(currentLibraryId));
  }, [currentLibraryId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ libraryId?: string; sectionName?: string }>).detail;
      if (!detail?.libraryId || detail.libraryId !== currentLibraryId) return;
      setCurrentSectionName(detail.sectionName || undefined);
    };
    window.addEventListener('library:active-section', handler);
    return () => window.removeEventListener('library:active-section', handler);
  }, [currentLibraryId]);

  // Re-read persisted section when the panel opens (covers missed CustomEvents).
  useEffect(() => {
    if (!open || !currentLibraryId) return;
    setCurrentSectionName(getActiveSectionName(currentLibraryId));
  }, [open, currentLibraryId]);

  const ctx = useMemo(
    () => ({
      userId: userProfile?.id,
      projectId: currentProjectId ?? '',
      currentFolderId: currentFolderId ?? undefined,
      currentFolderName: currentFolderName ?? undefined,
      currentLibraryId: currentLibraryId ?? undefined,
      currentLibraryName: currentLibraryName ?? undefined,
      currentSectionName,
    }),
    [
      userProfile?.id,
      currentProjectId,
      currentFolderId,
      currentFolderName,
      currentLibraryId,
      currentLibraryName,
      currentSectionName,
    ]
  );

  const { items, isStreaming, streamActivity, streamStartedAt, streamingAssistantId, conversationId, send, confirm, startNewConversation, loadConversation, appendNote } =
    useAgentChat(ctx);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // Append a note when an import completes via the handoff to ImportScriptModal.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ libraryId?: string; libraryName?: string }>).detail;
      const name = detail?.libraryName || 'unknown';
      appendNote(`✅ Library "${name}" has been imported via Import Modal.`);
    };
    window.addEventListener('agent:import-complete', handler as EventListener);
    return () => window.removeEventListener('agent:import-complete', handler as EventListener);
  }, [appendNote]);

  if (!currentProjectId) return null;

  if (!open) {
    return (
      <button className={styles.launcher} title="Keco Assistant" onClick={() => setOpen(true)}>
        <MessageOutlined className={styles.launcherIcon} />
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Keco Assistant</span>
        <div className={styles.headerActions}>
          <button className={styles.iconButton} onClick={() => startNewConversation()}>
            New
          </button>
          <button className={styles.iconButton} onClick={() => setShowHistory((v) => !v)}>
            History
          </button>
          <button className={styles.iconButton} onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        {showHistory && (
          <ConversationList
            activeId={conversationId}
            onSelect={(id) => {
              setShowHistory(false);
              void loadConversation(id);
            }}
            onDelete={(id) => {
              if (userProfile?.id) {
                clearLastConversationById(userProfile.id, id);
              }
              if (conversationId === id) {
                startNewConversation();
              }
            }}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>

      <div className={styles.messages} ref={messagesRef}>
        {items.length === 0 ? (
          <div className={styles.empty}>
            Ask about your project data, create or update assets, or import a script.
          </div>
        ) : (
          items.map((item) => (
            <ChatMessage
              key={item.id}
              item={item}
              streaming={isStreaming && item.id === streamingAssistantId}
              onDecision={confirm}
            />
          ))
        )}
      </div>

      {isStreaming && streamStartedAt != null && (
        <AgentActivityBar activity={streamActivity} startedAt={streamStartedAt} />
      )}

      <ChatInput userId={userProfile?.id} isStreaming={isStreaming} onSend={send} />
    </div>
  );
}

export default ChatPanel;
