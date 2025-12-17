'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { createProject } from '@/lib/services/projectService';
import styles from './NewProjectModal.module.css';

type NewProjectModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string, defaultFolderId: string) => void;
};

export function NewProjectModal({ open, onClose, onCreated }: NewProjectModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Project name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { projectId, defaultFolderId } = await createProject(supabase, {
        name: trimmed,
        description,
      });
      onCreated(projectId, defaultFolderId);
      setName('');
      setDescription('');
      onClose();
    } catch (e: any) {
      console.error('Project creation error:', e);
      setError(e?.message || 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>New Project</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Project name *</label>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter project name"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Description (optional)</label>
          <input
            className={styles.input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a short note"
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <button className={`${styles.button} ${styles.secondary}`} onClick={onClose}>
            Cancel
          </button>
          <button
            className={`${styles.button} ${styles.primary}`}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}

