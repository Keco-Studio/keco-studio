import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  AssetCreateEvent,
  AssetDeleteEvent,
  CellUpdateEvent,
  CellsBatchUpdateEvent,
  OptimisticUpdate,
  RowOrderChangeEvent,
} from '@/lib/types/collaboration';

export type RealtimeSubscriptionConfig = {
  libraryId: string;
  currentUserId: string;
  currentUserName: string;
  currentUserEmail: string;
  avatarColor: string;
  onCellUpdate: (event: CellUpdateEvent) => void;
  onAssetCreate: (event: AssetCreateEvent) => void;
  onAssetDelete: (event: AssetDeleteEvent) => void;
  onConflict: (event: CellUpdateEvent, localValue: any) => void;
  onRowOrderChange?: (event: RowOrderChangeEvent) => void;
  onCellsBatchUpdate?: (event: CellsBatchUpdateEvent) => void;
  onReconnect?: () => void | Promise<void>;
  onVersionChange?: (payload: any) => void;
};

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export type LibraryChannelRuntime = {
  config: RealtimeSubscriptionConfig;
  optimisticUpdatesRef: MutableRefObject<Map<string, OptimisticUpdate>>;
  removeOptimisticUpdate: (assetId: string, propertyKey: string) => void;
  processQueuedUpdates: () => Promise<void>;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  broadcastDebounceRef: MutableRefObject<Map<string, NodeJS.Timeout>>;
};

export type LibraryBroadcastRuntime = {
  channelRef: MutableRefObject<RealtimeChannel | null>;
  broadcastDebounceRef: MutableRefObject<Map<string, NodeJS.Timeout>>;
  connectionStatus: ConnectionStatus;
  addOptimisticUpdate: (update: OptimisticUpdate) => void;
  removeOptimisticUpdate: (assetId: string, propertyKey: string) => void;
  queueUpdate: (event: CellUpdateEvent) => void;
};
