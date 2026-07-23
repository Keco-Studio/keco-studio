'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject } from '@/lib/services/projectService';
import { getOAuthAuthorizationResource } from '@/lib/mcp/oauthAuthorizationResource';
import { classifyOAuthResource } from '@/lib/mcp/oauthProjectBinding';
import styles from './OAuthConsent.module.css';

type BoundDetails = OAuthAuthorizationDetails & { resource: string };
type LoadedRequest = {
  authorizationId: string;
  details: OAuthAuthorizationDetails;
};
type AccountBinding = Omit<LoadedRequest, 'details'> & {
  details: BoundDetails;
  mode: 'account';
};
type ProjectBinding = Omit<LoadedRequest, 'details'> & {
  details: BoundDetails;
  mode: 'project';
  projectId: string;
  projectName: string;
};
type VerifiedBinding = AccountBinding | ProjectBinding;
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
  const resource = classifyOAuthResource(binding.details.resource);
  if (binding.mode === 'account') {
    return resource?.mode === 'account' ? binding : null;
  }
  return resource?.mode === 'project' && resource.projectId === binding.projectId
    ? binding
    : null;
}

export function OAuthConsentClient() {
  const supabase = useSupabase();
  const router = useRouter();
  const search = useSearchParams();
  const authorizationId = search.get('authorization_id') ?? '';
  const authorizationIdRef = useRef(authorizationId);
  const [state, setState] = useState<ConsentState>(emptyConsentState(authorizationId));
  const currentState = state.authorizationId === authorizationId
    ? state
    : emptyConsentState(authorizationId);
  const currentRequest = currentState.request;
  const currentVerifiedBinding = verifiedBindingFor(
    currentState.verifiedBinding,
    authorizationId
  );

  useLayoutEffect(() => {
    authorizationIdRef.current = authorizationId;
  }, [authorizationId]);

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

      const next = result.data as OAuthAuthorizationDetails;
      if (next.authorization_id !== authorizationId) {
        setState({
          ...emptyConsentState(authorizationId),
          error: 'Authorization request is unavailable or expired.',
        });
        return;
      }
      const request: LoadedRequest = { authorizationId, details: next };
      if (next.redirect_url) {
        window.location.assign(next.redirect_url);
        return;
      }
      let resource: string | null;
      try {
        resource = await getOAuthAuthorizationResource(supabase, authorizationId);
      } catch {
        resource = null;
      }
      if (!active) return;
      const binding = classifyOAuthResource(resource);
      if (!binding) {
        setState({
          ...emptyConsentState(authorizationId),
          request,
          error: 'Project binding was not preserved by the authorization server.',
        });
        return;
      }
      const boundRequest = { authorizationId, details: { ...next, resource } };
      setState({ ...emptyConsentState(authorizationId), request });

      if (binding.mode === 'account') {
        setState({
          ...emptyConsentState(authorizationId),
          request,
          verifiedBinding: { ...boundRequest, mode: 'account' },
        });
        return;
      }

      try {
        const project = await getProject(supabase, binding.projectId);
        if (!active) return;
        if (!project || project.id !== binding.projectId) {
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
              ...boundRequest,
              mode: 'project',
              projectId: binding.projectId,
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
    const decisionAuthorizationId = authorizationId;
    setState({ ...currentState, busy: true });

    if (action === 'approve' && binding) {
      let latestResult: Awaited<ReturnType<
        typeof supabase.auth.oauth.getAuthorizationDetails
      >>;
      let latestResource: string | null;
      try {
        latestResult = await supabase.auth.oauth.getAuthorizationDetails(decisionAuthorizationId);
        latestResource = await getOAuthAuthorizationResource(supabase, decisionAuthorizationId);
      } catch {
        if (authorizationIdRef.current !== decisionAuthorizationId) return;
        setState({
          ...currentState,
          error: 'Authorization request changed before approval.',
          busy: false,
        });
        return;
      }
      if (authorizationIdRef.current !== decisionAuthorizationId) return;

      const latestDetails = latestResult.data as OAuthAuthorizationDetails | null;
      const latestBinding = classifyOAuthResource(latestResource);
      if (
        latestResult.error
        || !latestDetails
        || latestDetails.authorization_id !== decisionAuthorizationId
        || latestResource !== binding.details.resource
        || !latestBinding
        || latestBinding.mode !== binding.mode
        || (binding.mode === 'project'
          && (latestBinding.mode !== 'project' || latestBinding.projectId !== binding.projectId))
        || Boolean(latestDetails.redirect_url)
      ) {
        setState({
          ...currentState,
          error: 'Authorization request changed before approval.',
          busy: false,
        });
        return;
      }

      if (binding.mode === 'project') {
        try {
          const project = await getProject(supabase, binding.projectId);
          if (authorizationIdRef.current !== decisionAuthorizationId) return;
          if (!project || project.id !== binding.projectId) {
            setState({
              ...currentState,
              error: 'You do not have access to the bound project.',
              busy: false,
            });
            return;
          }
        } catch {
          if (authorizationIdRef.current !== decisionAuthorizationId) return;
          setState({
            ...currentState,
            error: 'You do not have access to the bound project.',
            busy: false,
          });
          return;
        }
      }
    }

    const result = action === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(decisionAuthorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(decisionAuthorizationId, { skipBrowserRedirect: true });
    if (authorizationIdRef.current !== decisionAuthorizationId) return;
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
        {currentRequest && <p><strong>{currentRequest.details.client.name}</strong> requests access to <strong>{currentVerifiedBinding?.mode === 'account' ? 'the Keco account' : currentVerifiedBinding?.projectName || 'the bound project'}</strong>.</p>}
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
