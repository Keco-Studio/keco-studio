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

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { validateInvitationToken, isTokenExpired } from '@/lib/utils/invitationToken';
import { acceptInvitation } from '@/lib/services/collaborationService';
import { AcceptInvitationContent } from './AcceptInvitationContent';

export default function AcceptInvitationPage() {
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
      
      // 4. Validate token signature and decode payload
      let tokenPayload;
      try {
        tokenPayload = await validateInvitationToken(token);
      } catch (error) {
        console.error('Token validation error:', error);
        setStatus('error');
        setMessage('Invalid invitation');
        setDescription(
          error instanceof Error 
            ? error.message 
            : 'This invitation link is invalid or has been tampered with.'
        );
        return;
      }
      
      // 5. Verify user email matches invitation email (optional check)
      const userEmail = user.email?.toLowerCase();
      const invitationEmail = tokenPayload.email.toLowerCase();
      
      if (userEmail !== invitationEmail) {
        setStatus('error');
        setMessage('Email mismatch');
        setDescription(`This invitation was sent to ${invitationEmail}, but you are logged in as ${userEmail}. Please log in with the correct account.`);
        return;
      }
      
      // 6. Accept the invitation
      const result = await acceptInvitation(
        tokenPayload.invitationId,
        user.id,
        userEmail
      );
      
      if (!result.success) {
        setStatus('error');
        setMessage('Failed to accept invitation');
        setDescription(result.error || 'An unexpected error occurred while accepting the invitation.');
        return;
      }
      
      // 7. Success! Set success state
      const resultProjectId = result.projectId || tokenPayload.projectId;
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

