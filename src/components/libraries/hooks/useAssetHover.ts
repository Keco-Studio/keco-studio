import { useState, useRef, useCallback, useEffect } from 'react';

export type AssetHoverDetails = {
  name: string;
  libraryName: string;
  libraryId: string;
};

/**
 * useAssetHover - 悬停 reference 头像时加载资产详情并定位浮层
 *
 * - 悬停/移出带延迟，避免闪动
 * - 从 library_assets 拉取 name、library，用于 Asset Card 浮层
 * - 产出：hoveredAssetId、hoveredAssetDetails、loading、position、handlers、avatarRefs
 */
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
          setHoveredAssetDetails({
            name: data.name,
            libraryName: (data.libraries as any)?.name || 'Unknown Library',
            libraryId: data.library_id,
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
