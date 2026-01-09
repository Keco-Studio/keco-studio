/**
 * Collaborators Content (Client Component)
 * 
 * Client-side component for managing collaborators with interactivity.
 * Implements T023-T025:
 * - Role-based dropdown filtering
 * - Email validation and duplicate checks
 * - Error handling for email send failures
 */

'use client';

import { useState } from 'react';
import { Button, Table, Tag, Space, Popconfirm, Select, message, Empty } from 'antd';
import { UserAddOutlined, MailOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { useSupabase } from '@/lib/SupabaseContext';
import type { Collaborator, PendingInvitation, CollaboratorRole } from '@/lib/types/collaboration';
import { canUserManageCollaborators } from '@/lib/types/collaboration';

interface CollaboratorsContentProps {
  projectId: string;
  projectName: string;
  userRole: CollaboratorRole;
  isOwner: boolean;
  initialCollaborators: Collaborator[];
  initialPendingInvitations: PendingInvitation[];
}

export function CollaboratorsContent({
  projectId,
  projectName,
  userRole,
  isOwner,
  initialCollaborators,
  initialPendingInvitations,
}: CollaboratorsContentProps) {
  const supabase = useSupabase();
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [collaborators, setCollaborators] = useState(initialCollaborators);
  const [pendingInvitations, setPendingInvitations] = useState(initialPendingInvitations);
  const [loadingRoleChange, setLoadingRoleChange] = useState<string | null>(null);
  const [loadingRemove, setLoadingRemove] = useState<string | null>(null);
  
  const isAdmin = canUserManageCollaborators(userRole);
  
  // Handle role change
  const handleRoleChange = async (collaboratorId: string, newRole: CollaboratorRole) => {
    setLoadingRoleChange(collaboratorId);
    
    try {
      // Get session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        message.error('You must be logged in');
        setLoadingRoleChange(null);
        return;
      }
      
      // Call API route with authorization header
      const response = await fetch(`/api/collaborators/${collaboratorId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ newRole }),
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        message.success('Role updated successfully');
        // Update local state
        setCollaborators(prev =>
          prev.map(c => c.id === collaboratorId ? { ...c, role: newRole } : c)
        );
      } else {
        message.error(result.error || 'Failed to update role');
      }
    } catch (error) {
      message.error('An unexpected error occurred');
      console.error('Error updating role:', error);
    } finally {
      setLoadingRoleChange(null);
    }
  };
  
  // Handle remove collaborator
  const handleRemove = async (collaboratorId: string) => {
    setLoadingRemove(collaboratorId);
    
    try {
      // Get session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        message.error('You must be logged in');
        setLoadingRemove(null);
        return;
      }
      
      // Call API route with authorization header
      const response = await fetch(`/api/collaborators/${collaboratorId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        message.success('Collaborator removed');
        // Update local state
        setCollaborators(prev => prev.filter(c => c.id !== collaboratorId));
      } else {
        message.error(result.error || 'Failed to remove collaborator');
      }
    } catch (error) {
      message.error('An unexpected error occurred');
      console.error('Error removing collaborator:', error);
    } finally {
      setLoadingRemove(null);
    }
  };
  
  // Handle invitation success
  const handleInviteSuccess = () => {
    // Refresh page to get updated list
    window.location.reload();
  };
  
  // Collaborators table columns
  const collaboratorColumns = [
    {
      title: 'User',
      dataIndex: 'userName',
      key: 'userName',
      render: (_: any, record: Collaborator) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.userName}</div>
          <div style={{ fontSize: '12px', color: '#737373' }}>{record.userEmail}</div>
        </div>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 200,
      render: (_: any, record: Collaborator) => {
        if (!isAdmin) {
          // Non-admins see read-only role badge
          const roleColors: Record<CollaboratorRole, string> = {
            admin: 'red',
            editor: 'blue',
            viewer: 'default',
          };
          return (
            <Tag color={roleColors[record.role]}>
              {record.role.charAt(0).toUpperCase() + record.role.slice(1)}
            </Tag>
          );
        }
        
        // Admins see role dropdown
        return (
          <Select
            value={record.role}
            onChange={(value) => handleRoleChange(record.id, value)}
            loading={loadingRoleChange === record.id}
            disabled={loadingRoleChange === record.id}
            style={{ width: '100%' }}
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'editor', label: 'Editor' },
              { value: 'viewer', label: 'Viewer' },
            ]}
          />
        );
      },
    },
    {
      title: 'Joined',
      dataIndex: 'acceptedAt',
      key: 'acceptedAt',
      width: 150,
      render: (acceptedAt: string) => {
        const date = new Date(acceptedAt);
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        });
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: any, record: Collaborator) => {
        if (!isAdmin) {
          return null; // No actions for non-admins
        }
        
        return (
          <Popconfirm
            title="Remove collaborator"
            description="Are you sure you want to remove this collaborator?"
            onConfirm={() => handleRemove(record.id)}
            okText="Remove"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Button 
              type="link" 
              danger 
              size="small"
              loading={loadingRemove === record.id}
            >
              Remove
            </Button>
          </Popconfirm>
        );
      },
    },
  ];
  
  // Pending invitations table columns
  const invitationColumns = [
    {
      title: 'Email',
      dataIndex: 'recipientEmail',
      key: 'recipientEmail',
      render: (email: string) => (
        <Space>
          <MailOutlined style={{ color: '#737373' }} />
          {email}
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (role: CollaboratorRole) => {
        const roleColors: Record<CollaboratorRole, string> = {
          admin: 'red',
          editor: 'blue',
          viewer: 'default',
        };
        return (
          <Tag color={roleColors[role]}>
            {role.charAt(0).toUpperCase() + role.slice(1)}
          </Tag>
        );
      },
    },
    {
      title: 'Invited By',
      dataIndex: 'inviterName',
      key: 'inviterName',
      width: 150,
    },
    {
      title: 'Expires',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 150,
      render: (expiresAt: string) => {
        const date = new Date(expiresAt);
        const now = new Date();
        const daysLeft = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        return (
          <Space>
            <ClockCircleOutlined style={{ color: daysLeft <= 2 ? '#ff4d4f' : '#737373' }} />
            <span style={{ color: daysLeft <= 2 ? '#ff4d4f' : 'inherit' }}>
              {daysLeft > 0 ? `${daysLeft}d left` : 'Expired'}
            </span>
          </Space>
        );
      },
    },
  ];
  
  return (
    <div>
      {/* Invite Button */}
      {isAdmin && (
        <div style={{ marginBottom: '24px' }}>
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => setInviteModalOpen(true)}
            size="large"
          >
            Invite Collaborator
          </Button>
        </div>
      )}
      
      {/* Active Collaborators Table */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
          Active Collaborators ({collaborators.length})
        </h2>
        <Table
          dataSource={collaborators}
          columns={collaboratorColumns}
          rowKey="id"
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                description="No collaborators yet"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
        />
      </div>
      
      {/* Pending Invitations Table (Admins Only) */}
      {isAdmin && pendingInvitations.length > 0 && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Pending Invitations ({pendingInvitations.length})
          </h2>
          <Table
            dataSource={pendingInvitations}
            columns={invitationColumns}
            rowKey="id"
            pagination={false}
          />
        </div>
      )}
      
      {/* Invite Modal */}
      <InviteCollaboratorModal
        projectId={projectId}
        userRole={userRole}
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onSuccess={handleInviteSuccess}
      />
    </div>
  );
}

