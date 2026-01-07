'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams } from 'next/navigation';
import { Tabs, Button, App, ConfigProvider, Input } from 'antd';
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

function PredefinePageContent() {
  const { message } = App.useApp();
  const supabase = useSupabase();
  const params = useParams();
  const libraryId = params?.libraryId as string | undefined;

  const { sections, setSections, loading: sectionsLoading, reload: reloadSections } = useSchemaData({
    libraryId,
    supabase,
  });
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [isCreatingNewSection, setIsCreatingNewSection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loadingAfterSave, setLoadingAfterSave] = useState(false);
  // Track pending field for each section (field in FieldForm that hasn't been submitted yet)
  const [pendingFields, setPendingFields] = useState<Map<string, Omit<FieldConfig, 'id'> | null>>(new Map());
  // Use ref to store latest pendingFields for synchronous access in saveSchema
  const pendingFieldsRef = useRef<Map<string, Omit<FieldConfig, 'id'> | null>>(new Map());
  // Track temporary section name edits (only applied on save)
  const [tempSectionNames, setTempSectionNames] = useState<Map<string, string>>(new Map());
  // Track if we've already checked for auto-enter new section mode (to avoid re-triggering)
  const autoEnterChecked = useRef(false);
  // Track if we auto-entered creation mode due to empty sections (to handle slow loading)
  const autoEnteredCreationMode = useRef(false);

  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeSectionId) || null,
    [sections, activeSectionId]
  );

  // Load current library info (name, description) for page title display
  useEffect(() => {
    if (!libraryId) {
      setLoadingLibrary(false);
      return;
    }

    const fetchLibrary = async () => {
      setLoadingLibrary(true);
      try {
        const lib = await getLibrary(supabase, libraryId);
        setLibrary(lib);
      } catch (e) {
        // Only used for title display, ignore on failure
        console.error('Failed to load library info', e);
      } finally {
        setLoadingLibrary(false);
      }
    };

    fetchLibrary();
  }, [libraryId, supabase]);

  // Consolidated effect: Set active section and handle creation mode initialization
  useEffect(() => {
    // Wait for initial data load to complete
    if (sectionsLoading) return;
    
    // Only run initialization check once
    if (!autoEnterChecked.current) {
      autoEnterChecked.current = true;
      
      if (sections.length === 0) {
        // No sections exist, auto-enter creation mode
        setIsCreatingNewSection(true);
        autoEnteredCreationMode.current = true;
      } else {
        // Sections exist, set first as active if needed
        setIsCreatingNewSection(false);
        if (!activeSectionId || !sections.find((s) => s.id === activeSectionId)) {
          setActiveSectionId(sections[0].id);
        }
      }
    } else {
      // After initialization, handle slow-loading sections data
      if (sections.length > 0) {
        // If we auto-entered creation mode due to empty initial state,
        // but now sections exist (slow loading), exit creation mode
        if (autoEnteredCreationMode.current && isCreatingNewSection) {
          setIsCreatingNewSection(false);
          autoEnteredCreationMode.current = false;
        }
        if (!activeSectionId || !sections.find((s) => s.id === activeSectionId)) {
          setActiveSectionId(sections[0].id);
        }
      } else {
        setActiveSectionId(null);
      }
    }
  }, [sections, sectionsLoading, activeSectionId, isCreatingNewSection]);

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

  const handleReorderFields = (sectionId: string, newFieldOrder: FieldConfig[]) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, fields: newFieldOrder } : s
      )
    );
    setErrors([]);
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
        referenceLibraries: f.referenceLibraries,
      })),
    });

    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    // Combine with existing sections

    const allSections = [...sections, { id: uid(), ...newSection }];
    console.log('allSections:', allSections);
    await saveSchema(allSections);
  };

  const saveSchema = useCallback(async (sectionsToSave: SectionConfig[] = sections) => {
    if (!libraryId) {
      message.error('Missing libraryId, cannot save');
      return;
    }

    // Check if there are any pending fields and add them to their respective sections
    // Also apply temporary section name changes
    // Use ref to get latest pendingFields value to avoid stale closure issue
    const finalSections = sectionsToSave.map((section) => {
      const pendingField = pendingFieldsRef.current.get(section.id);
      const tempName = tempSectionNames.get(section.id);
      
      let updatedSection = { ...section };
      console.log('updatedSection:', updatedSection);
      
      // Apply temp section name if exists
      if (tempName !== undefined) {
        updatedSection.name = tempName;
      }
      
      // Add pending field if exists
      console.log('Checking pendingField for section:', section.id, {
        pendingField,
        hasPendingField: !!pendingField,
        label: pendingField?.label,
        dataType: pendingField?.dataType,
        referenceLibraries: pendingField?.referenceLibraries,
      });
      if (pendingField && pendingField.label.trim()) {
        // Debug: Log pendingField to verify referenceLibraries is included
        if (pendingField.dataType === 'reference') {
          console.log('Saving reference field:', {
            label: pendingField.label,
            referenceLibraries: pendingField.referenceLibraries,
          });
        }
        updatedSection.fields = [...updatedSection.fields, { id: uid(), ...pendingField }];
      }
      
      return updatedSection;
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
          referenceLibraries: f.referenceLibraries,
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
      console.log('finalSections:', finalSections);
      await saveSchemaIncremental(supabase, libraryId, finalSections);

      message.success('Saved successfully, loading...');

      // Clear pending fields and temp section names after successful save
      const emptyMap = new Map();
      setPendingFields(emptyMap);
      pendingFieldsRef.current = emptyMap;
      setTempSectionNames(new Map());

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
  }, [sections, libraryId, isCreatingNewSection, reloadSections, supabase, tempSectionNames]);

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

      // Invalidate cache before reloading to ensure fresh data
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      globalRequestCache.invalidate(`field-definitions:${libraryId}`);

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
                <div className={sectionHeaderStyles.dragHandle} style={{ visibility: 'hidden' }}>
                  <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                </div>
                <Input
                  value={tempSectionNames.get(section.id) ?? section.name}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setTempSectionNames((prev) => {
                      const newMap = new Map(prev);
                      newMap.set(section.id, newName);
                      return newMap;
                    });
                  }}
                  className={sectionHeaderStyles.sectionNameInput}
                  placeholder="section name"
                  disabled={saving}
                />
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
          onReorderFields={(newOrder) => handleReorderFields(section.id, newOrder)}
          disabled={saving}
          isFirstSection={sectionIndex === 0}
        />
        <FieldForm
          onSubmit={(data) => handleAddField(section.id, data)}
          disabled={saving}
          onFieldChange={(field) => {
            setPendingFields((prev) => {
              const newMap = new Map(prev);
              // Only update if field is not null
              // This prevents useEffect from overwriting manually set values with null
              if (field !== null) {
                newMap.set(section.id, field);
                // Update ref synchronously to ensure saveSchema can access latest value
                pendingFieldsRef.current = newMap;
              } else {
                // Only clear if there's no existing field with data
                const existing = prev.get(section.id);
                if (!existing || !existing.label.trim()) {
                  newMap.delete(section.id);
                  pendingFieldsRef.current = newMap;
                }
                // If existing field has data, don't clear it (ignore null from useEffect)
              }
              return newMap;
            });
          }}
        />
      </div>
    ),
  }));

  const tabItems: TabsProps['items'] = [...baseTabItems];

  // Add "New Section" tab when creating new section
  if (isCreatingNewSection) {
    tabItems.push({
      key: NEW_SECTION_TAB_KEY,
      label: 'New Section',
      children: (
        <div className={styles.tabContent}>
          <NewSectionForm
            onCancel={sections.length > 0 ? cancelCreatingNewSection : undefined}
            onSave={handleSaveNewSection}
            saving={saving}
            isFirstSection={sections.length === 0}
          />
        </div>
      ),
    });
  }

  return (
    <div className={styles.container}>
        <div className={styles.contentWrapper}>
          <div className={styles.header}>
            <div>
              {loadingLibrary ? (
                <h1 className={styles.title}>
                  Loading...
                </h1>
              ) : (
                <>
                  <h1 className={styles.title}>
                    {`Predefine ${library?.name ?? ''} Library`}
                  </h1>
                  {library?.description && (
                    <p className={styles.subtitle}>{library.description}</p>
                  )}
                </>
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
              {(sections.length > 0 || isCreatingNewSection) && (
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
                  {sections.length > 0 && (
                    <button
                      onClick={startCreatingNewSection}
                      className={styles.addSectionButton}
                    >
                      <Image src={predefineLabelAddIcon} alt="Add" width={20} height={20} />
                      Add Section
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        </div>
      </div>
  );
}

export default function PredefinePage() {
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
      <App>
        <PredefinePageContent />
      </App>
    </ConfigProvider>
  );
}
