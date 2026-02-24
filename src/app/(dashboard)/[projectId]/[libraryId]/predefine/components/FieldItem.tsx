'use client';
import { useRef, useState, useEffect } from 'react';
import { Button, Input, Select } from 'antd';
import Image from 'next/image';
import type { FieldConfig, FieldType } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/types';
import { FIELD_TYPE_OPTIONS, getFieldTypeIcon } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import predefineLabelDelIcon from '@/assets/images/predefineLabelDelIcon.svg';
import predefineLabelConfigIcon from '@/assets/images/predefineLabelConfigIcon.svg';
import predefineDragIcon from '@/assets/images/predefineDragIcon.svg';
import predefineTypeSwitchIcon from '@/assets/images/predefineTypeSwitchIcon.svg';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams } from 'next/navigation';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './FieldItem.module.css';

interface FieldItemProps {
  field: FieldConfig;
  /** Sync changes to parent when editing field inline */
  onChangeField: (fieldId: string, data: Omit<FieldConfig, 'id'>) => void;
  onDelete: (fieldId: string) => void;
  isFirst?: boolean;
  disabled?: boolean;
  isMandatoryNameField?: boolean;
  isDraggable?: boolean;
  hasValidationError?: boolean;
}

export function FieldItem({
  field,
  onChangeField,
  onDelete,
  isFirst = false,
  disabled,
  isMandatoryNameField = false,
  isDraggable = false,
  hasValidationError = false,
}: FieldItemProps) {
  const supabase = useSupabase();
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const currentLibraryId = params?.libraryId as string | undefined;
  
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  
  // Track IME composition state to handle Chinese/Japanese/Korean input properly
  const [isComposing, setIsComposing] = useState(false);
  const [localLabel, setLocalLabel] = useState(field.label);
  const [isEditing, setIsEditing] = useState(false);
  const [composingOptionIndex, setComposingOptionIndex] = useState<number | null>(null);
  const [localOptions, setLocalOptions] = useState(field.enumOptions ?? []);
  
  const dataTypeInputRef = useRef<any>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const configMenuRef = useRef<HTMLDivElement>(null);
  const configButtonRef = useRef<HTMLButtonElement>(null);
  
  // Set up sortable behavior for drag-and-drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: field.id,
    disabled: !isDraggable,
  });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Sync external field.label changes to local state
  // Only update if user is not actively editing to avoid overwriting their input
  useEffect(() => {
    if (!isComposing && !isEditing) {
      setLocalLabel(field.label);
    }
  }, [field.label, isComposing, isEditing]);

  // Sync external field.enumOptions changes to local state
  // Only sync when composingOptionIndex is null to avoid interrupting user input
  useEffect(() => {
    if (composingOptionIndex === null) {
      setLocalOptions(field.enumOptions ?? []);
    }
  }, [field.enumOptions]); // Remove composingOptionIndex from deps to avoid sync on composition end

  const getDataTypeLabel = (value: FieldType) => {
    const option = FIELD_TYPE_OPTIONS.find((opt) => opt.value === value);
    return option?.label ?? '';
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalLabel(newValue);
    setIsEditing(true);
  };
  
  const handleLabelFocus = () => {
    setIsEditing(true);
  };
  
  const handleLabelBlur = () => {
    setIsEditing(false);
    // Only update parent on blur (not during typing)
    const { id, ...rest } = field;
    onChangeField(field.id, {
      ...rest,
      label: localLabel,
    });
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false);
    // Update local state with the final composed value
    const newValue = (e.target as HTMLInputElement).value;
    setLocalLabel(newValue);
  };

  const handleSlashMenuSelect = (dataType: FieldType) => {
    const { id, ...rest } = field;
    onChangeField(field.id, {
      ...rest,
      dataType,
      enumOptions: dataType === 'enum' ? rest.enumOptions ?? [] : undefined,
    });
    setShowSlashMenu(false);
    setTimeout(() => {
      if (dataTypeInputRef.current) {
        dataTypeInputRef.current.focus();
      }
    }, 0);
  };

  const handleDataTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '/') {
      e.preventDefault();
      setShowSlashMenu(true);
    }
  };

  const handleAddOption = () => {
    const { id, ...rest } = field;
    const currentOptions = rest.enumOptions ?? [];
    onChangeField(field.id, {
      ...rest,
      enumOptions: [...currentOptions, ''],
    });
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
    const { id, ...rest } = field;
    onChangeField(field.id, {
      ...rest,
      enumOptions: localOptions,
    });
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
    const { id, ...rest } = field;
    const newOptions = [...(rest.enumOptions ?? [])];
    newOptions.splice(index, 1);
    onChangeField(field.id, {
      ...rest,
      enumOptions: newOptions,
    });
  };

  const handleReferenceLibrariesChange = (selectedLibraryIds: string[]) => {
    const { id, ...rest } = field;
    onChangeField(field.id, {
      ...rest,
      referenceLibraries: selectedLibraryIds,
    });
  };

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
          const { id, ...rest } = field;
          onChangeField(field.id, {
            ...rest,
            enumOptions: localOptions,
          });
        }
        setShowConfigMenu(false);
      }
    };

    if (showConfigMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showConfigMenu, field, localOptions, onChangeField]);

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

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className={`${styles.fieldItem} ${disabled ? styles.disabled : ''}`}
      data-testid="field-item"
    >
      <div 
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
        style={{ cursor: isDraggable ? 'grab' : 'default' }}
        onMouseDown={(e) => {
          // Prevent text selection when starting to drag
          // This works alongside dnd-kit's listeners
          if (isDraggable) {
            e.preventDefault();
          }
        }}
      >
        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} className="icon-16" draggable={false} />
      </div>
      <div className={styles.fieldInfo}>
        <div className={styles.inputWrapper}>
          <Input
            value={localLabel}
            placeholder="Type label for property..."
            className={styles.labelInput}
            onChange={handleLabelChange}
            onFocus={handleLabelFocus}
            onBlur={handleLabelBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            disabled={disabled}
            status={hasValidationError && (!field.label || !field.label.trim()) ? 'error' : undefined}
          />
        </div>
        <div className={styles.dataTypeDisplay}>
          <Input
            ref={dataTypeInputRef}
            placeholder="Click to select"
            value={field.dataType ? getDataTypeLabel(field.dataType as FieldType) : ''}
            readOnly
            onKeyDown={handleDataTypeKeyDown}
            onClick={() => {
              if (!disabled) {
                setShowSlashMenu(true);
              }
            }}
            onFocus={() => {
              if (!disabled) {
                setShowSlashMenu(true);
              }
            }}
            className={styles.dataTypeInput}
            disabled={disabled}
            status={hasValidationError && !field.dataType ? 'error' : undefined}
            data-testid="field-datatype-input"
            prefix={
              field.dataType ? (
                <Image src={getFieldTypeIcon(field.dataType)}
                  alt={field.dataType}
                  width={16} height={16} className="icon-16"
                />
              ) : undefined
            }
            suffix={
              <button
                type="button"
                className={styles.typeSwitchButton}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) {
                    setShowSlashMenu(true);
                  }
                }}
                disabled={disabled}
                title="Choose type"
              >
                <Image src={predefineTypeSwitchIcon}
                  alt="Switch type"
                  width={16} height={16} className="icon-16"
                />
              </button>
            }
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
        {field.required && <span className={styles.requiredMark}>*</span>}
      </div>
      <div className={styles.fieldActions}>
        {/* Only show configure icon for Reference and Option (enum) data types */}
        {(field.dataType === 'reference' || field.dataType === 'enum') && (
          <div className={styles.configButtonWrapper}>
            <button 
              ref={configButtonRef}
              className={`${styles.configButton} ${showConfigMenu ? styles.configButtonActive : ''}`}
              onClick={() => {
                if (disabled) return;
                // If closing the menu, save any pending enum option changes first
                if (showConfigMenu && field.dataType === 'enum') {
                  const { id, ...rest } = field;
                  onChangeField(field.id, {
                    ...rest,
                    enumOptions: localOptions,
                  });
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
        <Button
          type="text"
          size="small"
          icon={<Image src={predefineLabelDelIcon} alt="Delete" width={20} height={20} className="icon-20" />}
          onClick={() => onDelete(field.id)}
          className={styles.deleteButton}
          title="Delete property"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
