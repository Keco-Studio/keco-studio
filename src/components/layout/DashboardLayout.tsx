'use client';

import { Sidebar } from './Sidebar';
import { LeftNav } from './LeftNav';
import { TopBar } from './TopBar';
import { useAuth } from '@/lib/contexts/AuthContext';
import AuthForm from '@/components/authform/AuthForm';
import { ChatPanel } from '@/components/agent/ChatPanel';
import { AgentImportBridge } from '@/components/agent/AgentImportBridge';
import styles from './DashboardLayout.module.css';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading, userProfile, signOut } = useAuth();
  const prevAuthenticatedRef = useRef<boolean | null>(null);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const hideSidebarForSimulation = pathname?.startsWith('/simulation-system') ?? false;

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
      <LeftNav />
      {!hideSidebarForSimulation ? (
        <Sidebar userProfile={userProfile} onAuthRequest={signOut} />
      ) : null}
      <div className={styles.main}>
        {!hideSidebarForSimulation ? <TopBar /> : null}
        <div className={styles.content}>
          {children}
        </div>
      </div>
      <ChatPanel />
      <AgentImportBridge />
    </div>
  );
}
