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

export function clipboardImagesToMarkdown(
  images: readonly UploadedClipboardImage[],
): string {
  return images.map(({ file, url }) => {
    const altText = file.name
      .replaceAll('\\', '\\\\')
      .replaceAll('[', '\\[')
      .replaceAll(']', '\\]');
    return `![${altText}](${url})`;
  }).join('\n\n');
}
