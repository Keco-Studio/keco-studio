'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { updateAsset } from '@/lib/services/libraryAssetsService';
import styles from '../folders/NewFolderModal.module.css';

type EditAssetModalProps = {
  open: boolean;
  assetId: string;
  onClose: () => void;
  onUpdated?: () => void;
};

export function EditAssetModal({ open, assetId, onClose, onUpdated }: EditAssetModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Load asset data when modal opens
  useEffect(() => {
    if (open && assetId) {
      setLoading(true);
      setError(null);
      (async () => {
        try {
          const { data, error } = await supabase
            .from('library_assets')
            .select('id, name, library_id')
            .eq('id', assetId)
            .single();
          
          if (error) {
            setError('Asset not found');
            return;
          }
          if (data) {
            setName(data.name || '');
            setLibraryId(data.library_id || null);
          }
        } catch (e: any) {
          console.error('Failed to load asset:', e);
          setError(e?.message || 'Failed to load asset');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [open, assetId, supabase]);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Asset name is required');
      return;
    }
    
    setSubmitting(true);
    setError(null);
    
    try {
      // First, get the libraryId if we don't have it
      let verifiedLibraryId = libraryId;
      if (!verifiedLibraryId) {
        const { data: assetData, error: assetErr } = await supabase
          .from('library_assets')
          .select('library_id')
          .eq('id', assetId)
          .single();
        
        if (assetErr || !assetData) {
          throw new Error('Failed to get asset library');
        }
        verifiedLibraryId = assetData.library_id;
      }
      
      // Get field definitions to find the name field
      const { data: fieldDefs, error: fieldDefsError } = await supabase
        .from('library_field_definitions')
        .select('id, label, data_type')
        .eq('library_id', verifiedLibraryId)
        .eq('label', 'name')
        .eq('data_type', 'string')
        .limit(1);
      
      if (fieldDefsError) {
        console.warn('Failed to get field definitions:', fieldDefsError);
      }
      
      // Build propertyValues with name field update
      const propertyValues: Record<string, any> = {};
      if (fieldDefs && fieldDefs.length > 0) {
        const nameFieldId = fieldDefs[0].id;
        propertyValues[nameFieldId] = trimmed;
      }
      
      // Update the asset (both name and propertyValues)
      await updateAsset(supabase, assetId, trimmed, propertyValues);
      
      // Verify the update was successful by querying the database
      const { data: updatedAsset, error: verifyError } = await supabase
        .from('library_assets')
        .select('id, name, library_id')
        .eq('id', assetId)
        .single();
      
      if (verifyError) {
        console.error('Failed to verify asset update:', verifyError);
        throw new Error('Failed to verify asset update');
      }
      
      if (!updatedAsset) {
        throw new Error('Asset not found after update');
      }
      
      // Dispatch event to notify other components to refresh cache
      // Include libraryId so Sidebar can refresh the correct library's assets
      if (verifiedLibraryId) {
        const eventDetail = { assetId, libraryId: verifiedLibraryId };
        const event = new CustomEvent('assetUpdated', { 
          detail: eventDetail,
          bubbles: true,
          cancelable: true
        });
        
        // Dispatch on window
        window.dispatchEvent(event);
        
        // Also dispatch on document to ensure it reaches all listeners
        if (typeof document !== 'undefined') {
          document.dispatchEvent(event);
        }
      }
      
      if (onUpdated) {
        onUpdated();
      }
      onClose();
    } catch (e: any) {
      console.error('Asset update error:', e);
      setError(e?.message || 'Failed to update asset');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Edit Asset</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
            <div>Loading...</div>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.label}>Asset Name</label>
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter asset name"
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSubmit();
                  }
                }}
              />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.footer}>
              <button 
                className={`${styles.button} ${styles.secondary}`} 
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={handleSubmit}
                disabled={submitting || loading}
              >
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

