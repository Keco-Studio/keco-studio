export type ScriptPlotTitleChapter = {
  id: string;
  contents: string[];
  incomingOption?: string;
  title?: string;
};

export type ScriptPlotTitleResult = {
  titles: Record<string, string>;
};

export async function summarizeScriptPlotTitlesClient(input: {
  projectId: string;
  libraryId: string;
  chapters?: ScriptPlotTitleChapter[];
}): Promise<ScriptPlotTitleResult> {
  const response = await fetch('/api/script-plot-titles', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'Failed to summarize chapter titles',
    );
  }
  const titles = payload.titles && typeof payload.titles === 'object'
    ? Object.fromEntries(
      Object.entries(payload.titles as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    : {};
  return { titles };
}
