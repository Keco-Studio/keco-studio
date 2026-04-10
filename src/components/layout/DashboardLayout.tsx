'use client';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import AuthForm from '@/components/authform/AuthForm';
import styles from './DashboardLayout.module.css';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
// REMOVED: PresenceProvider causes duplicate subscriptions with LibraryDataProvider
// import { PresenceProvider } from '@/lib/contexts/PresenceContext';

type DashboardLayoutProps = {
  children: React.ReactNode;
};

/**
 * 检测是否是模拟系统特殊页面
 * 这些页面不需要完整的导航上下文
 */
function isSimulationPage(pathname: string): boolean {
  return pathname.startsWith('/simulation-system');
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { isAuthenticated, isLoading, userProfile, signOut } = useAuth();
  const pathname = usePathname();
  
  // 只有非模拟系统页面才需要完整的导航上下文
  const isSimPage = isSimulationPage(pathname);
  const { currentLibraryId } = useNavigation();
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

  // 模拟系统特殊页面：跳过侧边栏和 TopBar，使用简化布局
  if (isSimPage) {
    return <div className={styles.content}>{children}</div>;
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

