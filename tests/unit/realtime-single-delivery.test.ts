import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceRealtimeConnection,
  type RealtimeConnectionPhase,
} from '@/lib/realtime/reconnect-reconciliation';

describe('single-path realtime delivery', () => {
  it('reconciles exactly once after a disconnected channel resubscribes', () => {
    let phase: RealtimeConnectionPhase = 'initial';

    let transition = advanceRealtimeConnection(phase, 'SUBSCRIBED');
    phase = transition.phase;
    expect(transition.shouldReconcile).toBe(false);

    transition = advanceRealtimeConnection(phase, 'CHANNEL_ERROR');
    phase = transition.phase;
    expect(transition.shouldReconcile).toBe(false);

    transition = advanceRealtimeConnection(phase, 'SUBSCRIBED');
    phase = transition.phase;
    expect(transition.shouldReconcile).toBe(true);

    transition = advanceRealtimeConnection(phase, 'SUBSCRIBED');
    expect(transition.shouldReconcile).toBe(false);
  });

  it('removes database change delivery and timing-based deduplication from the hook', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/hooks/realtime/useLibraryChannel.ts'),
      'utf8'
    );
    const compositionSource = readFileSync(
      join(process.cwd(), 'src/lib/hooks/useRealtimeSubscription.ts'),
      'utf8'
    );

    expect(source).not.toContain("table: 'library_asset_values'");
    expect(source).not.toContain("table: 'library_assets'");
    expect(source).toContain("table: 'library_versions'");
    expect(source).not.toContain('recentBroadcastsRef');
    expect(source).not.toContain('recentBatchCellKeysRef');
    expect(source).toContain('onReconnect');
    expect(source).toContain('advanceRealtimeConnection');
    expect(compositionSource).toContain('optimisticUpdatesRef');
    expect(compositionSource).toContain('queuedUpdatesRef');
    expect(source).toContain('runtimeRef');
    expect(source).toMatch(/\}, \[libraryId, supabase\]\);/);
  });

  it('uses a forward migration to remove both library tables from the publication', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260713030000_remove_library_tables_from_realtime.sql'
      ),
      'utf8'
    );

    expect(migration).toContain('DROP TABLE public.library_asset_values');
    expect(migration).toContain('DROP TABLE public.library_assets');
    expect(migration).toContain('project_collaborators');
  });
});
