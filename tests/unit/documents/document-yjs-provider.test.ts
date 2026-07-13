/**
 * Unit tests for DocumentYjsProvider helpers: encode/decode and remote apply
 * merge two Y.Docs the way Realtime broadcast would.
 */

import * as Y from 'yjs';
import {
  applyRemoteYjsUpdate,
  base64ToUint8,
  DocumentYjsProvider,
  uint8ToBase64,
} from '@/lib/documents/documentYjsProvider';

function fakeSupabase() {
  return {
    channel: () => ({
      on: () => ({ on: () => ({ on: () => ({ subscribe: () => {} }) }) }),
      send: async () => ({}),
      subscribe: () => {},
    }),
    removeChannel: async () => {},
  } as never;
}

describe('documentYjsProvider encoding', () => {
  it('round-trips Uint8Array through base64', () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
    expect(Array.from(base64ToUint8(uint8ToBase64(original)))).toEqual(
      Array.from(original)
    );
  });

  it('merges concurrent Y.Text updates across two docs', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const textA = docA.getText('md');
    const textB = docB.getText('md');

    textA.insert(0, 'Hello');
    applyRemoteYjsUpdate(docB, Y.encodeStateAsUpdate(docA));

    textB.insert(5, ' world');
    applyRemoteYjsUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(textA.toString()).toBe('Hello world');
    expect(textB.toString()).toBe('Hello world');
  });

  it('persists state as base64 that rehydrates a fresh doc', () => {
    const doc = new Y.Doc();
    doc.getText('md').insert(0, 'persist me');
    const encoded = uint8ToBase64(Y.encodeStateAsUpdate(doc));

    const restored = new Y.Doc();
    applyRemoteYjsUpdate(restored, base64ToUint8(encoded));
    expect(restored.getText('md').toString()).toBe('persist me');
  });

  it('defers Postgres yjs_state until applyInitialState (avoids double hydrate)', () => {
    const seed = new Y.Doc();
    seed.getText('root').insert(0, 'seeded');
    const encoded = uint8ToBase64(Y.encodeStateAsUpdate(seed));

    const doc = new Y.Doc();
    const provider = new DocumentYjsProvider({
      supabase: fakeSupabase(),
      documentId: 'doc-1',
      doc,
      initialStateBase64: encoded,
    });

    expect(doc.getText('root').toString()).toBe('');
    provider.applyInitialState();
    expect(doc.getText('root').toString()).toBe('seeded');
    // Second call must be a no-op (idempotent guard).
    provider.applyInitialState();
    expect(doc.getText('root').toString()).toBe('seeded');
    provider.destroy();
  });
});
