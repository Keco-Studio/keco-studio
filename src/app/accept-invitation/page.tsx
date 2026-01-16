/**
 * Accept Invitation Page
 * 
 * Handles invitation acceptance flow with:
 * - JWT token validation (T027)
 * - Expiration check (7 days) (T028)
 * - User authentication requirement
 * - Error handling for various failure cases
 */

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { isTokenExpired } from '@/lib/utils/invitationToken';
import { AcceptInvitationContent } from './AcceptInvitationContent';

function AcceptInvitationContentWrapper() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useSupabase();
  const token = searchParams.get('token');
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'expired'>('loading');
  const [message, setMessage] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>();
  const [projectName, setProjectName] = useState<string | undefined>();
  
  useEffect(() => {
    const processInvitation = async () => {
      // 1. Validate token parameter exists
      if (!token) {
        setStatus('error');
        setMessage('Missing invitation token');
        setDescription('The invitation link appears to be incomplete. Please use the full link from your email.');
        return;
      }
      
      // 2. Check if user is authenticated
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        // Store token in session and redirect to login
        router.push(`/login?redirect=/accept-invitation?token=${encodeURIComponent(token)}`);
        return;
      }
      
      // 3. Quick expiration check (without full validation)
      if (isTokenExpired(token)) {
        setStatus('expired');
        setMessage('Invitation expired');
        setDescription('This invitation link has expired. Please ask the project admin to send a new invitation.');
        return;
      }
      
      // 4. Get user session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus('error');
        setMessage('Session expired');
        setDescription('Your session has expired. Please log in again.');
        return;
      }
      
      // 5. Call API route to accept invitation
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          invitationToken: token,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        setStatus('error');
        setMessage('Failed to accept invitation');
        setDescription(result.error || 'An unexpected error occurred while accepting the invitation.');
        return;
      }
      
      // 6. Success! Set success state
      const resultProjectId = result.projectId;
      const resultProjectName = result.projectName || 'the project';
      
      setStatus('success');
      setMessage('Invitation accepted!');
      setDescription(`You now have access to ${resultProjectName}.`);
      setProjectId(resultProjectId);
      setProjectName(resultProjectName);
    };
    
    processInvitation();
  }, [token, supabase, router]);
  
  if (status === 'loading') {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <div>Processing invitation...</div>
      </div>
    );
  }
  
  return (
    <AcceptInvitationContent
      status={status}
      message={message}
      description={description}
      projectId={projectId}
      projectName={projectName}
    />
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <div>Loading...</div>
      </div>
    }>
      <AcceptInvitationContentWrapper />
    </Suspense>
  );
}

