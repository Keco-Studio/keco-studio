'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { usePresenceTracking } from '@/lib/hooks/usePresenceTracking';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import type { PresenceState } from '@/lib/types/collaboration';

type PresenceContextType = {
  presenceUsers: PresenceState[];
  isTracking: boolean;
  updateActiveCell: (assetId: string | null, propertyKey: string | null) => Promise<void>;
  updateCursorPosition: (row: number | null, col: number | null) => void;
  getUsersEditingCell: (assetId: string, propertyKey: string) => PresenceState[];
  getActiveUsers: () => PresenceState[];
  currentLibraryId: string | null;
};

const PresenceContext = createContext<PresenceContextType | null>(null);

type PresenceProviderProps = {
  children: ReactNode;
  libraryId: string | null;
};

export function PresenceProvider({ children, libraryId }: PresenceProviderProps) {
  const { userProfile } = useAuth();
  
  const userAvatarColor = userProfile?.id ? getUserAvatarColor(userProfile.id) : '#999999';
  
  const {
    presenceUsers,
    isTracking,
    updateActiveCell,
    updateCursorPosition,
    getUsersEditingCell,
    getActiveUsers,
  } = usePresenceTracking({
    libraryId: libraryId || '',
    userId: userProfile?.id || '',
    userName: userProfile?.username || userProfile?.full_name || userProfile?.email || 'Anonymous',
    userEmail: userProfile?.email || '',
    avatarColor: userAvatarColor,
    debugLabel: 'GlobalProvider',
  });

  return (
    <PresenceContext.Provider
      value={{
        presenceUsers: presenceUsers || [],
        isTracking,
        updateActiveCell,
        updateCursorPosition,
        getUsersEditingCell,
        getActiveUsers,
        currentLibraryId: libraryId,
      }}
    >
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error('usePresence must be used within a PresenceProvider');
  }
  return context;
}

