'use client';

import { Sidebar } from './Sidebar';
import { LeftNav } from './LeftNav';
import { TopBar } from './TopBar';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import AuthForm from '@/components/authform/AuthForm';
import { ChatPanel } from '@/components/agent/ChatPanel';
import { AgentImportBridge } from '@/components/agent/AgentImportBridge';
import { ScriptSidebar } from '@/components/script-system/ScriptSidebar';
import { RecentVisitTracker } from '@/components/layout/RecentVisitTracker';
import { getCreateMapDashboardChrome } from '@/lib/create-map/dashboardChrome';
import { isScriptSystemPath } from '@/lib/script-system/isScriptSystemPath';
import styles from './DashboardLayout.module.css';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading, userProfile, signOut } = useAuth();
  const { currentProjectId } = useNavigation();
  const prevAuthenticatedRef = useRef<boolean | null>(null);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const hideSidebarForSimulation = pathname?.startsWith('/simulation-system') ?? false;
  const hideSidebarForGameDesignSystems = pathname?.startsWith('/game-design-systems') ?? false;
  const onScriptSystem = isScriptSystemPath(pathname);
  const createMapChrome = getCreateMapDashboardChrome(pathname);
  const hideSidebarForCreateMap = !createMapChrome.showStudioSidebar;
  // Simulation and Create Map hide the Studio resource sidebar and Agent Chat. Script keeps both,
  // and mounts ScriptSidebar as a left sibling of TopBar/main.
  const showStudioSidebar = !hideSidebarForSimulation && !hideSidebarForGameDesignSystems && !onScriptSystem && !hideSidebarForCreateMap;
  const showScriptSidebar = onScriptSystem && Boolean(currentProjectId);
  const hideChatPanel = hideSidebarForSimulation || hideSidebarForGameDesignSystems || !createMapChrome.showChatPanel;
  const isMcpAccountPage = pathname === '/mcp';

  useEffect(() => {
    if (isLoading) return;

    if (prevAuthenticatedRef.current === null) {
      prevAuthenticatedRef.current = isAuthenticated;
      if (!isAuthenticated) {
        // Keep the form mounted for explicit login/register flows. An automatic
        // sign-in after registration must not unmount it before its success message.
        setShowAuthForm(true);
      }
      return;
    }

    let timer: NodeJS.Timeout | null = null;

    if (isAuthenticated && prevAuthenticatedRef.current === false) {
      timer = setTimeout(() => {
        setShowAuthForm(false);
      }, 800);
      prevAuthenticatedRef.current = isAuthenticated;
    } else if (!isAuthenticated) {
      setShowAuthForm(true);
      prevAuthenticatedRef.current = isAuthenticated;
    } else if (isAuthenticated && prevAuthenticatedRef.current === true) {
      setShowAuthForm(false);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isAuthenticated, isLoading]);

  // Do not show the login form while an existing browser session is being restored.
  // Rendering it during this async gap causes a visible login -> dashboard flash on refresh.
  if (isLoading) {
    return null;
  }

  if (!isAuthenticated || showAuthForm) {
    return <AuthForm />;
  }

  return (
    <div className={styles.dashboard}>
      {createMapChrome.showLeftNav ? <LeftNav userId={userProfile?.id} /> : null}
      {showStudioSidebar ? (
        <div className={isMcpAccountPage ? styles.mcpSidebarSlot : styles.sidebarSlot}>
          <Sidebar userProfile={userProfile} onAuthRequest={signOut} />
        </div>
      ) : null}
      {showScriptSidebar && currentProjectId ? (
        <div className={styles.sidebarSlot}>
          <ScriptSidebar projectId={currentProjectId} />
        </div>
      ) : null}
      {hideSidebarForSimulation ? (
        <div className={styles.simulationSidebarSlot} data-simulation-sidebar-slot data-simulation-root />
      ) : null}
      <div className={styles.main}>
        {createMapChrome.showTopBar ? <TopBar /> : null}
        <div className={styles.workspace}>
          <div className={styles.content}>
            {children}
          </div>
          {!hideChatPanel ? <ChatPanel /> : null}
        </div>
      </div>
      <AgentImportBridge />
      <RecentVisitTracker />
    </div>
  );
}
