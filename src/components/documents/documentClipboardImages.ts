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

type RtfImagePayload = {
  mimeType: 'image/jpeg' | 'image/png';
  hex: string;
};

function isEscapedRtfCharacter(rtf: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && rtf[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function extractBalancedRtfPictGroups(rtf: string): string[] {
  const groups: string[] = [];
  const pictStart = /\{\\pict\b/gi;

  for (const match of rtf.matchAll(pictStart)) {
    const start = match.index;
    if (start === undefined || isEscapedRtfCharacter(rtf, start)) continue;

    let depth = 0;
    for (let cursor = start; cursor < rtf.length; cursor += 1) {
      const character = rtf[cursor];
      if (isEscapedRtfCharacter(rtf, cursor)) continue;
      if (character === '{') depth += 1;
      if (character !== '}') continue;
      depth -= 1;
      if (depth !== 0) continue;
      groups.push(rtf.slice(start, cursor + 1));
      break;
    }
  }

  return groups;
}

function topLevelRtfGroupContent(group: string): string {
  let depth = 1;
  let content = '';

  for (let cursor = 1; cursor < group.length - 1; cursor += 1) {
    const character = group[cursor] ?? '';
    if (!isEscapedRtfCharacter(group, cursor) && character === '{') {
      depth += 1;
      continue;
    }
    if (!isEscapedRtfCharacter(group, cursor) && character === '}') {
      depth -= 1;
      continue;
    }
    if (depth === 1) content += character;
  }

  return content;
}

function rtfPictGroupToImage(group: string): RtfImagePayload | null {
  const content = topLevelRtfGroupContent(group);
  const format = /\\(pngblip|jpegblip)\b/i.exec(content);
  if (!format || format.index === undefined) return null;

  const mimeType = format[1]?.toLowerCase() === 'pngblip'
    ? 'image/png'
    : 'image/jpeg';
  const payload = content
    .slice(format.index + format[0].length)
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/\s/g, '')
    .toLowerCase();
  if (!payload || payload.length % 2 !== 0 || !/^[0-9a-f]+$/.test(payload)) {
    return null;
  }
  if (mimeType === 'image/png' && !payload.startsWith('89504e47')) return null;
  if (mimeType === 'image/jpeg' && !payload.startsWith('ffd8')) return null;

  return { mimeType, hex: payload };
}

function extractRtfPictPayloads(rtf: string): RtfImagePayload[] {
  return extractBalancedRtfPictGroups(rtf)
    .map(rtfPictGroupToImage)
    .filter((image): image is RtfImagePayload => image !== null)
    .filter((image, index, images) => {
      const previous = images[index - 1];
      return !previous
        || previous.mimeType !== image.mimeType
        || previous.hex !== image.hex;
    });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function extractClipboardRtfImageFiles(
  clipboardData: Pick<DataTransfer, 'getData'> | null,
): File[] {
  if (!clipboardData) return [];

  return extractRtfPictPayloads(clipboardData.getData('text/rtf'))
    .map(({ mimeType, hex }, index) => new File(
      [hexToBytes(hex)],
      fileNameForClipboardImage(mimeType, index),
      { type: mimeType },
    ));
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
  wpsImageFallbackCount: number;
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

const WPS_IMAGE_FALLBACK_TEXT =
  '[WPS image was not included in the clipboard. Paste this image separately.]';

function isWpsTemporaryImageSource(source: string): boolean {
  if (!source.toLowerCase().startsWith('file:')) return false;

  let pathname = source;
  try {
    pathname = new URL(source).pathname;
  } catch {
    // Preserve the raw source for conservative pattern matching below.
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  const normalizedPath = pathname.replace(/\\/g, '/');
  return /\/ksohtml\/(?:[^/]+\/)*wps_clip_image[-_]/i.test(normalizedPath);
}

export function prepareClipboardRichImagePaste(
  clipboardData: ClipboardImageData,
): PreparedClipboardRichImagePaste | null {
  const html = clipboardData.getData('text/html');
  if (!html || !/<img\b/i.test(html)) return null;

  const document = new DOMParser().parseFromString(html, 'text/html');
  const imageElements = Array.from(document.body.querySelectorAll('img'));
  const clipboardFiles = extractClipboardImageFiles(clipboardData);
  const rtfFiles = extractClipboardRtfImageFiles(clipboardData);
  const images: PreparedClipboardImage[] = [];
  let wpsImageFallbackCount = 0;

  imageElements.forEach((image, index) => {
    const source = image.getAttribute('src') ?? '';
    const clipboardFile = clipboardFiles[index];
    const file = clipboardFile
      ?? rtfFiles[index]
      ?? dataImageUrlToFile(source, index);
    if (!file) {
      if (isWpsTemporaryImageSource(source)) {
        const fallback = document.createElement('p');
        fallback.textContent = WPS_IMAGE_FALLBACK_TEXT;
        image.replaceWith(fallback);
        wpsImageFallbackCount += 1;
      } else if (!isSanctionedExistingImageSource(source)) {
        image.remove();
      }
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
    wpsImageFallbackCount,
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
