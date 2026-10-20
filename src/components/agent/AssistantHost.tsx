'use client';

import type { AgentWorkspaceContext } from '@/lib/agent/client-workspace';
import { ChatPanel } from './ChatPanel';

type AssistantHostProps = {
  context: AgentWorkspaceContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AssistantHost({ context, open, onOpenChange }: AssistantHostProps) {
  if (!context) return null;

  const panelKey = `${context.workspace}|${context.projectId ?? ''}|${context.currentFolderId ?? ''}|${context.currentLibraryId ?? ''}`;
  return <ChatPanel key={panelKey} context={context} open={open} onOpenChange={onOpenChange} />;
}
