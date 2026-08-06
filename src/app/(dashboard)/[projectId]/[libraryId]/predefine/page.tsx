'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfigProvider } from 'antd';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import { getLibrary, type Library } from '@/lib/services/libraryService';
import { showErrorToast } from '@/lib/utils/toast';
import type { FieldConfig } from './types';
import { uid } from './types';
import { useSchemaData } from './hooks/useSchemaData';
import { saveSchemaIncremental } from './hooks/useSchemaSave';
import { FieldsList } from './components/FieldsList';
import { FieldForm } from './components/FieldForm';
import styles from './page.module.css';
import PredefineBackIcon from '@/assets/images/collaborationReturnIcon.svg';

function PredefinePageContent() {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const libraryId = params?.libraryId as string | undefined;
  const { fields, setFields, loading, error, reload } = useSchemaData({ libraryId, supabase });
  const [library, setLibrary] = useState<Library | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingField, setPendingField] = useState<Omit<FieldConfig, 'id'> | null>(null);
  const pendingFieldRef = useRef<Omit<FieldConfig, 'id'> | null>(null);
  const saveInFlight = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSavedThisSessionRef = useRef(false);

  useEffect(() => {
    if (!libraryId) {
      setLoadingLibrary(false);
      return;
    }
    void getLibrary(supabase, libraryId)
      .then(setLibrary)
      .catch((loadError) => console.error('Failed to load library info', loadError))
      .finally(() => setLoadingLibrary(false));
  }, [libraryId, supabase]);

  const saveSchema = useCallback(async (fieldsToSave: FieldConfig[] = fields, shouldReload = true) => {
    if (!libraryId || saveInFlight.current) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveInFlight.current = true;
    setSaving(true);
    setErrors([]);
    try {
      const pending = pendingFieldRef.current;
      const finalFields = pending && (pending.label.trim() || pending.dataType)
        ? [...fieldsToSave, { id: uid(), ...pending }]
        : fieldsToSave;
      const { tempIdToDbIdMap } = await saveSchemaIncremental(supabase, libraryId, finalFields);
      const withDatabaseIds = finalFields.map((field) => ({
        ...field,
        id: tempIdToDbIdMap.get(field.id) ?? field.id,
      }));
      setFields(withDatabaseIds);
      setPendingField(null);
      pendingFieldRef.current = null;
      hasSavedThisSessionRef.current = true;
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySchema(libraryId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
      if (shouldReload) await reload();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save fields';
      setErrors([message]);
      showErrorToast(message);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }, [fields, libraryId, queryClient, reload, setFields, supabase]);

  const scheduleSave = useCallback((nextFields: FieldConfig[], delay: number) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveSchema(nextFields, false);
    }, delay);
  }, [saveSchema]);

  const handleAddField = useCallback((data: Omit<FieldConfig, 'id'>) => {
    const nextFields = [...fields, { id: uid(), ...data, label: data.label || '' }];
    setFields(nextFields);
    setPendingField(null);
    pendingFieldRef.current = null;
    setErrors([]);
    window.dispatchEvent(new CustomEvent('fieldform-reset'));
    void saveSchema(nextFields, false);
  }, [fields, saveSchema, setFields]);

  const handleChangeField = useCallback((fieldId: string, data: Omit<FieldConfig, 'id'>) => {
    const nextFields = fields.map((field) => field.id === fieldId ? { ...field, ...data } : field);
    setFields(nextFields);
    setErrors([]);
    if (data.dataType === 'enum' || data.dataType === 'reference') {
      void saveSchema(nextFields, false);
    } else {
      scheduleSave(nextFields, 500);
    }
  }, [fields, saveSchema, scheduleSave, setFields]);

  const handleDeleteField = useCallback((fieldId: string) => {
    const nextFields = fields.filter((field) => field.id !== fieldId);
    setFields(nextFields);
    void saveSchema(nextFields, false);
  }, [fields, saveSchema, setFields]);

  const handleReorderFields = useCallback((nextFields: FieldConfig[]) => {
    setFields(nextFields);
    scheduleSave(nextFields, 800);
  }, [scheduleSave, setFields]);

  return (
    <div className={styles.container}>
      <div className={styles.contentWrapper}>
        <div className={styles.header}>
          <div className={styles.headerTitleRow}>
            {projectId && libraryId && (
              <button
                type="button"
                className={styles.backButton}
                onClick={() => {
                  if (hasSavedThisSessionRef.current) router.push(`/${projectId}/${libraryId}`);
                  else router.back();
                }}
                title="Back to library"
                aria-label="Back to library"
              >
                <Image src={PredefineBackIcon} alt="Back" width={20} height={20} className="icon-20" />
              </button>
            )}
            <div>
              <h1 className={styles.title}>
                {loadingLibrary ? 'Loading...' : `Predefine ${library?.name ?? ''} Library`}
              </h1>
            </div>
          </div>
        </div>

        {(error || errors.length > 0) && (
          <div className={styles.errorsContainer}>
            {[...(error ? [error] : []), ...errors].map((message, index) => (
              <div key={`${message}-${index}`}>{message}</div>
            ))}
          </div>
        )}

        <div className={styles.tabContent}>
          <div className={styles.headerRow}>
            <div className={styles.headerLabel}>Label text</div>
            <div className={styles.headerDataType}>Data type</div>
            <div className={styles.headerActions} />
          </div>
          {!loading && (
            <FieldsList
              fields={fields}
              onChangeField={handleChangeField}
              onDeleteField={handleDeleteField}
              onReorderFields={handleReorderFields}
              disabled={saving}
              isFirstSection
              invalidFields={new Set()}
            />
          )}
          <FieldForm
            onSubmit={handleAddField}
            disabled={saving}
            onFieldChange={(field) => {
              setPendingField(field);
              pendingFieldRef.current = field;
            }}
            onFieldBlur={() => {
              scheduleSave(fields, 300);
            }}
            validationError={undefined}
          />
        </div>
      </div>
    </div>
  );
}

export default function PredefinePage() {
  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#8726EE' } }}>
      <PredefinePageContent />
    </ConfigProvider>
  );
}
