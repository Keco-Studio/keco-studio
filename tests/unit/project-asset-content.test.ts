import { describe, expect, it } from '@jest/globals';
import { projectAssetContentMatches } from '../../shared/project-asset-content';
import { projectAssetMaxBytes } from '../../shared/project-asset-upload-contract';

const encoder = new TextEncoder();

function zipWithEntries(names: string[]): Uint8Array {
  const encodedNames = names.map((name) => encoder.encode(name));
  const directorySize = encodedNames.reduce((size, name) => size + 46 + name.byteLength, 0);
  const directoryOffset = 4;
  const bytes = new Uint8Array(directoryOffset + directorySize + 22);
  bytes.set([0x50, 0x4b, 0x03, 0x04]);
  let offset = directoryOffset;
  for (const name of encodedNames) {
    bytes.set([0x50, 0x4b, 0x01, 0x02], offset);
    new DataView(bytes.buffer).setUint16(offset + 28, name.byteLength, true);
    bytes.set(name, offset + 46);
    offset += 46 + name.byteLength;
  }
  bytes.set([0x50, 0x4b, 0x05, 0x06], offset);
  const view = new DataView(bytes.buffer);
  view.setUint16(offset + 8, names.length, true);
  view.setUint16(offset + 10, names.length, true);
  view.setUint32(offset + 12, directorySize, true);
  view.setUint32(offset + 16, directoryOffset, true);
  return bytes;
}

describe('project asset content validation', () => {
  it('applies canonical size tiers to supported MIME aliases', () => {
    expect(projectAssetMaxBytes('image/jpg')).toBe(10 * 1024 * 1024);
    expect(projectAssetMaxBytes('audio/x-m4a')).toBe(50 * 1024 * 1024);
  });

  it.each([
    ['image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/jpeg', new Uint8Array([255, 216, 255])],
    ['image/gif', encoder.encode('GIF89a')],
    ['image/webp', encoder.encode('RIFF0000WEBP')],
    ['image/vnd.adobe.photoshop', encoder.encode('8BPS')],
    ['application/pdf', encoder.encode('%PDF-1.7')],
    ['application/msword', new Uint8Array([208, 207, 17, 224, 161, 177, 26, 225])],
    ['video/mp4', encoder.encode('0000ftyp0000')],
    ['audio/mp4', encoder.encode('0000ftyp0000')],
    ['audio/mpeg', encoder.encode('ID3data')],
    ['audio/wav', encoder.encode('RIFF0000WAVE')],
    ['audio/ogg', encoder.encode('OggSdata')],
    ['application/json', encoder.encode('{"valid":true}')],
    ['text/plain', encoder.encode('plain text')],
    ['text/csv', encoder.encode('name,value\na,1')],
  ])('accepts valid %s bytes', (mimeType, bytes) => {
    expect(projectAssetContentMatches(mimeType, bytes)).toBe(true);
  });

  it('accepts valid MP3 frame variants and rejects reserved headers', () => {
    expect(projectAssetContentMatches('audio/mpeg', new Uint8Array([0xff, 0xfa, 0x90, 0x00]))).toBe(true);
    expect(projectAssetContentMatches('audio/mpeg', new Uint8Array([0xff, 0xe3, 0x90, 0x00]))).toBe(true);
    expect(projectAssetContentMatches('audio/mpeg', new Uint8Array([0xff, 0xeb, 0x90, 0x00]))).toBe(false);
  });

  it('checks safe SVG content rather than only its opening tag', () => {
    expect(projectAssetContentMatches('image/svg+xml', encoder.encode('<svg><path d="M0 0"/></svg>'))).toBe(true);
    expect(projectAssetContentMatches('image/svg+xml', encoder.encode('<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>'))).toBe(true);
    expect(projectAssetContentMatches('image/svg+xml', encoder.encode('<svg onload="alert(1)"></svg>'))).toBe(false);
    expect(projectAssetContentMatches('image/svg+xml', encoder.encode('<svg><animate attributeName="href" to="https://example.com"/></svg>'))).toBe(false);
    expect(projectAssetContentMatches('image/svg+xml', encoder.encode('<svg><set attributeName="href" to="data:text/html,bad"/></svg>'))).toBe(false);
  });

  it('checks ZIP structure and the expected OpenXML package root', () => {
    const docx = zipWithEntries(['[Content_Types].xml', 'word/document.xml']);
    expect(projectAssetContentMatches('application/zip', docx)).toBe(true);
    expect(projectAssetContentMatches('application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx)).toBe(true);
    expect(projectAssetContentMatches('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx)).toBe(false);
    expect(projectAssetContentMatches('application/zip', new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false);
  });

  it('rejects malformed structured text and invalid UTF-8', () => {
    expect(projectAssetContentMatches('application/json', encoder.encode('{invalid'))).toBe(false);
    expect(projectAssetContentMatches('text/plain', new Uint8Array([0xff]))).toBe(false);
  });
});
