/**
 * Invite Collaborator Modal
 * 
 * Modal for inviting users to collaborate on a project.
 * Features:
 * - Email input with validation
 * - Role selection dropdown (filtered by user's role)
 * - Duplicate invitation detection
 * - Error handling for email failures
 */

'use client';

import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, Alert, message } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import { canUserInviteWithRole } from '@/lib/types/collaboration';
import styles from './InviteCollaboratorModal.module.css';

interface InviteCollaboratorModalProps {
  projectId: string;
  projectName?: string;
  userRole: CollaboratorRole;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function InviteCollaboratorModal({
  projectId,
  projectName = 'this project',
  userRole,
  open,
  onClose,
  onSuccess,
}: InviteCollaboratorModalProps) {
  const supabase = useSupabase();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get available roles based on user's role
  const availableRoles: { value: CollaboratorRole; label: string; description: string }[] = [
    {
      value: 'admin' as CollaboratorRole,
      label: 'Admin',
      description: 'Can manage collaborators, edit content, and change settings',
    },
    {
      value: 'editor' as CollaboratorRole,
      label: 'Editor',
      description: 'Can edit libraries and assets, invite collaborators',
    },
    {
      value: 'viewer' as CollaboratorRole,
      label: 'Viewer',
      description: 'Can view project content, no edit permissions',
    },
  ].filter((roleOption) => canUserInviteWithRole(userRole, roleOption.value));

  // Get default role: the highest role the user can invite (first in available roles)
  const defaultRole = availableRoles[0]?.value || 'editor';

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ role: defaultRole });
      setError(null);
    }
  }, [open, form, defaultRole]);

  const handleSubmit = async () => {
    try {
      setError(null);
      setLoading(true);
      
      // Validate form
      const values = await form.validateFields();
      const { email, role } = values;

      console.log('[InviteCollaboratorModal] Sending invitation:', {
        projectId,
        recipientEmail: email.trim().toLowerCase(),
        role,
      });

      // Get current session for authorization header
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[InviteCollaboratorModal] Session:', session ? 'exists' : 'null');
      console.log('[InviteCollaboratorModal] Access token:', session?.access_token ? 'exists (length: ' + session.access_token.length + ')' : 'null');
      
      if (!session) {
        setError('You must be logged in to send invitations');
        setLoading(false);
        return;
      }

      // Call API route with authorization header
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId,
          recipientEmail: email.trim().toLowerCase(),
          role: role as CollaboratorRole,
        }),
      });

      const result = await response.json();

      if (result.success) {
        message.success(result.message || 'Invitation sent successfully!');
        form.resetFields();
        onClose();
        onSuccess?.();
      } else {
        setError(result.error || 'Failed to send invitation');
      }
    } catch (validationError) {
      // Form validation failed - Ant Design will show field errors
      console.error('[InviteCollaboratorModal] Validation error:', validationError);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (!loading) {
      form.resetFields();
      setError(null);
      onClose();
    }
  };

  return (
    <Modal
      title="Invite Collaborator"
      open={open}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel} disabled={loading}>
          Cancel
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSubmit}>
          Send Invitation
        </Button>,
      ]}
      width={480}
      destroyOnHidden
      className={styles.modal}
    >
      <div className={styles.content}>
        {error && (
          <Alert
            message="Error"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 24 }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          initialValues={{ role: defaultRole }}
          className={styles.form}
        >
          <Form.Item
            name="email"
            label="Email Address"
            rules={[
              { required: true, message: 'Please enter an email address' },
              { type: 'email', message: 'Please enter a valid email address' },
            ]}
          >
            <Input
              size="large"
              placeholder="colleague@example.com"
              autoComplete="off"
              disabled={loading}
            />
          </Form.Item>

          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Please select a role' }]}
          >
            <Select
              size="large"
              placeholder="Select a role"
              disabled={loading}
              options={availableRoles.map((roleOption) => ({
                value: roleOption.value,
                label: (
                  <div className={styles.roleOption}>
                    <div className={styles.roleLabel}>{roleOption.label}</div>
                    <div className={styles.roleDescription}>{roleOption.description}</div>
                  </div>
                ),
              }))}
            />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}

