'use client';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuth } from '@/lib/contexts/AuthContext';
import AuthForm from '@/components/authform/AuthForm';
import styles from './DashboardLayout.module.css';
import { useEffect, useRef, useState } from 'react';

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { isAuthenticated, isLoading, userProfile, signOut } = useAuth();
  const prevAuthenticatedRef = useRef<boolean | null>(null);
  const [showAuthForm, setShowAuthForm] = useState(true);

  useEffect(() => {
    if (isLoading) return;

    if (prevAuthenticatedRef.current === null) {
      prevAuthenticatedRef.current = isAuthenticated;
      setShowAuthForm(!isAuthenticated);
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

  // While loading auth state or when unauthenticated, show the auth form
  if (isLoading || !isAuthenticated || showAuthForm) {
    return <AuthForm />;
  }

  return (
    <div className={styles.dashboard}>
      <Sidebar userProfile={userProfile} onAuthRequest={signOut} />
      <div className={styles.main}>
        <TopBar />
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}

