'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type DocumentRole = 'admin' | 'editor' | 'viewer';

export type DocumentPermissionState = {
  role: DocumentRole | null;
  isLoading: boolean;
  error: string | null;
  readOnly: boolean;
  userId: string | null;
  accessToken: string | null;
  userName: string | null;
};

export type LoadDocumentPermissionsOptions = {
  projectId: string;
  documentProjectId: string;
  supabase: SupabaseClient;
  fetcher?: typeof fetch;
};

const denied = (error: string): DocumentPermissionState => ({
  role: null,
  isLoading: false,
  error,
  readOnly: true,
  userId: null,
  accessToken: null,
  userName: null,
});

export async function loadDocumentPermissions({
  projectId,
  documentProjectId,
  supabase,
  fetcher = fetch,
}: LoadDocumentPermissionsOptions): Promise<DocumentPermissionState> {
  if (documentProjectId !== projectId) {
    return denied('This document does not belong to this project.');
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (error || !session?.user?.id || !session.access_token) {
      return denied('Your session could not be verified.');
    }

    const response = await fetcher(`/api/projects/${projectId}/role`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      return denied('Project permissions could not be loaded.');
    }
    const body = (await response.json()) as { role?: unknown };
    const role = body.role;
    if (role !== 'admin' && role !== 'editor' && role !== 'viewer') {
      return denied('You do not have access to this project.');
    }

    return {
      role,
      isLoading: false,
      error: null,
      readOnly: role === 'viewer',
      userId: session.user.id,
      accessToken: session.access_token,
      userName:
        (typeof session.user.user_metadata?.full_name === 'string' &&
        session.user.user_metadata.full_name.trim()
          ? session.user.user_metadata.full_name.trim()
          : null) ??
        (typeof session.user.user_metadata?.name === 'string' &&
        session.user.user_metadata.name.trim()
          ? session.user.user_metadata.name.trim()
          : null) ??
        session.user.email?.split('@')[0] ??
        'Collaborator',
    };
  } catch {
    return denied('Project permissions could not be loaded.');
  }
}

const loadingState: DocumentPermissionState = {
  role: null,
  isLoading: true,
  error: null,
  readOnly: true,
  userId: null,
  accessToken: null,
  userName: null,
};

export function useDocumentPermissions({
  projectId,
  documentProjectId,
  supabase,
}: {
  projectId: string;
  documentProjectId: string | null;
  supabase: SupabaseClient;
}): DocumentPermissionState {
  const requestKey = `${projectId}:${documentProjectId ?? ''}`;
  const [loaded, setLoaded] = useState<{
    requestKey: string;
    permission: DocumentPermissionState;
  }>({ requestKey: '', permission: loadingState });

  useEffect(() => {
    if (!documentProjectId) return;
    let active = true;
    void loadDocumentPermissions({ projectId, documentProjectId, supabase }).then((next) => {
      if (active) setLoaded({ requestKey, permission: next });
    });
    return () => {
      active = false;
    };
  }, [documentProjectId, projectId, requestKey, supabase]);

  if (loaded.requestKey !== requestKey) return loadingState;
  return loaded.permission;
}
