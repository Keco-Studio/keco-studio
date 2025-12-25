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

  // 检测从未登录到已登录的转换，延迟切换以显示成功消息
  useEffect(() => {
    // 初始化时，如果已经加载完成且已登录，直接显示 dashboard（页面刷新场景）
    if (!isLoading && prevAuthenticatedRef.current === null) {
      prevAuthenticatedRef.current = isAuthenticated;
      if (isAuthenticated) {
        setShowAuthForm(false);
      }
      return;
    }

    // 检测从未登录到已登录的转换（真正的登录操作）
    if (!isLoading && isAuthenticated && prevAuthenticatedRef.current === false) {
      // 刚登录成功，延迟 1.5 秒再切换，让用户看到成功消息
      const timer = setTimeout(() => {
        setShowAuthForm(false);
      }, 1500);
      prevAuthenticatedRef.current = isAuthenticated;
      return () => clearTimeout(timer);
    } else if (!isAuthenticated) {
      // 未登录时立即显示 AuthForm
      setShowAuthForm(true);
      prevAuthenticatedRef.current = isAuthenticated;
    } else if (isAuthenticated && prevAuthenticatedRef.current === true) {
      // 已经登录且之前也是登录状态，直接显示 dashboard
      setShowAuthForm(false);
    }
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

