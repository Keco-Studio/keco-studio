'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/contexts/AuthContext';
import type { AgentWorkspaceContext } from '@/lib/agent/client-workspace';
import { peekDesignHandoff, takeDesignHandoff, DESIGN_UPLOAD_EVENT } from '@/lib/design-upload-handoff';
import type { AgentSelectionContext } from '@/lib/agent/selection-context';
import botIcon from '@/assets/images/bot.svg';
import chatIcon from '@/assets/images/chat.svg';
import { useAgentChat } from './useAgentChat';
import { agentRuntimeScopeKey } from './agentChatRuntimeStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ConversationList } from './ConversationList';
import { AgentPanelHeader } from './AgentPanelHeader';
import { useDraggableLauncherPosition } from './useDraggableLauncherPosition';
import styles from './ChatPanel.module.css';

export function ChatPanel({ context }: { context: AgentWorkspaceContext }) {
  const { workspace, projectId, projectName, currentDocumentId, currentFolderId,
    currentFolderName, currentLibraryId, currentLibraryName } = context;
  const { userProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
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

  const ctx = useMemo(
    () => ({
      userId: userProfile?.id,
      projectId: projectId ?? '',
      currentDocumentId: currentDocumentId ?? undefined,
      currentFolderId: currentFolderId ?? undefined,
      currentFolderName: currentFolderName ?? undefined,
      currentLibraryId: currentLibraryId ?? undefined,
      currentLibraryName: currentLibraryName ?? undefined,
      workspace,
    }),
    [
      userProfile?.id,
      projectId,
      currentDocumentId,
      currentFolderId,
      currentFolderName,
      currentLibraryId,
      currentLibraryName,
      workspace,
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
  } = useAgentChat(ctx, open);
  const draftScopeKey = agentRuntimeScopeKey({
    userId: userProfile?.id,
    workspace,
    projectId,
  });

  // Close when the navigation scope changes without a route remount.
  const openScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openScopeRef.current = null;
      return;
    }
    const scopeKey = `${workspace}|${projectId ?? ''}|${currentFolderId ?? ''}|${currentLibraryId ?? ''}`;
    if (openScopeRef.current === null) {
      openScopeRef.current = scopeKey;
      return;
    }
    if (openScopeRef.current !== scopeKey) {
      setOpen(false);
      setShowHistory(false);
      setPendingSelectionContext(undefined);
    }
  }, [open, projectId, currentFolderId, currentLibraryId, workspace]);

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
          return projectName || 'Project';
      }
    }
    // New conversation preview (not yet frozen).
    if (currentLibraryName) return currentLibraryName;
    if (currentFolderName) return currentFolderName;
    if (projectName) return projectName;
    return null;
  }, [activeScope, projectName, currentLibraryName, currentFolderName]);

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

  // A hand-off opens the panel before consuming its queued message.
  const consumeDesignHandoff = useCallback(() => {
    if (!projectId || !userProfile?.id) return;
    const handoff = takeDesignHandoff(projectId);
    if (!handoff) return;
    setPendingSelectionContext(undefined);
    startNewConversation();
    void send(handoff.message, {
      imageUrls: handoff.imageUrls,
      documentExport: handoff.documentExport,
    });
  }, [projectId, userProfile?.id, startNewConversation, send]);

  useEffect(() => {
    if (projectId && peekDesignHandoff(projectId)) setOpen(true);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      setOpen(true);
      if (open) consumeDesignHandoff();
    };
    window.addEventListener(DESIGN_UPLOAD_EVENT, handler);
    return () => window.removeEventListener(DESIGN_UPLOAD_EVENT, handler);
  }, [consumeDesignHandoff, open, projectId]);

  useEffect(() => {
    if (open) consumeDesignHandoff();
  }, [open, consumeDesignHandoff]);

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

  return (
    <div className={`${styles.panelSlot} ${open ? styles.panelSlotOpen : ''}`}>
      {!open ? (
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
      ) : (
      <div className={styles.panel} data-testid="agent-panel">
      <AgentPanelHeader
        canManageConversations={Boolean(userProfile?.id)}
        title={headerTitle}
        subtitle={projectName || lockLabel}
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
          projectId={projectId}
          workspace={workspace}
          enabled={open && showHistory}
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
            draftScopeKey={draftScopeKey}
            projectId={projectId}
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
      )}
    </div>
  );
}

export default ChatPanel;
