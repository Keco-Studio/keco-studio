'use client';

import Image from 'next/image';
import { LeftOutlined } from '@ant-design/icons';
import addIcon from '@/assets/images/add.svg';
import closeIcon from '@/assets/images/close.svg';
import listIcon from '@/assets/images/list.svg';
import styles from './ChatPanel.module.css';

interface AgentPanelHeaderProps {
  canManageConversations: boolean;
  title?: string;
  subtitle?: string | null;
  historyOpen: boolean;
  onNew: () => void;
  onHistory: () => void;
  onClose: () => void;
}

export function AgentPanelHeader({
  canManageConversations,
  title,
  subtitle,
  historyOpen,
  onNew,
  onHistory,
  onClose,
}: AgentPanelHeaderProps) {
  const displayedTitle = historyOpen ? 'Recent chats' : title || 'New chat';

  return (
    <header className={styles.header}>
      <div className={styles.headerIdentity}>
        <button
          type="button"
          className={`${styles.headerIconButton} ${historyOpen ? styles.headerIconButtonActive : ''}`}
          data-testid="agent-history"
          disabled={!canManageConversations}
          aria-label={historyOpen ? 'Back to chat' : 'Open chat history'}
          aria-pressed={historyOpen}
          title={historyOpen ? 'Back' : 'Chat history'}
          onClick={onHistory}
        >
          {historyOpen ? (
            <LeftOutlined />
          ) : (
            <Image src={listIcon} alt="" width={16} height={16} aria-hidden="true" />
          )}
        </button>
        <div className={styles.headerTitleGroup}>
          <span className={styles.headerTitle}>{displayedTitle}</span>
          {subtitle ? <span className={styles.scopeLock}>{subtitle}</span> : null}
        </div>
      </div>

      <div className={styles.headerActions}>
        <button
          type="button"
          className={styles.headerIconButton}
          disabled={!canManageConversations}
          aria-label="Start new chat"
          title="Start new chat"
          onClick={onNew}
        >
          <Image src={addIcon} alt="" width={16} height={16} aria-hidden="true" />
        </button>
        {!historyOpen && (
          <button
            type="button"
            className={styles.headerIconButton}
            aria-label="Close Keco Agent"
            title="Close"
            onClick={onClose}
          >
            <Image src={closeIcon} alt="" width={16} height={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}

export default AgentPanelHeader;
