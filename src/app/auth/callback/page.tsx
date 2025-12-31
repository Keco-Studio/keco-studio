'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useSupabase();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      
      if (code) {
        try {
          // 使用 code 交换 session
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          
          if (error) {
            console.error('Error exchanging code for session:', error);
            router.push('/?error=auth_error');
            return;
          }

          // 成功登录，重定向到主页
          router.push('/');
        } catch (err) {
          console.error('Auth callback error:', err);
          router.push('/?error=auth_error');
        }
      } else {
        // 没有 code 参数，直接重定向
        router.push('/');
      }
    };

    handleCallback();
  }, [searchParams, supabase, router]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column',
      gap: '16px'
    }}>
      <div style={{ fontSize: '18px', fontWeight: 500 }}>正在完成登录...</div>
      <div style={{ fontSize: '14px', color: '#64748b' }}>请稍候</div>
    </div>
  );
}

