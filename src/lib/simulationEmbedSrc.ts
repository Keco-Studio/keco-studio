export type SimulationEmbedProject = {
  id: string;
  name: string;
};

export type SimulationEmbedContext = {
  projectId?: string;
  projectName?: string;
  projects?: SimulationEmbedProject[];
};

/** Iframe URL for the embedded simulation app (demo is a root SPA). */
export function buildSimulationEmbedSrc(origin: string, ctx?: SimulationEmbedContext): string {
  const base = origin.replace(/\/$/, '');
  const url = new URL(`${base}/`);
  if (ctx?.projectId) url.searchParams.set('projectId', ctx.projectId);
  if (ctx?.projectName) url.searchParams.set('projectName', ctx.projectName);
  if (ctx?.projects?.length) {
    url.searchParams.set('projects', encodeURIComponent(JSON.stringify(ctx.projects)));
  }
  return url.toString();
}
