import { useState, useRef, useCallback, useEffect } from 'react';

export type AssetHoverDetails = {
  name?: string;
  libraryName?: string;
  libraryId?: string;
  firstColumnLabel?: string;
  /** Referenced asset field rows for the reference card. */
  selectedCells?: Array<{ fieldLabel: string; displayValue: string }>;
  /** True when the referenced asset/library row is missing (e.g. source library deleted). */
  sourceLibraryDeleted?: boolean;
};

type HoverReferenceSelection = {
  fieldLabel?: string | null;
  displayValue?: string | null;
};

const PANEL_WIDTH = 220;
const PANEL_HEIGHT = 220;
const NON_DISPLAY_TYPES = new Set([
  'image',
  'file',
  'multimedia',
  'audio',
  'reference',
  'formula',
]);

function formatDisplayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return '';
    return trimmed;
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => formatDisplayValue(item))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (typeof record.name === 'string' && record.name.trim()) return record.name.trim();
    if (typeof record.label === 'string' && record.label.trim()) return record.label.trim();
    try {
      return JSON.stringify(raw);
    } catch {
      return '';
    }
  }
  return String(raw);
}

export function useAssetHover(supabase: any): {
  hoveredAssetId: string | null;
  setHoveredAssetId: React.Dispatch<React.SetStateAction<string | null>>;
  hoveredAssetDetails: AssetHoverDetails | null;
  loadingAssetDetails: boolean;
  hoveredAvatarPosition: { x: number; y: number } | null;
  /** Open (or toggle) the reference card from a click on a reference pill/icon. */
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
  const avatarRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const assetCardRef = useRef<HTMLElement | null>(null);
  const openTriggerRef = useRef<HTMLElement | null>(null);

  const dismissCard = useCallback(() => {
    setHoveredAssetId(null);
    setHoveredAssetDetails(null);
    setHoveredAvatarPosition(null);
    openTriggerRef.current = null;
  }, []);

  useEffect(() => {
    if (!hoveredAssetId) {
      setHoveredAssetDetails(null);
      setHoveredAvatarPosition(null);
      return;
    }

    let cancelled = false;

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
        if (cancelled) return;

        if (!data) {
          setHoveredAssetDetails({ sourceLibraryDeleted: true });
          return;
        }

        const librariesRow = data.libraries as { name?: string } | null | undefined;
        const sourceLibraryDeleted =
          librariesRow == null ||
          (typeof librariesRow === 'object' && !librariesRow.name);

        const { data: fieldDefs } = await supabase
          .from('library_field_definitions')
          .select('id, label, data_type, order_index')
          .eq('library_id', data.library_id)
          .order('order_index', { ascending: true })
          .limit(12);

        if (cancelled) return;

        const displayFields = ((fieldDefs as Array<{
          id: string;
          label: string | null;
          data_type: string | null;
        }> | null) ?? [])
          .filter((field) => !NON_DISPLAY_TYPES.has((field.data_type || '').toLowerCase()))
          .slice(0, 6);

        const fieldIds = displayFields.map((field) => field.id);
        const valueByFieldId = new Map<string, unknown>();

        if (fieldIds.length > 0) {
          const { data: valueRows } = await supabase
            .from('library_asset_values')
            .select('field_id, value_json')
            .eq('asset_id', hoveredAssetId)
            .in('field_id', fieldIds);

          if (cancelled) return;

          for (const row of (valueRows as Array<{ field_id: string; value_json: unknown }> | null) ?? []) {
            valueByFieldId.set(row.field_id, row.value_json);
          }
        }

        const selectedCells = displayFields
          .map((field) => ({
            fieldLabel: (field.label || 'Field').trim() || 'Field',
            displayValue: formatDisplayValue(valueByFieldId.get(field.id)),
          }))
          .filter((row) => row.displayValue !== '');

        const fallbackName = formatDisplayValue(data.name) || 'Untitled';
        if (selectedCells.length === 0) {
          selectedCells.push({ fieldLabel: 'Name', displayValue: fallbackName });
        }

        setHoveredAssetDetails({
          sourceLibraryDeleted,
          name: selectedCells[0]?.displayValue || fallbackName,
          libraryName: librariesRow?.name ?? '',
          libraryId: data.library_id,
          firstColumnLabel: selectedCells[0]?.fieldLabel || 'Name',
          selectedCells,
        });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load asset details:', error);
        setHoveredAssetDetails({ sourceLibraryDeleted: true });
      } finally {
        if (!cancelled) setLoadingAssetDetails(false);
      }
    };

    void loadAssetDetails();
    return () => {
      cancelled = true;
    };
  }, [hoveredAssetId, supabase]);

  const setAssetCardRef = useCallback((el: HTMLElement | null) => {
    assetCardRef.current = el;
  }, []);

  useEffect(() => {
    if (!hoveredAssetId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (assetCardRef.current && assetCardRef.current.contains(target)) return;
      if (openTriggerRef.current && openTriggerRef.current.contains(target)) return;
      dismissCard();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissCard();
    };

    window.addEventListener('scroll', dismissCard, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('scroll', dismissCard, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dismissCard, hoveredAssetId]);

  const updatePositionForElement = useCallback((element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const spacing = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = rect.right + spacing;
    let y = rect.top;

    if (x + PANEL_WIDTH > vw) {
      x = rect.left - PANEL_WIDTH - spacing;
      if (x < 0) x = spacing;
    }
    if (y + PANEL_HEIGHT > vh) {
      y = vh - PANEL_HEIGHT - spacing;
      if (y < 0) y = spacing;
    }

    setHoveredAvatarPosition({ x, y });
  }, []);

  const handleAvatarMouseEnter = useCallback((
    assetId: string,
    element: HTMLDivElement,
    _selections?: HoverReferenceSelection[]
  ) => {
    if (avatarRefs.current.get(assetId) !== element) {
      avatarRefs.current.set(assetId, element);
    }
    openTriggerRef.current = element;

    // Clicking the same open trigger toggles the card closed.
    if (hoveredAssetId === assetId) {
      dismissCard();
      return;
    }

    updatePositionForElement(element);
    setHoveredAssetId(assetId);
  }, [dismissCard, hoveredAssetId, updatePositionForElement]);

  // Hover leave is intentionally a no-op: the card is click-triggered.
  const handleAvatarMouseLeave = useCallback(() => {}, []);
  const handleAssetCardMouseEnter = useCallback(() => {}, []);
  const handleAssetCardMouseLeave = useCallback(() => {}, []);

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
