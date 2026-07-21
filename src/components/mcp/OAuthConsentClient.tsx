'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject } from '@/lib/services/projectService';
import { projectIdFromOAuthResource } from '@/lib/mcp/oauthProjectBinding';
import styles from './OAuthConsent.module.css';

type BoundDetails = OAuthAuthorizationDetails & { resource?: string };
type LoadedRequest = {
  authorizationId: string;
  details: BoundDetails;
};
type VerifiedBinding = LoadedRequest & {
  projectId: string;
  projectName: string;
};
type ConsentState = {
  authorizationId: string;
  request: LoadedRequest | null;
  verifiedBinding: VerifiedBinding | null;
  error: string;
  busy: boolean;
};

function emptyConsentState(authorizationId: string): ConsentState {
  return {
    authorizationId,
    request: null,
    verifiedBinding: null,
    error: '',
    busy: false,
  };
}

function verifiedBindingFor(
  binding: VerifiedBinding | null,
  authorizationId: string
): VerifiedBinding | null {
  if (!binding || binding.authorizationId !== authorizationId) return null;
  return projectIdFromOAuthResource(binding.details.resource) === binding.projectId
    ? binding
    : null;
}

export function OAuthConsentClient() {
  const supabase = useSupabase();
  const router = useRouter();
  const search = useSearchParams();
  const authorizationId = search.get('authorization_id') ?? '';
  const [state, setState] = useState<ConsentState>(emptyConsentState(authorizationId));
  const currentState = state.authorizationId === authorizationId
    ? state
    : emptyConsentState(authorizationId);
  const currentRequest = currentState.request;
  const currentVerifiedBinding = verifiedBindingFor(
    currentState.verifiedBinding,
    authorizationId
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!authorizationId) {
        if (active) {
          setState({
            ...emptyConsentState(authorizationId),
            error: 'Missing OAuth authorization ID.',
          });
        }
        return;
      }

      const result = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (result.error?.name === 'AuthSessionMissingError') {
        const target = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
        router.replace(`/projects?redirect=${encodeURIComponent(target)}`);
        return;
      }
      if (result.error || !result.data) {
        setState({
          ...emptyConsentState(authorizationId),
          error: 'Authorization request is unavailable or expired.',
        });
        return;
      }

      const next = result.data as BoundDetails;
      if (next.authorization_id !== authorizationId) {
        setState({
          ...emptyConsentState(authorizationId),
          error: 'Authorization request is unavailable or expired.',
        });
        return;
      }
      const boundProjectId = projectIdFromOAuthResource(next.resource);
      if (!boundProjectId) {
        setState({
          ...emptyConsentState(authorizationId),
          error: 'Project binding was not preserved by the authorization server.',
        });
        return;
      }
      if (next.redirect_url) {
        setState({
          ...emptyConsentState(authorizationId),
          error: 'Existing OAuth consent bypassed the project-bound approval step.',
        });
        return;
      }
      const request = { authorizationId, details: next };
      setState({ ...emptyConsentState(authorizationId), request });

      try {
        const project = await getProject(supabase, boundProjectId);
        if (!active) return;
        if (!project || project.id !== boundProjectId) {
          setState({
            ...emptyConsentState(authorizationId),
            request,
            error: 'You do not have access to the bound project.',
          });
        } else {
          setState({
            ...emptyConsentState(authorizationId),
            request,
            verifiedBinding: {
              ...request,
              projectId: boundProjectId,
              projectName: project.name,
            },
          });
        }
      } catch {
        if (active) {
          setState({
            ...emptyConsentState(authorizationId),
            request,
            error: 'You do not have access to the bound project.',
          });
        }
      }
    })();

    return () => { active = false; };
  }, [authorizationId, router, supabase]);

  async function decide(action: 'approve' | 'deny') {
    const binding = verifiedBindingFor(currentState.verifiedBinding, authorizationId);
    if (!authorizationId || (action === 'approve' && !binding)) return;
    setState({ ...currentState, busy: true });
    const result = action === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
      setState({
        ...currentState,
        error: 'Authorization decision could not be completed.',
        busy: false,
      });
      return;
    }
    window.location.assign(result.data.redirect_url);
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1>Authorize Keco MCP</h1>
        {currentRequest && <p><strong>{currentRequest.details.client.name}</strong> requests access to <strong>{currentVerifiedBinding?.projectName || 'the bound project'}</strong>.</p>}
        {currentRequest && <p>Requested scopes: {currentRequest.details.scope || 'default identity scopes'}</p>}
        {currentState.error && <p role="alert" className={styles.error}>{currentState.error}</p>}
        <div className={styles.actions}>
          <button type="button" onClick={() => void decide('deny')} disabled={currentState.busy || !currentRequest}>Deny</button>
          <button type="button" onClick={() => void decide('approve')} disabled={currentState.busy || !currentVerifiedBinding || Boolean(currentState.error)}>Approve</button>
        </div>
      </section>
    </main>
  );
}
