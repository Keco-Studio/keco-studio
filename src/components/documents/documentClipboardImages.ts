/**
 * Whether the clipboard contains meaningful text in addition to image files.
 * Image-only HTML (the common browser representation of a copied image) must
 * not count as text, otherwise the native paste path would insert a broken
 * remote/blob image instead of the uploaded image node.
 */
export function hasClipboardTextPayload(
  clipboardData: Pick<DataTransfer, 'getData'> | null,
): boolean {
  if (!clipboardData) return false;
  const html = clipboardData.getData('text/html');
  if (html) {
    // Browsers commonly expose an image's alt text as text/plain. When the
    // HTML contains only an image, that fallback is not meaningful document
    // text and should not switch the paste into the mixed-content path.
    return html
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim().length > 0;
  }
  return clipboardData.getData('text/plain').trim().length > 0;
}

export function extractClipboardImageFiles(
  clipboardData: Pick<DataTransfer, 'items'> | null,
): File[] {
  if (!clipboardData) return [];

  return Array.from(clipboardData.items).flatMap((item) => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

export type UploadedClipboardImage = {
  file: File;
  url: string;
};

export async function uploadClipboardImages(
  files: readonly File[],
  upload: (file: File) => Promise<string>,
): Promise<UploadedClipboardImage[]> {
  const settled = await Promise.allSettled(
    files.map(async (file) => ({ file, url: await upload(file) })),
  );

  return settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [result.value];
    console.error(
      `Failed to upload pasted image: ${files[index]?.name ?? 'unknown'}`,
      result.reason,
    );
    return [];
  });
}
