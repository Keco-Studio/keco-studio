'use client';
import { useState, useEffect, useRef } from 'react';
import { Input, Button, Select } from 'antd';
import Image from 'next/image';
import type { FieldConfig, FieldType } from '../types';
import { FIELD_TYPE_OPTIONS, getFieldTypeIcon } from '../utils';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import predefineLabelConfigIcon from '@/app/assets/images/predefineLabelConfigIcon.svg';
import { useSupabase } from '@/lib/SupabaseContext';
import { useParams } from 'next/navigation';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import styles from './FieldForm.module.css';

interface FieldFormProps {
  initialField?: Omit<FieldConfig, 'id'>;
  onSubmit: (field: Omit<FieldConfig, 'id'>) => void;
  onCancel?: () => void;
  disabled?: boolean;
  onFieldChange?: (field: Omit<FieldConfig, 'id'> | null) => void;
}

export function FieldForm({ initialField, onSubmit, onCancel, disabled, onFieldChange }: FieldFormProps) {
  const supabase = useSupabase();
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const currentLibraryId = params?.libraryId as string | undefined;
  
  const [field, setField] = useState<Omit<FieldConfig, 'id'>>(
    initialField || {
      label: '',
      dataType: 'string',
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
  const inputRef = useRef<any>(null);
  const dataTypeInputRef = useRef<any>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const configMenuRef = useRef<HTMLDivElement>(null);
  const configButtonRef = useRef<HTMLButtonElement>(null);

  // Notify parent of field changes
  useEffect(() => {
    if (onFieldChange) {
      // Only pass field if it has content (label is not empty)
      if (field.label.trim()) {
        onFieldChange(field);
      } else {
        onFieldChange(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  useEffect(() => {
    if (initialField) {
      setField(initialField);
      setDataTypeSelected(true);
    } else {
      // Reset form when initialField becomes null/undefined
      setField({
        label: '',
        dataType: 'string',
        required: false,
        enumOptions: [],
        referenceLibraries: [],
      });
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
        setShowConfigMenu(false);
      }
    };

    if (showConfigMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showConfigMenu]);

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
        dataType: 'string',
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
  };

  const handleDataTypeFocus = () => {
    setShowSlashMenu(true);
  };

  const getDataTypeLabel = (value: FieldType) => {
    const option = FIELD_TYPE_OPTIONS.find((opt) => opt.value === value);
    return option?.label ?? '';
  };

  const handleAddOption = () => {
    const currentOptions = field.enumOptions ?? [];
    setField((p) => ({
      ...p,
      enumOptions: [...currentOptions, ''],
    }));
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...(field.enumOptions ?? [])];
    newOptions[index] = value;
    setField((p) => ({
      ...p,
      enumOptions: newOptions,
    }));
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
    setField((p) => ({
      ...p,
      referenceLibraries: selectedLibraryIds,
    }));
  };

  const isEditing = !!initialField;

  return (
    <div className={`${styles.addFieldContainer} ${disabled ? styles.disabled : ''}`}>
      <button 
        className={styles.addButton} 
        onClick={handleSubmit}
        disabled={!field.label.trim() || disabled}
        title="Add property"
      >
        <Image src={predefineLabelAddIcon} alt="Add" width={20} height={20} />
      </button>
      <div className={styles.dragHandle}>
        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
      </div>
      <div className={styles.inputWrapper}>
        <Input
          ref={inputRef}
          placeholder="Type label for property..."
          value={field.label}
          onChange={handleLabelChange}
          className={styles.labelInput}
          onPressEnter={handleSubmit}
          disabled={disabled}
        />
      </div>
      <div className={styles.dataTypeDisplay}>
        <Input
          ref={dataTypeInputRef}
          placeholder="Click to Select"
          value={dataTypeSelected ? getDataTypeLabel(field.dataType) : ''}
          readOnly
          onFocus={handleDataTypeFocus}
          className={styles.dataTypeInput}
          disabled={disabled}
          prefix={
            dataTypeSelected ? (
              <Image
                src={getFieldTypeIcon(field.dataType)}
                alt={field.dataType}
                width={16}
                height={16}
              />
            ) : (
              <span style={{ width: 16, height: 16, display: 'inline-block' }} />
            )
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
                <Image
                  src={getFieldTypeIcon(option.value as FieldType)}
                  alt={option.value}
                  width={16}
                  height={16}
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
              className={styles.configButton}
              onClick={() => !disabled && setShowConfigMenu(!showConfigMenu)}
              disabled={disabled}
              title="Configure options"
            >
              <Image src={predefineLabelConfigIcon} alt="Config" width={20} height={20} />
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
                    {(field.enumOptions ?? []).map((option, index) => (
                      <div key={index} className={styles.optionItem}>
                        <Input
                          value={option}
                          onChange={(e) => handleOptionChange(index, e.target.value)}
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
                  {(field.enumOptions ?? []).length === 0 && (
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
                    value={field.referenceLibraries ?? []}
                    onChange={handleReferenceLibrariesChange}
                    loading={loadingLibraries}
                    options={libraries.map((lib) => ({
                      label: (lib as any).folder_name ? `${lib.name} (${(lib as any).folder_name})` : lib.name,
                      value: lib.id,
                    }))}
                    maxTagCount="responsive"
                  />
                  {(field.referenceLibraries ?? []).length === 0 && (
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

