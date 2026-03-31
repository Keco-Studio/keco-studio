import { useState, useRef, useCallback, useEffect } from 'react';

export type AssetHoverDetails = {
  name: string;
  libraryName: string;
  libraryId: string;
  firstColumnLabel?: string;
  selectedCells?: Array<{ fieldLabel: string; displayValue: string }>;
};

type HoverReferenceSelection = {
  fieldLabel?: string | null;
  displayValue?: string | null;
};

export function useAssetHover(supabase: any): {
  hoveredAssetId: string | null;
  setHoveredAssetId: React.Dispatch<React.SetStateAction<string | null>>;
  hoveredAssetDetails: AssetHoverDetails | null;
  loadingAssetDetails: boolean;
  hoveredAvatarPosition: { x: number; y: number } | null;
  handleAvatarMouseEnter: (
    assetId: string,
    element: HTMLDivElement,
    selections?: HoverReferenceSelection[]
  ) => void;
  handleAvatarMouseLeave: () => void;
  handleAssetCardMouseEnter: () => void;
  handleAssetCardMouseLeave: () => void;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  setAssetCardRef: (el: HTMLElement | null) => void;
} {
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoveredAssetDetails, setHoveredAssetDetails] = useState<AssetHoverDetails | null>(null);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);
  const [hoveredAvatarPosition, setHoveredAvatarPosition] = useState<{ x: number; y: number } | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const selectedReferenceByAssetId = useRef<Map<string, HoverReferenceSelection[]>>(new Map());

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
          const selectedReferences = selectedReferenceByAssetId.current.get(hoveredAssetId) ?? [];
          const normalizedSelectedCells = selectedReferences
            .map((s) => ({
              fieldLabel: (s.fieldLabel || '').trim(),
              displayValue: (s.displayValue || '').trim(),
            }))
            .filter((s) => s.fieldLabel || s.displayValue);
          const selectedDisplayValue = normalizedSelectedCells[0]?.displayValue;
          const selectedFieldLabel = normalizedSelectedCells[0]?.fieldLabel;

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

          // Get the display value: prefer the selected reference cell from modal,
          // otherwise fall back to the first column value.
          let firstColumnValue = selectedDisplayValue || data.name;
          if (!selectedDisplayValue && firstFieldId) {
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
            firstColumnLabel: selectedFieldLabel || firstFieldLabel,
            selectedCells: normalizedSelectedCells.length > 0 ? normalizedSelectedCells : undefined,
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

  // Track the asset card DOM element so we can exclude clicks on it
  const assetCardRef = useRef<HTMLElement | null>(null);

  const setAssetCardRef = useCallback((el: HTMLElement | null) => {
    assetCardRef.current = el;
  }, []);

  // Dismiss asset card on scroll or mousedown outside the card.
  // Scrolling doesn't fire mouseleave, and when the cell is selected
  // the mouseleave guard (`isCellSelected`) prevents dismissal, so
  // clicking another cell would leave the card stuck.
  useEffect(() => {
    if (!hoveredAssetId) return;

    const dismiss = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      setHoveredAssetId(null);
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Don't dismiss if the click is inside the asset card itself
      if (assetCardRef.current && assetCardRef.current.contains(e.target as Node)) {
        return;
      }
      dismiss();
    };

    // Use capture phase so we catch scroll on any scrollable ancestor
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [hoveredAssetId]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const handleAvatarMouseEnter = useCallback((
    assetId: string,
    element: HTMLDivElement,
    selections?: HoverReferenceSelection[]
  ) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    if (avatarRefs.current.get(assetId) !== element) {
      avatarRefs.current.set(assetId, element);
    }
    if (selections && selections.some((s) => s && (s.displayValue || s.fieldLabel))) {
      selectedReferenceByAssetId.current.set(assetId, selections);
    } else {
      selectedReferenceByAssetId.current.delete(assetId);
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
    setAssetCardRef,
  };
}
