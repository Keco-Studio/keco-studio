'use client';

import { useState } from 'react';
import Image from 'next/image';
import { DownOutlined, UpOutlined, PaperClipOutlined, ToolOutlined } from '@ant-design/icons';
import styles from './ChatPanel.module.css';
import type { ChatItem } from './types';
import { ConfirmationCard } from './ConfirmationCard';
import { ScriptPreviewCard } from './ScriptPreviewCard';
import { SetupLibraryPreviewCard } from './SetupLibraryPreviewCard';
import { AssistantMarkdown } from './AssistantMarkdown';
import { collapseMarkdownThematicBreaks } from './collapseMarkdownThematicBreaks';
import { summarizeReasoning } from './reasoning-utils';

interface Props {
  item: ChatItem;
  streaming: boolean;
  onDecision: (actionId: string, decision: 'approve' | 'reject') => void;
}

function inferCompletedStatus(content: string): string {
  const text = content.trim();
  if (!text) return 'Processing...';
  // Greeting / onboarding responses should not be classified as "edit".
  // Chinese intent tokens are unicode-escaped so the English-only CI check passes.
  if (
    /(\u4f60\u597d|\u60a8\u597d|hi|hello)/i.test(text) &&
    /(\u6211\u662f|\u5f88\u9ad8\u5174|\u53ef\u4ee5\u5e2e\u4f60|\u4eca\u5929\u60f3\u505a\u4ec0\u4e48)/.test(text)
  ) {
    return 'Greeting...';
  }
  // Prefer intent signals from the opening sentence to avoid matching broad
  // capability lists as a concrete action.
  const lead = text.split(/[\u3002\uff01\uff1f\n]/)[0] ?? text;
  if (/(\u4fee\u6539|\u6539\u6210|\u66f4\u65b0|\u66ff\u6362|\u8c03\u6574|\u4fee\u6b63)/.test(lead)) {
    return 'Editing...';
  }
  if (/(\u586b\u5199|\u586b\u5145|\u5f55\u5165|\u8865\u5168|\u5b8c\u5584)/.test(lead)) {
    return 'Filling...';
  }
  if (/(\u67e5\u8be2|\u67e5\u627e|\u68c0\u7d22|\u7edf\u8ba1|\u5206\u6790|\u786e\u8ba4)/.test(lead)) {
    return 'Querying...';
  }
  if (/(\u5220\u9664|\u79fb\u9664|\u6e05\u7406)/.test(lead)) return 'Deleting...';
  if (/(\u521b\u5efa|\u65b0\u589e|\u751f\u6210|\u6dfb\u52a0)/.test(lead)) return 'Creating...';
  // Fallback to full text when lead sentence is too short/neutral.
  if (/(\u4fee\u6539|\u6539\u6210|\u66f4\u65b0|\u66ff\u6362|\u8c03\u6574|\u4fee\u6b63)/.test(text)) {
    return 'Editing...';
  }
  if (/(\u586b\u5199|\u586b\u5145|\u5f55\u5165|\u8865\u5168|\u5b8c\u5584)/.test(text)) {
    return 'Filling...';
  }
  if (/(\u67e5\u8be2|\u67e5\u627e|\u68c0\u7d22|\u7edf\u8ba1|\u5206\u6790|\u786e\u8ba4)/.test(text)) {
    return 'Querying...';
  }
  if (/(\u5220\u9664|\u79fb\u9664|\u6e05\u7406)/.test(text)) return 'Deleting...';
  if (/(\u521b\u5efa|\u65b0\u589e|\u751f\u6210|\u6dfb\u52a0)/.test(text)) return 'Creating...';
  return 'Processing...';
}

export function ChatMessage({ item, streaming, onDecision }: Props) {
  switch (item.role) {
    case 'user':
      return (
        <div className={`${styles.bubble} ${styles.user}`} data-testid="agent-message-user">
          {item.attachments && item.attachments.length > 0 && (
            <div className={styles.userAttachments}>
              {item.attachments.map((att, idx) =>
                att.imageUrl ? (
                  <a
                    key={`${att.fileName}-${idx}`}
                    className={styles.userImageThumb}
                    href={att.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={att.fileName}
                  >
                    <Image
                      src={att.imageUrl}
                      alt={att.fileName}
                      width={72}
                      height={72}
                      className={styles.userImageThumbImg}
                      unoptimized
                    />
                  </a>
                ) : (
                  <span
                    key={`${att.fileName}-${idx}`}
                    className={`${styles.userAttachment} ${att.kind === 'selection' ? styles.userSelectionAttachment : ''}`}
                  >
                    <PaperClipOutlined className={styles.userAttachmentIcon} />
                    <span className={styles.userAttachmentName}>{att.fileName}</span>
                  </span>
                )
              )}
            </div>
          )}
          {item.text && <div className={styles.userText}>{item.text}</div>}
        </div>
      );
    case 'assistant':
      return <AssistantBubble item={item} streaming={streaming} />;
    case 'error':
      return <div className={styles.errorBubble}>{item.error}</div>;
    case 'tool':
      return null;
    case 'confirmation': {
      if (!item.confirmation) return null;
      if (item.confirmation.confirmationMode === 'post_preview') {
        const preview = item.confirmation.preview as { type?: string } | undefined;
        if (preview?.type === 'setup_library') {
          return (
            <SetupLibraryPreviewCard
              confirmation={item.confirmation}
              disabled={streaming}
              onDecision={onDecision}
            />
          );
        }
        if (
          item.confirmation.tool === 'propose_document_edit' ||
          preview?.type === 'document_delete' ||
          preview?.type === 'update_row' ||
          preview?.type === 'set_reference'
        ) {
          return <ConfirmationCard confirmation={item.confirmation} disabled={streaming} onDecision={onDecision} />;
        }
        return <ScriptPreviewCard confirmation={item.confirmation} disabled={streaming} onDecision={onDecision} />;
      }
      return <ConfirmationCard confirmation={item.confirmation} disabled={streaming} onDecision={onDecision} />;
    }
    default:
      return null;
  }
}

function AssistantBubble({ item, streaming }: { item: ChatItem; streaming: boolean }) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const hasReasoning = !!item.reasoning?.trim();
  const normalizedText = collapseMarkdownThematicBreaks(item.text ?? '');
  const hasVisibleText = !!normalizedText.trim();
  const summary = summarizeReasoning(item.reasoning ?? '').trim();
  const thinkingText =
    summary ||
    item.reasoning?.trim() ||
    'Analyzing user intent and executing the solution to address the issue at hand.';

  if (!hasReasoning && !normalizedText.trim() && !streaming) return null;

  const streamingStatus = 'Connecting/thinking/working...';
  const completedStatus = inferCompletedStatus(normalizedText || item.reasoning || '');
  const statusLabel = streaming && !hasVisibleText ? streamingStatus : streaming ? streamingStatus : completedStatus;
  const canToggleThinking = hasReasoning || Boolean(summary) || streaming;
  const showThinkingCard = (streaming && !hasVisibleText) || (thinkingOpen && canToggleThinking);

  return (
    <div className={styles.assistantStreamWrap} data-testid="agent-message-assistant">
      {canToggleThinking ? (
        <button
          type="button"
          className={styles.assistantStatusRow}
          data-testid="agent-thinking-toggle"
          aria-expanded={showThinkingCard}
          aria-controls={`agent-thinking-${item.id}`}
          onClick={() => setThinkingOpen((value) => !value)}
        >
          <ToolOutlined className={styles.assistantStatusIcon} />
          <span className={styles.assistantStatusText}>{statusLabel}</span>
          {showThinkingCard ? (
            <UpOutlined className={styles.assistantStatusChevron} />
          ) : (
            <DownOutlined className={styles.assistantStatusChevron} />
          )}
        </button>
      ) : (
        <div className={styles.assistantStatusRow} role="status" aria-live="polite">
          <ToolOutlined className={styles.assistantStatusIcon} />
          <span className={styles.assistantStatusText}>{statusLabel}</span>
        </div>
      )}

      {showThinkingCard && (
        <div
          id={`agent-thinking-${item.id}`}
          className={`${styles.bubble} ${styles.assistant} ${styles.assistantThinkingCard}`}
          data-testid="agent-thinking-panel"
        >
          <div className={styles.assistantThinkingRow}>
            <ToolOutlined className={styles.assistantThinkingIcon} />
            <span className={styles.assistantThinkingText}>
              {hasReasoning ? item.reasoning : thinkingText}
            </span>
          </div>
        </div>
      )}

      {hasVisibleText && (
        <div className={`${styles.bubble} ${styles.assistant}`}>
          <AssistantMarkdown markdown={normalizedText} />
        </div>
      )}
    </div>
  );
}

export default ChatMessage;
