'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Input, Button, Select } from 'antd';
import Image from 'next/image';
import type { FieldConfig, FieldType } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/types';
import { FIELD_TYPE_OPTIONS, getFieldTypeIcon } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import predefineLabelAddIcon from '@/assets/images/predefineLabelAddIcon.svg';
import predefineDragIcon from '@/assets/images/predefineDragIcon.svg';
import predefineLabelConfigIcon from '@/assets/images/predefineLabelConfigIcon.svg';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams } from 'next/navigation';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import styles from './FieldForm.module.css';

interface FieldFormProps {
  sectionId?: string;
  initialField?: Omit<FieldConfig, 'id'>;
  onSubmit: (field: Omit<FieldConfig, 'id'>) => void;
  onCancel?: () => void;
  disabled?: boolean;
  onFieldChange?: (field: Omit<FieldConfig, 'id'> | null) => void;
  onFieldBlur?: () => void;
  validationError?: { labelInvalid: boolean; dataTypeInvalid: boolean };
}

export function FieldForm({ sectionId, initialField, onSubmit, onCancel, disabled, onFieldChange, onFieldBlur, validationError }: FieldFormProps) {
  const supabase = useSupabase();
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const currentLibraryId = params?.libraryId as string | undefined;
  
  const [field, setField] = useState<Omit<FieldConfig, 'id'>>(
    initialField || {
      label: '',
      dataType: undefined, // No default type - user must select
      required: false,
      enumOptions: [],
      referenceLibraries: [],
    }
  );
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  
  // Whether data type has been selected via slash, used to control placeholder display
  const [dataTypeSelected, setDataTypeSelected] = useState(!!initialField);
  // Track IME composition state for Chinese/Japanese/Korean input
  const [isComposing, setIsComposing] = useState(false);
  const [localLabel, setLocalLabel] = useState(field.label);
  const [composingOptionIndex, setComposingOptionIndex] = useState<number | null>(null);
  const [localOptions, setLocalOptions] = useState(field.enumOptions ?? []);
  const inputRef = useRef<any>(null);
  const dataTypeInputRef = useRef<any>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const configMenuRef = useRef<HTMLDivElement>(null);
  const configButtonRef = useRef<HTMLButtonElement>(null);
  // Store onFieldChange callback in ref to ensure we always use the latest version
  const onFieldChangeRef = useRef(onFieldChange);
  
  // Update ref whenever onFieldChange changes
  useEffect(() => {
    onFieldChangeRef.current = onFieldChange;
  }, [onFieldChange]);
  
  // Sync external field.label changes to local state
  useEffect(() => {
    if (!isComposing) {
      setLocalLabel(field.label);
    }
  }, [field.label, isComposing]);

  // Sync external field.enumOptions changes to local state
  // Only sync when composingOptionIndex is null to avoid interrupting user input
  useEffect(() => {
    if (composingOptionIndex === null) {
      setLocalOptions(field.enumOptions ?? []);
    }
  }, [field.enumOptions]); // Remove composingOptionIndex from deps to avoid sync on composition end

  // Listen for reset event from parent (when user clicks add button or auto-save adds field)
  useEffect(() => {
    const handleReset = (event: Event) => {
      const customEvent = event as CustomEvent;
      const eventSectionId = customEvent.detail?.sectionId;
      
      // Only reset if the event is for this specific section (or no section specified for backwards compatibility)
      if (!eventSectionId || eventSectionId === sectionId) {
        // Reset form to initial empty state
        setField({
          label: '',
          dataType: undefined,
          required: false,
          enumOptions: [],
          referenceLibraries: [],
        });
        setLocalLabel('');
        setDataTypeSelected(false);
        setShowSlashMenu(false);
        setShowConfigMenu(false);
      }
    };

    window.addEventListener('fieldform-reset', handleReset as EventListener);
    return () => {
      window.removeEventListener('fieldform-reset', handleReset as EventListener);
    };
  }, [sectionId]);

  // Notify parent of field changes (always notify, even if empty)
  useEffect(() => {
    if (onFieldChangeRef.current) {
      // Always pass the field, even if completely empty
      onFieldChangeRef.current(field);
    } else {
      console.warn('[FieldForm] onFieldChangeRef.current is undefined! Cannot notify parent.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  useEffect(() => {
    if (initialField) {
      setField(initialField);
      setLocalLabel(initialField.label || '');
      setDataTypeSelected(true);
    } else {
      // Reset form when initialField becomes null/undefined
      setField({
        label: '',
        dataType: undefined,
        required: false,
        enumOptions: [],
        referenceLibraries: [],
      });
      setLocalLabel('');
      setDataTypeSelected(false);
    }
  }, [initialField]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        dataTypeInputRef.current &&
        !dataTypeInputRef.current.input?.contains(event.target as Node)
      ) {
        setShowSlashMenu(false);
      }
    };

    if (showSlashMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSlashMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Check if click is on Ant Design Select dropdown
      const isSelectDropdown = (target as Element).closest?.('.ant-select-dropdown');
      if (isSelectDropdown) {
        return; // Don't close if clicking on Select dropdown
      }
      
      if (
        configMenuRef.current &&
        !configMenuRef.current.contains(target) &&
        configButtonRef.current &&
        !configButtonRef.current.contains(target)
      ) {
        // Before closing, save any pending changes to enum options
        // This ensures changes are saved even if user clicks outside without blurring the input
        if (field.dataType === 'enum') {
          setField((p) => ({
            ...p,
            enumOptions: localOptions,
          }));
          // Trigger blur callback to notify parent
          if (onFieldBlur) {
            onFieldBlur();
          }
        }
        setShowConfigMenu(false);
      }
    };

    if (showConfigMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showConfigMenu, field.dataType, localOptions, onFieldBlur]);

  // Load libraries when config menu is opened for reference type
  useEffect(() => {
    if (showConfigMenu && field.dataType === 'reference' && projectId) {
      setLoadingLibraries(true);
      
      const loadLibrariesWithFolders = async () => {
        try {
          const libs = await listLibraries(supabase, projectId);
          // Filter out current library
          const filteredLibs = libs.filter(lib => lib.id !== currentLibraryId);
          
          // Load folder names for libraries that have folders
          const libsWithFolders = await Promise.all(
            filteredLibs.map(async (lib) => {
              if (lib.folder_id) {
                const { data: folder } = await supabase
                  .from('folders')
                  .select('name')
                  .eq('id', lib.folder_id)
                  .single();
                return { ...lib, folder_name: folder?.name };
              }
              return lib;
            })
          );
          
          setLibraries(libsWithFolders);
        } catch (error) {
          console.error('Failed to load libraries:', error);
          setLibraries([]);
        } finally {
          setLoadingLibraries(false);
        }
      };
      
      loadLibrariesWithFolders();
    }
  }, [showConfigMenu, field.dataType, projectId, currentLibraryId, supabase]);

  const handleSubmit = () => {
    // Allow adding empty field rows (user can fill them later)
    // Validation will happen at section save time
    const payload = {
      ...field,
      enumOptions:
        field.dataType === 'enum'
          ? (field.enumOptions || []).filter((v) => v.trim().length > 0)
          : undefined,
      referenceLibraries:
        field.dataType === 'reference'
          ? (field.referenceLibraries || []).filter((v) => v && v.trim().length > 0)
          : undefined,
    };
    onSubmit(payload);
    if (!initialField) {
      // Reset form only if not editing
      setField({
        label: '',
        dataType: undefined,
        required: false,
        enumOptions: [],
        referenceLibraries: [],
      });
      setDataTypeSelected(false); // Reset dataType selection state
    }
    setShowSlashMenu(false);
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalLabel(value);
    
    // Only update field if not composing (to avoid interrupting IME input)
    if (!isComposing) {
      setField((p) => ({ ...p, label: value }));
    }
  };
  
  const handleCompositionStart = () => {
    setIsComposing(true);
  };
  
  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false);
    // Update field with the final composed value
    const value = (e.target as HTMLInputElement).value;
    setLocalLabel(value);
    setField((p) => ({ ...p, label: value }));
  };

  const handleSlashMenuSelect = (dataType: FieldType) => {
    setField((p) => ({
      ...p,
      dataType,
      enumOptions: dataType === 'enum' ? p.enumOptions ?? [] : undefined,
    }));
    setDataTypeSelected(true);
    setShowSlashMenu(false);
    // Focus back on data type input
    setTimeout(() => {
      if (dataTypeInputRef.current) {
        dataTypeInputRef.current.focus();
      }
    }, 0);
    
    // Trigger blur callback when data type is selected
    if (onFieldBlur) {
      onFieldBlur();
    }
  };

  const handleDataTypeFocus = () => {
    setShowSlashMenu(true);
  };

  const getDataTypeLabel = (value: FieldType) => {
    const option = FIELD_TYPE_OPTIONS.find((opt) => opt.value === value);
    return option?.label ?? '';
  };

  // Memoize prefix to prevent DOM structure changes when Input is focused
  // Always render a container to maintain stable DOM structure
  const dataTypeInputPrefix = useMemo(() => {
    if (dataTypeSelected && field.dataType) {
      return (
        <Image src={getFieldTypeIcon(field.dataType)}
          alt={field.dataType}
          width={16} height={16} className="icon-16"
        />
      );
    }
    // Return empty span to maintain DOM structure stability
    return <span style={{ display: 'inline-block', width: 16, height: 16 }} />;
  }, [dataTypeSelected, field.dataType]);

  const handleAddOption = () => {
    const currentOptions = field.enumOptions ?? [];
    setField((p) => ({
      ...p,
      enumOptions: [...currentOptions, ''],
    }));
  };

  const handleOptionChange = (index: number, value: string) => {
    // Always update localOptions to capture all input changes, including during IME composition
    // This ensures we don't lose user input during Chinese/Japanese/Korean input
    const newOptions = [...localOptions];
    newOptions[index] = value;
    setLocalOptions(newOptions);
  };
  
  const handleOptionBlur = () => {
    // Update parent with the current options when input loses focus
    setField((p) => ({
      ...p,
      enumOptions: localOptions,
    }));
    
    // Trigger blur callback when enum option loses focus
    if (onFieldBlur) {
      onFieldBlur();
    }
  };

  const handleOptionCompositionStart = (index: number) => {
    setComposingOptionIndex(index);
  };

  const handleOptionCompositionEnd = (index: number) => {
    setComposingOptionIndex(null);
    // No need to update localOptions here since onChange already handles it
    // Just clear the composing flag
  };

  const handleRemoveOption = (index: number) => {
    const newOptions = [...(field.enumOptions ?? [])];
    newOptions.splice(index, 1);
    setField((p) => ({
      ...p,
      enumOptions: newOptions,
    }));
  };

  const handleReferenceLibrariesChange = (selectedLibraryIds: string[]) => {
    setField((prevField) => {
      const newField = {
        ...prevField,
        referenceLibraries: selectedLibraryIds,
      };
      
      // Immediately notify parent with updated field to ensure data is saved
      // This is critical for reference fields where user might select libraries
      // and then immediately click save without triggering other field changes
      if (onFieldChangeRef.current && newField.label.trim()) {
        onFieldChangeRef.current(newField);
      }
      
      return newField;
    });
    
    // Trigger blur callback when reference libraries change
    if (onFieldBlur) {
      onFieldBlur();
    }
  };

  const isEditing = !!initialField;

  return (
    <div 
      className={`${styles.addFieldContainer} ${disabled ? styles.disabled : ''}`}
      data-testid="field-form"
    >
      <button 
        className={styles.addButton} 
        onClick={handleSubmit}
        disabled={disabled}
        title="Add property"
      >
        <Image src={predefineLabelAddIcon} alt="Add" width={20} height={20} className="icon-20" />
      </button>
      <div className={styles.dragHandle}>
        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} className="icon-16" />
      </div>
      <div className={styles.inputWrapper}>
        <Input
          ref={inputRef}
          placeholder="Type label for property..."
          value={localLabel}
          onChange={handleLabelChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onBlur={() => {
            if (onFieldBlur) {
              onFieldBlur();
            }
          }}
          className={styles.labelInput}
          onPressEnter={handleSubmit}
          disabled={disabled}
          status={validationError?.labelInvalid ? 'error' : undefined}
          data-testid="field-form-label-input"
        />
      </div>
      <div className={styles.dataTypeDisplay}>
        <Input
          ref={dataTypeInputRef}
          placeholder="Click to select"
          value={dataTypeSelected && field.dataType ? getDataTypeLabel(field.dataType) : ''}
          readOnly
          onFocus={handleDataTypeFocus}
          className={styles.dataTypeInput}
          disabled={disabled}
          status={validationError?.dataTypeInvalid ? 'error' : undefined}
          prefix={dataTypeInputPrefix}
        />
        {showSlashMenu && (
          <div ref={slashMenuRef} className={styles.slashMenu}>
            {FIELD_TYPE_OPTIONS.map((option) => (
              <div
                key={option.value}
                className={styles.slashMenuItem}
                onClick={() => handleSlashMenuSelect(option.value as FieldType)}
              >
                <Image src={getFieldTypeIcon(option.value as FieldType)}
                  alt={option.value}
                  width={16} height={16} className="icon-16"
                  style={{ marginRight: 8 }}
                />
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.fieldActions}>
        {(field.dataType === 'reference' || field.dataType === 'enum') && (
          <div className={styles.configButtonWrapper}>
            <button 
              ref={configButtonRef}
              className={`${styles.configButton} ${showConfigMenu ? styles.configButtonActive : ''}`}
              onClick={() => {
                if (disabled) return;
                // If closing the menu, save any pending enum option changes first
                if (showConfigMenu && field.dataType === 'enum') {
                  setField((p) => ({
                    ...p,
                    enumOptions: localOptions,
                  }));
                  // Trigger blur callback to notify parent
                  if (onFieldBlur) {
                    onFieldBlur();
                  }
                }
                setShowConfigMenu(!showConfigMenu);
              }}
              disabled={disabled}
              title="Configure options"
            >
              <Image src={predefineLabelConfigIcon} 
                alt="Config" 
                width={20} height={20} className="icon-20" 
              />
            </button>
            {showConfigMenu && field.dataType === 'enum' && (
              <div ref={configMenuRef} className={styles.configMenu}>
                <div className={styles.configMenuHeader}>
                  <span>CONFIGURE PROPERTY</span>
                </div>
                <div className={styles.optionsList}>
                  <div className={styles.optionsListHeaderContainer}>
                    <span className={styles.optionsListHeader}>Predefine options</span>
                    <button 
                      className={styles.addOptionButton}
                      onClick={handleAddOption}
                      title="Add option"
                    >
                      +
                    </button>
                  </div>
                  <div className={styles.optionsListItemsContainer}>  
                    {localOptions.map((option, index) => (
                      <div key={index} className={styles.optionItem}>
                        <Input
                          value={option}
                          onChange={(e) => handleOptionChange(index, e.target.value)}
                          onBlur={handleOptionBlur}
                          onCompositionStart={() => handleOptionCompositionStart(index)}
                          onCompositionEnd={() => handleOptionCompositionEnd(index)}
                          placeholder="enter new option here"
                          className={styles.optionInput}
                        />
                        <button
                          className={styles.removeOptionButton}
                          onClick={() => handleRemoveOption(index)}
                          title="Remove option"
                        >
                          −
                        </button>
                      </div>
                    ))}
                  </div>
                  {localOptions.length === 0 && (
                    <div className={styles.emptyOptionsMessage}>
                      Click + to add options
                    </div>
                  )}
                </div>
              </div>
            )}
            {showConfigMenu && field.dataType === 'reference' && (
              <div ref={configMenuRef} className={styles.configMenu}>
                <div className={styles.configMenuHeader}>
                  <span>ADD USER DEFINED REFERENCE</span>
                </div>
                <div className={styles.referenceConfig}>
                  <span className={styles.referenceConfigHeader}>Choose library</span>
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    placeholder="Select libraries to reference"
                    value={loadingLibraries ? [] : (field.referenceLibraries ?? [])}
                    onChange={handleReferenceLibrariesChange}
                    loading={loadingLibraries}
                    options={libraries.map((lib) => ({
                      label: (lib as any).folder_name ? `${lib.name} (${(lib as any).folder_name})` : lib.name,
                      value: lib.id,
                    }))}
                    maxTagCount="responsive"
                    className={styles.referenceSelect}
                  />
                  {(field.referenceLibraries ?? []).length === 0 && !loadingLibraries && (
                    <div className={styles.emptyOptionsMessage}>
                      Select libraries that this field can reference
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className={styles.actions}>
        {isEditing && onCancel && (
          <Button onClick={onCancel} className={styles.cancelButton} disabled={disabled}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

