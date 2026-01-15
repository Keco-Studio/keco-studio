'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { updateProject, getProject, Project } from '@/lib/services/projectService';
import Image from 'next/image';
import projectIcon from '@/app/assets/images/projectIcon52.svg';
import closeIcon from '@/app/assets/images/closeIcon32.svg';
import styles from './NewProjectModal.module.css';

type EditProjectModalProps = {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onUpdated?: () => void;
};

export function EditProjectModal({ open, projectId, onClose, onUpdated }: EditProjectModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Load project data when modal opens
  useEffect(() => {
    if (open && projectId) {
      setLoading(true);
      setError(null);
      getProject(supabase, projectId)
        .then((project: Project | null) => {
          if (project) {
            setName(project.name || '');
            setDescription(project.description || '');
          } else {
            setError('Project not found');
          }
        })
        .catch((e: any) => {
          console.error('Failed to load project:', e);
          setError(e?.message || 'Failed to load project');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, projectId, supabase]);

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
      await updateProject(supabase, projectId, {
        name: trimmed,
        description,
      });
      
      // Dispatch event to notify other components to refresh cache
      window.dispatchEvent(new CustomEvent('projectUpdated', { detail: { projectId } }));
      
      if (onUpdated) {
        onUpdated();
      }
      onClose();
    } catch (e: any) {
      console.error('Project update error:', e);
      setError(e?.message || 'Failed to update project');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Edit Project</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} />
          </button>
        </div>

        <div className={styles.divider}></div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <div>Loading...</div>
          </div>
        ) : (
          <>
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
                  disabled={submitting}
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
                  disabled={submitting}
                />
              </div>
            </div>

            <div className={styles.footer}>
              {error && <div className={styles.error}>{error}</div>}
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={handleSubmit}
                disabled={submitting || loading}
              >
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  , document.body);
}

