'use client';

import { LeftOutlined } from '@ant-design/icons';
import Image from 'next/image';
import listIcon from '@/assets/images/list.svg';
import { PanelHeader, PanelIconButton } from '@/components/shared/PanelHeader';

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
    <PanelHeader
      title={displayedTitle}
      subtitle={subtitle}
      titleAs="span"
      onAdd={onNew}
      addLabel="Start new chat"
      addDisabled={!canManageConversations}
      onClose={onClose}
      closeLabel="Close Keco Agent"
      hideClose={historyOpen}
      leading={
        <PanelIconButton
          data-testid="agent-history"
          disabled={!canManageConversations}
          aria-label={historyOpen ? 'Back to chat' : 'Open chat history'}
          aria-pressed={historyOpen}
          title={historyOpen ? 'Back' : 'Chat history'}
          active={historyOpen}
          onClick={onHistory}
        >
          {historyOpen ? (
            <LeftOutlined />
          ) : (
            <Image src={listIcon} alt="" width={16} height={16} aria-hidden="true" />
          )}
        </PanelIconButton>
      }
    />
  );
}

export default AgentPanelHeader;
