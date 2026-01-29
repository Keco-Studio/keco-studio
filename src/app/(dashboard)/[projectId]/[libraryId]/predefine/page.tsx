'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/utils/queryKeys';
import { Tabs, Button, App, ConfigProvider, Input, Tooltip } from 'antd';
import type { TabsProps } from 'antd/es/tabs';
import type { InputRef } from 'antd/es/input';
import Image from 'next/image';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import predefineLabelDelIcon from '@/app/assets/images/predefineLabelDelIcon.svg';
import predefineAddSectionIcon from '@/app/assets/images/predefineAddSectionIcon.svg';
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
import PredefineBackIcon from '@/app/assets/images/PredefineBackIcon.svg';

const NEW_SECTION_TAB_KEY = '__new_section__';

function PredefinePageContent() {
  const { message } = App.useApp();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
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
  // Track pending field for each section (field in FieldForm that hasn't been submitted yet)
  const [pendingFields, setPendingFields] = useState<Map<string, Omit<FieldConfig, 'id'> | null>>(new Map());
  // Use ref to store latest pendingFields for synchronous access in saveSchema
  const pendingFieldsRef = useRef<Map<string, Omit<FieldConfig, 'id'> | null>>(new Map());
  // Flag to prevent auto-save during reload/save operations
  const isSavingOrReloading = useRef(false);
  // Track temporary section name edits (only applied on save)
  const [tempSectionNames, setTempSectionNames] = useState<Map<string, string>>(new Map());
  // Track if we've already checked for auto-enter new section mode (to avoid re-triggering)
  const autoEnterChecked = useRef(false);
  // Track if we auto-entered creation mode due to empty sections (to handle slow loading)
  const autoEnteredCreationMode = useRef(false);
  // Ref for tabs container to calculate add button position
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [addButtonLeft, setAddButtonLeft] = useState<number>(0);
  // Track which tab name is being edited (section ID)
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  // Track new section name when creating
  const [newSectionName, setNewSectionName] = useState('');
  // Ref for new section tab name input to auto-focus
  const newSectionInputRef = useRef<InputRef>(null);
  // Flag to prevent immediate blur after auto-focus
  const isAutoFocusing = useRef(false);
  // Track auto-save timer to debounce saves
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track if user saved schema this session → back goes to library table, else router.back()
  const hasSavedThisSessionRef = useRef(false);

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
        setNewSectionName('New Section'); // Initialize default section name
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
          setNewSectionName(''); // Clear section name when exiting creation mode
          setEditingTabId(null); // Clear editing state when exiting creation mode
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
    setNewSectionName('New Section');
    setErrors([]);
  }, []);

  const cancelCreatingNewSection = useCallback(() => {
    setIsCreatingNewSection(false);
    setNewSectionName('');
    setEditingTabId(null); // Clear editing state when canceling
    setErrors([]);
  }, []);

  // Auto-enter edit mode for new section tab name
  useEffect(() => {
    if (isCreatingNewSection) {
      // First set editing state, then focus the input after it's rendered
      setEditingTabId(NEW_SECTION_TAB_KEY);
      
      // Set flag to prevent immediate blur
      isAutoFocusing.current = true;
      
      // Use multiple animation frames to ensure the input is fully rendered
      const focusTimer = setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (newSectionInputRef.current) {
              newSectionInputRef.current.focus();
              // Also select all text so user can immediately start typing
              newSectionInputRef.current.select();
            }
          });
        });
      }, 100);
      
      // Clear the auto-focusing flag after a longer delay to prevent accidental blur
      const flagTimer = setTimeout(() => {
        isAutoFocusing.current = false;
      }, 1000);
      
      return () => {
        clearTimeout(focusTimer);
        clearTimeout(flagTimer);
        isAutoFocusing.current = false;
      };
    }
  }, [isCreatingNewSection]);

  const handleAddField = (sectionId: string, fieldData: Omit<FieldConfig, 'id'>) => {
    const field: FieldConfig = {
      id: uid(),
      label: fieldData.label || '',
      dataType: fieldData.dataType, // Allow undefined dataType
      required: fieldData.required,
      ...(fieldData.enumOptions && { enumOptions: fieldData.enumOptions }),
      ...(fieldData.referenceLibraries && { referenceLibraries: fieldData.referenceLibraries }),
    };

    const updatedSections = sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            fields: [...s.fields, field],
          }
        : s
    );
    
    setSections(updatedSections);
    setActiveSectionId(sectionId);
    setErrors([]);
    
    // Clear pending field for this section after adding it to the list
    // This prevents duplicate additions when saving
    setPendingFields((prev) => {
      const newMap = new Map(prev);
      newMap.delete(sectionId);
      return newMap;
    });
    pendingFieldsRef.current.delete(sectionId);
    
    // Trigger FieldForm reset by dispatching a custom event
    window.dispatchEvent(new CustomEvent('fieldform-reset', { detail: { sectionId } }));
    
    // Auto-save immediately after adding field (important operation)
    // Skip if currently saving or reloading
    if (!isSavingOrReloading.current) {
      // Clear any pending auto-save timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      // Save immediately (no delay) to ensure data is persisted
      void saveSchema(updatedSections, false); // false = don't reload after save
    }
  };

  const handleChangeField = (
    sectionId: string,
    fieldId: string,
    fieldData: Omit<FieldConfig, 'id'>
  ) => {
    const updatedSections = sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            fields: s.fields.map((f) => (f.id === fieldId ? { 
              ...f, 
              ...fieldData,
              label: fieldData.label !== undefined ? fieldData.label : f.label,
              dataType: fieldData.dataType !== undefined ? fieldData.dataType : f.dataType,
            } : f)),
          }
        : s
    );
    
    setSections(updatedSections);
    setErrors([]);
    
    // Debounce auto-save after changing field
    // Clear previous timer and set new one
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      if (!isSavingOrReloading.current) {
        void saveSchema(updatedSections, false); // false = don't reload after save
      }
    }, 500); // Increased to 500ms for debouncing
  };

  const handleDeleteField = (sectionId: string, fieldId: string) => {
    const updatedSections = sections.map((s) =>
      s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s
    );
    
    setSections(updatedSections);
    
    // Auto-save immediately after deleting field (important operation)
    if (!isSavingOrReloading.current) {
      // Clear any pending auto-save timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      // Save immediately to ensure data is persisted
      void saveSchema(updatedSections, false); // false = don't reload after save
    }
  };

  const handleReorderFields = (sectionId: string, newFieldOrder: FieldConfig[]) => {
    const updatedSections = sections.map((s) =>
      s.id === sectionId ? { ...s, fields: newFieldOrder } : s
    );
    
    setSections(updatedSections);
    setErrors([]);
    
    // Auto-save after reordering fields (debounced to allow multiple drag operations)
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      if (!isSavingOrReloading.current) {
        void saveSchema(updatedSections, false); // false = don't reload after save
      }
    }, 800); // Longer delay for drag operations
  };

  const handleSaveNewSection = async (newSection: { name: string; fields: FieldConfig[] }) => {
    if (!libraryId) {
      message.error('Missing libraryId, cannot save');
      return;
    }

    const trimmedName = newSection.name.trim() || 'Untitled Section';

    // Combine with existing sections (allow undefined dataType)
    // Note: Section names can be duplicate since section_id is the unique identifier
    const allSections = [...sections, { id: uid(), name: trimmedName, fields: newSection.fields }];
    await saveSchema(allSections);
  };

  const saveSchema = useCallback(async (sectionsToSave: SectionConfig[] = sections, shouldReload: boolean = true) => {
    if (!libraryId) {
      message.error('Missing libraryId, cannot save');
      return;
    }

    // Prevent concurrent saves or auto-saves during save/reload
    if (isSavingOrReloading.current) {
      return;
    }

    // Clear any pending auto-save timers
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    
    // Check if there are any pending fields and add them to their respective sections
    // Also apply temporary section name changes
    // Use ref to get latest pendingFields value to avoid stale closure issue
    const finalSections = sectionsToSave.map((section) => {
      const pendingField = pendingFieldsRef.current.get(section.id);
      const tempName = tempSectionNames.get(section.id);
      
      let updatedSection = { ...section };
      
      // Apply temp section name if exists
      if (tempName !== undefined) {
        updatedSection.name = tempName || 'Untitled Section';
      }
      
      // Add pending field if exists (even if completely empty)
      if (pendingField) {
        const newField = {
          id: uid(),
          label: pendingField.label || '',
          dataType: pendingField.dataType, // Allow undefined
          required: pendingField.required,
          ...(pendingField.enumOptions && { enumOptions: pendingField.enumOptions }),
          ...(pendingField.referenceLibraries && { referenceLibraries: pendingField.referenceLibraries }),
        };
        updatedSection.fields = [...updatedSection.fields, newField];
      }
      
      return updatedSection;
    });

    // Use finalSections directly (allow undefined dataType)
    const sectionsWithDefaults = finalSections;

    isSavingOrReloading.current = true;
    setSaving(true);
    setErrors([]);
    try {
      // Use incremental update to preserve field IDs and asset data
      await saveSchemaIncremental(supabase, libraryId, sectionsWithDefaults);
      
      hasSavedThisSessionRef.current = true;

      // Invalidate React Query cache to ensure LibraryPage gets fresh data
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySchema(libraryId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      
      // Refetch to ensure data is updated immediately
      await queryClient.refetchQueries({ queryKey: queryKeys.librarySchema(libraryId) });
      await queryClient.refetchQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
      await queryClient.refetchQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      
      // Notify LibraryPage to refresh schema and assets (for backward compatibility)
      window.dispatchEvent(new CustomEvent('schemaUpdated', {
        detail: { libraryId }
      }));

      // Clear pending fields and temp section names after successful save
      const emptyMap = new Map();
      setPendingFields(emptyMap);
      pendingFieldsRef.current = emptyMap;
      setTempSectionNames(new Map());

      
      // If creating new section, exit creation mode and reload sections
      if (isCreatingNewSection) {
        setIsCreatingNewSection(false);
        setNewSectionName(''); // Clear new section name
        setEditingTabId(null); // Clear editing state after saving
        const loadedSections = await reloadSections();
        // Keep the newly created section active (last one in the list)
        if (loadedSections && loadedSections.length > 0) {
          setActiveSectionId(loadedSections[loadedSections.length - 1].id);
        }
      } else if (shouldReload) {
        // Only reload if explicitly requested (e.g., after deleting section)
        const currentActiveId = activeSectionId;
        const loadedSections = await reloadSections();
        // Restore the active section ID if it still exists
        if (currentActiveId && loadedSections?.find(s => s.id === currentActiveId)) {
          setActiveSectionId(currentActiveId);
        }
      } else {
        // No reload needed - just update local state
        // The sections are already updated via setSections in the handlers
      }
    } catch (e: any) {
      message.error(e?.message || 'Failed to save');
      setErrors([e?.message || 'Failed to save']);
    } finally {
      setSaving(false);
      // Reset flag after a brief delay to ensure all updates are complete
      setTimeout(() => {
        isSavingOrReloading.current = false;
      }, 500);
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
      // Delete all field definitions for this section using section_id (not section name)
      // This ensures only the specific section is deleted, even if there are duplicate names
      // This will cascade delete asset values due to foreign key constraint
      const { error: delError } = await supabase
        .from('library_field_definitions')
        .delete()
        .eq('library_id', libraryId)
        .eq('section_id', sectionId);

      if (delError) throw delError;

      message.success(`Section "${sectionToDelete.name}" deleted successfully`);

      // Invalidate cache before reloading to ensure fresh data
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      globalRequestCache.invalidate(`field-definitions:${libraryId}`);

      // Invalidate React Query cache to ensure LibraryPage gets fresh data
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySchema(libraryId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      
      // Refetch to ensure data is updated immediately
      await queryClient.refetchQueries({ queryKey: queryKeys.librarySchema(libraryId) });
      await queryClient.refetchQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
      await queryClient.refetchQueries({ queryKey: queryKeys.librarySummary(libraryId) });

      // Notify LibraryPage to refresh schema and assets (for backward compatibility)
      window.dispatchEvent(new CustomEvent('schemaUpdated', {
        detail: { libraryId }
      }));

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

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Calculate add button position based on the rightmost tab
  useEffect(() => {
    const calculateButtonPosition = () => {
      if (!tabsContainerRef.current) return;
      
      // Find all tab elements
      const tabNavWrap = tabsContainerRef.current.querySelector('.ant-tabs-nav-wrap');
      if (!tabNavWrap) return;
      
      const tabList = tabNavWrap.querySelector('.ant-tabs-nav-list');
      if (!tabList) return;
      
      const tabs = tabList.querySelectorAll('.ant-tabs-tab');
      if (tabs.length === 0) return;
      
      // Get the last tab (rightmost)
      const lastTab = tabs[tabs.length - 1] as HTMLElement;
      const tabRect = lastTab.getBoundingClientRect();
      const containerRect = tabsContainerRef.current.getBoundingClientRect();
      
      // Calculate position: right edge of last tab + some margin
      const leftPosition = tabRect.right - containerRect.left + 25;
      setAddButtonLeft(leftPosition);
    };
    
    // Calculate on mount and when dependencies change
    calculateButtonPosition();
    
    // Recalculate after a short delay to ensure tabs are rendered
    const timer = setTimeout(calculateButtonPosition, 100);
    
    // Set up ResizeObserver to watch for tab size changes
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    
    const setupObservers = () => {
      if (!tabsContainerRef.current) return;
      
      const tabNavWrap = tabsContainerRef.current.querySelector('.ant-tabs-nav-wrap');
      if (!tabNavWrap) return;
      
      const tabList = tabNavWrap.querySelector('.ant-tabs-nav-list');
      if (!tabList) return;
      
      // Watch for size changes in the tab list
      resizeObserver = new ResizeObserver(() => {
        calculateButtonPosition();
      });
      resizeObserver.observe(tabList);
      
      // Watch for DOM changes (adding/removing tabs, content changes)
      mutationObserver = new MutationObserver(() => {
        calculateButtonPosition();
      });
      mutationObserver.observe(tabList, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    
    // Set up observers after a delay to ensure DOM is ready
    const observerTimer = setTimeout(setupObservers, 200);
    
    return () => {
      clearTimeout(timer);
      clearTimeout(observerTimer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
      }
    };
  }, [sections, isCreatingNewSection, activeSectionId, editingTabId, tempSectionNames, newSectionName]);

  const baseTabItems = sections.map((section, sectionIndex): TabsProps['items'][0] => ({
    key: section.id,
    label: (
      <div
        onClick={(e) => {
          // Only trigger edit mode if clicking on the tab itself, not during onChange
          if (activeSectionId === section.id) {
            e.stopPropagation();
            setEditingTabId(section.id);
          }
        }}
        style={{ display: 'inline-block' }}
      >
        {editingTabId === section.id ? (
          <Input
            autoFocus
            value={tempSectionNames.get(section.id) ?? section.name}
            onChange={(e) => {
              e.stopPropagation();
              const newName = e.target.value;
              
              // Always update the value (even during composition)
              // Note: Section names can be duplicate since section_id is the unique identifier
              setTempSectionNames((prev) => {
                const newMap = new Map(prev);
                newMap.set(section.id, newName);
                return newMap;
              });
            }}
            onKeyDown={(e) => {
              // Allow space key and other normal input keys
              if (e.key === ' ' || e.key === 'Enter') {
                e.stopPropagation();
              }
            }}
            onBlur={() => {
              setEditingTabId(null);
              
              // Auto-save after section name loses focus
              // Skip if currently saving or reloading
              if (isSavingOrReloading.current) {
                return;
              }
              
              if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
              }
              autoSaveTimerRef.current = setTimeout(() => {
                if (!isSavingOrReloading.current) {
                  void saveSchema(sections, false); // false = don't reload after save
                }
              }, 300);
            }}
            onPressEnter={() => {
              setEditingTabId(null);
              
              // Auto-save after pressing Enter
              // Skip if currently saving or reloading
              if (isSavingOrReloading.current) {
                return;
              }
              
              if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
              }
              autoSaveTimerRef.current = setTimeout(() => {
                if (!isSavingOrReloading.current) {
                  void saveSchema(sections, false); // false = don't reload after save
                }
              }, 300);
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={styles.tabNameInput}
            style={{ 
              width: `${Math.max(60, Math.min(200, (tempSectionNames.get(section.id) ?? section.name).length * 8 + 30))}px`, 
              height: '24px', 
              padding: '0 8px' 
            }}
          />
        ) : (
          <span>{tempSectionNames.get(section.id) ?? section.name}</span>
        )}
      </div>
    ),
    children: (
      <div className={styles.tabContent}>
        <div>
          <div className={styles.headerRow}>
            <div className={styles.headerLabel}>Label text</div>
            <div className={styles.headerDataType}>Data type</div>
            <div className={styles.headerActions} />
          </div>
        </div>
        <FieldsList
          fields={section.fields}
          onChangeField={(fieldId, data) => {
            handleChangeField(section.id, fieldId, data);
          }}
          onDeleteField={(fieldId) => handleDeleteField(section.id, fieldId)}
          onReorderFields={(newOrder) => handleReorderFields(section.id, newOrder)}
          disabled={saving}
          isFirstSection={sectionIndex === 0}
          invalidFields={new Set()}
        />
        <FieldForm
          onSubmit={(data) => handleAddField(section.id, data)}
          disabled={saving}
          onFieldChange={(field) => {
            // Always update pending field (even if empty)
            setPendingFields((prev) => {
              const newMap = new Map(prev);
              newMap.set(section.id, field);
              // Update ref synchronously to ensure saveSchema can access latest value
              pendingFieldsRef.current = newMap;
              return newMap;
            });
          }}
          onFieldBlur={() => {
            // Auto-save when field loses focus
            // Skip if currently saving or reloading
            if (isSavingOrReloading.current) {
              return;
            }
            
            if (autoSaveTimerRef.current) {
              clearTimeout(autoSaveTimerRef.current);
            }
            autoSaveTimerRef.current = setTimeout(() => {
              if (!isSavingOrReloading.current) {
                void saveSchema(sections, false); // false = don't reload after save
              }
            }, 300);
          }}
          validationError={undefined}
        />
      </div>
    ),
  }));

  const tabItems: TabsProps['items'] = [...baseTabItems];

  // Add "New Section" tab when creating new section
  if (isCreatingNewSection) {
    tabItems.push({
      key: NEW_SECTION_TAB_KEY,
      label: (
        <div
          onClick={(e) => {
            // Only allow setting edit mode when not already editing
            if (editingTabId !== NEW_SECTION_TAB_KEY) {
              e.stopPropagation();
              setEditingTabId(NEW_SECTION_TAB_KEY);
            }
          }}
          style={{ display: 'inline-block' }}
        >
          {editingTabId === NEW_SECTION_TAB_KEY ? (
            <Input
              ref={newSectionInputRef}
              autoFocus
              value={newSectionName}
              onChange={(e) => {
                e.stopPropagation();
                const newName = e.target.value;
                
                // Always update the value (even during composition)
                // Note: Section names can be duplicate since section_id is the unique identifier
                setNewSectionName(newName);
              }}
              onKeyDown={(e) => {
                // Allow space key and other normal input keys
                if (e.key === ' ' || e.key === 'Enter') {
                  e.stopPropagation();
                }
              }}
              onBlur={(e) => {
                // Ignore blur during auto-focusing period
                if (!isAutoFocusing.current) {
                  setEditingTabId(null);
                  
                  // Auto-save new section name after losing focus
                  // Note: The section hasn't been created yet, so we don't trigger saveSchema here
                  // The name will be saved when the section is actually created (when user adds first field or clicks save)
                }
              }}
              onPressEnter={() => {
                // Always allow Enter to exit editing
                isAutoFocusing.current = false;
                setEditingTabId(null);
              }}
              onFocus={(e) => {
                // Select all text when focused
                e.target.select();
              }}
              onClick={(e) => {
                e.stopPropagation();
                // Ensure input stays focused when clicked
                if (e.currentTarget) {
                  e.currentTarget.focus();
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={styles.tabNameInput}
              style={{ 
                width: `${Math.max(60, Math.min(200, newSectionName.length * 8 + 30))}px`, 
                height: '24px', 
                padding: '0 8px' 
              }}
            />
          ) : (
            <span>{newSectionName || 'New Section'}</span>
          )}
        </div>
      ),
      children: (
        <div className={styles.tabContent}>
          <NewSectionForm
            onCancel={sections.length > 0 ? cancelCreatingNewSection : undefined}
            onSave={(section) => handleSaveNewSection({ ...section, name: newSectionName || section.name })}
            saving={saving}
            isFirstSection={sections.length === 0}
            sectionName={newSectionName}
          />
        </div>
      ),
    });
  }

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
                    if (hasSavedThisSessionRef.current) {
                      router.push(`/${projectId}/${libraryId}`);
                    } else {
                      router.back();
                    }
                  }}
                  title="Back to library"
                  aria-label="Back to library"
                >
                  <Image
                    src={PredefineBackIcon}
                    alt="Back"
                    width={24}
                    height={24}
                  />
                </button>
              )}
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
                      <Tooltip title={library.description.length > 50 ? library.description : undefined}>
                        <p className={styles.subtitle}>
                          {library.description.length > 50
                            ? `${library.description.slice(0, 50)}...`
                            : library.description}
                        </p>
                      </Tooltip>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {errors.length > 0 && (
            <div className={styles.errorsContainer}>
              {errors.map((err, idx) => (
                <div key={idx}>{err}</div>
              ))}
            </div>
          )}

          <>
            <div className={styles.tabsContainer} ref={tabsContainerRef}>
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
                      style={{ left: `${addButtonLeft}px` }}
                    >
                      <Image src={predefineAddSectionIcon} alt="Add Section" width={24} height={24} />
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
      <App message={{ top: 20, maxCount: 1 }}>
        <PredefinePageContent />
      </App>
    </ConfigProvider>
  );
}
