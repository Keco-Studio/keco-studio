'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import styles from '@/components/collaboration/InviteCollaboratorModal.module.css';

type InviteAdminStatus = 'granted' | 'already_admin';

type InviteAdminModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (status: InviteAdminStatus, email: string) => void;
};

function readError(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Unable to grant Admin access';
  const error = (body as Record<string, unknown>).error;
  return typeof error === 'string' && error ? error : 'Unable to grant Admin access';
}

export function InviteAdminModal({ open, onClose, onSuccess }: InviteAdminModalProps) {
  const supabase = useSupabase();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setError(null);
    }
  }, [form, open]);

  const close = () => {
    if (loading) return;
    form.resetFields();
    setError(null);
    onClose();
  };

  const submit = async () => {
    try {
      await form.validateFields();
    } catch {
      // Ant Design presents form validation feedback inline.
      return;
    }

    try {
      setError(null);
      const email = form.getFieldValue('email') as string;
      const normalizedEmail = email.trim().toLowerCase();
      setLoading(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('You must be logged in to grant Admin access');
        return;
      }

      const response = await fetch('/api/keco-admin/admins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
        setError(readError(body));
        return;
      }
      const status = (body as Record<string, unknown>).status;
      const grantedEmail = (body as Record<string, unknown>).email;
      if ((status !== 'granted' && status !== 'already_admin') || typeof grantedEmail !== 'string') {
        setError(readError(body));
        return;
      }

      form.resetFields();
      onSuccess(status, grantedEmail);
      onClose();
    } catch {
      setError('Unable to grant Admin access');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Invite administrator"
      open={open}
      onCancel={close}
      centered
      destroyOnHidden
      width="38.5rem"
      className={styles.modal}
      footer={[
        <Button key="submit" type="primary" loading={loading} onClick={() => void submit()}>
          Grant Admin access
        </Button>,
      ]}
    >
      <div className={styles.content} data-testid="invite-admin-modal">
        {error ? (
          <Alert
            message="Unable to grant Admin access"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 24 }}
          />
        ) : null}
        <Form form={form} layout="vertical" className={styles.form}>
          <Form.Item
            name="email"
            label="Email"
            className={styles.formItem}
            rules={[
              { required: true, message: 'Please enter an email address' },
              {
                type: 'email',
                transform: (value) => typeof value === 'string' ? value.trim() : value,
                message: 'Please enter a valid email address',
              },
            ]}
          >
            <Input
              size="large"
              placeholder="colleague@example.com"
              autoComplete="off"
              disabled={loading}
            />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}
