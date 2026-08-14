'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { GameDesignSourceReference } from '@/lib/game-design-system/sourceSnapshots';
import {
  fetchGameDesignReferenceOptions,
  fetchGameDesignSystems,
  fetchGameDesignSystemGenerationJob,
  retryGameDesignSystemGeneration,
  startGameDesignSystemGeneration,
  type GameDesignGenerationRequest,
} from '@/lib/services/gameDesignSystemClient';
import type { GameDesignSystemGenerationJob } from '@/lib/services/gameDesignSystemService';
import { queryKeys } from '@/lib/utils/queryKeys';
import styles from './GameDesignSystemsPage.module.css';

const GENRES = ['RPG', 'Strategy', 'Deckbuilder', 'Roguelike', 'Simulation', 'Narrative', 'Action', 'Puzzle', 'Management'];
const PHILOSOPHIES = ['Meaningful Decisions', 'Readable Systems', 'System Driven', 'Narrative First', 'Player Agency', 'Emergent Play', 'Competitive Fairness', 'Expressive Customization'];

type ProjectOption = { id: string; name: string };
type GameDraft = { name: string; reference: string; avoid: string };

const phaseLabels: Record<string, string> = {
  collecting: 'Read and snapshot sources',
  generating: 'Generate structured rules',
  validating: 'Validate rule contract',
  saving: 'Save immutable version',
  completed: 'Completed',
  failed: 'Generation failed',
};

async function fetchProjects(): Promise<ProjectOption[]> {
  const response = await fetch('/api/projects', { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load projects.');
  return (await response.json()) as ProjectOption[];
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `gds-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function GameDesignSystemCreatePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const systemsQuery = useQuery({ queryKey: queryKeys.gameDesignSystems(), queryFn: fetchGameDesignSystems });
  const projectsQuery = useQuery({ queryKey: queryKeys.projects(), queryFn: fetchProjects });
  const [title, setTitle] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [philosophies, setPhilosophies] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [suitableFor, setSuitableFor] = useState('');
  const [baseSystemId, setBaseSystemId] = useState('');
  const [pastedMarkdown, setPastedMarkdown] = useState('');
  const [sourceProjectId, setSourceProjectId] = useState('');
  const [references, setReferences] = useState<GameDesignSourceReference[]>([]);
  const [referenceGames, setReferenceGames] = useState<GameDraft[]>([]);
  const [job, setJob] = useState<GameDesignSystemGenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitKey = useRef<string>(newIdempotencyKey());
  const retryKey = useRef<string>(newIdempotencyKey());

  const referenceOptionsQuery = useQuery({
    queryKey: ['game-design-system-reference-options', sourceProjectId],
    queryFn: () => fetchGameDesignReferenceOptions(sourceProjectId),
    enabled: Boolean(sourceProjectId),
  });
  const submitting = Boolean(job && (job.status === 'queued' || job.status === 'running'));
  const selectedReferenceIds = useMemo(() => new Set(references.map((reference) => `${reference.kind}:${reference.resourceId}`)), [references]);

  useEffect(() => {
    setReferences([]);
  }, [sourceProjectId]);

  useEffect(() => {
    if (!job || !submitting) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await fetchGameDesignSystemGenerationJob(job.id);
        setJob(fresh);
        if (fresh.status === 'completed' && fresh.design_system_id) {
          window.clearInterval(timer);
          await queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
          router.push(`/game-design-systems?systemId=${encodeURIComponent(fresh.design_system_id)}`);
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : 'Failed to read generation progress.');
      }
    }, 900);
    return () => window.clearInterval(timer);
  }, [job, queryClient, router, submitting]);

  function toggle(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function toggleReference(reference: GameDesignSourceReference) {
    const key = `${reference.kind}:${reference.resourceId}`;
    setReferences((current) => current.some((item) => `${item.kind}:${item.resourceId}` === key)
      ? current.filter((item) => `${item.kind}:${item.resourceId}` !== key)
      : [...current, reference]);
  }

  async function submit() {
    setError(null);
    if (!title.trim()) return setError('Enter a system name.');
    if (genres.length === 0 && philosophies.length === 0 && !description.trim() && !pastedMarkdown.trim() && references.length === 0 && referenceGames.length === 0 && !baseSystemId) {
      return setError('Add at least one genre, design philosophy, or reference.');
    }
    const input: GameDesignGenerationRequest = {
      title: title.trim(),
      genres,
      philosophies,
      references,
      referenceGames: referenceGames
        .map((game) => ({ name: game.name.trim(), reference: game.reference.trim(), avoid: game.avoid.trim() }))
        .filter((game) => game.name || game.reference || game.avoid),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(suitableFor.trim() ? { suitableFor: suitableFor.trim() } : {}),
      ...(baseSystemId ? { baseSystemId } : {}),
      ...(pastedMarkdown.trim() ? { pastedMarkdown: pastedMarkdown.trim() } : {}),
    };
    try {
      setJob(await startGameDesignSystemGeneration(input, submitKey.current));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to start generation.');
    }
  }

  async function retry() {
    if (!job) return;
    setError(null);
    try {
      setJob(await retryGameDesignSystemGeneration(job.id, retryKey.current));
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Failed to start retry.');
    }
  }

  function returnToForm() {
    setJob(null);
    submitKey.current = newIdempotencyKey();
    retryKey.current = newIdempotencyKey();
  }

  function addGame() {
    setReferenceGames((current) => [...current, { name: '', reference: '', avoid: '' }]);
  }

  if (job) {
    const phases = ['collecting', 'generating', 'validating', 'saving', 'completed'];
    const currentIndex = phases.indexOf(job.phase);
    const retryAt = job.status === 'queued' && job.attempt_count > 0
      ? new Date(job.available_at).toLocaleTimeString()
      : null;
    return (
      <main className={styles.page}>
        <section className={styles.progress} aria-live="polite">
          <h2>{job.status === 'failed' ? 'Generation incomplete' : 'Generating Game Design System'}</h2>
          <p>{job.status === 'failed' ? job.error || 'DeepSeek did not return usable structured rules.' : `Attempt ${Math.max(job.attempt_count, 1)} / ${job.max_attempts}${retryAt ? `, retrying at ${retryAt}` : ''}`}</p>
          <div className={styles.progressList}>
            {phases.map((phase, index) => {
              const done = job.status === 'completed' || index < currentIndex;
              const current = job.status !== 'failed' && index === currentIndex;
              return <div className={`${styles.progressRow} ${done ? styles.progressRowDone : ''} ${current ? styles.progressRowCurrent : ''}`} key={phase}><span className={styles.dot} />{phaseLabels[phase]}</div>;
            })}
          </div>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          {job.status === 'failed' ? <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={returnToForm}><ArrowLeftOutlined /> Back to references</button><button className={styles.primaryButton} type="button" onClick={() => void retry()}><ReloadOutlined /> Retry job</button></div> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><button className={styles.secondaryButton} type="button" onClick={() => router.push('/game-design-systems')}><ArrowLeftOutlined /> Back to systems</button><h1 className={styles.title} style={{ marginTop: 18 }}>Create Game Design System</h1><p className={styles.subtitle}>Add references and let DeepSeek generate verifiable structured rules as an immutable version.</p></div>
        <button className={styles.primaryButton} type="button" disabled={submitting} onClick={() => void submit()}><ThunderboltOutlined /> Generate system</button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <section className={styles.form}>
        <div className={styles.formGrid}>
          <div className={styles.field}><label htmlFor="gds-title">System name</label><input id="gds-title" className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="For example: Tactical Deckbuilder" /></div>
          <div className={styles.field}><label htmlFor="gds-suitable">Suitable for</label><input id="gds-suitable" className={styles.input} value={suitableFor} onChange={(event) => setSuitableFor(event.target.value)} placeholder="For example: Single-player, run-based" /></div>
          <div className={styles.field}><label>Game genres</label><div className={styles.checks}>{GENRES.map((genre) => <button type="button" key={genre} className={`${styles.check} ${genres.includes(genre) ? styles.checkActive : ''}`} aria-pressed={genres.includes(genre)} onClick={() => toggle(genres, genre, setGenres)}>{genre}</button>)}</div></div>
          <div className={styles.field}><label>Design philosophies</label><div className={styles.checks}>{PHILOSOPHIES.map((philosophy) => <button type="button" key={philosophy} className={`${styles.check} ${philosophies.includes(philosophy) ? styles.checkActive : ''}`} aria-pressed={philosophies.includes(philosophy)} onClick={() => toggle(philosophies, philosophy, setPhilosophies)}>{philosophy}</button>)}</div></div>
          <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="gds-description">Natural language description</label><textarea id="gds-description" className={styles.textarea} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the player experience, decision structure, and design tradeoffs to preserve" /></div>
          <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="gds-base">Base system</label><select id="gds-base" className={styles.select} value={baseSystemId} onChange={(event) => setBaseSystemId(event.target.value)}><option value="">No base system</option>{(systemsQuery.data ?? []).map((system) => <option key={system.id} value={system.id}>{system.title} ({system.source === 'official' ? 'Official' : 'My system'})</option>)}</select>{systemsQuery.isError ? <button type="button" className={styles.secondaryButton} onClick={() => systemsQuery.refetch()}><ReloadOutlined /> Retry systems</button> : null}</div>
          <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="gds-markdown">Paste an existing GAME_DESIGN_SYSTEM.md</label><textarea id="gds-markdown" className={styles.editor} style={{ minHeight: 180 }} value={pastedMarkdown} onChange={(event) => setPastedMarkdown(event.target.value)} placeholder="Legacy Markdown is parsed as a compatibility source before structured rules are generated" /></div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label htmlFor="gds-source-project">Source project</label>
            <select id="gds-source-project" className={styles.select} value={sourceProjectId} onChange={(event) => setSourceProjectId(event.target.value)}>
              <option value="">Select a project containing source material</option>
              {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            {projectsQuery.isError ? <div className={styles.inlineError}>Failed to load projects.<button type="button" className={styles.secondaryButton} onClick={() => projectsQuery.refetch()}><ReloadOutlined /> Retry</button></div> : null}
            {sourceProjectId && referenceOptionsQuery.isLoading ? <div className={styles.resourceState}>Loading project resources...</div> : null}
            {sourceProjectId && referenceOptionsQuery.isError ? <div className={styles.inlineError}>Failed to load project resources.<button type="button" className={styles.secondaryButton} onClick={() => referenceOptionsQuery.refetch()}><ReloadOutlined /> Retry</button></div> : null}
            {sourceProjectId && referenceOptionsQuery.data?.length === 0 ? <div className={styles.resourceState}>This project has no referenceable documents or tables.</div> : null}
            {(referenceOptionsQuery.data?.length ?? 0) > 0 ? <div className={styles.resourcePicker}>{referenceOptionsQuery.data!.map((option) => {
              const key = `${option.kind}:${option.resourceId}`;
              return <label className={styles.resourceOption} key={key}><input type="checkbox" checked={selectedReferenceIds.has(key)} onChange={() => toggleReference({ kind: option.kind, projectId: option.projectId, resourceId: option.resourceId })} /><span><strong>{option.label}</strong><small>{option.kind === 'document' ? 'Document' : 'Keco table'} · Updated {new Date(option.updatedAt).toLocaleDateString()}</small></span></label>;
            })}</div> : null}
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}><label>Reference games (what to reference and what to avoid)</label>{referenceGames.map((game, index) => <div className={styles.referenceRow} key={index}><input className={styles.input} aria-label={`Reference game ${index + 1}`} value={game.name} onChange={(event) => setReferenceGames((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Game name" /><input className={styles.input} value={game.reference} onChange={(event) => setReferenceGames((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reference: event.target.value } : item))} placeholder="What to reference" /><input className={styles.input} value={game.avoid} onChange={(event) => setReferenceGames((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, avoid: event.target.value } : item))} placeholder="What to avoid" /><button className={styles.remove} type="button" aria-label="Remove reference game" onClick={() => setReferenceGames((current) => current.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutlined /></button></div>)}<button type="button" className={styles.secondaryButton} onClick={addGame}><PlusOutlined /> Add reference game</button></div>
        </div>
        <div className={styles.formActions}><span>Select a genre or philosophy, or provide a description, source, base system, or reference game.</span><button className={styles.primaryButton} type="button" disabled={submitting} onClick={() => void submit()}><ThunderboltOutlined /> Generate system</button></div>
      </section>
    </main>
  );
}
