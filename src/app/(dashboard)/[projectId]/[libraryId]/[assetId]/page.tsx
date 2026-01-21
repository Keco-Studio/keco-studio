'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ConfigProvider, Tabs, Switch } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getLibrary, Library } from '@/lib/services/libraryService';
import { getFieldTypeIcon } from '../predefine/utils';
import { usePresence } from '@/lib/contexts/PresenceContext';
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
import { useRealtimeSubscription } from '@/lib/hooks/useRealtimeSubscription';
import type { CellUpdateEvent, AssetCreateEvent, AssetDeleteEvent, PresenceState } from '@/lib/types/collaboration';
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
  const { userProfile, isAuthenticated, isLoading: authLoading } = useAuth();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  const assetId = params.assetId as string;
  
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
  
  // Realtime collaboration state
  const [realtimeEditedFields, setRealtimeEditedFields] = useState<Map<string, { value: any; timestamp: number }>>(new Map());
  
  // User role state (for permission control)
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);

  // Presence tracking state
  const [currentFocusedField, setCurrentFocusedField] = useState<string | null>(null);

  // Get presence from global context (shared with Sidebar)
  const {
    updateActiveCell,
    getUsersEditingCell,
    isTracking,
    presenceUsers,
  } = usePresence();

  // Keep assetRef updated (to avoid recreating callbacks when asset changes)
  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);

  // Handle realtime cell updates from other users
  const handleCellUpdateEvent = useCallback((event: CellUpdateEvent) => {
    const currentAsset = assetRef.current;

    // Only process updates for the current asset
    if (!currentAsset || event.assetId !== currentAsset.id) {
      return;
    }

    // Check if value actually changed (to prevent infinite loops from database subscriptions)
    setValues(prev => {
      const currentValue = prev[event.propertyKey];
      const newValue = event.newValue;
      
      // Compare values using JSON.stringify to handle objects/arrays
      const currentValueStr = JSON.stringify(currentValue);
      const newValueStr = JSON.stringify(newValue);
      
      if (currentValueStr === newValueStr) {
        return prev; // No change, return previous state
      }

      // Track this as a realtime edited field (for visual feedback)
      setRealtimeEditedFields(prevFields => {
        const next = new Map(prevFields);
        next.set(event.propertyKey, { value: newValue, timestamp: event.timestamp });
        return next;
      });

      // Clear the realtime edited state after a short delay
      setTimeout(() => {
        setRealtimeEditedFields(prevFields => {
          const next = new Map(prevFields);
          next.delete(event.propertyKey);
          return next;
        });
      }, 2000);

      // Return updated values
      return {
        ...prev,
        [event.propertyKey]: newValue,
      };
    });
  }, []);

  // Handle asset creation events (not relevant for this page, but required by hook)
  const handleAssetCreateEvent = useCallback((event: AssetCreateEvent) => {
    // Not used in AssetPage
  }, []);

  // Handle asset deletion events
  const handleAssetDeleteEvent = useCallback((event: AssetDeleteEvent) => {
    const currentAsset = assetRef.current;
    // If this asset was deleted by another user, redirect to library page
    if (currentAsset && event.assetId === currentAsset.id) {
      router.push(`/${projectId}/${libraryId}`);
    }
  }, [projectId, libraryId, router]);

  // Handle conflicts (when both users edit the same field)
  const handleConflictEvent = useCallback((event: CellUpdateEvent, localValue: any) => {
    // For now, remote value wins (you can add a conflict resolution UI later)
    setValues(prev => ({
      ...prev,
      [event.propertyKey]: event.newValue,
    }));
  }, []);

  // Configure realtime subscription (use useMemo to prevent unnecessary re-initialization)
  const realtimeConfig = useMemo(() => {
    if (!libraryId || isNewAsset || !asset || !userProfile) {
      return null;
    }

    return {
      libraryId: libraryId,
      currentUserId: userProfile.id,
      currentUserName: userProfile.username || userProfile.full_name || userProfile.email,
      currentUserEmail: userProfile.email,
      avatarColor: getUserAvatarColor(userProfile.id),
      onCellUpdate: handleCellUpdateEvent,
      onAssetCreate: handleAssetCreateEvent,
      onAssetDelete: handleAssetDeleteEvent,
      onConflict: handleConflictEvent,
    };
  }, [
    libraryId, 
    isNewAsset, 
    asset?.id,
    userProfile?.id,
    userProfile?.username,
    userProfile?.full_name,
    userProfile?.email,
    handleCellUpdateEvent,
    handleAssetCreateEvent,
    handleAssetDeleteEvent,
    handleConflictEvent,
  ]);

  // Initialize realtime subscription
  const realtimeSubscription = useRealtimeSubscription(
    realtimeConfig || {
      libraryId: '',
      currentUserId: '',
      currentUserName: '',
      currentUserEmail: '',
      avatarColor: '',
      onCellUpdate: () => {},
      onAssetCreate: () => {},
      onAssetDelete: () => {},
      onConflict: () => {},
    }
  );

  const {
    connectionStatus,
    broadcastCellUpdate,
  } = realtimeConfig ? realtimeSubscription : {
    connectionStatus: 'disconnected' as const,
    broadcastCellUpdate: async () => {},
  };

  // Keep broadcastCellUpdateRef updated with the latest function
  useEffect(() => {
    broadcastCellUpdateRef.current = broadcastCellUpdate;
  }, [broadcastCellUpdate]);

  // Set presence to indicate user is viewing this asset (when not editing any field)
  useEffect(() => {
    if (!isNewAsset && asset && updateActiveCell) {
      // Always try to set viewing state when conditions are met
      // Even if isTracking is temporarily false, it will retry when isTracking becomes true
      if (isTracking) {
        if (!currentFocusedField) {
          // Use a special propertyKey to indicate "viewing" (not editing)
          updateActiveCell(asset.id, '__viewing__');
        }
      }
    }
  }, [asset, isNewAsset, updateActiveCell, currentFocusedField, isTracking]);

  // Cleanup: clear presence when component unmounts or asset changes
  useEffect(() => {
    return () => {
      if (updateActiveCell) {
        updateActiveCell(null, null);
      }
    };
  }, [updateActiveCell]);

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
          // Load field definitions, asset, and values
          const [{ data: defs, error: defErr }, { data: assetRow, error: assetErr }, { data: vals, error: valErr }] =
            await Promise.all([
              supabase
                .from('library_field_definitions')
                .select('*')
                .eq('library_id', libraryId)
                .order('section', { ascending: true })
                .order('order_index', { ascending: true }),
              supabase.from('library_assets').select('id,name,library_id').eq('id', assetId).single(),
              supabase.from('library_asset_values').select('field_id,value_json').eq('asset_id', assetId),
            ]);

          if (defErr) throw defErr;
          if (assetErr) throw assetErr;
          if (!assetRow) throw new Error('Asset not found');
          if (assetRow.library_id !== libraryId) throw new Error('Asset not in this library');
          if (valErr) throw valErr;

          // Migrate legacy 'media' type to 'image' for backward compatibility
          const fieldDefs = (defs as FieldDef[]) || [];
          const migratedDefs = fieldDefs.map(def => ({
            ...def,
            data_type: def.data_type === 'media' as any ? 'image' : def.data_type
          }));
          setFieldDefs(migratedDefs);
          setAsset(assetRow as AssetRow);
          
          // Create a map of field IDs to field definitions for easier lookup
          const fieldDefMap = new Map(migratedDefs.map(f => [f.id, f]));
          
          const valueMap: Record<string, any> = {};
          (vals as ValueRow[] | null)?.forEach((v) => {
            let parsedValue = v.value_json;
            const fieldDef = fieldDefMap.get(v.field_id);
            
            // Parse JSON strings for image/file/reference fields
            if (fieldDef && (fieldDef.data_type === 'image' || fieldDef.data_type === 'file' || fieldDef.data_type === 'reference')) {
              if (typeof parsedValue === 'string' && parsedValue.trim() !== '') {
                try {
                  parsedValue = JSON.parse(parsedValue);
                } catch {
                  // If parsing fails, keep the original value (might be legacy format)
                }
              }
            }
            
            valueMap[v.field_id] = parsedValue;
          });
          setValues(valueMap);
          // Store initial values for change detection in realtime updates
          previousValuesRef.current = { ...valueMap };
        }
      } catch (e: any) {
        setError(e?.message || (isNewAsset ? 'Failed to load library' : 'Failed to load asset'));
      } finally {
        setLoading(false);
      }
    };
    
    load();
  }, [assetId, libraryId, projectId, supabase, isNewAsset]);

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
    if (updateActiveCell && asset) {
      updateActiveCell(asset.id, fieldId);
    }
  }, [updateActiveCell, asset]);

  // Handle field blur for presence tracking
  const handleFieldBlur = useCallback(() => {
    setCurrentFocusedField(null);
    if (updateActiveCell && asset && !isNewAsset) {
      // When blurring, set back to viewing state (not editing any field)
      updateActiveCell(asset.id, '__viewing__');
    } else if (updateActiveCell) {
      updateActiveCell(null, null);
    }
  }, [updateActiveCell, asset, isNewAsset]);

  // Get users editing a specific field (including current user if they're editing it)
  const getFieldEditingUsers = useCallback((fieldId: string) => {
    if (!getUsersEditingCell || !asset) return [];
    let editingUsers = getUsersEditingCell(asset.id, fieldId);
    
    // If current user is editing this field, ensure they're in the list
    if (currentFocusedField === fieldId && userProfile) {
      const hasCurrentUser = editingUsers.some(u => u.userId === userProfile.id);
      if (!hasCurrentUser) {
        // Add current user at the beginning (they should be shown first)
        const currentUserPresence: PresenceState = {
          userId: userProfile.id,
          userName: userProfile.full_name || userProfile.username || userProfile.email,
          userEmail: userProfile.email,
          avatarColor: getUserAvatarColor(userProfile.id),
          activeCell: { assetId: asset.id, propertyKey: fieldId },
          cursorPosition: null,
          lastActivity: new Date().toISOString(),
          connectionStatus: 'online',
        };
        editingUsers = [currentUserPresence, ...editingUsers];
      }
    }
    
    return editingUsers;
  }, [getUsersEditingCell, asset, currentFocusedField, userProfile]);

  // Get the first user's color for border styling
  const getFirstUserColor = useCallback((users: any[]) => {
    if (users.length === 0) return null;
    return users[0].avatarColor;
  }, []);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(null);
    
    // Validate int fields before saving
    for (const f of fieldDefs) {
      if (f.data_type === 'int') {
        const raw = values[f.id];
        if (raw !== '' && raw !== undefined && raw !== null) {
          const strValue = String(raw).trim();
          if (strValue !== '') {
            // Check if value contains decimal point or is not a valid integer
            if (strValue.includes('.') || !/^-?\d+$/.test(strValue)) {
              setSaveError(`Field "${f.label}" must be an integer (no decimals allowed). Please enter a valid integer.`);
              return;
            }
          }
        }
      }
    }
    
    if (isNewAsset) {
      // Create new asset
      const nameValue = assetName.trim();
      if (!nameValue) {
        setSaveError('Asset name is required (please fill in the "name" field)');
        return;
      }

      setSaving(true);
      try {
        const { data: newAsset, error: assetErr } = await supabase
          .from('library_assets')
          .insert({ library_id: libraryId, name: nameValue })
          .select()
          .single();
        if (assetErr) throw assetErr;

        const newAssetId = newAsset.id as string;

        const payload = fieldDefs.map((f) => {
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
          return { asset_id: newAssetId, field_id: f.id, value_json: v };
        });

        if (payload.length > 0) {
          const { error: valErr } = await supabase
            .from('library_asset_values')
            .upsert(payload, { onConflict: 'asset_id,field_id' });
          if (valErr) throw valErr;
        }

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
      // Update existing asset
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
        
        // Update asset name if it changed
        if (newAssetName !== asset.name) {
          const { error: assetUpdateErr } = await supabase
            .from('library_assets')
            .update({ name: newAssetName })
            .eq('id', asset.id);
          if (assetUpdateErr) throw assetUpdateErr;
          
          // Update local asset state
          setAsset({ ...asset, name: newAssetName });
        }
        
        const payload = fieldDefs.map((f) => {
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
          return { asset_id: asset.id, field_id: f.id, value_json: v };
        });

        if (payload.length > 0) {
          const { error: valErr } = await supabase
            .from('library_asset_values')
            .upsert(payload, { onConflict: 'asset_id,field_id' });
          if (valErr) throw valErr;
        }

        // Broadcast realtime updates for changed fields
        const broadcastFn = broadcastCellUpdateRef.current;

        if (broadcastFn) {
          for (const f of fieldDefs) {
            const currentValue = values[f.id];
            const previousValue = previousValuesRef.current[f.id];
            
            // Check if value changed
            const hasChanged = JSON.stringify(currentValue) !== JSON.stringify(previousValue);
            
            if (hasChanged) {
              // Broadcast the update to other users
              try {
                await broadcastFn(asset.id, f.id, currentValue, previousValue);
              } catch (err) {
                // Silently fail
              }
            }
          }
        }

        // Update previousValuesRef with current values
        previousValuesRef.current = { ...values };

        // Dispatch event to notify Sidebar to refresh assets
        // skipLocalRefresh: true to prevent re-fetching data in the same component (avoid auto-save loop)
        window.dispatchEvent(new CustomEvent('assetUpdated', {
          detail: { libraryId, assetId: asset.id, skipLocalRefresh: true }
        }));
      } catch (e: any) {
        setSaveError(e?.message || 'Save failed');
      } finally {
        setSaving(false);
      }
    }
  }, [isNewAsset, assetName, supabase, libraryId, fieldDefs, values, asset, router, projectId]);

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
  }, [values, isNewAsset, asset, mode]); // 移除 handleSave 依赖

  // Reset initial values loaded flag when asset changes
  useEffect(() => {
    initialValuesLoadedRef.current = false;
  }, [assetId]);

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
                                          onFocus={() => handleFieldFocus(f.id)}
                                          onBlur={handleFieldBlur}
                                          tabIndex={0}
                                        >
                                          <div className={styles.booleanToggle}>
                                            <Switch
                                              checked={!!value}
                                              disabled={mode === 'view'}
                                              onChange={
                                                mode !== 'view'
                                                  ? (checked) => handleValueChange(f.id, checked)
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
                                          onChange={
                                            mode !== 'view'
                                              ? (e) =>
                                                  handleValueChange(
                                                    f.id,
                                                    e.target.value === '' ? null : e.target.value
                                                  )
                                              : undefined
                                          }
                                          onFocus={() => handleFieldFocus(f.id)}
                                          onBlur={handleFieldBlur}
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
                                          onFocus={() => handleFieldFocus(f.id)}
                                          onBlur={handleFieldBlur}
                                          tabIndex={0}
                                        >
                                          <AssetReferenceSelector
                                            value={value}
                                            onChange={(newValue) => handleValueChange(f.id, newValue)}
                                            referenceLibraries={f.reference_libraries ?? []}
                                            disabled={mode === 'view'}
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
                          value={value ?? ''}
                                        disabled={mode === 'view'}
                                        onChange={
                                          mode !== 'view'
                                            ? (e) =>
                                                handleValueChange(f.id, e.target.value)
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


