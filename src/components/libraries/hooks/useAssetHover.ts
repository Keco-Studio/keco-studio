import { useState, useRef, useCallback, useEffect } from 'react';

export type AssetHoverDetails = {
  name: string;
  libraryName: string;
  libraryId: string;
  firstColumnLabel?: string;
};

export function useAssetHover(supabase: any): {
  hoveredAssetId: string | null;
  setHoveredAssetId: React.Dispatch<React.SetStateAction<string | null>>;
  hoveredAssetDetails: AssetHoverDetails | null;
  loadingAssetDetails: boolean;
  hoveredAvatarPosition: { x: number; y: number } | null;
  handleAvatarMouseEnter: (assetId: string, element: HTMLDivElement) => void;
  handleAvatarMouseLeave: () => void;
  handleAssetCardMouseEnter: () => void;
  handleAssetCardMouseLeave: () => void;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
} {
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoveredAssetDetails, setHoveredAssetDetails] = useState<AssetHoverDetails | null>(null);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);
  const [hoveredAvatarPosition, setHoveredAvatarPosition] = useState<{ x: number; y: number } | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!hoveredAssetId) {
      setHoveredAssetDetails(null);
      setHoveredAvatarPosition(null);
      return;
    }

    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    const loadAssetDetails = async () => {
      if (!supabase) return;
      setLoadingAssetDetails(true);
      try {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id, name, library_id, libraries(name)')
          .eq('id', hoveredAssetId)
          .single();

        if (error) throw error;

        if (data) {
          // Get the first column field definition for this asset's library
          const { data: fieldDefs, error: fieldError } = await supabase
            .from('library_field_definitions')
            .select('id, label, order_index')
            .eq('library_id', data.library_id)
            .order('order_index', { ascending: true })
            .limit(1);

          const firstField = fieldDefs && fieldDefs.length > 0 ? fieldDefs[0] : null;
          const firstFieldId = firstField?.id || null;
          const firstFieldLabel = firstField?.label || 'Name';

          // Get the first column value for this asset
          let firstColumnValue = data.name; // Fallback to name
          if (firstFieldId) {
            const { data: valueData, error: valueError } = await supabase
              .from('library_asset_values')
              .select('value_json')
              .eq('asset_id', hoveredAssetId)
              .eq('field_id', firstFieldId)
              .single();

            if (!valueError && valueData?.value_json !== null && valueData?.value_json !== undefined) {
              const rawValue = valueData.value_json;
              const strValue = String(rawValue).trim();
              if (strValue !== '' && strValue !== 'null' && strValue !== 'undefined') {
                firstColumnValue = strValue;
              }
            }
          }

          setHoveredAssetDetails({
            name: firstColumnValue || 'Untitled',
            libraryName: (data.libraries as any)?.name || 'Unknown Library',
            libraryId: data.library_id,
            firstColumnLabel: firstFieldLabel,
          });
        }
      } catch (error) {
        console.error('Failed to load asset details:', error);
        setHoveredAssetDetails(null);
      } finally {
        setLoadingAssetDetails(false);
      }
    };

    loadAssetDetails();
  }, [hoveredAssetId, supabase]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const handleAvatarMouseEnter = useCallback((assetId: string, element: HTMLDivElement) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    if (avatarRefs.current.get(assetId) !== element) {
      avatarRefs.current.set(assetId, element);
    }

    const updatePosition = () => {
      let currentElement: HTMLDivElement | null = element;
      if (!currentElement?.isConnected) {
        const stored = avatarRefs.current.get(assetId);
        if (!stored?.isConnected) return;
        currentElement = stored;
      }
      if (!currentElement) return;

      const rect = currentElement.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        requestAnimationFrame(updatePosition);
        return;
      }

      const panelWidth = 320;
      const panelHeight = 200;
      const spacing = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let x = rect.right + spacing;
      let y = rect.top;

      if (x + panelWidth > vw) {
        x = rect.left - panelWidth - spacing;
        if (x < 0) x = spacing;
      }
      if (y + panelHeight > vh) {
        y = vh - panelHeight - spacing;
        if (y < 0) y = spacing;
      }

      const valid = (x > 0 || rect.left > 0) && (y > 0 || rect.top > 0);
      if (valid) {
        setHoveredAvatarPosition({ x, y });
      } else if (rect.left > 0 || rect.top > 0) {
        setHoveredAvatarPosition({
          x: Math.max(spacing, rect.left + rect.width / 2 - panelWidth / 2),
          y: Math.max(spacing, rect.bottom + spacing),
        });
      }
    };

    requestAnimationFrame(() => requestAnimationFrame(updatePosition));
    setHoveredAssetId(assetId);
  }, []);

  const handleAvatarMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredAssetId(null);
      hideTimeoutRef.current = null;
    }, 200);
  }, []);

  const handleAssetCardMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handleAssetCardMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredAssetId(null);
      hideTimeoutRef.current = null;
    }, 200);
  }, []);

  return {
    hoveredAssetId,
    setHoveredAssetId,
    hoveredAssetDetails,
    loadingAssetDetails,
    hoveredAvatarPosition,
    handleAvatarMouseEnter,
    handleAvatarMouseLeave,
    handleAssetCardMouseEnter,
    handleAssetCardMouseLeave,
    avatarRefs,
  };
}
