import { DOMParser } from '@xmldom/xmldom';
import { canonicalProjectAssetMimeType } from './project-asset-upload-contract.ts';

const SAFE_SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc', 'defs', 'lineargradient', 'radialgradient',
  'stop', 'clippath', 'mask', 'pattern', 'marker',
]);
const SAFE_SVG_ATTRIBUTES = new Set([
  'xmlns', 'version', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1',
  'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill',
  'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'transform', 'preserveaspectratio', 'id',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform',
  'spreadmethod', 'patternunits', 'patterncontentunits', 'patterntransform',
  'markerwidth', 'markerheight', 'markerunits', 'refx', 'refy', 'orient',
  'clip-path', 'clip-rule', 'mask', 'font-family', 'font-size', 'font-weight',
  'text-anchor', 'dominant-baseline', 'dx', 'dy', 'rotate', 'lengthadjust',
  'textlength',
]);

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  return Array.from(value, (char) => char.charCodeAt(0)).every(
    (byte, index) => bytes[offset + index] === byte,
  );
}

function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03]) || startsWith(bytes, [0x50, 0x4b, 0x05]) || startsWith(bytes, [0x50, 0x4b, 0x07]);
}

function zipEntryNames(bytes: Uint8Array): Set<string> | null {
  const minimumEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (startsWith(bytes, [0x50, 0x4b, 0x05, 0x06], offset)) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return null;
  const eocd = new DataView(bytes.buffer, bytes.byteOffset + eocdOffset, bytes.byteLength - eocdOffset);
  const entriesOnDisk = eocd.getUint16(8, true);
  const entryCount = eocd.getUint16(10, true);
  const directorySize = eocd.getUint32(12, true);
  const directoryOffset = eocd.getUint32(16, true);
  if (eocd.getUint16(4, true) !== 0 || eocd.getUint16(6, true) !== 0 || entriesOnDisk !== entryCount || directoryOffset + directorySize > eocdOffset) return null;

  const names = new Set<string>();
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || !startsWith(bytes, [0x50, 0x4b, 0x01, 0x02], offset)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const fileNameLength = view.getUint16(28, true);
    const extraLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (fileNameLength < 1 || nextOffset > eocdOffset) return null;
    try {
      names.add(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength)));
    } catch {
      return null;
    }
    offset = nextOffset;
  }
  return offset === directoryOffset + directorySize ? names : null;
}

function isOpenXml(bytes: Uint8Array, rootEntry: string): boolean {
  if (!isZip(bytes)) return false;
  const entries = zipEntryNames(bytes);
  return entries !== null && entries.has('[Content_Types].xml') && entries.has(rootEntry);
}

function isMp3(bytes: Uint8Array): boolean {
  if (asciiAt(bytes, 0, 'ID3')) return true;
  if (bytes.byteLength < 4) return false;
  const header = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const version = (header >>> 19) & 0x03;
  const layer = (header >>> 17) & 0x03;
  const bitrate = (header >>> 12) & 0x0f;
  const sampleRate = (header >>> 10) & 0x03;
  return (header >>> 21) === 0x07ff && version !== 0x01 &&
    layer === 0x01 && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03;
}

function isSafeSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimStart();
  } catch {
    return false;
  }
  if (/<!doctype\b|<!entity\b|<\?xml-stylesheet\b/i.test(text)) return false;
  let malformed = false;
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => { malformed = true; },
      fatalError: () => { malformed = true; },
    },
  }).parseFromString(text, 'image/svg+xml');
  const root = document.documentElement;
  if (malformed || !root || root.tagName.toLowerCase() !== 'svg') return false;

  const visit = (node: Node): boolean => {
    if (node.nodeType === 1) {
      const element = node as Element;
      if (!SAFE_SVG_ELEMENTS.has(element.tagName.toLowerCase())) return false;
      for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index);
        if (!attribute) return false;
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name === 'xmlns') {
          if (value !== 'http://www.w3.org/2000/svg') return false;
          continue;
        }
        if (!SAFE_SVG_ATTRIBUTES.has(name) || /^on/i.test(name) ||
          /(?:javascript|data|https?):|\/\/|@import\b|expression\s*\(/i.test(value)) return false;
        if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][\w.-]*\)$/i.test(value)) return false;
      }
    } else if (![3, 4, 8].includes(node.nodeType)) {
      return false;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (!visit(child)) return false;
    }
    return true;
  };
  return visit(root);
}

export function projectAssetContentMatches(mimeType: string, bytes: Uint8Array): boolean {
  const canonical = canonicalProjectAssetMimeType(mimeType);
  if (!canonical || bytes.byteLength < 1) return false;
  if (canonical === 'image/png') return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  if (canonical === 'image/jpeg') return startsWith(bytes, [255, 216, 255]);
  if (canonical === 'image/gif') return startsWith(bytes, [71, 73, 70, 56, 55, 97]) || startsWith(bytes, [71, 73, 70, 56, 57, 97]);
  if (canonical === 'image/webp') return asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP');
  if (canonical === 'image/svg+xml') return isSafeSvg(bytes);
  if (canonical === 'image/vnd.adobe.photoshop') return asciiAt(bytes, 0, '8BPS');
  if (canonical === 'application/pdf') return asciiAt(bytes, 0, '%PDF-');
  if (canonical === 'application/zip') return isZip(bytes) && zipEntryNames(bytes) !== null;
  if (canonical === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return isOpenXml(bytes, 'word/document.xml');
  if (canonical === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return isOpenXml(bytes, 'xl/workbook.xml');
  if (canonical === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return isOpenXml(bytes, 'ppt/presentation.xml');
  if (canonical === 'application/msword' || canonical === 'application/vnd.ms-excel' || canonical === 'application/vnd.ms-powerpoint') return startsWith(bytes, [208, 207, 17, 224, 161, 177, 26, 225]);
  if (canonical === 'video/mp4' || canonical === 'audio/mp4') return bytes.byteLength >= 12 && asciiAt(bytes, 4, 'ftyp');
  if (canonical === 'audio/mpeg') return isMp3(bytes);
  if (canonical === 'audio/wav') return asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE');
  if (canonical === 'audio/ogg') return asciiAt(bytes, 0, 'OggS');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
  if (canonical === 'application/json') { try { JSON.parse(text); return true; } catch { return false; } }
  if (canonical === 'text/plain' || canonical === 'text/csv') return !text.includes('\uFFFD');
  return false;
}
