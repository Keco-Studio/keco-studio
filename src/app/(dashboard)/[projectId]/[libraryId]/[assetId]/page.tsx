'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ConfigProvider, Tabs, Switch, Tooltip } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import { useLibraryData } from '@/lib/contexts/LibraryDataContext';
import { getLibrary, Library } from '@/lib/services/libraryService';
import { getFieldTypeIcon } from '../predefine/utils';
import styles from './page.module.css';
import Image from 'next/image';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import predefineLabelConfigIcon from '@/app/assets/images/predefineLabelConfigIcon.svg';
import noassetIcon1 from '@/app/assets/images/NoassetIcon1.svg';
import noassetIcon2 from '@/app/assets/images/NoassetIcon2.svg';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { AssetReferenceSelector } from '@/components/asset/AssetReferenceSelector';
import { FieldPresenceAvatars } from '@/components/collaboration/FieldPresenceAvatars';
import type { PresenceState } from '@/lib/types/collaboration';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import { ConnectionStatusIndicator } from '@/components/collaboration/ConnectionStatusIndicator';
import { AssetHeader } from '@/components/asset/AssetHeader';
import type { CollaboratorRole } from '@/lib/types/collaboration';

type FieldDef = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  data_type: 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date' | 'image' | 'file' | 'reference';
  enum_options: string[] | null;
  reference_libraries: string[] | null;
  required: boolean;
  order_index: number;
};

const DATA_TYPE_LABEL: Record<FieldDef['data_type'], string> = {
  string: 'String',
  int: 'Int',
  float: 'Float',
  boolean: 'Boolean',
  enum: 'Option',
  date: 'Date',
  image: 'Image',
  file: 'File',
  reference: 'Reference',
};

type AssetRow = {
  id: string;
  name: string;
  library_id: string;
};

type ValueRow = {
  field_id: string;
  value_json: any;
};

type AssetMode = 'view' | 'edit' | 'create';

export default function AssetPage() {
  const params = useParams();
  const supabase = useSupabase();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userProfile, isAuthenticated, isLoading: authLoading } = useAuth();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  const assetId = params.assetId as string;
  
  // Use unified data context
  const {
    getAsset,
    updateAssetField,
    updateAssetName,
    createAsset: createAssetFromContext,
    getUsersEditingField,
    setActiveField,
    connectionStatus,
    presenceUsers,
    yAssets,
    yDoc,
  } = useLibraryData();
  
  // Check if this is a new asset creation
  const isNewAsset = assetId === 'new';

  const [library, setLibrary] = useState<Library | null>(null);
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [fieldValidationErrors, setFieldValidationErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<AssetMode>(isNewAsset ? 'create' : 'edit');
  const [navigating, setNavigating] = useState(false);
  
  // Auto-save related state
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialValuesLoadedRef = useRef(false);
  const isSavingRef = useRef(false);
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);
  const previousValuesRef = useRef<Record<string, any>>({});
  const broadcastCellUpdateRef = useRef<((assetId: string, propertyKey: string, newValue: any, oldValue?: any) => Promise<void>) | null>(null);
  const assetRef = useRef<AssetRow | null>(null);
  
  // Realtime collaboration state (field highlighting)
  const [realtimeEditedFields, setRealtimeEditedFields] = useState<Map<string, { value: any; timestamp: number }>>(new Map());
  
  // User role state (for permission control)
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);

  // Presence tracking state
  const [currentFocusedField, setCurrentFocusedField] = useState<string | null>(null);
  
  // Subscribe to asset changes from context (for realtime updates)
  // Use Yjs observeDeep to catch nested Y.Map changes
  useEffect(() => {
    if (isNewAsset || !assetId) return;
    
    const yAsset = yAssets.get(assetId);
    if (!yAsset) return;
    
    
    // Observe changes to the Yjs asset (including nested Y.Map changes)
    const observer = () => {
      
      const name = yAsset.get('name');
      const yPropertyValues = yAsset.get('propertyValues');
      
      // Convert Y.Map to plain object
      const propertyValues: Record<string, any> = {};
      if (yPropertyValues && typeof yPropertyValues.forEach === 'function') {
        // It's a Y.Map
        yPropertyValues.forEach((value: any, key: string) => {
          propertyValues[key] = value;
        });
      } else if (yPropertyValues && typeof yPropertyValues === 'object') {
        // Fallback for plain objects (shouldn't happen with new structure)
        Object.assign(propertyValues, yPropertyValues);
      }
      
      
      // Update asset name (only if not in view mode)
      if (mode !== 'view') {
        setAsset(prev => {
          if (prev && prev.name !== name) {
            return { ...prev, name };
          }
          return prev;
        });
      }
      
      // Update property values (selectively - skip currently focused field)
      setValues(prev => {
        const newValues = { ...prev };
        let hasChanges = false;
        
        Object.keys(propertyValues).forEach(fieldId => {
          // Skip the field user is currently editing to avoid overwriting their input
          if (currentFocusedField === fieldId) {
            return;
          }
          
          // Update all other fields
          if (JSON.stringify(prev[fieldId]) !== JSON.stringify(propertyValues[fieldId])) {
            newValues[fieldId] = propertyValues[fieldId];
            hasChanges = true;
          }
        });
        
        if (hasChanges) {
        }
        
        return hasChanges ? newValues : prev;
      });
    };
    
    // Use observeDeep to catch nested Y.Map changes
    yAsset.observeDeep(observer);
    
    return () => {
      yAsset.unobserveDeep(observer);
    };
  }, [isNewAsset, assetId, yAssets, mode, currentFocusedField]);

  // Presence tracking is now handled by LibraryDataContext
  // getUsersEditingField and setActiveField are available from context

  // Keep assetRef updated (to avoid recreating callbacks when asset changes)
  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);

  // No longer need separate realtime subscription - using LibraryDataContext

  // Set presence when entering/leaving the asset page
  // Presence will be updated to specific fields by handleFieldFocus when editing
  // and restored to viewing state by handleFieldBlur when done editing
  // Use ref to avoid re-running effect when setActiveField reference changes
  const setActiveFieldRef = useRef(setActiveField);
  
  useEffect(() => {
    setActiveFieldRef.current = setActiveField;
  }, [setActiveField]);
  
  useEffect(() => {
    // Set presence immediately when entering asset page
    if (!isNewAsset && assetId) {
      setActiveFieldRef.current(assetId, '__viewing__');
    }
    
    // Cleanup: clear presence when leaving the asset page or switching assets
    return () => {
      if (!isNewAsset && assetId) {
        setActiveFieldRef.current(null, null);
      }
    };
  }, [assetId, isNewAsset]); // 移除 setActiveField 依赖

  const sections = useMemo(() => {
    const map: Record<string, FieldDef[]> = {};
    fieldDefs.forEach((f) => {
      if (!map[f.section]) map[f.section] = [];
      map[f.section].push(f);
    });
    Object.keys(map).forEach((k) => (map[k] = map[k].slice().sort((a, b) => a.order_index - b.order_index)));
    return map;
  }, [fieldDefs]);

  // Find the name field (for both new and existing assets)
  const nameField = useMemo(() => {
    if (fieldDefs.length === 0) return null;
    // First try to find a field with label 'name' and type 'string'
    const nameFieldDef = fieldDefs.find(f => f.label === 'name' && f.data_type === 'string');
    if (nameFieldDef) return nameFieldDef;
    
    // Fallback: for new assets, use the first field of the first section
    if (isNewAsset) {
      const firstSectionKey = Object.keys(sections)[0];
      const firstSection = sections[firstSectionKey];
      if (!firstSection || firstSection.length === 0) return null;
      const firstField = firstSection[0];
      if (firstField.label === 'name' && firstField.data_type === 'string') {
        return firstField;
      }
    }
    return null;
  }, [isNewAsset, fieldDefs, sections]);

  // Get asset name (prioritize edited value, then asset name)
  const assetName = useMemo(() => {
    // If we have a name field and its value is being edited, use that
    if (nameField && values[nameField.id] !== undefined && values[nameField.id] !== null) {
      const editedValue = String(values[nameField.id]).trim();
      if (editedValue !== '') {
        return editedValue;
      }
    }
    // Otherwise, use the asset's name (for existing assets)
    return asset?.name || '';
  }, [nameField, values, asset]);

  // Fetch user role
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!projectId) {
        setUserRole(null);
        return;
      }
      
      try {
        // Get session for authorization
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setUserRole(null);
          return;
        }
        
        // Call API to get user role
        const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        
        if (roleResponse.ok) {
          const roleResult = await roleResponse.json();
          setUserRole(roleResult.role || null);
        } else {
          setUserRole(null);
        }
      } catch (error) {
        console.error('[AssetPage] Error fetching user role:', error);
        setUserRole(null);
      }
    };
    
    fetchUserRole();
  }, [projectId, supabase]);

  useEffect(() => {
    const load = async () => {
      if (!libraryId) return;
      setLoading(true);
      setError(null);
      try {
        if (isNewAsset) {
          // Load library and field definitions only
          const [lib, defsRes] = await Promise.all([
            getLibrary(supabase, libraryId, projectId),
            supabase
              .from('library_field_definitions')
              .select('*')
              .eq('library_id', libraryId)
              .order('section', { ascending: true })
              .order('order_index', { ascending: true }),
          ]);

          if (!lib) {
            setError('Library not found');
            return;
          }

          if (defsRes.error) {
            throw defsRes.error;
          }

          setLibrary(lib);
          // Migrate legacy 'media' type to 'image' for backward compatibility
          const defs = (defsRes.data as FieldDef[]) || [];
          const migratedDefs = defs.map(def => ({
            ...def,
            data_type: def.data_type === 'media' as any ? 'image' : def.data_type
          }));
          setFieldDefs(migratedDefs);
        } else {
          // Load field definitions, get asset from context
          const { data: defs, error: defErr } = await supabase
            .from('library_field_definitions')
            .select('*')
            .eq('library_id', libraryId)
            .order('section', { ascending: true })
            .order('order_index', { ascending: true });

          if (defErr) throw defErr;

          // Migrate legacy 'media' type to 'image' for backward compatibility
          const fieldDefs = (defs as FieldDef[]) || [];
          const migratedDefs = fieldDefs.map(def => ({
            ...def,
            data_type: def.data_type === 'media' as any ? 'image' : def.data_type
          }));
          setFieldDefs(migratedDefs);
          
          // Get asset from context
          const assetFromContext = getAsset(assetId);
          if (!assetFromContext) {
            throw new Error('Asset not found');
          }
          
          // Set asset and values from context
          setAsset({
            id: assetFromContext.id,
            name: assetFromContext.name,
            library_id: assetFromContext.libraryId,
          } as AssetRow);
          
          setValues(assetFromContext.propertyValues);
          previousValuesRef.current = { ...assetFromContext.propertyValues };
        }
      } catch (e: any) {
        setError(e?.message || (isNewAsset ? 'Failed to load library' : 'Failed to load asset'));
      } finally {
        setLoading(false);
      }
    };
    
    load();
  }, [assetId, libraryId, projectId, supabase, isNewAsset, getAsset]);

  // Notify TopBar about current mode
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asset-page-mode', {
          detail: { mode, isNewAsset },
        })
      );
    }
  }, [mode, isNewAsset]);

  // Listen for asset updates to refresh asset name
  useEffect(() => {
    if (isNewAsset) return; // New assets don't need to listen for updates
    
    const handleAssetUpdated = async (event: Event) => {
      const customEvent = event as CustomEvent<{ assetId: string; libraryId?: string; skipLocalRefresh?: boolean }>;
      // Only refresh if the event is for this asset and skipLocalRefresh is not set
      if (customEvent.detail?.assetId === assetId && !customEvent.detail?.skipLocalRefresh) {
        try {
          // Use a small delay to ensure database transaction is committed
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Refresh asset data - query directly from database
          const { data: assetRow, error: assetErr } = await supabase
            .from('library_assets')
            .select('id, name, library_id')
            .eq('id', assetId)
            .single();
          
          if (!assetErr && assetRow) {
            setAsset(assetRow as AssetRow);
            // If there's a name field, update its value too
            const nameFieldDef = fieldDefs.find(f => f.label === 'name' && f.data_type === 'string');
            if (nameFieldDef) {
              setValues(prev => ({ ...prev, [nameFieldDef.id]: assetRow.name }));
            }
          } else if (assetErr) {
            console.error('Error refreshing asset:', assetErr);
          }
        } catch (e: any) {
          console.error('Failed to refresh asset:', e);
        }
      }
    };

    window.addEventListener('assetUpdated', handleAssetUpdated as EventListener);

    return () => {
      window.removeEventListener('assetUpdated', handleAssetUpdated as EventListener);
    };
  }, [assetId, isNewAsset, supabase, fieldDefs]);

  // Set mode to 'view' for viewers
  useEffect(() => {
    if (!isNewAsset && userRole === 'viewer') {
      setMode('view');
    }
  }, [userRole, isNewAsset]);

  // Listen to top bar Viewing / Editing toggle (only for existing assets)
  useEffect(() => {
    if (isNewAsset) return; // New assets don't need mode toggle from TopBar
    
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ mode?: AssetMode }>;
      const nextMode = custom.detail?.mode;
      // Viewer cannot switch to edit mode
      if (userRole === 'viewer' && nextMode === 'edit') {
        return;
      }
      if (nextMode === 'view' || nextMode === 'edit') {
        setMode(nextMode);
        // Clear status messages when switching mode
        setSaveError(null);
        setSaveSuccess(null);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('asset-mode-change', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('asset-mode-change', handler as EventListener);
      }
    };
  }, [isNewAsset, userRole]);

  // Handle navigate to predefine page
  const handlePredefineClick = () => {
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  const handleValueChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  // Handle field focus for presence tracking
  const handleFieldFocus = useCallback((fieldId: string) => {
    setCurrentFocusedField(fieldId);
    if (asset) {
      setActiveField(asset.id, fieldId);
    }
  }, [setActiveField, asset]);

  // Handle field blur for presence tracking
  const handleFieldBlur = useCallback(() => {
    setCurrentFocusedField(null);
    if (asset && !isNewAsset) {
      // When blurring, set back to viewing state (not editing any field)
      setActiveField(asset.id, '__viewing__');
    } else {
      setActiveField(null, null);
    }
  }, [setActiveField, asset, isNewAsset]);

  // Get users editing a specific field (including current user if they're editing it)
  // More stable version to avoid flickering
  const getFieldEditingUsers = useCallback((fieldId: string) => {
    if (!asset) return [];
    let editingUsers = getUsersEditingField(asset.id, fieldId);
    
    // If current user is editing this field, ensure they're in the list
    // But be more conservative to avoid flickering
    if (currentFocusedField === fieldId && userProfile) {
      const hasCurrentUser = editingUsers.some(u => u.userId === userProfile.id);
      
      // Only add if truly missing (not just delayed)
      if (!hasCurrentUser) {
        // Use stable timestamp to avoid re-sorting on every render
        const currentUserPresence: PresenceState = {
          userId: userProfile.id,
          userName: userProfile.username || userProfile.full_name || userProfile.email,
          userEmail: userProfile.email,
          avatarColor: getUserAvatarColor(userProfile.id),
          activeCell: { assetId: asset.id, propertyKey: fieldId },
          cursorPosition: null,
          lastActivity: new Date().toISOString(),
          connectionStatus: 'online',
        };
        editingUsers.push(currentUserPresence);
        
        // Re-sort to ensure consistent ordering (first to arrive first)
        editingUsers.sort((a, b) => {
          return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
        });
      }
    }
    
    return editingUsers;
  }, [getUsersEditingField, asset, currentFocusedField, userProfile]);

  // Get the first user's color for border styling
  const getFirstUserColor = useCallback((users: any[]) => {
    if (users.length === 0) return null;
    return users[0].avatarColor;
  }, []);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(null);
    setFieldValidationErrors({});
    
    // Validate field types before saving
    const validationErrors: Record<string, string> = {};
    for (const f of fieldDefs) {
      const raw = values[f.id];
      if (raw === '' || raw === undefined || raw === null) {
        continue; // Empty values are allowed
      }
      
      if (f.data_type === 'int') {
        // Int type: must be a valid integer (no decimal point)
        const strValue = String(raw).trim();
        if (strValue !== '') {
          // Check if contains decimal point
          if (strValue.includes('.')) {
            validationErrors[f.id] = 'type mismatch';
          } else {
            // Check if valid integer
            const intValue = parseInt(strValue, 10);
            if (isNaN(intValue) || String(intValue) !== strValue.replace(/^-/, '')) {
              validationErrors[f.id] = 'type mismatch';
            }
          }
        }
      } else if (f.data_type === 'float') {
        // Float type: must contain a decimal point (cannot be pure integer)
        const strValue = String(raw).trim();
        if (strValue !== '' && strValue !== '-' && strValue !== '.') {
          if (!strValue.includes('.')) {
            validationErrors[f.id] = 'type mismatch';
          } else {
            // Check if valid float
            const floatValue = parseFloat(strValue);
            if (isNaN(floatValue)) {
              validationErrors[f.id] = 'type mismatch';
            }
          }
        }
      }
    }
    
    if (Object.keys(validationErrors).length > 0) {
      setFieldValidationErrors(validationErrors);
      setSaveError('Please fix type errors before saving');
      return;
    }
    
    if (isNewAsset) {
      // Create new asset using context
      const nameValue = assetName.trim() || 'Untitled';
      // No validation error - allow creating assets without name field

      setSaving(true);
      try {
        // Prepare property values
        const propertyValues: Record<string, any> = {};
        fieldDefs.forEach((f) => {
          const raw = values[f.id];
          let v: any = raw;
          if (f.data_type === 'int') {
            v = raw === '' || raw === undefined ? null : parseInt(raw, 10);
          } else if (f.data_type === 'float') {
            v = raw === '' || raw === undefined ? null : parseFloat(raw);
          } else if (f.data_type === 'boolean') {
            v = !!raw;
          } else if (f.data_type === 'date') {
            v = raw || null;
          } else if (f.data_type === 'enum') {
            v = (raw === '' || raw === undefined || raw === null) ? null : raw;
          } else if (f.data_type === 'image' || f.data_type === 'file' || f.data_type === 'reference') {
            v = raw || null;
          } else {
            v = raw ?? null;
          }
          propertyValues[f.id] = v;
        });

        // Create asset using context (handles database + Yjs + broadcast)
        const newAssetId = await createAssetFromContext(nameValue, propertyValues);

        setValues({});
        setNavigating(true);

        // Dispatch event to notify Sidebar to refresh assets
        window.dispatchEvent(new CustomEvent('assetCreated', {
          detail: { libraryId, assetId: newAssetId }
        }));

        // Navigate to edit page for further changes with a slight delay
        setTimeout(() => {
          router.push(`/${projectId}/${libraryId}/${newAssetId}`);
        }, 500);
      } catch (e: any) {
        setSaveError(e?.message || 'Failed to create asset');
      } finally {
        setSaving(false);
      }
    } else {
      // Update existing asset using context
      if (!asset) return;
      
      setSaving(true);
      try {
        // Find the name field and update asset name if changed
        const nameFieldDef = fieldDefs.find(f => f.label === 'name' && f.data_type === 'string');
        let newAssetName = asset.name;
        
        if (nameFieldDef) {
          const nameValue = values[nameFieldDef.id];
          if (nameValue !== undefined && nameValue !== null && String(nameValue).trim() !== '') {
            newAssetName = String(nameValue).trim();
          }
        }
        
        // Update asset name if it changed (using context)
        if (newAssetName !== asset.name) {
          await updateAssetName(asset.id, newAssetName);
          // Update local asset state
          setAsset({ ...asset, name: newAssetName });
        }
        
        // Update changed fields using context (handles database + Yjs + broadcast)
        for (const f of fieldDefs) {
          const raw = values[f.id];
          const previousValue = previousValuesRef.current[f.id];
          
          // Prepare value based on type
          let v: any = raw;
          if (f.data_type === 'int') {
            v = raw === '' || raw === undefined ? null : parseInt(raw, 10);
          } else if (f.data_type === 'float') {
            v = raw === '' || raw === undefined ? null : parseFloat(raw);
          } else if (f.data_type === 'boolean') {
            v = !!raw;
          } else if (f.data_type === 'date') {
            v = raw || null;
          } else if (f.data_type === 'enum') {
            v = (raw === '' || raw === undefined || raw === null) ? null : raw;
          } else if (f.data_type === 'image' || f.data_type === 'file' || f.data_type === 'reference') {
            v = raw || null;
          } else {
            v = raw ?? null;
          }
          
          // Check if value changed
          const hasChanged = JSON.stringify(v) !== JSON.stringify(previousValue);
          
          if (hasChanged) {
            await updateAssetField(asset.id, f.id, v);
          }
        }

        // Update previousValuesRef with current values
        previousValuesRef.current = { ...values };

        // Dispatch event to notify Sidebar to refresh assets
        window.dispatchEvent(new CustomEvent('assetUpdated', {
          detail: { libraryId, assetId: asset.id, skipLocalRefresh: true }
        }));
      } catch (e: any) {
        setSaveError(e?.message || 'Save failed');
      } finally {
        setSaving(false);
      }
    }
  }, [isNewAsset, assetName, supabase, libraryId, fieldDefs, values, asset, router, projectId, createAssetFromContext, updateAssetName, updateAssetField]);

  // Keep handleSaveRef updated with the latest handleSave function
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  // Auto-save functionality for edit mode (not for new assets)
  useEffect(() => {
    // Skip auto-save for new assets or if initial values haven't loaded
    if (isNewAsset || !asset || mode === 'view' || isSavingRef.current) {
      return;
    }

    // Mark initial values as loaded after first render
    if (!initialValuesLoadedRef.current) {
      initialValuesLoadedRef.current = true;
      previousValuesRef.current = { ...values };
      return;
    }

    // Check if values actually changed (avoid saving on remote updates)
    const hasLocalChanges = Object.keys(values).some(fieldId => {
      return JSON.stringify(values[fieldId]) !== JSON.stringify(previousValuesRef.current[fieldId]);
    });
    
    // Only trigger auto-save if there are actual local changes
    if (!hasLocalChanges) {
      return;
    }

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer for auto-save (debounce for 1.5 seconds)
    autoSaveTimerRef.current = setTimeout(() => {
      // Don't trigger save if already saving
      if (!isSavingRef.current && handleSaveRef.current) {
        isSavingRef.current = true;
        handleSaveRef.current().finally(() => {
          isSavingRef.current = false;
        });
      }
    }, 1500);

    // Cleanup timer on unmount or when values change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [values, isNewAsset, asset, mode]);

  // Reset initial values loaded flag when asset changes
  useEffect(() => {
    initialValuesLoadedRef.current = false;
  }, [assetId]);

  // Add global click listener to clear focus state when clicking outside
  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Don't clear focus if clicking on form elements or their children
      if (
        target.closest('[class*="fieldControl"]') ||
        target.closest('[class*="booleanToggle"]') ||
        target.closest('[class*="fieldSelect"]') ||
        target.closest('[class*="fieldInput"]') ||
        target.closest('[class*="customComponent"]')
      ) {
        return;
      }
      
      // Don't clear focus if clicking on modals, dropdowns, or interactive components
      if (
        target.closest('[role="dialog"]') ||
        target.closest('.ant-modal') ||
        target.closest('.ant-modal-root') ||
        target.closest('.ant-modal-mask') ||
        target.closest('.ant-modal-wrap') ||
        target.closest('.ant-select-dropdown') ||
        target.closest('.ant-switch') ||
        target.closest('[class*="modal"]') ||
        target.closest('[class*="Modal"]') ||
        target.closest('[class*="dropdown"]') ||
        target.closest('[class*="Dropdown"]') ||
        target.closest('input[type="file"]') ||
        target.closest('button') ||
        target.closest('[role="combobox"]') ||
        target.closest('[class*="mediaFileUpload"]') ||
        target.closest('[class*="MediaFileUpload"]')
      ) {
        return;
      }
      
      // Clear focus state
      if (currentFocusedField) {
        handleFieldBlur();
      }
    };
    
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [currentFocusedField, handleFieldBlur]);

  // Listen to TopBar Create Asset button click for new assets
  useEffect(() => {
    if (!isNewAsset) return;
    
    const handler = () => {
      handleSave();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('asset-create-save', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('asset-create-save', handler as EventListener);
      }
    };
  }, [isNewAsset, handleSave]);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div>{isNewAsset ? 'Loading library...' : 'Loading asset...'}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorText}>{error}</div>
      </div>
    );
  }

  if (!isNewAsset && !asset) {
    return (
      <div className={styles.notFoundContainer}>
        <div>Asset not found</div>
      </div>
    );
  }

  const sectionKeys = Object.keys(sections);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#8726EE',
        },
      }}
    >
    <div className={styles.container}>
        <div className={styles.contentWrapper}>
      {/* Asset Header (only for existing assets) */}
      {!isNewAsset && userProfile && (
        <AssetHeader
          assetId={assetId}
          assetName={assetName}
          projectId={projectId}
          libraryId={libraryId}
          libraryName={library?.name || ''}
          currentUserId={userProfile.id}
          currentUserName={userProfile.username || userProfile.full_name || userProfile.email}
          currentUserEmail={userProfile.email}
          currentUserAvatarColor={getUserAvatarColor(userProfile.id)}
          userRole={userRole as CollaboratorRole || 'viewer'}
          presenceUsers={presenceUsers || []}
        />
      )}
      
      <div className={styles.header}>
        {isNewAsset && (
          <div>
            <h1 className={styles.title}>{assetName || 'New asset'}</h1>
          </div>
        )}
            <div className={styles.headerRight}>
              {/* Realtime connection status (only for existing assets) */}
              {/* {!isNewAsset && realtimeConfig && (
                <ConnectionStatusIndicator 
                  status={connectionStatus}
                  queuedUpdatesCount={realtimeSubscription?.queuedUpdatesCount || 0}
                />
              )} */}
              {saveError && <div className={styles.saveError}>{saveError}</div>}
            </div>
          </div>
          {!authLoading && !isAuthenticated && isNewAsset && (
            <div className={styles.authWarning}>Please sign in to add assets.</div>
          )}

          <div className={styles.formContainer}>
          <div className={styles.fieldsContainer}>
              {sectionKeys.length === 0 && (
                <div className={styles.emptyState}>
                  <Image
                    src={noassetIcon1}
                    alt=""
                    width={72}
                    height={72}
                    className={styles.emptyStateIcon}
                  />
                  <p className={styles.emptyStateText}>
                    There is no any asset here. You need to create an asset firstly.
                  </p>
                  {userRole === 'admin' && (
                    <button className={styles.predefineButton} onClick={handlePredefineClick}>
                      <Image
                        src={noassetIcon2}
                        alt=""
                        width={24}
                        height={24}
                        className={styles.predefineButtonIcon}
                      />
                      <span>Predefine</span>
                    </button>
                  )}
                </div>
              )}

              {sectionKeys.length > 0 && (
                <div className={styles.tabsContainer}>
                  <Tabs
                    defaultActiveKey={sectionKeys[0]}
                    items={sectionKeys.map((sectionName) => {
                      const fields = sections[sectionName] || [];
                      return {
                        key: sectionName,
                        label: sectionName,
                        children: (
                          <div className={styles.tabContent}>
                            <div className={styles.fieldsList}>
                  {fields.map((f) => {
                                const value =
                                  values[f.id] ?? (f.data_type === 'boolean' ? false : '');
                                const label = f.label;

                    if (f.data_type === 'boolean') {
                      // Get users editing this field
                      const editingUsers = getFieldEditingUsers(f.id);
                      const borderColor = getFirstUserColor(editingUsers);
                      const isBeingEdited = editingUsers.length > 0;
                      const isRealtimeEdited = realtimeEditedFields.has(f.id);

                      return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                   
                                      <div className={styles.fieldControl}>
                                        <div 
                                          className={`${styles.booleanToggleWrapper} ${isBeingEdited ? styles.booleanToggleWrapperEditing : ''}`}
                                          style={borderColor ? { borderColor } : undefined}
                                          onClick={() => {
                                            if (mode !== 'view') {
                                              handleFieldFocus(f.id);
                                            }
                                          }}
                                          tabIndex={0}
                                        >
                                          <div className={styles.booleanToggle}>
                                            <Switch
                                              checked={!!value}
                                              disabled={mode === 'view'}
                                              onChange={
                                                mode !== 'view'
                                                  ? (checked) => {
                                                      handleValueChange(f.id, checked);
                                                      // Blur after a short delay to ensure other users see the change
                                                      setTimeout(() => {
                                                        handleFieldBlur();
                                                      }, 1000);
                                                    }
                                                  : undefined
                                              }
                                            />
                                            <span className={styles.booleanLabel}>
                                              {value ? 'True' : 'False'}
                                            </span>
                                          </div>
                                        </div>
                                        <FieldPresenceAvatars users={editingUsers} />
                                      </div>
                                    </div>
                      );
                    }

                    if (f.data_type === 'enum') {
                      // Get users editing this field
                      const editingUsers = getFieldEditingUsers(f.id);
                      const borderColor = getFirstUserColor(editingUsers);
                      const isBeingEdited = editingUsers.length > 0;
                      const isRealtimeEdited = realtimeEditedFields.has(f.id);

                      return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                    
                                      <div className={styles.fieldControl}>
                          <select
                            value={value ?? ''}
                                          disabled={mode === 'view'}
                                          onClick={() => {
                                            if (mode !== 'view') {
                                              handleFieldFocus(f.id);
                                            }
                                          }}
                                          onChange={
                                            mode !== 'view'
                                              ? (e) => {
                                                  handleValueChange(
                                                    f.id,
                                                    e.target.value === '' ? null : e.target.value
                                                  );
                                                  // Blur after a short delay to ensure other users see the change
                                                  setTimeout(() => {
                                                    handleFieldBlur();
                                                  }, 1000);
                                                }
                                              : undefined
                                          }
                                          className={`${styles.fieldSelect} ${isBeingEdited ? styles.fieldInputEditing : ''} ${isRealtimeEdited ? styles.fieldRealtimeEdited : ''} ${
                                            mode === 'view' ? styles.disabledInput : ''
                                          }`}
                                          style={borderColor ? { borderColor } : undefined}
                          >
                            <option value="">Select an option</option>
                            {(f.enum_options || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                                        <FieldPresenceAvatars users={editingUsers} />
                                      </div>
                                    </div>
                      );
                    }

                                if (f.data_type === 'image' || f.data_type === 'file') {
                                  // Get users editing this field
                                  const editingUsers = getFieldEditingUsers(f.id);
                                  const borderColor = getFirstUserColor(editingUsers);
                                  const isBeingEdited = editingUsers.length > 0;
                                  const isRealtimeEdited = realtimeEditedFields.has(f.id);

                                  return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                     
                                      <div className={styles.fieldControl}>
                                        <div
                                          className={`${styles.customComponentWrapper} ${isBeingEdited ? styles.customComponentWrapperEditing : ''}`}
                                          style={borderColor ? { borderColor } : undefined}
                                          onClick={() => {
                                            if (mode !== 'view') {
                                              handleFieldFocus(f.id);
                                            }
                                          }}
                                          onFocus={() => handleFieldFocus(f.id)}
                                          onBlur={handleFieldBlur}
                                          tabIndex={0}
                                        >
                                          <MediaFileUpload
                                            value={value as MediaFileMetadata | null}
                                            onChange={(newValue) => handleValueChange(f.id, newValue)}
                                            disabled={mode === 'view'}
                                            fieldType={f.data_type}
                                          />
                                        </div>
                                        <FieldPresenceAvatars users={editingUsers} />
                                      </div>
                                    </div>
                                  );
                                }

                                if (f.data_type === 'reference') {
                                  // Get users editing this field
                                  const editingUsers = getFieldEditingUsers(f.id);
                                  const borderColor = getFirstUserColor(editingUsers);
                                  const isBeingEdited = editingUsers.length > 0;
                                  const isRealtimeEdited = realtimeEditedFields.has(f.id);

                                  return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                     
                                      <div className={styles.fieldControl}>
                                        <div
                                          className={`${styles.customComponentWrapper} ${isBeingEdited ? styles.customComponentWrapperEditing : ''}`}
                                          style={borderColor ? { borderColor } : undefined}
                                          tabIndex={0}
                                        >
                                          <AssetReferenceSelector
                                            value={value}
                                            onChange={(newValue) => handleValueChange(f.id, newValue)}
                                            referenceLibraries={f.reference_libraries ?? []}
                                            disabled={mode === 'view'}
                                            onFocus={() => handleFieldFocus(f.id)}
                                            onBlur={handleFieldBlur}
                                          />
                                        </div>
                                        <FieldPresenceAvatars users={editingUsers} />
                                      </div>
                                    </div>
                                  );
                                }

                    const inputType =
                      f.data_type === 'int' || f.data_type === 'float'
                        ? 'number'
                        : f.data_type === 'date'
                        ? 'date'
                        : 'text';
                    
                    // Add class to hide spinner for int type
                    const inputClassName = f.data_type === 'int' 
                      ? `${styles.fieldInput} ${styles.noSpinner} ${mode === 'view' ? styles.disabledInput : ''}`
                      : `${styles.fieldInput} ${mode === 'view' ? styles.disabledInput : ''}`;

                    // Get users editing this field
                    const editingUsers = getFieldEditingUsers(f.id);
                    const borderColor = getFirstUserColor(editingUsers);
                    const isBeingEdited = editingUsers.length > 0;
                    
                    // Check if this field was just updated by a remote user
                    const isRealtimeEdited = realtimeEditedFields.has(f.id);

                    return (
                                  <div key={f.id} className={styles.fieldRow}>
                                    <div className={styles.dragHandle}>
                                      <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                    </div>
                                    <div className={styles.fieldMeta}>
                                      <span className={styles.fieldLabel}>
                                        {label}
                                        {f.required && (
                                          <span className={styles.requiredMark}>*</span>
                                        )}
                                      </span>
                                      <div className={styles.dataTypeTag}>
                                        <Image
                                          src={getFieldTypeIcon(f.data_type)}
                                          alt=""
                                          width={16}
                                          height={16}
                                          className={styles.dataTypeIcon}
                                        />
                                        {DATA_TYPE_LABEL[f.data_type]}
                                      </div>
                                    </div>
                                    <div className={styles.fieldControl}>
                        <input
                          type={inputType}
                          step={f.data_type === 'int' ? '1' : f.data_type === 'float' ? 'any' : undefined}
                          value={value ?? ''}
                                        disabled={mode === 'view'}
                                        onChange={
                                          mode !== 'view'
                                            ? (e) => {
                                                let inputValue = e.target.value;
                                                
                                                // Validate int type: only allow integers
                                                if (f.data_type === 'int' && inputValue !== '') {
                                                  // Check if contains decimal point - show error immediately
                                                  if (inputValue.includes('.')) {
                                                    setFieldValidationErrors(prev => ({
                                                      ...prev,
                                                      [f.id]: 'type mismatch'
                                                    }));
                                                    // Remove decimal point and everything after it
                                                    inputValue = inputValue.split('.')[0];
                                                  } else {
                                                    // Clear error if no decimal point
                                                    setFieldValidationErrors(prev => {
                                                      const newErrors = { ...prev };
                                                      delete newErrors[f.id];
                                                      return newErrors;
                                                    });
                                                  }
                                                  
                                                  // Remove any non-digit characters except minus sign at the start
                                                  const cleaned = inputValue.replace(/[^\d-]/g, '');
                                                  const intValue = cleaned.startsWith('-') 
                                                    ? '-' + cleaned.slice(1).replace(/-/g, '')
                                                    : cleaned.replace(/-/g, '');
                                                  
                                                  // Only update if valid integer format
                                                  if (!/^-?\d*$/.test(intValue)) {
                                                    return; // Don't update if invalid
                                                  }
                                                  inputValue = intValue;
                                                }
                                                // Validate float type: must contain decimal point
                                                else if (f.data_type === 'float' && inputValue !== '') {
                                                  // Clear error initially
                                                  setFieldValidationErrors(prev => {
                                                    const newErrors = { ...prev };
                                                    delete newErrors[f.id];
                                                    return newErrors;
                                                  });
                                                  
                                                  // Remove invalid characters but keep valid float format
                                                  const cleaned = inputValue.replace(/[^\d.-]/g, '');
                                                  const floatValue = cleaned.startsWith('-') 
                                                    ? '-' + cleaned.slice(1).replace(/-/g, '')
                                                    : cleaned.replace(/-/g, '');
                                                  // Ensure only one decimal point
                                                  const parts = floatValue.split('.');
                                                  const finalValue = parts.length > 2 
                                                    ? parts[0] + '.' + parts.slice(1).join('')
                                                    : floatValue;
                                                  
                                                  if (!/^-?\d*\.?\d*$/.test(finalValue)) {
                                                    return; // Don't update if invalid
                                                  }
                                                  inputValue = finalValue;
                                                } else {
                                                  // Clear error for other types
                                                  setFieldValidationErrors(prev => {
                                                    const newErrors = { ...prev };
                                                    delete newErrors[f.id];
                                                    return newErrors;
                                                  });
                                                }
                                                
                                                handleValueChange(f.id, inputValue);
                                              }
                                            : undefined
                                        }
                                        onFocus={() => handleFieldFocus(f.id)}
                                        onBlur={handleFieldBlur}
                                        className={`${inputClassName} ${isBeingEdited ? styles.fieldInputEditing : ''} ${isRealtimeEdited ? styles.fieldRealtimeEdited : ''}`}
                                        style={borderColor ? { borderColor } : undefined}
                          placeholder={f.label}
                        />
                                      <FieldPresenceAvatars users={editingUsers} />
                                    </div>
                                    {/* Only Reference and Option (enum) show configure icon */}
                                  </div>
                    );
                  })}
                </div>
              </div>
                        ),
                      };
                    })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
    </ConfigProvider>
  );
}


