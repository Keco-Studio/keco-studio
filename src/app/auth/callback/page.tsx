'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useSupabase();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      
      if (code) {
        try {
          // exchange code for session

          const { error } = await supabase.auth.exchangeCodeForSession(code);
          
          if (error) {
            console.error('Error exchanging code for session:', error);
            router.push('/?error=auth_error');
            return;
          }

          // login success - check for redirect parameter
          const redirectPath = searchParams.get('redirect');
          if (redirectPath) {
            router.push(redirectPath);
          } else {
            router.push('/');
          }
        } catch (err) {
          console.error('Auth callback error:', err);
          router.push('/?error=auth_error');
        }
      } else {
        // login fail
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
      <div style={{ fontSize: '18px', fontWeight: 500 }}>Completing sign-in...</div>
      <div style={{ fontSize: '14px', color: '#64748b' }}>Please wait</div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense
      fallback={
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{ fontSize: '18px', fontWeight: 500 }}>Loading...</div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
