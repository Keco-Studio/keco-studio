'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { DownOutlined, RightOutlined, PaperClipOutlined } from '@ant-design/icons';
import styles from './ChatPanel.module.css';
import type { ChatItem } from './types';
import { ToolCallCard } from './ToolCallCard';
import { ConfirmationCard } from './ConfirmationCard';
import { ScriptPreviewCard } from './ScriptPreviewCard';
import { SetupLibraryPreviewCard } from './SetupLibraryPreviewCard';
import { AssistantMarkdown } from './AssistantMarkdown';
import { collapseMarkdownThematicBreaks } from './collapseMarkdownThematicBreaks';
import { reasoningDurationLabel, summarizeReasoning } from './reasoning-utils';

interface Props {
  item: ChatItem;
  streaming: boolean;
  onDecision: (actionId: string, decision: 'approve' | 'reject') => void;
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
      return item.toolCall ? <ToolCallCard toolCall={item.toolCall} /> : null;
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
          preview?.type === 'document_delete'
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
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const hasReasoning = !!item.reasoning?.trim();
  const isThinking = hasReasoning && streaming && !item.reasoningEndedAt;
  const reasoningStreaming = hasReasoning && !item.text && streaming;
  const normalizedText = collapseMarkdownThematicBreaks(item.text ?? '');

  useEffect(() => {
    if (!isThinking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [isThinking]);

  const summary = summarizeReasoning(item.reasoning ?? '');
  const duration = reasoningDurationLabel(
    item.reasoningStartedAt,
    item.reasoningEndedAt,
    now
  );

  if (!hasReasoning && !normalizedText.trim()) return null;

  return (
    <div className={`${styles.bubble} ${styles.assistant}`} data-testid="agent-message-assistant">
      {hasReasoning && (
        <div className={styles.reasoningBlock}>
          <button
            type="button"
            className={styles.reasoningToggle}
            onClick={() => setReasoningOpen((v) => !v)}
            aria-expanded={reasoningOpen}
          >
            <span className={styles.reasoningChevron}>
              {reasoningOpen ? <DownOutlined /> : <RightOutlined />}
            </span>
            <span className={styles.reasoningLabel}>{summary || 'Deep thinking'}</span>
            {isThinking && <span className={styles.reasoningStatus}>(Thinking)</span>}
            {duration && <span className={styles.reasoningDuration}>{duration}</span>}
            {isThinking && <span className={styles.reasoningDot} />}
          </button>
          {reasoningOpen && <div className={styles.reasoningContent}>{item.reasoning}</div>}
        </div>
      )}
      {normalizedText ? (
        <AssistantMarkdown markdown={normalizedText} />
      ) : reasoningStreaming ? (
        '…'
      ) : null}
    </div>
  );
}

export default ChatMessage;
