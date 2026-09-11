export const PROJECT_ASSET_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip', 'application/json',
  'image/vnd.adobe.photoshop',
] as const;

export type ProjectAssetMimeType = typeof PROJECT_ASSET_MIME_TYPES[number];

export const PROJECT_ASSET_EXTENSIONS: Record<ProjectAssetMimeType, readonly string[]> = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'], 'image/webp': ['webp'], 'image/svg+xml': ['svg'],
  'video/mp4': ['mp4'], 'audio/mpeg': ['mp3'], 'audio/mp4': ['m4a'], 'audio/wav': ['wav'], 'audio/ogg': ['ogg'],
  'application/pdf': ['pdf'], 'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'text/plain': ['txt'], 'text/csv': ['csv'], 'application/zip': ['zip'], 'application/json': ['json'], 'image/vnd.adobe.photoshop': ['psd'],
};

export const PROJECT_ASSET_MAX_BYTES: Record<string, number> = {
  image: 10 * 1024 * 1024,
  text: 10 * 1024 * 1024,
  application: 25 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  archive: 100 * 1024 * 1024,
  photoshop: 100 * 1024 * 1024,
};

export function canonicalProjectAssetMimeType(value: string): ProjectAssetMimeType | null {
  const normalized = value.toLowerCase().split(';', 1)[0].trim();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'audio/x-m4a') return 'audio/mp4';
  return (PROJECT_ASSET_MIME_TYPES as readonly string[]).includes(normalized)
    ? normalized as ProjectAssetMimeType : null;
}

export function projectAssetMaxBytes(mimeType: string): number {
  const canonical = canonicalProjectAssetMimeType(mimeType) ?? mimeType.toLowerCase().split(';', 1)[0].trim();
  if (canonical === 'application/zip') return PROJECT_ASSET_MAX_BYTES.archive;
  if (canonical === 'image/vnd.adobe.photoshop') return PROJECT_ASSET_MAX_BYTES.photoshop;
  if (canonical === 'application/json') return PROJECT_ASSET_MAX_BYTES.text;
  if (canonical.startsWith('image/')) return PROJECT_ASSET_MAX_BYTES.image;
  return PROJECT_ASSET_MAX_BYTES[canonical.split('/', 1)[0]] ?? PROJECT_ASSET_MAX_BYTES.application;
}

export function projectAssetMimeFromName(name: string): ProjectAssetMimeType | null {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  for (const [mime, extensions] of Object.entries(PROJECT_ASSET_EXTENSIONS)) {
    if (extensions.includes(ext)) return mime as ProjectAssetMimeType;
  }
  return null;
}

export function projectAssetExtensionMatches(name: string, mimeType: string): boolean {
  const canonical = canonicalProjectAssetMimeType(mimeType);
  return canonical !== null && projectAssetMimeFromName(name) === canonical;
}
