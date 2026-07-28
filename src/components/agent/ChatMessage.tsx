'use client';

import { useState } from 'react';
import Image from 'next/image';
import { DownOutlined, RightOutlined, PaperClipOutlined, ToolOutlined } from '@ant-design/icons';
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
  if (!text) return '处理内容...';
  // Greeting / onboarding responses should not be classified as "edit".
  if (/(你好|您好|hi|hello)/i.test(text) && /(我是|很高兴|可以帮你|今天想做什么)/.test(text)) {
    return '问候内容...';
  }
  // Prefer intent signals from the opening sentence to avoid matching broad
  // capability lists ("我可以帮你修改/创建/查询...") as a concrete action.
  const lead = text.split(/[。！？\n]/)[0] ?? text;
  if (/(修改|改成|更新|替换|调整|修正)/.test(lead)) return '修改内容...';
  if (/(填写|填充|录入|补全|完善)/.test(lead)) return '填写内容...';
  if (/(查询|查找|检索|统计|分析|确认)/.test(lead)) return '查询内容...';
  if (/(删除|移除|清理)/.test(lead)) return '删除内容...';
  if (/(创建|新增|生成|添加)/.test(lead)) return '创建内容...';
  // Fallback to full text when lead sentence is too short/neutral.
  if (/(修改|改成|更新|替换|调整|修正)/.test(text)) return '修改内容...';
  if (/(填写|填充|录入|补全|完善)/.test(text)) return '填写内容...';
  if (/(查询|查找|检索|统计|分析|确认)/.test(text)) return '查询内容...';
  if (/(删除|移除|清理)/.test(text)) return '删除内容...';
  if (/(创建|新增|生成|添加)/.test(text)) return '创建内容...';
  return '处理内容...';
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

  const hasReasoning = !!item.reasoning?.trim();
  const normalizedText = collapseMarkdownThematicBreaks(item.text ?? '');
  const hasVisibleText = !!normalizedText.trim();
  const showReasoning = hasReasoning && !hasVisibleText;
  const reasoningStreaming = showReasoning && streaming;
  const summary = summarizeReasoning(item.reasoning ?? '').trim();

  if (!hasReasoning && !normalizedText.trim()) return null;

  const streamingStatus = 'Connecting/thinking/working...';
  const completedStatus = inferCompletedStatus(normalizedText || item.reasoning || '');
  const thinkingText =
    summary || 'Analyzing user intent and executing the solution to address the issue at hand.';

  if (streaming && !hasVisibleText) {
    return (
      <div className={styles.assistantStreamWrap} data-testid="agent-message-assistant">
        <div className={styles.assistantStatusRow} role="status" aria-live="polite">
          <ToolOutlined className={styles.assistantStatusIcon} />
          <span className={styles.assistantStatusText}>{streamingStatus}</span>
          <DownOutlined className={styles.assistantStatusChevron} />
        </div>
        <div className={`${styles.bubble} ${styles.assistant} ${styles.assistantThinkingCard}`}>
          <div className={styles.assistantThinkingRow}>
            <ToolOutlined className={styles.assistantThinkingIcon} />
            <span className={styles.assistantThinkingText}>{thinkingText}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.assistantStreamWrap} data-testid="agent-message-assistant">
      <div className={styles.assistantStatusRow} role="status" aria-live="polite">
        <ToolOutlined className={styles.assistantStatusIcon} />
        <span className={styles.assistantStatusText}>{streaming ? streamingStatus : completedStatus}</span>
        <DownOutlined className={styles.assistantStatusChevron} />
      </div>
      <div className={`${styles.bubble} ${styles.assistant}`}>
      {showReasoning && (
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
          </button>
          {reasoningOpen && <div className={styles.reasoningContent}>{item.reasoning}</div>}
        </div>
      )}
      {hasVisibleText ? (
        <AssistantMarkdown markdown={normalizedText} />
      ) : reasoningStreaming ? (
        '…'
      ) : null}
      </div>
    </div>
  );
}

export default ChatMessage;
