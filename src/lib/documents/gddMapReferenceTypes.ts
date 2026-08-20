import { isUuid } from '@/lib/utils/uuid';

export const GDD_MAP_REFERENCE_DISPLAYS = ['compact', 'full'] as const;
export type GddMapReferenceDisplay = (typeof GDD_MAP_REFERENCE_DISPLAYS)[number];

export type GddMapReferenceAttributes = {
  artifactId: string;
  display: GddMapReferenceDisplay;
  fallbackTitle: string;
};

const MAX_FALLBACK_TITLE_LENGTH = 160;

function hasExactKeys(value: Record<string, string>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === 3 && keys.join('\u0000') === 'artifactId\u0000display\u0000fallbackTitle';
}

export function sanitizeGddMapFallbackTitle(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FALLBACK_TITLE_LENGTH)
    .trim();
}

export function parseGddMapReferenceAttributes(
  attributes: Readonly<Record<string, string>>,
): GddMapReferenceAttributes | null {
  if (!hasExactKeys(attributes)) return null;
  const fallbackTitle = sanitizeGddMapFallbackTitle(attributes.fallbackTitle);
  if (!isUuid(attributes.artifactId) || !GDD_MAP_REFERENCE_DISPLAYS.includes(attributes.display as GddMapReferenceDisplay)) return null;
  if (!fallbackTitle) return null;
  return {
    artifactId: attributes.artifactId,
    display: attributes.display as GddMapReferenceDisplay,
    fallbackTitle,
  };
}

export function gddMapReferenceAttributes(
  value: GddMapReferenceAttributes,
): Record<string, string> {
  const parsed = parseGddMapReferenceAttributes(value);
  if (!parsed) throw new Error('GDD map reference attributes are invalid.');
  return parsed;
}

