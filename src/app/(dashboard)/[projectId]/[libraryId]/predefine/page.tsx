'use client';

import { useMemo, useState, useEffect } from 'react';
import { z } from 'zod';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams } from 'next/navigation';
import { Tabs, Button, message, ConfigProvider } from 'antd';
import type { TabsProps } from 'antd/es/tabs';
import Image from 'next/image';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import predefineLabelDelIcon from '@/app/assets/images/predefineLabelDelIcon.svg';
import type { SectionConfig, FieldConfig } from './types';
import { sectionSchema } from './validation';
import { uid } from './types';
import { useSchemaData } from './hooks/useSchemaData';
import { saveSchemaIncremental } from './hooks/useSchemaSave';
import { SectionHeader } from './components/SectionHeader';
import { FieldsList } from './components/FieldsList';
import { FieldForm } from './components/FieldForm';
import { NewSectionForm } from './components/NewSectionForm';
import styles from './page.module.css';

export default function PredefinePage() {
  const supabase = useSupabase();
  const params = useParams();
  const libraryId = params?.libraryId as string | undefined;

  const { sections, setSections, reload: reloadSections } = useSchemaData({
    libraryId,
    supabase,
  });

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [draftField, setDraftField] = useState<Omit<FieldConfig, 'id'> | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [isCreatingNewSection, setIsCreatingNewSection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeSectionId) || null,
    [sections, activeSectionId]
  );

  // Set first section as active when sections load or when activeSectionId becomes invalid
  useEffect(() => {
    if (sections.length > 0) {
      // If no active section or active section no longer exists, set first section as active
      if (!activeSectionId || !sections.find((s) => s.id === activeSectionId)) {
        setActiveSectionId(sections[0].id);
      }
    } else {
      // If no sections, clear activeSectionId
      setActiveSectionId(null);
    }
  }, [sections, activeSectionId]);

  const resetField = () => {
    setDraftField(null);
    setEditingFieldId(null);
  };

  const startCreatingNewSection = () => {
    setIsCreatingNewSection(true);
    setErrors([]);
  };

  const cancelCreatingNewSection = () => {
    setIsCreatingNewSection(false);
    setErrors([]);
  };

  const handleAddField = (sectionId: string, fieldData: Omit<FieldConfig, 'id'>) => {
    const field: FieldConfig = {
      id: uid(),
      ...fieldData,
    };

    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: [...s.fields, field],
            }
          : s
      )
    );
    setActiveSectionId(sectionId);
    resetField();
    setErrors([]);
  };

  const handleUpdateField = (sectionId: string, fieldId: string, fieldData: Omit<FieldConfig, 'id'>) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) => (f.id === fieldId ? { ...f, ...fieldData } : f)),
            }
          : s
      )
    );
    resetField();
    setErrors([]);
  };

  const handleEditField = (sectionId: string, field: FieldConfig) => {
    setActiveSectionId(sectionId);
    setEditingFieldId(field.id);
    setDraftField({
      label: field.label,
      dataType: field.dataType,
      required: field.required,
      enumOptions: field.enumOptions,
    });
  };

  const handleDeleteField = (sectionId: string, fieldId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s
      )
    );
  };

  const handleSaveNewSection = async (newSection: { name: string; fields: FieldConfig[] }) => {
    if (!libraryId) {
      message.error('Missing libraryId, cannot save');
      return;
    }

    // Validate new section
    const parsed = sectionSchema.safeParse({
      name: newSection.name.trim(),
      fields: newSection.fields.map((f) => ({
        label: f.label,
        dataType: f.dataType,
        required: f.required,
        enumOptions: f.enumOptions,
      })),
    });

    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    // Combine with existing sections
    const allSections = [...sections, { id: uid(), ...newSection }];

    await saveSchema(allSections);
  };

  const saveSchema = async (sectionsToSave: SectionConfig[] = sections) => {
    if (!libraryId) {
      message.error('Missing libraryId, cannot save');
      return;
    }

    // Validate all sections
    const parsed = z.array(sectionSchema).safeParse(
      sectionsToSave.map((s) => ({
        name: s.name,
        fields: s.fields.map((f) => ({
          label: f.label,
          dataType: f.dataType,
          required: f.required,
          enumOptions: f.enumOptions,
        })),
      }))
    );

    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      // Use incremental update to preserve field IDs and asset data
      await saveSchemaIncremental(supabase, libraryId, sectionsToSave);

      message.success('Saved successfully');

      // If creating new section, exit creation mode and reload sections
      if (isCreatingNewSection) {
        setIsCreatingNewSection(false);
        const loadedSections = await reloadSections();
        if (loadedSections && loadedSections.length > 0) {
          setActiveSectionId(loadedSections[loadedSections.length - 1].id);
        }
      } else {
        // Reload to sync with database
        await reloadSections();
      }
    } catch (e: any) {
      message.error(e?.message || 'Failed to save');
      setErrors([e?.message || 'Failed to save']);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!libraryId) {
      message.error('Missing libraryId, cannot delete');
      return;
    }

    const sectionToDelete = sections.find((s) => s.id === sectionId);
    if (!sectionToDelete) {
      message.error('Section not found');
      return;
    }

    // Confirm deletion
    if (!confirm(`Are you sure you want to delete section "${sectionToDelete.name}"? This will also delete all asset values for this section.`)) {
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      // Delete all field definitions for this section
      // This will cascade delete asset values due to foreign key constraint
      const { error: delError } = await supabase
        .from('library_field_definitions')
        .delete()
        .eq('library_id', libraryId)
        .eq('section', sectionToDelete.name);

      if (delError) throw delError;

      message.success(`Section "${sectionToDelete.name}" deleted successfully`);

      // Reload to sync with database
      const loadedSections = await reloadSections();
      
      // Update active section after reload
      if (activeSectionId === sectionId) {
        if (loadedSections && loadedSections.length > 0) {
          setActiveSectionId(loadedSections[0].id);
        } else {
          setActiveSectionId(null);
        }
      }
    } catch (e: any) {
      message.error(e?.message || 'Failed to delete section');
      setErrors([e?.message || 'Failed to delete section']);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldFormSubmit = (fieldData: Omit<FieldConfig, 'id'>) => {
    if (!activeSectionId) {
      message.error('Please select a section first');
      return;
    }

    if (editingFieldId) {
      handleUpdateField(activeSectionId, editingFieldId, fieldData);
    } else {
      handleAddField(activeSectionId, fieldData);
    }
  };

  const tabItems = sections.map((section): TabsProps['items'][0] => ({
    key: section.id,
    label: section.name,
    children: (
      <div className={styles.tabContent}>
        <div style={{ marginBottom: 16 }}>
          <SectionHeader sectionName={section.name} />
          <h3 className={styles.sectionTitle}>Pre-define property</h3>
        </div>
        <FieldsList
          fields={section.fields}
          onEditField={(field) => handleEditField(section.id, field)}
          onDeleteField={(fieldId) => handleDeleteField(section.id, fieldId)}
        />
        <FieldForm
          initialField={editingFieldId && draftField ? draftField : undefined}
          onSubmit={handleFieldFormSubmit}
          onCancel={() => {
            resetField();
            setActiveSectionId(section.id);
          }}
          disabled={saving}
        />
      </div>
    ),
  }));

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#8726EE',
        },
        components: {
          Tabs: {
            itemActiveColor: '#8726EE',
            itemSelectedColor: '#8726EE',
            inkBarColor: '#8726EE',
          },
        },
      }}
    >
      <div className={styles.container}>
        <div className={styles.contentWrapper}>
          <div className={styles.header}>
            <div>
              <h1 className={styles.title}>Predefine seedcrop Library...</h1>
              <p className={styles.subtitle}>here is the land description for this library</p>
            </div>
          </div>

          {errors.length > 0 && (
            <div className={styles.errorsContainer}>
              {errors.map((err, idx) => (
                <div key={idx}>{err}</div>
              ))}
            </div>
          )}

          {isCreatingNewSection ? (
            <NewSectionForm
              onCancel={cancelCreatingNewSection}
              onSave={handleSaveNewSection}
              saving={saving}
            />
          ) : (
            <>
              <div className={styles.tabsContainer}>
                {sections.length > 0 ? (
                  <>
                    <Tabs
                      activeKey={activeSectionId || undefined}
                      onChange={(key) => {
                        setActiveSectionId(key);
                        resetField();
                      }}
                      items={tabItems}
                    />
                    <Button
                      type="primary"
                      icon={<Image src={predefineLabelAddIcon} alt="Add" width={20} height={20} />}
                      onClick={startCreatingNewSection}
                      className={styles.addSectionButton}
                    >
                      Add Section
                    </Button>
                  </>
                ) : (
                  <div className={styles.emptySectionsContainer}>
                    <div className={styles.emptySectionsMessage}>
                      No sections yet. Add a section to get started.
                    </div>
                    <Button
                      type="primary"
                      icon={<Image src={predefineLabelAddIcon} alt="Add" width={20} height={20} />}
                      onClick={startCreatingNewSection}
                      className={styles.saveButton}
                    >
                      Add Section
                    </Button>
                  </div>
                )}
              </div>

              {sections.length > 0 && (
                <div className={styles.saveButtonContainer}>
                  {activeSectionId && (
                    <Button
                      danger
                      size="large"
                      icon={<Image src={predefineLabelDelIcon} alt="Delete" width={20} height={20} />}
                      onClick={() => handleDeleteSection(activeSectionId)}
                      loading={saving}
                      className={styles.deleteButton}
                    >
                      Delete Section
                    </Button>
                  )}
                  <Button
                    type="primary"
                    size="large"
                    onClick={() => saveSchema()}
                    loading={saving}
                    className={styles.saveButton}
                  >
                    {saving ? 'Saving...' : 'Save Schema'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ConfigProvider>
  );
}
