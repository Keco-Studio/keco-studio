/**
 * Accept Invitation Content (Client Component)
 * 
 * Client component for displaying invitation acceptance status
 * with appropriate UI for success, error, and expired states.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { Result, Button } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';

interface AcceptInvitationContentProps {
  status: 'success' | 'error' | 'expired';
  message: string;
  description: string;
  projectId?: string;
  projectName?: string;
}

export function AcceptInvitationContent({
  status,
  message,
  description,
  projectId,
  projectName,
}: AcceptInvitationContentProps) {
  const router = useRouter();
  const supabase = useSupabase();
  
  // Auto-redirect on success after 2 seconds
  useEffect(() => {
    if (status === 'success' && projectId) {
      // Clear caches to ensure new project appears in sidebar
      (async () => {
        try {
          // 1. Clear globalRequestCache for projects list
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const cacheKey = `projects:list:${user.id}`;
            globalRequestCache.invalidate(cacheKey);
          }
          
          // 2. Dispatch event to trigger React Query cache refresh in Sidebar
          window.dispatchEvent(new CustomEvent('projectCreated'));
        } catch (error) {
          console.error('[AcceptInvitation] Error clearing caches:', error);
        }
      })();
      
      const timer = setTimeout(() => {
        router.push(`/${projectId}/collaborators`);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [status, projectId, router, supabase]);
  
  // Check if error is due to invitation already being accepted, declined, or not found
  const isInvalidInvitation = message.toLowerCase().includes('already been accepted') || 
                                message.toLowerCase().includes('already been declined') ||
                                message.toLowerCase().includes('invalid invitation') ||
                                message.toLowerCase().includes('not found');
  
  const getStatusConfig = () => {
    switch (status) {
      case 'success':
        return {
          status: 'success' as const,
          icon: <CheckCircleOutlined style={{ fontSize: 72, color: '#52c41a' }} />,
          extra: projectId ? (
            <Button 
              type="primary" 
              size="large"
              onClick={() => router.push(`/${projectId}/collaborators`)}
            >
              Go to {projectName || 'Project'} Collaborators
            </Button>
          ) : (
            <Button 
              type="primary" 
              size="large"
              onClick={() => router.push('/projects')}
            >
              Go to Projects
            </Button>
          ),
        };
      
      case 'expired':
        return {
          status: 'info' as const,
          icon: <ClockCircleOutlined style={{ fontSize: 72, color: '#1890ff' }} />,
          extra: (
            <Button 
              size="large"
              onClick={() => router.push('/projects')}
            >
              Go to Projects
            </Button>
          ),
        };
      
      case 'error':
      default:
        // Use special styling for invalid invitation errors
        if (isInvalidInvitation) {
          return {
            status: 'info' as const,
            icon: <InfoCircleOutlined style={{ fontSize: 72, color: '#94a3b8' }} />,
            extra: (
              <Button 
                size="large"
                onClick={() => router.push('/projects')}
              >
                Back to projects
              </Button>
            ),
          };
        }
        
        return {
          status: 'error' as const,
          icon: <CloseCircleOutlined style={{ fontSize: 72, color: '#ff4d4f' }} />,
          extra: (
            <Button 
              size="large"
              onClick={() => router.push('/projects')}
            >
              Go to Projects
            </Button>
          ),
        };
    }
  };
  
  const config = getStatusConfig();
  
  // Custom UI for invalid invitation
  if (status === 'error' && isInvalidInvitation) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px',
        backgroundColor: '#ffffff',
      }}>
        <div style={{
          maxWidth: '800px',
          width: '100%',
        }}>
          {/* Logo */}
          <div style={{
            textAlign: 'center',
            marginBottom: '48px',
          }}>
            <h1 style={{
              fontSize: '32px',
              fontWeight: '700',
              color: '#1a1a1a',
              margin: '0',
            }}>
              keco-studio
            </h1>
          </div>
          
          {/* Error Card */}
          <div style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '48px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: '24px',
            }}>
              <InfoCircleOutlined style={{
                fontSize: '24px',
                color: '#94a3b8',
                marginRight: '16px',
                marginTop: '4px',
              }} />
              <div style={{ flex: 1 }}>
                <h2 style={{
                  fontSize: '20px',
                  fontWeight: '600',
                  color: '#1a1a1a',
                  margin: '0 0 8px 0',
                }}>
                  Invalid invitation
                </h2>
                <p style={{
                  fontSize: '16px',
                  color: '#737373',
                  margin: '0',
                  lineHeight: '1.5',
                }}>
                  This organization invite is no longer valid as it has either been accepted or declined
                </p>
              </div>
            </div>
            
            <div style={{
              textAlign: 'center',
              marginTop: '32px',
            }}>
              <Button 
                size="large"
                onClick={() => router.push('/projects')}
                style={{
                  minWidth: '200px',
                }}
              >
                Back to projects
              </Button>
            </div>
          </div>
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
      }}>
        <Result
          status={config.status}
          icon={config.icon}
          title={message}
          subTitle={description}
          extra={config.extra}
        />
      </div>
    </div>
  );
}

