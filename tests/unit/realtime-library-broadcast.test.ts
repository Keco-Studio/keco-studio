import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('library broadcast delivery', () => {
  it('sends library edit broadcasts through explicit httpSend', () => {
    const helper = readFileSync(
      join(process.cwd(), 'src/lib/realtime/sendLibraryBroadcast.ts'),
      'utf8'
    );
    const broadcasts = readFileSync(
      join(process.cwd(), 'src/lib/hooks/realtime/useLibraryBroadcasts.ts'),
      'utf8'
    );
    const subscription = readFileSync(
      join(process.cwd(), 'src/lib/hooks/useRealtimeSubscription.ts'),
      'utf8'
    );

    expect(helper).toContain('channel.httpSend(');
    expect(broadcasts).toContain('sendLibraryBroadcast(');
    expect(broadcasts).not.toContain('.send({');
    expect(subscription).toContain('sendLibraryBroadcast(');
    expect(subscription).not.toContain("type: 'broadcast'");
  });
});
