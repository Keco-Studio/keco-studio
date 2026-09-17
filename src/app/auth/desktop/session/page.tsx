'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { parseDesktopSessionHash } from '@/lib/desktopSessionHandoff';

export default function DesktopSessionPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      const session = parseDesktopSessionHash(window.location.hash);
      if (!session) {
        setError('Unable to complete desktop sign-in.');
        return;
      }

      try {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
        });
        if (sessionError) {
          setError('Unable to complete desktop sign-in.');
          return;
        }
        if (!cancelled) router.replace('/projects');
      } catch {
        if (!cancelled) setError('Unable to complete desktop sign-in.');
      } finally {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  if (error) {
    return (
      <main>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.replace('/?desktop=1')}>
          Return to sign-in
        </button>
      </main>
    );
  }

  return <main>Completing sign-in...</main>;
}
