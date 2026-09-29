'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useSupabase } from '@/lib/SupabaseContext';
import styles from './ChatPanel.module.css';

const uuid = z.string().uuid();
const childStatus = z.object({ status: z.string().max(40) });
const gddStatus = z.object({
  jobType: z.literal('gdd'), jobId: uuid, status: z.string().max(80), phase: z.string().max(80).optional(),
  workerWake: z.string().max(40).optional(), resourceWake: z.string().max(40).optional(),
  mapWake: z.string().max(40).optional(), error: z.string().max(200).optional(),
  document: z.object({ id: uuid, name: z.string().max(160), url: z.string().regex(/^\/[0-9a-f-]{36}\/doc\/[0-9a-f-]{36}$/i) }).optional(),
  resources: z.array(childStatus.extend({ kind: z.string().max(40) })).nullable().optional(),
  maps: z.array(childStatus.extend({ title: z.string().max(160) })).nullable().optional(),
});

export type GddChatJob = z.infer<typeof gddStatus>;

export function parseGddChatJob(value: unknown): GddChatJob | null {
  const parsed = gddStatus.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function gddChatJobHasPendingWork(job: GddChatJob): boolean {
  if (job.status === 'queued' || job.status === 'running' || job.status === 'waiting_for_maps') return true;
  if (job.status === 'failed') return false;
  if (job.status !== 'completed' && job.status !== 'completed_with_map_failures') return true;
  if (!job.resources || !job.maps) return true;
  return [...job.resources, ...job.maps].some((child) => child.status === 'queued' || child.status === 'running');
}

export function GddChatJobStatus({ initial }: { initial: GddChatJob }) {
  const supabase = useSupabase();
  const { data: job = initial, error } = useQuery({
    queryKey: ['agent-gdd-job', initial.jobId],
    initialData: initial,
    queryFn: async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const response = await fetch(`/api/agent-chat/gdd-jobs/${initial.jobId}`, {
          credentials: 'include', cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 404 ? 'Job access unavailable.' : 'Status unavailable.');
        const payload = await response.json() as { job?: unknown };
        const parsed = parseGddChatJob(payload.job);
        if (!parsed || parsed.jobId !== initial.jobId) throw new Error('Status unavailable.');
        return parsed;
      } catch (error) {
        if (error instanceof Error && error.message === 'Job access unavailable.') throw error;
        throw new Error('Status unavailable.');
      }
    },
    retry: false,
    refetchInterval: (query) => {
      if (query.state.error?.message === 'Job access unavailable.') return false;
      return gddChatJobHasPendingWork(query.state.data ?? initial) ? 3_000 : false;
    },
    refetchOnWindowFocus: true,
  });
  const pending = gddChatJobHasPendingWork(job);
  return <div className={`${styles.bubble} ${styles.assistant}`} data-testid="generation-job-status" aria-live="polite">
    <div>GDD generation: {job.status}{job.phase && job.phase !== job.status ? ` (${job.phase})` : ''}</div>
    {job.document && <a href={job.document.url}>{job.document.name}</a>}
    {job.resources?.map((resource, index) => <div key={`resource-${index}`}>{resource.kind}: {resource.status}</div>)}
    {job.maps?.map((map, index) => <div key={`map-${index}`}>{map.title}: {map.status}</div>)}
    {job.error && <div>{job.error}</div>}
    {error && <div>{error.message === 'Status unavailable.' ? 'Status unavailable; retrying...' : error.message}</div>}
    {pending && !error && <div>Updating automatically...</div>}
  </div>;
}
