import { useState, useRef, useCallback, useEffect, startTransition } from 'react';

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

type AssetCardState = {
  assetId: string;
  position: { x: number; y: number };
  details: AssetHoverDetails;
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

function buildInitialDetailsFromSelections(
  selections?: HoverReferenceSelection[]
): AssetHoverDetails | null {
  if (!selections?.length) return null;

  const selectedCells = selections
    .map((selection) => ({
      fieldLabel: (selection.fieldLabel || 'Field').trim() || 'Field',
      displayValue: (selection.displayValue || '').trim(),
    }))
    .filter((cell) => cell.displayValue !== '');

  if (selectedCells.length === 0) return null;

  return {
    name: selectedCells[0].displayValue,
    firstColumnLabel: selectedCells[0].fieldLabel,
    selectedCells,
  };
}

function computePanelPosition(element: HTMLDivElement): { x: number; y: number } | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

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

  return { x, y };
}

export function useAssetHover(supabase: any): {
  hoveredAssetId: string | null;
  setHoveredAssetId: React.Dispatch<React.SetStateAction<string | null>>;
  hoveredAssetDetails: AssetHoverDetails | null;
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
  const [cardState, setCardState] = useState<AssetCardState | null>(null);
  const avatarRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const assetCardRef = useRef<HTMLElement | null>(null);
  const openTriggerRef = useRef<HTMLElement | null>(null);
  const detailsCacheRef = useRef(new Map<string, AssetHoverDetails>());
  const fetchGenerationRef = useRef(0);

  const dismissCard = useCallback(() => {
    setCardState(null);
    openTriggerRef.current = null;
  }, []);

  const loadAssetDetails = useCallback(
    async (assetId: string, generation: number) => {
      if (!supabase) return;

      try {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id, name, library_id, libraries(name)')
          .eq('id', assetId)
          .single();

        if (error) throw error;
        if (generation !== fetchGenerationRef.current) return;

        if (!data) {
          const deletedDetails: AssetHoverDetails = { sourceLibraryDeleted: true };
          detailsCacheRef.current.set(assetId, deletedDetails);
          startTransition(() => {
            setCardState((prev) =>
              prev?.assetId === assetId ? { ...prev, details: deletedDetails } : prev
            );
          });
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

        if (generation !== fetchGenerationRef.current) return;

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
            .eq('asset_id', assetId)
            .in('field_id', fieldIds);

          if (generation !== fetchGenerationRef.current) return;

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

        const nextDetails: AssetHoverDetails = {
          sourceLibraryDeleted,
          name: selectedCells[0]?.displayValue || fallbackName,
          libraryName: librariesRow?.name ?? '',
          libraryId: data.library_id,
          firstColumnLabel: selectedCells[0]?.fieldLabel || 'Name',
          selectedCells,
        };

        detailsCacheRef.current.set(assetId, nextDetails);
        startTransition(() => {
          setCardState((prev) =>
            prev?.assetId === assetId ? { ...prev, details: nextDetails } : prev
          );
        });
      } catch (error) {
        if (generation !== fetchGenerationRef.current) return;
        console.error('Failed to load asset details:', error);
        const fallbackDetails: AssetHoverDetails = { sourceLibraryDeleted: true };
        startTransition(() => {
          setCardState((prev) =>
            prev?.assetId === assetId
              ? { ...prev, details: prev.details ?? fallbackDetails }
              : prev
          );
        });
      }
    },
    [supabase]
  );

  useEffect(() => {
    const assetId = cardState?.assetId;
    if (!assetId) return;

    if (detailsCacheRef.current.has(assetId)) return;

    const generation = ++fetchGenerationRef.current;
    const frameId = requestAnimationFrame(() => {
      void loadAssetDetails(assetId, generation);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [cardState?.assetId, loadAssetDetails]);

  const setAssetCardRef = useCallback((el: HTMLElement | null) => {
    assetCardRef.current = el;
  }, []);

  useEffect(() => {
    if (!cardState?.assetId) return;

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
  }, [cardState?.assetId, dismissCard]);

  const handleAvatarMouseEnter = useCallback((
    assetId: string,
    element: HTMLDivElement,
    selections?: HoverReferenceSelection[]
  ) => {
    if (avatarRefs.current.get(assetId) !== element) {
      avatarRefs.current.set(assetId, element);
    }
    openTriggerRef.current = element;

    if (cardState?.assetId === assetId) {
      dismissCard();
      return;
    }

    const position = computePanelPosition(element);
    if (!position) return;

    const cachedDetails = detailsCacheRef.current.get(assetId);
    const details =
      cachedDetails ??
      buildInitialDetailsFromSelections(selections) ??
      ({ name: 'Untitled' } satisfies AssetHoverDetails);

    setCardState({ assetId, position, details });
  }, [cardState?.assetId, dismissCard]);

  const handleAvatarMouseLeave = useCallback(() => {}, []);
  const handleAssetCardMouseEnter = useCallback(() => {}, []);
  const handleAssetCardMouseLeave = useCallback(() => {}, []);

  const setHoveredAssetId = useCallback((value: React.SetStateAction<string | null>) => {
    setCardState((prev) => {
      const nextId = typeof value === 'function' ? value(prev?.assetId ?? null) : value;
      if (!nextId) return null;
      if (prev?.assetId === nextId) return prev;
      return prev ? { ...prev, assetId: nextId } : null;
    });
  }, []);

  return {
    hoveredAssetId: cardState?.assetId ?? null,
    setHoveredAssetId,
    hoveredAssetDetails: cardState?.details ?? null,
    hoveredAvatarPosition: cardState?.position ?? null,
    handleAvatarMouseEnter,
    handleAvatarMouseLeave,
    handleAssetCardMouseEnter,
    handleAssetCardMouseLeave,
    avatarRefs,
    setAssetCardRef,
  };
}
