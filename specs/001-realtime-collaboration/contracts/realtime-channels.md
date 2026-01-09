# Realtime Channels Contract: Collaboration

**Feature**: Real-time Project Collaboration  
**Date**: 2026-01-08  
**Type**: Supabase Realtime Channels (WebSocket)

## Overview

This document defines the Realtime channel structure and event schemas for real-time collaboration features, including cell editing broadcasts and presence tracking.

---

## Channel Architecture

### Channel Naming Convention

```
library:{libraryId}:edits      // Cell edit broadcasts
library:{libraryId}:presence   // User presence tracking
db-changes:projects            // Database change notifications
```

**Scope**: Library-level isolation prevents cross-contamination between different libraries.

---

## Channel 1: Edit Broadcasts

**Channel Name**: `library:{libraryId}:edits`  
**Type**: Broadcast (fire-and-forget, no persistence)  
**Purpose**: Low-latency broadcasting of cell edits to all active collaborators

### Configuration

```typescript
const editChannel = supabase.channel(`library:${libraryId}:edits`, {
  config: {
    broadcast: { ack: false }, // Fire-and-forget for speed
  },
});
```

### Events

#### Event: `cell:update`

**Purpose**: Notify all users when a cell value changes.

**Payload**:
```typescript
type CellUpdateEvent = {
  type: 'cell:update';
  userId: string;
  userName: string;
  avatarColor: string;
  assetId: string;
  propertyKey: string;
  newValue: any; // JSON-serializable value
  oldValue?: any; // Optional for conflict detection
  timestamp: number; // Unix timestamp in ms
};
```

**Example**:
```typescript
await editChannel.send({
  type: 'broadcast',
  event: 'cell:update',
  payload: {
    type: 'cell:update',
    userId: 'user-123',
    userName: 'Alice',
    avatarColor: 'hsl(180, 70%, 60%)',
    assetId: 'asset-456',
    propertyKey: 'field-789',
    newValue: 'Updated text value',
    oldValue: 'Previous text value',
    timestamp: Date.now(),
  },
});
```

**Receiver Handling**:
```typescript
editChannel.on('broadcast', { event: 'cell:update' }, (payload) => {
  const event = payload.payload as CellUpdateEvent;
  
  // Update UI with new value
  updateCellInUI(event.assetId, event.propertyKey, event.newValue);
  
  // Check for conflicts
  if (hasLocalPendingEdit(event.assetId, event.propertyKey)) {
    handleConflict(event);
  }
  
  // Show notification if another user edited
  if (event.userId !== currentUserId) {
    showToast(`${event.userName} updated cell`);
  }
});
```

---

#### Event: `asset:create`

**Purpose**: Notify all users when a new asset row is added.

**Payload**:
```typescript
type AssetCreateEvent = {
  type: 'asset:create';
  userId: string;
  userName: string;
  assetId: string;
  assetName: string;
  propertyValues: Record<string, any>;
  timestamp: number;
};
```

**Example**:
```typescript
await editChannel.send({
  type: 'broadcast',
  event: 'asset:create',
  payload: {
    type: 'asset:create',
    userId: 'user-123',
    userName: 'Alice',
    assetId: 'new-asset-id',
    assetName: 'New Asset',
    propertyValues: {
      'field-1': 'value1',
      'field-2': 42,
    },
    timestamp: Date.now(),
  },
});
```

**Receiver Handling**:
```typescript
editChannel.on('broadcast', { event: 'asset:create' }, (payload) => {
  const event = payload.payload as AssetCreateEvent;
  
  // Add new row to table UI
  addAssetRowToUI(event.assetId, event.assetName, event.propertyValues);
  
  // Show notification
  if (event.userId !== currentUserId) {
    showToast(`${event.userName} added "${event.assetName}"`);
  }
});
```

---

#### Event: `asset:delete`

**Purpose**: Notify all users when an asset row is deleted.

**Payload**:
```typescript
type AssetDeleteEvent = {
  type: 'asset:delete';
  userId: string;
  userName: string;
  assetId: string;
  assetName: string;
  timestamp: number;
};
```

**Example**:
```typescript
await editChannel.send({
  type: 'broadcast',
  event: 'asset:delete',
  payload: {
    type: 'asset:delete',
    userId: 'user-123',
    userName: 'Alice',
    assetId: 'asset-456',
    assetName: 'Deleted Asset',
    timestamp: Date.now(),
  },
});
```

**Receiver Handling**:
```typescript
editChannel.on('broadcast', { event: 'asset:delete' }, (payload) => {
  const event = payload.payload as AssetDeleteEvent;
  
  // Remove row from UI
  removeAssetRowFromUI(event.assetId);
  
  // Check if user was editing deleted row
  if (isEditingAsset(event.assetId)) {
    showModal(`Asset "${event.assetName}" was deleted by ${event.userName}`);
    clearEditingState();
  }
});
```

---

## Channel 2: Presence Tracking

**Channel Name**: `library:{libraryId}:presence`  
**Type**: Presence (automatic state sync)  
**Purpose**: Track which users are currently viewing/editing the library

### Configuration

```typescript
const presenceChannel = supabase.channel(`library:${libraryId}:presence`, {
  config: {
    presence: {
      key: userId, // Unique key per user
    },
  },
});
```

### Presence State Schema

```typescript
type PresenceState = {
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  activeCell: {
    assetId: string;
    propertyKey: string;
  } | null;
  cursorPosition: {
    row: number;
    col: number;
  } | null;
  lastActivity: string; // ISO timestamp
  connectionStatus: 'online' | 'away';
};
```

### Lifecycle

#### Join (Track Presence)

```typescript
await presenceChannel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    await presenceChannel.track({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      avatarColor: currentUser.avatarColor,
      activeCell: null,
      cursorPosition: null,
      lastActivity: new Date().toISOString(),
      connectionStatus: 'online',
    });
  }
});
```

#### Update Presence

```typescript
// Update when user changes active cell
function handleCellFocus(assetId: string, propertyKey: string) {
  presenceChannel.track({
    userId: currentUser.id,
    userName: currentUser.name,
    userEmail: currentUser.email,
    avatarColor: currentUser.avatarColor,
    activeCell: { assetId, propertyKey },
    cursorPosition: null,
    lastActivity: new Date().toISOString(),
    connectionStatus: 'online',
  });
}

// Heartbeat every 30 seconds
setInterval(() => {
  presenceChannel.track({
    ...currentPresenceState,
    lastActivity: new Date().toISOString(),
  });
}, 30000);
```

#### Listen for Presence Changes

```typescript
presenceChannel.on('presence', { event: 'sync' }, () => {
  const state = presenceChannel.presenceState();
  
  // state is Record<string, PresenceState[]>
  // Key is userId, value is array (usually single element)
  const activeUsers = Object.values(state)
    .flat()
    .filter(user => user.userId !== currentUserId);
  
  // Update UI
  setActiveCollaborators(activeUsers);
  updatePresenceIndicators(activeUsers);
});

presenceChannel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  const user = newPresences[0] as PresenceState;
  showToast(`${user.userName} joined`);
});

presenceChannel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
  const user = leftPresences[0] as PresenceState;
  showToast(`${user.userName} left`);
});
```

#### Leave (Untrack Presence)

```typescript
// Cleanup on unmount
useEffect(() => {
  return () => {
    presenceChannel.untrack();
    presenceChannel.unsubscribe();
  };
}, []);
```

---

## Channel 3: Database Changes

**Channel Name**: `db-changes:projects`  
**Type**: Postgres Changes (reliable database event stream)  
**Purpose**: Notify users when collaborators are added/removed/updated

### Configuration

```typescript
const collaboratorChannel = supabase
  .channel('db-changes:projects')
  .on('postgres_changes', {
    event: '*', // INSERT, UPDATE, DELETE
    schema: 'public',
    table: 'project_collaborators',
    filter: `project_id=eq.${projectId}`,
  }, handleCollaboratorChange);

await collaboratorChannel.subscribe();
```

### Event Handler

```typescript
function handleCollaboratorChange(payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, any>;
  old: Record<string, any>;
  table: string;
  schema: string;
  commit_timestamp: string;
}) {
  switch (payload.eventType) {
    case 'INSERT':
      // New collaborator added
      if (payload.new.user_id === currentUserId && payload.new.accepted_at) {
        // Current user was added to project
        showToast('You were added as collaborator');
        refetchProjects();
      }
      break;
      
    case 'UPDATE':
      // Collaborator role changed
      if (payload.new.user_id === currentUserId) {
        const oldRole = payload.old.role;
        const newRole = payload.new.role;
        showToast(`Your role changed from ${oldRole} to ${newRole}`);
        refetchPermissions();
      }
      break;
      
    case 'DELETE':
      // Collaborator removed
      if (payload.old.user_id === currentUserId) {
        showToast('Your access was revoked');
        disconnectFromProject();
        navigateToProjects();
      }
      break;
  }
}
```

---

## Connection Management

### Subscription Lifecycle

```typescript
function useRealtimeCollaboration(libraryId: string) {
  useEffect(() => {
    // Create channels
    const editChannel = supabase.channel(`library:${libraryId}:edits`);
    const presenceChannel = supabase.channel(`library:${libraryId}:presence`);
    
    // Setup event listeners
    editChannel.on('broadcast', { event: 'cell:update' }, handleCellUpdate);
    editChannel.on('broadcast', { event: 'asset:create' }, handleAssetCreate);
    editChannel.on('broadcast', { event: 'asset:delete' }, handleAssetDelete);
    
    presenceChannel.on('presence', { event: 'sync' }, handlePresenceSync);
    presenceChannel.on('presence', { event: 'join' }, handlePresenceJoin);
    presenceChannel.on('presence', { event: 'leave' }, handlePresenceLeave);
    
    // Subscribe
    editChannel.subscribe();
    presenceChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track(initialPresenceState);
      }
    });
    
    // Cleanup
    return () => {
      editChannel.unsubscribe();
      presenceChannel.untrack();
      presenceChannel.unsubscribe();
    };
  }, [libraryId]);
}
```

### Error Handling

```typescript
function handleChannelError(channel: RealtimeChannel) {
  channel.on('system', {}, (payload) => {
    if (payload.status === 'CHANNEL_ERROR') {
      console.error('Channel error:', payload);
      showToast('Connection error. Reconnecting...', { type: 'warning' });
      
      // Attempt reconnect
      setTimeout(() => {
        channel.subscribe();
      }, 2000);
    }
  });
}
```

### Connection Status Indicator

```typescript
function ConnectionStatus() {
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  
  useEffect(() => {
    const channel = supabase.channel('connection-test');
    
    channel.on('system', {}, (payload) => {
      if (payload.status === 'SUBSCRIBED') {
        setStatus('connected');
      } else if (payload.status === 'CHANNEL_ERROR') {
        setStatus('disconnected');
      }
    });
    
    channel.subscribe();
    
    return () => {
      channel.unsubscribe();
    };
  }, []);
  
  return (
    <div className={styles.connectionStatus}>
      {status === 'connected' && <GreenDot />}
      {status === 'disconnected' && <RedDot />}
      {status === 'connecting' && <YellowDot />}
    </div>
  );
}
```

---

## Performance Considerations

### Message Throttling

```typescript
import { throttle } from 'lodash';

// Throttle cursor position updates (max 10/second)
const sendCursorUpdate = throttle((row: number, col: number) => {
  presenceChannel.track({
    ...currentPresenceState,
    cursorPosition: { row, col },
    lastActivity: new Date().toISOString(),
  });
}, 100);

// Debounce cell value broadcasts (wait for typing pause)
import { debounce } from 'lodash';

const broadcastCellUpdate = debounce((assetId: string, propertyKey: string, value: any) => {
  editChannel.send({
    type: 'broadcast',
    event: 'cell:update',
    payload: {
      type: 'cell:update',
      userId: currentUserId,
      userName: currentUserName,
      avatarColor: currentUserColor,
      assetId,
      propertyKey,
      newValue: value,
      timestamp: Date.now(),
    },
  });
}, 500);
```

### Payload Size Limits

- **Broadcast**: Max 250KB per message
- **Presence**: Max 100KB per user state
- **Best practice**: Keep payloads minimal, reference database for large data

### Subscription Limits

- **Per client**: Max 100 channels
- **Per channel**: Max 1000 connected clients
- **Rate limit**: 100 messages/second per channel

---

## Security

### Channel Authorization

Supabase Realtime respects RLS policies:
- User must have SELECT permission on `library_assets` to subscribe to `library:{id}:edits`
- User must be active collaborator (checked via RLS)

### Message Validation

Always validate broadcast payloads:
```typescript
const CellUpdateSchema = z.object({
  type: z.literal('cell:update'),
  userId: z.string().uuid(),
  userName: z.string(),
  avatarColor: z.string(),
  assetId: z.string().uuid(),
  propertyKey: z.string(),
  newValue: z.any(),
  timestamp: z.number(),
});

editChannel.on('broadcast', { event: 'cell:update' }, (payload) => {
  try {
    const event = CellUpdateSchema.parse(payload.payload);
    handleCellUpdate(event);
  } catch (error) {
    console.error('Invalid payload:', error);
  }
});
```

---

## Testing

### Mock Realtime Channels

```typescript
// tests/mocks/supabase-realtime.ts
export function createMockChannel(name: string) {
  const listeners = new Map();
  const presenceState = new Map();
  
  return {
    on: (type: string, filter: any, callback: Function) => {
      listeners.set(`${type}:${filter.event}`, callback);
      return this;
    },
    send: async (message: any) => {
      const listener = listeners.get(`broadcast:${message.event}`);
      if (listener) {
        listener({ payload: message.payload });
      }
    },
    track: async (state: any) => {
      presenceState.set(state.userId, state);
      const listener = listeners.get('presence:sync');
      if (listener) {
        listener();
      }
    },
    presenceState: () => {
      return Object.fromEntries(presenceState);
    },
    subscribe: async (callback?: Function) => {
      if (callback) callback('SUBSCRIBED');
    },
    unsubscribe: async () => {},
    untrack: async () => {},
  };
}
```

### E2E Tests

Test scenarios:
1. Two users editing different cells (no conflicts)
2. Two users editing same cell (conflict resolution)
3. User joins/leaves (presence updates)
4. Connection lost/restored (reconnection)
5. Permission revoked mid-session (graceful disconnect)

---

## Summary

This contract defines:
- ✅ Channel naming and scoping strategy
- ✅ Event schemas for edits and presence
- ✅ Subscription lifecycle management
- ✅ Error handling and reconnection logic
- ✅ Performance optimization patterns
- ✅ Security validation requirements
- ✅ Testing approach for realtime features

