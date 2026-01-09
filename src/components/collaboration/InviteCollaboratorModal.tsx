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
import { sendCollaborationInvitation } from '@/lib/actions/collaboration';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import { canUserInviteWithRole } from '@/lib/types/collaboration';
import styles from './InviteCollaboratorModal.module.css';

interface InviteCollaboratorModalProps {
  projectId: string;
  userRole: CollaboratorRole;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function InviteCollaboratorModal({
  projectId,
  userRole,
  open,
  onClose,
  onSuccess,
}: InviteCollaboratorModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      form.resetFields();
      setError(null);
    }
  }, [open, form]);

  // Get available roles based on user's role
  const availableRoles: { value: CollaboratorRole; label: string; description: string }[] = [
    {
      value: 'admin',
      label: 'Admin',
      description: 'Can manage collaborators, edit content, and change settings',
    },
    {
      value: 'editor',
      label: 'Editor',
      description: 'Can edit libraries and assets, invite collaborators',
    },
    {
      value: 'viewer',
      label: 'Viewer',
      description: 'Can view project content, no edit permissions',
    },
  ].filter((roleOption) => canUserInviteWithRole(userRole, roleOption.value));

  const handleSubmit = async () => {
    try {
      setError(null);
      setLoading(true);

      // Validate form
      const values = await form.validateFields();
      const { email, role } = values;

      // Send invitation
      const result = await sendCollaborationInvitation({
        projectId,
        recipientEmail: email.trim().toLowerCase(),
        role: role as CollaboratorRole,
      });

      if (result.success) {
        message.success('Invitation sent successfully!');
        form.resetFields();
        onClose();
        onSuccess?.();
      } else {
        setError(result.error || 'Failed to send invitation');
      }
    } catch (validationError) {
      // Form validation failed - Ant Design will show field errors
      console.error('Validation error:', validationError);
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
      destroyOnClose
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
          initialValues={{ role: 'editor' }}
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

          <div className={styles.infoBox}>
            <p className={styles.infoText}>
              An invitation email will be sent with a link to accept the invitation. 
              The invitation expires in 7 days.
            </p>
          </div>
        </Form>
      </div>
    </Modal>
  );
}

