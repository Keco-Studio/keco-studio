import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('document realtime broadcast delivery', () => {
  it('sends document collaboration broadcasts through explicit httpSend', () => {
    const session = readFileSync(
      join(process.cwd(), 'src/lib/documents/documentCollaborationSession.ts'),
      'utf8'
    );
    const documentBroadcast = readFileSync(
      join(process.cwd(), 'src/lib/documents/documentBroadcast.ts'),
      'utf8'
    );
    const resetBroadcaster = readFileSync(
      join(process.cwd(), 'src/lib/documents/documentStateResetBroadcaster.ts'),
      'utf8'
    );

    expect(session).toContain('httpSend(');
    expect(session).not.toContain("type: 'broadcast'");
    expect(documentBroadcast).toContain('channel.httpSend(');
    expect(documentBroadcast).not.toContain("type: 'broadcast'");
    expect(resetBroadcaster).toContain('channel.httpSend(');
    expect(resetBroadcaster).not.toContain("type: 'broadcast'");
  });
});
