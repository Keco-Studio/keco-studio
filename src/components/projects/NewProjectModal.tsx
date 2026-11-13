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
import Image from 'next/image';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from '@/components/shared/FormDialog.module.css';
import { ProjectIdentityFields, type ProjectIdentityDraft } from './ProjectIdentityFields';
import { ProjectTemplatePicker } from './ProjectTemplatePicker';
import {
  DEFAULT_PROJECT_TEMPLATE_KEY,
  type ProjectTemplateKey,
} from './projectTemplates';
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
  const [draft, setDraft] = useState<ProjectIdentityDraft>({
    name: '',
    description: '',
  });
  const [selectedTemplateKey, setSelectedTemplateKey] =
    useState<ProjectTemplateKey>(DEFAULT_PROJECT_TEMPLATE_KEY);
  const [templateRequestId, setTemplateRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const resetForm = () => {
    setDraft({ name: '', description: '' });
    setSelectedTemplateKey(DEFAULT_PROJECT_TEMPLATE_KEY);
    setTemplateRequestId(null);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

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
    const requestId = templateRequestId ?? crypto.randomUUID();
    setTemplateRequestId(requestId);

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
        templateKey: selectedTemplateKey,
        templateRequestId: requestId,
      });
      onCreated(created);
      resetForm();
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
          <button type="button" className={dialog.close} onClick={handleClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={dialog.divider}></div>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Project details</h3>
            <ProjectIdentityFields
              value={draft}
              onChange={(value) => {
                setDraft(value);
                setTemplateRequestId(null);
              }}
              disabled={submitting}
            />
          </section>
          <div className={styles.sectionDivider} />
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Start from a template</h3>
            <ProjectTemplatePicker
              value={selectedTemplateKey}
              onChange={(value) => {
                setSelectedTemplateKey(value);
                setTemplateRequestId(null);
              }}
              disabled={submitting}
            />
          </section>
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
