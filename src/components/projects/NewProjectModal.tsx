'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { createProject, checkProjectNameExists } from '@/lib/services/projectService';
import Image from 'next/image';
import projectIcon from '@/app/assets/images/projectIcon52.svg';
import closeIcon from '@/app/assets/images/closeIcon32.svg';
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
      // Check if project name already exists before attempting to create
      const exists = await checkProjectNameExists(supabase, trimmed);
      if (exists) {
        setError(`project name ${trimmed} already exists`);
        setSubmitting(false);
        return;
      }

      // If name doesn't exist, proceed with creation
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
          <div className={styles.title}>Create Project</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} />
          </button>
        </div>

        <div className={styles.divider}></div>

        <div className={styles.nameContainer}>
          <div className={styles.iconWrapper}>
            <Image src={projectIcon} alt="Project icon" width={52} height={52} />
          </div>
          <div className={styles.nameInputContainer}>
            <label htmlFor="project-name" className={styles.nameLabel}>Project Name</label>
          <input
            id="project-name"
            className={styles.nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter project name"
          />
          </div>
        </div>

        <div className={styles.notesContainer}>
          <label htmlFor="project-description" className={styles.notesLabel}>
            <span className={styles.notesLabelText}>Add notes for this project</span>
            <span className={styles.notesLabelLimit}> (250 characters limit)</span>
          </label>
          <div className={styles.textareaWrapper}>
            <textarea
              id="project-description"
              name="project-description"
              className={styles.textarea}
              value={description}
              onChange={(e) => {
                if (e.target.value.length <= 250) {
                  setDescription(e.target.value);
                }
              }}
              maxLength={250}
            />
          </div>
        </div>

        <div className={styles.footer}>
          {error && <div className={styles.error}>{error}</div>}
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

