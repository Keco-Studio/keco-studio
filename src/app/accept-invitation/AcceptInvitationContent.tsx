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
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';

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
        router.push(`/${projectId}`);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [status, projectId, router, supabase]);
  
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
              onClick={() => router.push(`/${projectId}`)}
            >
              Go to {projectName || 'Project'}
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

