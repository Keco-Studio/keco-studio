'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { getActiveSectionName } from '@/lib/agent/page-context';
import { takeDesignHandoff, DESIGN_UPLOAD_EVENT } from '@/lib/design-upload-handoff';
import type { AgentSelectionContext } from '@/lib/agent/selection-context';
import botIcon from '@/assets/images/bot.svg';
import chatIcon from '@/assets/images/chat.svg';
import { useAgentChat } from './useAgentChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ConversationList } from './ConversationList';
import { AgentPanelHeader } from './AgentPanelHeader';
import { useDraggableLauncherPosition } from './useDraggableLauncherPosition';
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
  const [showScrollJump, setShowScrollJump] = useState(false);
  const [scrollJumpMode, setScrollJumpMode] = useState<'top' | 'bottom'>('top');
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastScrollSampleRef = useRef<{ top: number; time: number } | null>(null);
  const scrollJumpHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    style: launcherStyle,
    onPointerDown: onLauncherPointerDown,
    isDragging: isLauncherDragging,
  } = useDraggableLauncherPosition();

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
    stopStreaming,
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
          return activeScope.libraryName || 'Table';
        case 'folder':
          return activeScope.folderName || 'Folder';
        case 'global':
          return 'Global';
        default:
          return currentProjectName || 'Project';
      }
    }
    // New conversation preview (not yet frozen).
    if (currentLibraryName) return currentLibraryName;
    if (currentFolderName) return currentFolderName;
    if (currentProjectName) return currentProjectName;
    return null;
  }, [activeScope, currentProjectName, currentLibraryName, currentFolderName]);

  const headerTitle = useMemo(() => {
    if (items.length === 0) return 'New chat';
    const firstUserText = items.find((it) => it.role === 'user' && (it.text?.trim() || '').length > 0)?.text?.trim();
    const fallbackText = items.find((it) => (it.text?.trim() || '').length > 0)?.text?.trim();
    const source = firstUserText || fallbackText || 'New chat';
    const oneLine = source.replace(/\s+/g, ' ');
    return oneLine.length > 18 ? `${oneLine.slice(0, 18)}...` : oneLine;
  }, [items]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  useEffect(() => {
    return () => {
      if (scrollJumpHideTimerRef.current) {
        clearTimeout(scrollJumpHideTimerRef.current);
      }
    };
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const now = Date.now();
    const currentTop = el.scrollTop;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const previous = lastScrollSampleRef.current;
    lastScrollSampleRef.current = { top: currentTop, time: now };
    if (!previous) return;

    const deltaTop = currentTop - previous.top;
    const deltaTime = Math.max(1, now - previous.time);
    const velocity = Math.abs((deltaTop / deltaTime) * 1000);
    const FAST_SCROLL_THRESHOLD = 2400;
    if (velocity < FAST_SCROLL_THRESHOLD || maxScroll <= 0) return;

    setScrollJumpMode(currentTop > maxScroll * 0.5 ? 'top' : 'bottom');
    setShowScrollJump(true);
    if (scrollJumpHideTimerRef.current) clearTimeout(scrollJumpHideTimerRef.current);
    scrollJumpHideTimerRef.current = setTimeout(() => setShowScrollJump(false), 1300);
  }, []);

  const handleScrollJump = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    if (scrollJumpMode === 'top') {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    setShowScrollJump(false);
  }, [scrollJumpMode]);

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
        className={`${styles.launcher} ${isLauncherDragging ? styles.launcherDragging : ''}`}
        data-testid="agent-launcher"
        title="Keco Assistant"
        style={launcherStyle}
        onPointerDown={onLauncherPointerDown}
        onClick={() => {
          setPendingSelectionContext(undefined);
          setOpen(true);
        }}
      >
        <Image
          src={botIcon}
          alt=""
          width={56}
          height={56}
          className={styles.launcherIcon}
          aria-hidden="true"
        />
      </button>
    );
  }

  return (
    <div className={styles.panel} data-testid="agent-panel">
      <AgentPanelHeader
        canManageConversations={Boolean(userProfile?.id)}
        title={headerTitle}
        subtitle={currentProjectName || lockLabel}
        historyOpen={showHistory}
        onNew={() => {
          setShowHistory(false);
          setPendingSelectionContext(undefined);
          startNewConversation();
        }}
        onHistory={() => setShowHistory((value) => !value)}
        onClose={() => {
          setPendingSelectionContext(undefined);
          setShowHistory(false);
          setOpen(false);
        }}
      />

      {showHistory && (
        <ConversationList
          projectId={currentProjectId}
          activeId={conversationId}
          onSelect={(id) => {
            setShowHistory(false);
            setPendingSelectionContext(undefined);
            void loadConversation(id);
          }}
        />
      )}

      {!showHistory && (
        <>
          <div className={styles.messages} ref={messagesRef} onScroll={handleMessagesScroll}>
            {items.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyMark} aria-hidden="true">
                  <Image src={chatIcon} alt="" width={44} height={44} />
                </span>
                <span className={styles.emptyTitle}>
                  Ask about your project data, create or update assets, or import a script.
                </span>
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
          {showScrollJump && (
            <button
              type="button"
              className={styles.scrollJumpBtn}
              onClick={handleScrollJump}
              aria-label={scrollJumpMode === 'top' ? 'Scroll to top' : 'Scroll to bottom'}
              title={scrollJumpMode === 'top' ? 'Scroll to top' : 'Scroll to bottom'}
            >
              {scrollJumpMode === 'top' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            </button>
          )}

          <ChatInput
            userId={userProfile?.id}
            isStreaming={isStreaming}
            autoExecute={autoExecute}
            focusRequest={inputFocusRequest}
            selectionContext={pendingSelectionContext}
            onClearSelectionContext={() => setPendingSelectionContext(undefined)}
            onToggleMode={() => void setAutoExecute(!autoExecute)}
            onSend={send}
            onStop={stopStreaming}
          />
        </>
      )}
    </div>
  );
}

export default ChatPanel;
