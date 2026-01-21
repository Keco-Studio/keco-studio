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
      // Check if we're processing a token from URL or from sessionStorage
      let tokenToProcess = token;
      
      // If no token in URL, check sessionStorage
      if (!tokenToProcess && typeof window !== 'undefined') {
        const pendingToken = sessionStorage.getItem('pendingInvitationToken');
        if (pendingToken) {
          tokenToProcess = pendingToken;
          // Clear the pending token
          sessionStorage.removeItem('pendingInvitationToken');
        }
      }
      
      // 1. Validate token parameter exists
      if (!tokenToProcess) {
        setStatus('error');
        setMessage('Missing invitation token');
        setDescription('The invitation link appears to be incomplete. Please use the full link from your email.');
        return;
      }
      
      // 2. Check if user is authenticated
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        // Store token in sessionStorage and redirect to projects with a redirect parameter
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('pendingInvitationToken', tokenToProcess);
        }
        // Redirect to projects with the current page as the redirect target
        const redirectUrl = `/projects?redirect=${encodeURIComponent(`/accept-invitation?token=${tokenToProcess}`)}`;
        router.push(redirectUrl);
        return;
      }
      
      // 3. Quick expiration check (without full validation)
      if (isTokenExpired(tokenToProcess)) {
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
          invitationToken: tokenToProcess,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        // Clear pending token from sessionStorage on error to prevent retry loops
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('pendingInvitationToken');
        }
        
        // Check if invitation was already accepted, declined, or not found
        const errorMsg = result.error || '';
        const isAlreadyAccepted = errorMsg.includes('already been accepted');
        const isAlreadyDeclined = errorMsg.includes('already been declined');
        const isNotFound = errorMsg.toLowerCase().includes('not found');
        const isEmailMismatch = errorMsg.includes('invitation was sent to');
        
        // If invitation already accepted, redirect to projects instead of showing error
        if (isAlreadyAccepted) {
          setStatus('error');
          setMessage('Invitation already accepted');
          setDescription('This invitation has already been accepted. Redirecting you to projects...');
          
          // Redirect to projects after 2 seconds
          setTimeout(() => {
            router.push('/projects');
          }, 2000);
          return;
        }
        
        // If invitation already declined or not found (was deleted), show invalid invitation message
        if (isAlreadyDeclined || isNotFound) {
          setStatus('error');
          setMessage('Invalid invitation');
          setDescription('This organization invite is no longer valid as it has either been accepted or declined');
          return;
        }
        
        // If email mismatch and user just logged out/switched accounts, show helpful message
        if (isEmailMismatch) {
          setStatus('error');
          setMessage('Email address mismatch');
          setDescription(errorMsg);
          return;
        }
        
        setStatus('error');
        setMessage('Failed to accept invitation');
        setDescription(errorMsg || 'An unexpected error occurred while accepting the invitation.');
        return;
      }
      
      // 6. Success! Set success state
      const resultProjectId = result.projectId;
      const resultProjectName = result.projectName || 'the project';
      
      // Clear pending token from sessionStorage on success
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('pendingInvitationToken');
      }
      
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

