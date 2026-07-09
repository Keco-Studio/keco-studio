'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useSupabase();

  useEffect(() => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      const redirectPath = searchParams.get('redirect');
      router.push(redirectPath || '/');
    };

    const handleCallback = async () => {
      const code = searchParams.get('code');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        router.push('/?error=auth_error');
        return;
      }

      if (!code) {
        // No PKCE code present — nothing to exchange.
        router.push('/');
        return;
      }

      // The @supabase/ssr browser client uses the PKCE flow with
      // detectSessionInUrl enabled, so it automatically exchanges the `?code=`
      // for a session (reading the code verifier from cookies) on load. Calling
      // exchangeCodeForSession manually here races that automatic exchange and
      // fails with "both auth code and code verifier should be non-empty" once
      // the verifier has already been consumed. Instead, just wait for the
      // session to appear.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) finish();
      });

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        finish();
      } else {
        // Fallback: poll briefly in case the automatic exchange is still in
        // flight and no auth event fires in this tab.
        for (let i = 0; i < 20 && !done; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const { data: retry } = await supabase.auth.getSession();
          if (retry.session) {
            finish();
            break;
          }
        }
        if (!done) {
          console.error('Auth callback: session not established after PKCE exchange');
          router.push('/?error=auth_error');
        }
      }

      sub.subscription.unsubscribe();
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
