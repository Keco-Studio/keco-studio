'use client';

import { Avatar, Modal } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { KecoAdministrator } from '@/lib/types/kecoAdmin';
import modalStyles from '@/components/collaboration/InviteCollaboratorModal.module.css';
import styles from './AdministratorsModal.module.css';

type AdministratorsModalProps = {
  open: boolean;
  onClose: () => void;
  refreshKey: number;
};

function isAdministrator(value: unknown): value is KecoAdministrator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<KecoAdministrator>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayName === 'string' &&
    (candidate.email === null || typeof candidate.email === 'string') &&
    (candidate.avatarUrl === null || typeof candidate.avatarUrl === 'string') &&
    (candidate.grantedAt === null || typeof candidate.grantedAt === 'string')
  );
}

async function fetchAdministrators(): Promise<KecoAdministrator[]> {
  const response = await fetch('/api/keco-admin/admins', { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load administrators');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Unable to load administrators');
  }
  const administrators = (body as Record<string, unknown>).administrators;
  if (!Array.isArray(administrators) || !administrators.every(isAdministrator)) {
    throw new Error('Unable to load administrators');
  }
  return administrators;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || '?';
}

function formatGrantedAt(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Configured administrator';
  return `Granted ${new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))}`;
}

export function AdministratorsModal({ open, onClose, refreshKey }: AdministratorsModalProps) {
  const administratorsQuery = useQuery({
    queryKey: ['keco-admin-administrators', refreshKey],
    queryFn: fetchAdministrators,
    enabled: open,
    retry: false,
  });

  return (
    <Modal
      title="Administrators"
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      destroyOnHidden
      width="38.5rem"
      className={modalStyles.modal}
    >
      <div className={styles.list} aria-live="polite">
        {administratorsQuery.isLoading ? <p className={styles.empty}>Loading administrators...</p> : null}
        {administratorsQuery.isError ? <p className={styles.error} role="alert">Administrators could not be loaded.</p> : null}
        {administratorsQuery.data?.length === 0 ? <p className={styles.empty}>No administrators found.</p> : null}
        {administratorsQuery.data?.map((administrator) => (
          <div key={administrator.id} className={styles.member}>
            <Avatar
              size={40}
              src={administrator.avatarUrl ?? undefined}
              alt={administrator.displayName}
              className={styles.avatar}
            >
              {initials(administrator.displayName)}
            </Avatar>
            <div className={styles.identity}>
              <span className={styles.name}>{administrator.displayName}</span>
              <span className={styles.email}>{administrator.email ?? 'No email address'}</span>
            </div>
            <span className={styles.grantedAt}>{formatGrantedAt(administrator.grantedAt)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
