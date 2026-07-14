import * as Y from 'yjs';
import {
  decodeBase64,
  documentCollabTopic,
  encodeBase64,
} from './documentCollaborationProtocol';

export {
  DocumentCollaborationSession as DocumentYjsProvider,
  type DocumentCollaborationSessionOptions as DocumentYjsProviderOptions,
} from './documentCollaborationSession';

export const base64ToUint8 = decodeBase64;
export const uint8ToBase64 = encodeBase64;
export { documentCollabTopic };

export function applyRemoteYjsUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, 'remote');
}
