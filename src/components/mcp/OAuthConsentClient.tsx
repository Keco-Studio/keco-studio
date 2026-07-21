'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject } from '@/lib/services/projectService';
import { projectIdFromOAuthResource } from '@/lib/mcp/oauthProjectBinding';
import styles from './OAuthConsent.module.css';

type BoundDetails = OAuthAuthorizationDetails & { resource?: string };

export function OAuthConsentClient() {
  const supabase = useSupabase();
  const router = useRouter();
  const search = useSearchParams();
  const authorizationId = search.get('authorization_id') ?? '';
  const [details, setDetails] = useState<BoundDetails | null>(null);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const projectId = projectIdFromOAuthResource(details?.resource);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!authorizationId) {
        if (active) setError('Missing OAuth authorization ID.');
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
        setError('Authorization request is unavailable or expired.');
        return;
      }

      const next = result.data as BoundDetails;
      setDetails(next);
      const boundProjectId = projectIdFromOAuthResource(next.resource);
      if (!boundProjectId) {
        setError('Project binding was not preserved by the authorization server.');
        return;
      }
      if (next.redirect_url) {
        setError('Existing OAuth consent bypassed the project-bound approval step.');
        return;
      }

      try {
        const project = await getProject(supabase, boundProjectId);
        if (!active) return;
        if (!project) setError('You do not have access to the bound project.');
        else setProjectName(project.name);
      } catch {
        if (active) setError('You do not have access to the bound project.');
      }
    })();

    return () => { active = false; };
  }, [authorizationId, router, supabase]);

  async function decide(action: 'approve' | 'deny') {
    if (!authorizationId || (action === 'approve' && !projectId)) return;
    setBusy(true);
    const result = action === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
      setError('Authorization decision could not be completed.');
      setBusy(false);
      return;
    }
    window.location.assign(result.data.redirect_url);
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1>Authorize Keco MCP</h1>
        {details && <p><strong>{details.client.name}</strong> requests access to <strong>{projectName || 'the bound project'}</strong>.</p>}
        {details && <p>Requested scopes: {details.scope || 'default identity scopes'}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" onClick={() => void decide('deny')} disabled={busy || !details}>Deny</button>
          <button type="button" onClick={() => void decide('approve')} disabled={busy || !details || !projectId || Boolean(error)}>Approve</button>
        </div>
      </section>
    </main>
  );
}
