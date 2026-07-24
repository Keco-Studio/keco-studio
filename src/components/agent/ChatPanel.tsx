'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { getActiveSectionName } from '@/lib/agent/page-context';
import { takeDesignHandoff, DESIGN_UPLOAD_EVENT } from '@/lib/design-upload-handoff';
import type { AgentSelectionContext } from '@/lib/agent/selection-context';
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
    currentProjectName,
    currentLibraryId,
    currentLibraryName,
    currentFolderId,
    currentFolderName,
    currentDocumentId,
  } = useNavigation();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [currentSectionName, setCurrentSectionName] = useState<string | undefined>(undefined);
  const [pendingSelectionContext, setPendingSelectionContext] = useState<AgentSelectionContext | undefined>(undefined);
  const [inputFocusRequest, setInputFocusRequest] = useState(0);
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
      currentDocumentId: currentDocumentId ?? undefined,
      currentFolderId: currentFolderId ?? undefined,
      currentFolderName: currentFolderName ?? undefined,
      currentLibraryId: currentLibraryId ?? undefined,
      currentLibraryName: currentLibraryName ?? undefined,
      currentSectionName,
    }),
    [
      userProfile?.id,
      currentProjectId,
      currentDocumentId,
      currentFolderId,
      currentFolderName,
      currentLibraryId,
      currentLibraryName,
      currentSectionName,
    ]
  );

  const {
    items,
    isStreaming,
    streamActivity,
    streamStartedAt,
    streamingAssistantId,
    conversationId,
    autoExecute,
    activeScope,
    send,
    confirm,
    setAutoExecute,
    startNewConversation,
    loadConversation,
    appendNote,
  } = useAgentChat(ctx);

  // Close the panel whenever the navigation scope it was opened in changes
  // (a different project, folder, or table/library). The scope is captured when
  // the panel opens and compared against the live location on each navigation.
  // We ignore unresolved states (no project id, e.g. the projects list or an
  // in-flight route) so transient flickers never close a freshly opened panel.
  const openScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openScopeRef.current = null;
      return;
    }
    if (!currentProjectId) return;
    const scopeKey = `${currentProjectId}|${currentFolderId ?? ''}|${currentLibraryId ?? ''}`;
    if (openScopeRef.current === null) {
      openScopeRef.current = scopeKey;
      return;
    }
    if (openScopeRef.current !== scopeKey) {
      setOpen(false);
      setShowHistory(false);
      setPendingSelectionContext(undefined);
    }
  }, [open, currentProjectId, currentFolderId, currentLibraryId]);

  // Locked-target label: an existing conversation shows its frozen scope; a new
  // one previews what the current navigation will bind to on first message.
  const lockLabel = useMemo(() => {
    if (activeScope) {
      switch (activeScope.level) {
        case 'table':
          return activeScope.libraryName ? `📄 ${activeScope.libraryName}` : '📄 Table';
        case 'folder':
          return activeScope.folderName ? `📁 ${activeScope.folderName}` : '📁 Folder';
        case 'global':
          return '🌐 Global';
        default:
          return currentProjectName ? `📦 ${currentProjectName}` : '📦 Project';
      }
    }
    // New conversation preview (not yet frozen).
    if (currentLibraryName) return `📄 ${currentLibraryName}`;
    if (currentFolderName) return `📁 ${currentFolderName}`;
    if (currentProjectName) return `📦 ${currentProjectName}`;
    return null;
  }, [activeScope, currentProjectName, currentLibraryName, currentFolderName]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // Consume a pending design-upload hand-off: open the panel, start a fresh
  // conversation, and auto-send the assembled message to the agent.
  const consumeDesignHandoff = useCallback(() => {
    if (!currentProjectId || !userProfile?.id) return;
    const handoff = takeDesignHandoff(currentProjectId);
    if (!handoff) return;
    setOpen(true);
    setPendingSelectionContext(undefined);
    startNewConversation();
    void send(handoff.message, {
      imageUrls: handoff.imageUrls,
      documentExport: handoff.documentExport,
    });
  }, [currentProjectId, userProfile?.id, startNewConversation, send]);

  useEffect(() => {
    // Run once on mount/route in case the event fired before this listener
    // attached (e.g. after a full page load), then keep listening for new ones.
    consumeDesignHandoff();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== currentProjectId) return;
      consumeDesignHandoff();
    };
    window.addEventListener(DESIGN_UPLOAD_EVENT, handler);
    return () => window.removeEventListener(DESIGN_UPLOAD_EVENT, handler);
  }, [consumeDesignHandoff, currentProjectId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ selectionContext?: AgentSelectionContext }>).detail;
      if (!detail?.selectionContext) return;
      setOpen(true);
      setPendingSelectionContext(detail.selectionContext);
      setInputFocusRequest((value) => value + 1);
    };
    window.addEventListener('agent:open-with-selection', handler);
    return () => window.removeEventListener('agent:open-with-selection', handler);
  }, []);

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
      <button
        className={styles.launcher}
        data-testid="agent-launcher"
        title="Keco Assistant"
        onClick={() => {
          setPendingSelectionContext(undefined);
          setOpen(true);
        }}
      >
        <MessageOutlined className={styles.launcherIcon} />
      </button>
    );
  }

  return (
    <div className={styles.panel} data-testid="agent-panel">
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <span className={styles.headerTitle}>Keco Assistant</span>
          {lockLabel && (
            <span
              className={styles.scopeLock}
              title={
                activeScope
                  ? 'This conversation is locked to this scope; switching projects will not change it'
                  : 'New conversations will be bound to the current scope'
              }
            >
              {activeScope ? '🔒 ' : ''}
              {lockLabel}
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.modeToggle} ${autoExecute ? styles.modeAuto : styles.modeConfirm}`}
            disabled={isStreaming}
            title={
              autoExecute
                ? 'Write tools run immediately. Refresh (F5) to discard in-progress work or fix a stale UI—not to undo saved changes.'
                : 'Write operations require step-by-step confirmation.'
            }
            onClick={() => void setAutoExecute(!autoExecute)}
          >
            {autoExecute ? 'Auto' : 'Confirm'}
          </button>
          <button
            className={styles.iconButton}
            disabled={!userProfile?.id}
            onClick={() => {
              setPendingSelectionContext(undefined);
              startNewConversation();
            }}
          >
            New
          </button>
          <button
            className={styles.iconButton}
            data-testid="agent-history"
            disabled={!userProfile?.id}
            onClick={() => setShowHistory((v) => !v)}
          >
            History
          </button>
          <button
            className={styles.iconButton}
            onClick={() => {
              setPendingSelectionContext(undefined);
              setOpen(false);
            }}
          >
            ✕
          </button>
        </div>
        {showHistory && (
          <ConversationList
            activeId={conversationId}
            onSelect={(id) => {
              setShowHistory(false);
              setPendingSelectionContext(undefined);
              void loadConversation(id);
            }}
            onDelete={(id) => {
              if (userProfile?.id) {
                clearLastConversationById(userProfile.id, id);
              }
              if (conversationId === id) {
                setPendingSelectionContext(undefined);
                startNewConversation();
              }
            }}
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

      <ChatInput
        userId={userProfile?.id}
        isStreaming={isStreaming}
        focusRequest={inputFocusRequest}
        selectionContext={pendingSelectionContext}
        onClearSelectionContext={() => setPendingSelectionContext(undefined)}
        onSend={send}
      />
    </div>
  );
}

export default ChatPanel;
