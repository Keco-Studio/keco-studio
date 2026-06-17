'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getUserProjectRole, getCurrentUserId } from '@/lib/services/authorizationService';
import { showErrorToast, showInfoToast } from '@/lib/utils/toast';
import {
  parseDocument,
  validateDesignFile,
  LARGE_DESIGN_TEXT_THRESHOLD,
} from '@/lib/document-parser';
import { uploadDocumentImages } from '@/lib/services/documentImageUpload';
import { buildDesignMessage } from '@/lib/design-message';
import { saveDesignHandoff, DESIGN_UPLOAD_EVENT } from '@/lib/design-upload-handoff';
import { DocumentDropZone } from '@/components/design-upload/DocumentDropZone';
import styles from './page.module.css';

export default function DesignUploadPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const projectId = params.projectId as string;

  const [file, setFile] = useState<File | null>(null);
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);

  useEffect(() => {
    let active = true;
    if (!projectId) return;
    getUserProjectRole(supabase, projectId)
      .then((r) => {
        if (active) setRole(r);
      })
      .catch(() => {
        if (active) setRole(null);
      });
    return () => {
      active = false;
    };
  }, [projectId, supabase]);

  const isViewer = role === 'viewer';

  const handleFileSelected = (next: File) => {
    const validation = validateDesignFile(next);
    if (!validation.ok) {
      showErrorToast(validation.error ?? 'Invalid file.');
      return;
    }
    setFile(next);
  };

  const handleSubmit = async () => {
    if (!file || submitting || isViewer) return;

    const validation = validateDesignFile(file);
    if (!validation.ok) {
      showErrorToast(validation.error ?? 'Invalid file.');
      return;
    }

    setSubmitting(true);
    try {
      const { text, images } = await parseDocument(file);
      const documentText = text.trim();
      if (!documentText) {
        showErrorToast('Could not extract any text from this file.');
        return;
      }

      let imageUrls: string[] = [];
      if (images.length > 0) {
        try {
          const userId = await getCurrentUserId(supabase);
          imageUrls = await uploadDocumentImages(supabase, images, userId);
          if (imageUrls.length < images.length) {
            showInfoToast(
              `${images.length - imageUrls.length} image(s) could not be processed and were skipped.`
            );
          }
        } catch {
          // best-effort: continue with a text-only design message
        }
      }

      const message = buildDesignMessage({
        fileName: file.name,
        documentText,
        additionalInstructions: instructions,
      });

      saveDesignHandoff(projectId, { message, fileName: file.name, imageUrls });
      window.dispatchEvent(
        new CustomEvent(DESIGN_UPLOAD_EVENT, { detail: { projectId } })
      );
      router.push(`/${projectId}`);
    } catch (e) {
      showErrorToast((e as Error).message || 'Failed to parse the document.');
    } finally {
      setSubmitting(false);
    }
  };

  const showLargeWarning = useMemo(
    () => (file?.size ?? 0) > LARGE_DESIGN_TEXT_THRESHOLD,
    [file]
  );

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Generate tables from a design document</h1>
        <p className={styles.subtitle}>
          Upload a design document (worldview, characters, systems, etc.). The assistant
          will analyze it, infer the tables to create, design their fields, and fill in
          data extracted from the document. You will review and confirm before anything is
          created.
        </p>

        <DocumentDropZone
          selectedFile={file}
          disabled={submitting || isViewer}
          onFileSelected={handleFileSelected}
          onClear={() => setFile(null)}
        />

        {showLargeWarning && (
          <div className={styles.warning}>
            This document is fairly long. The assistant may take a while to process it.
          </div>
        )}

        <label className={styles.fieldLabel} htmlFor="design-instructions">
          Additional instructions (optional)
        </label>
        <textarea
          id="design-instructions"
          className={styles.textarea}
          placeholder="e.g. Only create a characters table, or use English for all names."
          value={instructions}
          disabled={submitting || isViewer}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
        />

        <div className={styles.hint}>
          Images in the document will be analyzed by the assistant to better
          understand your design.
        </div>

        {isViewer && (
          <div className={styles.warning}>
            Your role is viewer; creating tables requires editor or admin permission.
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => router.push(`/${projectId}`)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={!file || submitting || isViewer}
          >
            {submitting ? 'Processing...' : 'Start generating'}
          </button>
        </div>
      </div>
    </div>
  );
}
