import { z } from 'zod';
import { isUuid } from '@/lib/utils/uuid';

export const DOC_COLLAB_TOPIC_PREFIX = 'doc-collab:';
export const COLLABORATION_MAX_UPDATE_BYTES = 256 * 1024;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_ENCODED_UPDATE_LENGTH =
  Math.ceil(COLLABORATION_MAX_UPDATE_BYTES / 3) * 4;

export class DocumentCollaborationProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentCollaborationProtocolError';
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  if (typeof btoa === 'undefined') {
    throw new DocumentCollaborationProtocolError('Base64 encoder is unavailable');
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new DocumentCollaborationProtocolError('Invalid base64 payload');
  }

  let bytes: Uint8Array;
  try {
    if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(value, 'base64'));
    } else {
      if (typeof atob === 'undefined') {
        throw new Error('decoder unavailable');
      }
      const binary = atob(value);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
  } catch {
    throw new DocumentCollaborationProtocolError('Invalid base64 payload');
  }

  if (encodeBase64(bytes) !== value) {
    throw new DocumentCollaborationProtocolError('Invalid canonical base64 payload');
  }
  return bytes;
}

export function documentCollabTopic(documentId: string): string {
  if (!isUuid(documentId)) {
    throw new DocumentCollaborationProtocolError('Invalid document ID for collaboration topic');
  }
  return `${DOC_COLLAB_TOPIC_PREFIX}${documentId}`;
}

const baseEventSchema = z
  .object({
    v: z.literal(1),
    documentId: z.string().uuid(),
    epoch: z.number().int().nonnegative(),
  })
  .strict();

const encodedUpdateSchema = z
  .string()
  .max(MAX_ENCODED_UPDATE_LENGTH, 'Collaboration payload exceeds size limit')
  .superRefine((value, context) => {
    try {
      if (decodeBase64(value).byteLength > COLLABORATION_MAX_UPDATE_BYTES) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Collaboration payload exceeds decoded size limit',
        });
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Collaboration payload is not valid base64',
      });
    }
  });

const eventSchemas = {
  'yjs-update': baseEventSchema.extend({
    updateId: z.string().uuid(),
    updateBase64: encodedUpdateSchema,
  }).strict(),
  'yjs-sync-request': baseEventSchema.extend({
    requesterId: z.string().uuid(),
    stateVectorBase64: encodedUpdateSchema,
  }).strict(),
  'yjs-sync-response': baseEventSchema.extend({
    requesterId: z.string().uuid(),
    updateBase64: encodedUpdateSchema,
  }).strict(),
  'yjs-awareness': baseEventSchema.extend({
    updateBase64: encodedUpdateSchema,
  }).strict(),
  'document-state-reset': baseEventSchema.extend({
    revision: z.number().int().nonnegative(),
    reason: z.enum(['initialize', 'restore', 'agent']),
    updatedAt: z.string().datetime({ offset: true }),
  }).strict(),
} as const;

export type DocumentCollaborationEventName = keyof typeof eventSchemas;
export type DocumentCollaborationEvent =
  z.infer<(typeof eventSchemas)[DocumentCollaborationEventName]>;

export type DocumentCollaborationScope = {
  documentId: string;
  epoch: number;
};

export function parseDocumentCollaborationEvent(
  event: string,
  payload: unknown,
  scope?: DocumentCollaborationScope
): DocumentCollaborationEvent {
  const schema = eventSchemas[event as DocumentCollaborationEventName];
  if (!schema) {
    throw new DocumentCollaborationProtocolError('Unknown collaboration event');
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const sizeFailure = parsed.error.issues.some((issue) =>
      issue.message.toLowerCase().includes('size')
    );
    throw new DocumentCollaborationProtocolError(
      sizeFailure
        ? 'Invalid collaboration payload size'
        : 'Invalid collaboration payload'
    );
  }
  if (
    scope &&
    (parsed.data.documentId !== scope.documentId ||
      parsed.data.epoch !== scope.epoch)
  ) {
    throw new DocumentCollaborationProtocolError('Collaboration event scope mismatch');
  }
  return parsed.data;
}
