/**
 * Decline Invitation Page
 * 
 * Handles invitation decline flow.
 */

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { isTokenExpired } from '@/lib/utils/invitationToken';

export default function DeclineInvitationPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  
  useEffect(() => {
    const declineInvitation = async () => {
      // 1. Validate token parameter exists
      if (!token) {
        setStatus('error');
        setMessage('Missing invitation token. The invitation link appears to be incomplete.');
        return;
      }
      
      // 2. Quick expiration check
      if (isTokenExpired(token)) {
        setStatus('error');
        setMessage('This invitation link has expired.');
        return;
      }
      
      // 3. Call API route to decline invitation
      const response = await fetch('/api/invitations/decline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invitationToken: token,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        setStatus('error');
        setMessage(result.error || 'Failed to decline invitation.');
        return;
      }
      
      // Success
      setStatus('success');
      setMessage('Invitation declined successfully.');
    };
    
    declineInvitation();
  }, [token]);
  
  if (status === 'loading') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px',
        backgroundColor: '#f6f9fc',
      }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '48px',
          maxWidth: '600px',
          width: '100%',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          textAlign: 'center',
        }}>
          <div>Processing...</div>
        </div>
      </div>
    );
  }
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '24px',
      backgroundColor: '#f6f9fc',
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        padding: '48px',
        maxWidth: '600px',
        width: '100%',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: '48px',
          marginBottom: '24px',
        }}>
          {status === 'success' ? '✓' : '✗'}
        </div>
        <h2 style={{
          fontSize: '24px',
          fontWeight: '600',
          marginBottom: '16px',
          color: '#1a1a1a',
        }}>
          {status === 'success' ? 'Invitation Declined' : 'Error'}
        </h2>
        <p style={{
          fontSize: '16px',
          color: '#737373',
          marginBottom: '0',
        }}>
          {message}
        </p>
      </div>
    </div>
  );
}

