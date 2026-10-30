'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  createProject,
  checkProjectNameExists,
  type Project,
} from '@/lib/services/projectService';
import { validateName } from '@/lib/utils/nameValidation';
import {
  DESIGN_PHILOSOPHY_PRESETS,
  GAME_GENRE_PRESETS,
  normalizeFoundationTags,
  type ProjectFoundationDraft,
} from '@/lib/projectFoundation';
import Image from 'next/image';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from '@/components/shared/FormDialog.module.css';
import { ProjectFoundationFields } from './ProjectFoundationFields';
import styles from './NewProjectModal.module.css';

export type CreatedProjectPayload = {
  project: Project;
  defaultFolderId: string;
};

type NewProjectModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (payload: CreatedProjectPayload) => void;
};

export function NewProjectModal({ open, onClose, onCreated }: NewProjectModalProps) {
  const supabase = useSupabase();
  const [draft, setDraft] = useState<ProjectFoundationDraft>({
    name: '',
    genres: [],
    designPhilosophies: [],
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = draft.name.trim();
    if (!trimmed) {
      setError('Project name is required');
      return;
    }

    // Validate name for disallowed characters (emoji, HTML tags, special symbols)
    const validationError = validateName(trimmed);
    if (validationError) {
      setError(validationError);
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
      const created = await createProject(supabase, {
        name: trimmed,
        description: draft.description.trim(),
        genres: normalizeFoundationTags(draft.genres, GAME_GENRE_PRESETS),
        designPhilosophies: normalizeFoundationTags(
          draft.designPhilosophies,
          DESIGN_PHILOSOPHY_PRESETS,
        ),
      });
      onCreated(created);
      setDraft({
        name: '',
        genres: [],
        designPhilosophies: [],
        description: '',
      });
      onClose();
    } catch (e: unknown) {
      console.error('Project creation error:', e);
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={dialog.backdrop}>
      <div
        className={`${dialog.modal} ${dialog.projectModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-dialog-title"
      >
        <div className={dialog.header}>
          <div id="new-project-dialog-title" className={dialog.title}>Create Project</div>
          <button className={dialog.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={dialog.divider}></div>

        <div className={styles.body}>
          <ProjectFoundationFields
            value={draft}
            onChange={setDraft}
            disabled={submitting}
          />
        </div>

        <div className={dialog.footer}>
          {error && <div className={dialog.error} role="alert">{error}</div>}
          <button
            className={`${dialog.button} ${dialog.buttonFixed} ${dialog.primary}`}
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
