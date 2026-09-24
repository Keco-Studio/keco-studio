'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import {
  CREATE_MAP_PROJECT_EVENT,
  readCreateMapProjectPreference,
  type CreateMapProjectPreference,
} from '@/lib/create-map/projectPreference';
import { deriveAgentWorkspaceContext } from '@/lib/agent/client-workspace';
import { ChatPanel } from './ChatPanel';

export function AssistantHost() {
  const pathname = usePathname();
  const navigation = useNavigation();
  const [createMapPreference, setCreateMapPreference] = useState<CreateMapProjectPreference | null>(null);

  useEffect(() => {
    if (!pathname?.startsWith('/create-map')) return;
    const update = () => setCreateMapPreference(readCreateMapProjectPreference());
    update();
    window.addEventListener(CREATE_MAP_PROJECT_EVENT, update);
    return () => window.removeEventListener(CREATE_MAP_PROJECT_EVENT, update);
  }, [pathname]);

  const context = deriveAgentWorkspaceContext(pathname, navigation, createMapPreference);
  if (!context) return null;

  // A navigation switch starts collapsed while scoped runtimes remain in the store.
  const panelKey = `${pathname}|${context.workspace}|${context.projectId ?? ''}|${context.currentFolderId ?? ''}|${context.currentLibraryId ?? ''}`;
  return <ChatPanel key={panelKey} context={context} />;
}
