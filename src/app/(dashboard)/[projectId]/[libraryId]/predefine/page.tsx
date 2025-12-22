'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams } from 'next/navigation';
import { Tabs, Button, message, ConfigProvider } from 'antd';
import type { TabsProps } from 'antd/es/tabs';
import Image from 'next/image';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import predefineLabelDelIcon from '@/app/assets/images/predefineLabelDelIcon.svg';
import type { SectionConfig, FieldConfig } from './types';
import type { Library } from '@/lib/services/libraryService';
import { getLibrary } from '@/lib/services/libraryService';
import { sectionSchema } from './validation';
import { uid } from './types';
import { useSchemaData } from './hooks/useSchemaData';
import { saveSchemaIncremental } from './hooks/useSchemaSave';
import { FieldsList } from './components/FieldsList';
import { FieldForm } from './components/FieldForm';
import { NewSectionForm } from './components/NewSectionForm';
import styles from './page.module.css';
import sectionHeaderStyles from './components/SectionHeader.module.css';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import predefineExpandIcon from '@/app/assets/images/predefineExpandIcon.svg';

const NEW_SECTION_TAB_KEY = '__new_section__';

export default function PredefinePage() {
  const supabase = useSupabase();
  const params = useParams();
  const libraryId = params?.libraryId as string | undefined;

  const { sections, setSections, reload: reloadSections } = useSchemaData({
    libraryId,
    supabase,
  });

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [isCreatingNewSection, setIsCreatingNewSection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loadingAfterSave, setLoadingAfterSave] = useState(false);
  // Track pending field for each section (field in FieldForm that hasn't been submitted yet)
  const [pendingFields, setPendingFields] = useState<Map<string, Omit<FieldConfig, 'id'> | null>>(new Map());

  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeSectionId) || null,
    [sections, activeSectionId]
  );

  // Load current library info (name, description) for page title display
  useEffect(() => {
    if (!libraryId) return;

    const fetchLibrary = async () => {
      try {
        const lib = await getLibrary(supabase, libraryId);
        setLibrary(lib);
      } catch (e) {
        // Only used for title display, ignore on failure
        console.error('Failed to load library info', e);
      }
    };

    fetchLibrary();
  }, [libraryId, supabase]);

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

  const startCreatingNewSection = useCallback(() => {
    setIsCreatingNewSection(true);
    setErrors([]);
  }, []);

  const cancelCreatingNewSection = useCallback(() => {
    setIsCreatingNewSection(false);
    setErrors([]);
  }, []);

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
    setErrors([]);
  };

  const handleChangeField = (
    sectionId: string,
    fieldId: string,
    fieldData: Omit<FieldConfig, 'id'>
  ) => {
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
    setErrors([]);
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

  const saveSchema = useCallback(async (sectionsToSave: SectionConfig[] = sections) => {
    if (!libraryId) {
      message.error('Missing libraryId, cannot save');
      return;
    }

    // Check if there are any pending fields and add them to their respective sections
    const finalSections = sectionsToSave.map((section) => {
      const pendingField = pendingFields.get(section.id);
      if (pendingField && pendingField.label.trim()) {
        // Add the pending field to this section
        return {
          ...section,
          fields: [...section.fields, { id: uid(), ...pendingField }],
        };
      }
      return section;
    });

    // Validate all sections
    const parsed = z.array(sectionSchema).safeParse(
      finalSections.map((s) => ({
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
      await saveSchemaIncremental(supabase, libraryId, finalSections);

      message.success('Saved successfully, loading...');

      // Clear pending fields after successful save
      setPendingFields(new Map());

      // If creating new section, exit creation mode and reload sections
      if (isCreatingNewSection) {
        setLoadingAfterSave(true);
        setIsCreatingNewSection(false);
        const loadedSections = await reloadSections();
        if (loadedSections && loadedSections.length > 0) {
          setActiveSectionId(loadedSections[loadedSections.length - 1].id);
        }
        setLoadingAfterSave(false);
      } else {
        // Reload to sync with database
        setLoadingAfterSave(true);
        await reloadSections();
        setLoadingAfterSave(false);
      }
    } catch (e: any) {
      message.error(e?.message || 'Failed to save');
      setErrors([e?.message || 'Failed to save']);
    } finally {
      setSaving(false);
    }
  }, [sections, libraryId, isCreatingNewSection, reloadSections, supabase, pendingFields]);

  // Broadcast predefine UI state (e.g. whether creating a new section) to TopBar
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('predefine-state', {
          detail: { isCreatingNewSection, activeSectionId },
        })
      );
    }
  }, [isCreatingNewSection, activeSectionId]);

  // Listen to top bar "Save" button for Predefine
  useEffect(() => {
    const handler = () => {
      // If we are creating a new section, trigger NewSectionForm save
      // Otherwise, trigger schema save for existing sections
      if (isCreatingNewSection) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('predefine-save-new-section'));
        }
      } else {
        void saveSchema();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('predefine-save', handler);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('predefine-save', handler);
      }
    };
  }, [isCreatingNewSection, saveSchema]);

  const handleDeleteSection = useCallback(async (sectionId: string) => {
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
  }, [libraryId, sections, activeSectionId, reloadSections, supabase]);

  // Listen to top bar "Cancel/Delete" button for Predefine
  useEffect(() => {
    const handler = () => {
      if (isCreatingNewSection) {
        cancelCreatingNewSection();
      } else if (activeSectionId) {
        void handleDeleteSection(activeSectionId);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('predefine-cancel-or-delete', handler);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('predefine-cancel-or-delete', handler);
      }
    };
  }, [isCreatingNewSection, activeSectionId, cancelCreatingNewSection, handleDeleteSection]);

  const baseTabItems = sections.map((section, sectionIndex): TabsProps['items'][0] => ({
    key: section.id,
    label: section.name,
    children: (
      <div className={styles.tabContent}>
        <div>
          <div className={sectionHeaderStyles.generalSection}>
            <div>
              <div>
                  <Image src={predefineExpandIcon} alt="expand" width={16} height={16} style={{ paddingTop: 3 }}/>
                  <span className={sectionHeaderStyles.generalLabel}>General</span>
              </div>
              <div className={sectionHeaderStyles.lineSeparator}></div>
              <div className={sectionHeaderStyles.sectionNameContainer}>
                <div className={sectionHeaderStyles.dragHandle}>
                  <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                </div>
                {section.name ? (
                  <span className={sectionHeaderStyles.sectionNameDisplay}>{section.name}</span>
                ) : (
                  <span className={sectionHeaderStyles.noSectionSelected}>No section selected</span>
                )}
              </div>
            </div>
          </div>
          <div>
              <Image src={predefineExpandIcon} alt="expand" width={16} height={16} style={{ paddingTop: 3 }}/>
              <span className={styles.sectionTitle}>Pre-define property</span>
          </div>
          <div className={sectionHeaderStyles.lineSeparator}></div>
          <div className={styles.headerRow}>
            <div className={styles.headerLabel}>Label text</div>
            <div className={styles.headerDataType}>Data type</div>
            <div className={styles.headerActions} />
          </div>
        </div>
        <FieldsList
          fields={section.fields}
          onChangeField={(fieldId, data) => handleChangeField(section.id, fieldId, data)}
          onDeleteField={(fieldId) => handleDeleteField(section.id, fieldId)}
          disabled={saving}
          isFirstSection={sectionIndex === 0}
        />
        <FieldForm
          onSubmit={(data) => handleAddField(section.id, data)}
          disabled={saving}
          onFieldChange={(field) => {
            setPendingFields((prev) => {
              const newMap = new Map(prev);
              newMap.set(section.id, field);
              return newMap;
            });
          }}
        />
      </div>
    ),
  }));

  const tabItems: TabsProps['items'] = [...baseTabItems];

  if (sections.length > 0 && isCreatingNewSection) {
    tabItems.push({
      key: NEW_SECTION_TAB_KEY,
      label: 'New section',
      children: (
        <div className={styles.tabContent}>
          <NewSectionForm
            onCancel={cancelCreatingNewSection}
            onSave={handleSaveNewSection}
            saving={saving}
            isFirstSection={false}
          />
        </div>
      ),
    });
  }

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
              <h1 className={styles.title}>
                {`Predefine ${library?.name ?? ''} Library`}
              </h1>
              {library?.description && (
                <p className={styles.subtitle}>{library.description}</p>
              )}
            </div>
          </div>

          {errors.length > 0 && (
            <div className={styles.errorsContainer}>
              {errors.map((err, idx) => (
                <div key={idx}>{err}</div>
              ))}
            </div>
          )}

          {loadingAfterSave && (
            <div className={styles.loadingAfterSave}>
              Section saved, loading results...
            </div>
          )}

          <>
            <div className={styles.tabsContainer}>
              {sections.length > 0 ? (
                <>
                  <Tabs
                    activeKey={
                      isCreatingNewSection
                        ? NEW_SECTION_TAB_KEY
                        : activeSectionId || undefined
                    }
                    onChange={(key) => {
                      if (key === NEW_SECTION_TAB_KEY) {
                        startCreatingNewSection();
                      } else {
                        setIsCreatingNewSection(false);
                        setActiveSectionId(key);
                      }
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
              ) : isCreatingNewSection ? (
                <NewSectionForm
                  onCancel={cancelCreatingNewSection}
                  onSave={handleSaveNewSection}
                  saving={saving}
                  isFirstSection={sections.length === 0}
                />
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

            {/* {sections.length > 0 && (
              <div>
                {activeSectionId && !isCreatingNewSection && (
                  <div className={styles.saveButtonContainer}>
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
              </div>
            )} */}
          </>
        </div>
      </div>
    </ConfigProvider>
  );
}
