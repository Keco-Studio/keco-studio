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

type ClipboardImageData = Pick<DataTransfer, 'getData' | 'items'>;

export function hasClipboardImagePayload(
  clipboardData: ClipboardImageData | null,
): boolean {
  if (!clipboardData) return false;
  if (extractClipboardImageFiles(clipboardData).length > 0) return true;
  return /<img\b/i.test(clipboardData.getData('text/html'));
}

export type PreparedClipboardRichImagePaste = {
  html: string;
  plainText: string;
  images: PreparedClipboardImage[];
};

export type PreparedClipboardImage = {
  file: File;
  placeholderSrc: string;
};

export type ResolvedClipboardImage = PreparedClipboardImage & {
  url: string | null;
};

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

function fileNameForClipboardImage(
  mimeType: string,
  index: number,
): string {
  return `clipboard-image-${index + 1}.${IMAGE_EXTENSION_BY_TYPE[mimeType] ?? 'bin'}`;
}

function dataImageUrlToFile(source: string, index: number): File | null {
  if (!source.toLowerCase().startsWith('data:image/')) return null;
  const separatorIndex = source.indexOf(',');
  if (separatorIndex < 0) return null;
  const [mimeType = '', ...parameters] = source
    .slice('data:'.length, separatorIndex)
    .split(';');
  if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) return null;

  const encoded = source.slice(separatorIndex + 1);
  const isBase64 = parameters.some(
    (parameter) => parameter.toLowerCase() === 'base64',
  );
  try {
    const contents = isBase64
      ? Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      : decodeURIComponent(encoded);
    return new File([contents], fileNameForClipboardImage(mimeType, index), {
      type: mimeType,
    });
  } catch {
    return null;
  }
}

let clipboardPasteSequence = 0;

function createImagePlaceholder(index: number): string {
  clipboardPasteSequence += 1;
  return `https://clipboard-image.invalid/keco-clipboard-${Date.now().toString(36)}-${clipboardPasteSequence}-${index}`;
}

function isSanctionedExistingImageSource(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' || (
      url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function prepareClipboardRichImagePaste(
  clipboardData: ClipboardImageData,
): PreparedClipboardRichImagePaste | null {
  const html = clipboardData.getData('text/html');
  if (!html || !/<img\b/i.test(html)) return null;

  const document = new DOMParser().parseFromString(html, 'text/html');
  const imageElements = Array.from(document.body.querySelectorAll('img'));
  const clipboardFiles = extractClipboardImageFiles(clipboardData);
  const images: PreparedClipboardImage[] = [];

  imageElements.forEach((image, index) => {
    const source = image.getAttribute('src') ?? '';
    const clipboardFile = clipboardFiles[index];
    const file = clipboardFile ?? dataImageUrlToFile(source, index);
    if (!file) {
      if (!isSanctionedExistingImageSource(source)) image.remove();
      return;
    }

    const placeholderSrc = createImagePlaceholder(index);
    image.setAttribute('src', placeholderSrc);
    if (clipboardFile) image.setAttribute('alt', clipboardFile.name);
    images.push({ file, placeholderSrc });
  });

  clipboardFiles.slice(imageElements.length).forEach((file, extraIndex) => {
    const index = imageElements.length + extraIndex;
    const placeholderSrc = createImagePlaceholder(index);
    const image = document.createElement('img');
    image.setAttribute('src', placeholderSrc);
    image.setAttribute('alt', file.name);
    document.body.append(image);
    images.push({ file, placeholderSrc });
  });

  return {
    html: document.body.innerHTML,
    plainText: clipboardData.getData('text/plain'),
    images,
  };
}

export async function uploadPreparedClipboardImages(
  images: readonly PreparedClipboardImage[],
  upload: (file: File) => Promise<string>,
): Promise<ResolvedClipboardImage[]> {
  return Promise.all(images.map(async (image) => {
    try {
      return { ...image, url: await upload(image.file) };
    } catch (error) {
      console.error(`Failed to upload pasted HTML image: ${image.file.name}`, error);
      return { ...image, url: null };
    }
  }));
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
