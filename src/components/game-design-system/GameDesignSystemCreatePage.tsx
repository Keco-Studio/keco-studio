'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
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
import { useAuth } from '@/lib/contexts/AuthContext';
import styles from './GameDesignSystemsPage.module.css';

const GENRES = ['RPG', 'Strategy', 'Deckbuilder', 'Roguelike', 'Simulation', 'Narrative', 'Action', 'Puzzle', 'Management'];
const PHILOSOPHIES = ['Meaningful Decisions', 'Readable Systems', 'System Driven', 'Narrative First', 'Player Agency', 'Emergent Play', 'Competitive Fairness', 'Expressive Customization'];
const stages = ['foundation', 'sources', 'review'] as const;

type ProjectOption = { id: string; name: string };
type GameDraft = { name: string; reference: string; avoid: string };
type Stage = typeof stages[number];

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
  return globalThis.crypto?.randomUUID?.() ?? 'gds-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

type Props = {
  embedded?: boolean;
  onCancel?: () => void;
  onCompleted?: (systemId: string) => void;
};

export function GameDesignSystemCreatePage({ embedded = false, onCancel, onCompleted }: Props = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userProfile } = useAuth();
  const systemsQuery = useQuery({ queryKey: queryKeys.gameDesignSystems(), queryFn: fetchGameDesignSystems });
  const projectsQuery = useQuery({ queryKey: queryKeys.projects(), queryFn: fetchProjects });
  const [stage, setStage] = useState<Stage>('foundation');
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
  const selectedReferenceIds = useMemo(() => new Set(references.map((reference) => reference.kind + ':' + reference.resourceId)), [references]);
  const baseSystems = useMemo(
    () => (systemsQuery.data ?? []).filter((system) => system.source === 'official' || system.owner_id === userProfile?.id),
    [systemsQuery.data, userProfile?.id],
  );
  const normalizedGames = useMemo(
    () => referenceGames
      .map((game) => ({ name: game.name.trim(), reference: game.reference.trim(), avoid: game.avoid.trim() }))
      .filter((game) => game.name || game.reference || game.avoid),
    [referenceGames],
  );

  useEffect(() => {
    if (!job || !submitting) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await fetchGameDesignSystemGenerationJob(job.id);
        setJob(fresh);
        if (fresh.status === 'completed' && fresh.design_system_id) {
          window.clearInterval(timer);
          await queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
          if (onCompleted) onCompleted(fresh.design_system_id);
          else router.push('/game-design-systems?systemId=' + encodeURIComponent(fresh.design_system_id));
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : 'Failed to read generation progress.');
      }
    }, 900);
    return () => window.clearInterval(timer);
  }, [job, onCompleted, queryClient, router, submitting]);

  function leave() {
    if (onCancel) onCancel();
    else router.push('/game-design-systems');
  }

  function toggle(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function toggleReference(reference: GameDesignSourceReference) {
    const key = reference.kind + ':' + reference.resourceId;
    setReferences((current) => current.some((item) => item.kind + ':' + item.resourceId === key)
      ? current.filter((item) => item.kind + ':' + item.resourceId !== key)
      : [...current, reference]);
  }

  function generationInput(): GameDesignGenerationRequest {
    return {
      title: title.trim(),
      genres,
      philosophies,
      references,
      referenceGames: normalizedGames,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(suitableFor.trim() ? { suitableFor: suitableFor.trim() } : {}),
      ...(baseSystemId ? { baseSystemId } : {}),
      ...(pastedMarkdown.trim() ? { pastedMarkdown: pastedMarkdown.trim() } : {}),
    };
  }

  async function submit() {
    setError(null);
    if (!title.trim()) {
      setStage('foundation');
      setError('Enter a system name.');
      return;
    }
    if (genres.length === 0 && philosophies.length === 0 && !description.trim() && !pastedMarkdown.trim() && references.length === 0 && normalizedGames.length === 0 && !baseSystemId) {
      setStage('foundation');
      setError('Add at least one genre, design philosophy, or reference.');
      return;
    }
    try {
      const fresh = await startGameDesignSystemGeneration(generationInput(), submitKey.current);
      setJob(fresh);
      if (fresh.status === 'completed' && fresh.design_system_id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.gameDesignSystems() });
        if (onCompleted) onCompleted(fresh.design_system_id);
        else router.push('/game-design-systems?systemId=' + encodeURIComponent(fresh.design_system_id));
      }
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

  function returnToSources() {
    setJob(null);
    setStage('sources');
    submitKey.current = newIdempotencyKey();
    retryKey.current = newIdempotencyKey();
  }

  if (job) {
    const phases = ['collecting', 'generating', 'validating', 'saving', 'completed'];
    const currentIndex = phases.indexOf(job.phase);
    const retryAt = job.status === 'queued' && job.attempt_count > 0 ? new Date(job.available_at).toLocaleTimeString() : null;
    return (
      <section className={embedded ? styles.createWorkspace : styles.page}>
        <div className={styles.progress} aria-live="polite">
          <span className={styles.eyebrow}>Durable generation job</span>
          <h2>{job.status === 'failed' ? 'Generation incomplete' : 'Generating Game Design System'}</h2>
          <p>{job.status === 'failed' ? job.error || 'The model did not return usable structured rules.' : 'Attempt ' + Math.max(job.attempt_count, 1) + ' / ' + job.max_attempts + (retryAt ? ', retrying at ' + retryAt : '')}</p>
          <div className={styles.progressList}>
            {phases.map((phase, index) => {
              const done = job.status === 'completed' || index < currentIndex;
              const current = job.status !== 'failed' && index === currentIndex;
              return <div className={styles.progressRow + ' ' + (done ? styles.progressRowDone : '') + ' ' + (current ? styles.progressRowCurrent : '')} key={phase}><span className={styles.dot} />{phaseLabels[phase]}</div>;
            })}
          </div>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          {job.status === 'failed' ? <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={returnToSources}><ArrowLeftOutlined /> Back to sources</button><button className={styles.primaryButton} type="button" onClick={() => void retry()}><ReloadOutlined /> Retry job</button></div> : null}
        </div>
      </section>
    );
  }

  return (
    <section className={embedded ? styles.createWorkspace : styles.page}>
      <header className={styles.createHeader}>
        <div>
          <button className={styles.secondaryButton} type="button" onClick={leave}><ArrowLeftOutlined /> Back to systems</button>
          <span className={styles.eyebrow}>New system</span>
          <h1>Create Game Design System</h1>
          <p>Define the design direction, choose real sources, then start a durable structured-rule generation job.</p>
        </div>
      </header>

      <nav className={styles.stageTabs} role="tablist" aria-label="Creation stages">
        {stages.map((item, index) => {
          const label = item === 'foundation' ? 'Foundation' : item === 'sources' ? 'Sources' : 'Review';
          return <button role="tab" type="button" aria-label={label} aria-selected={stage === item} className={stage === item ? styles.stageTabActive : styles.stageTab} key={item} onClick={() => setStage(item)}><span aria-hidden="true">{index + 1}</span>{label}</button>;
        })}
      </nav>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {stage === 'foundation' ? (
        <section className={styles.createStage} role="tabpanel">
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Step 1</span><h2>Foundation</h2><p>Set the direction the generated rules must preserve.</p></div></div>
          <div className={styles.formGrid}>
            <div className={styles.field}><label htmlFor="gds-title">System name</label><input id="gds-title" className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tactical Deckbuilder" /></div>
            <div className={styles.field}><label htmlFor="gds-suitable">Suitable for</label><input id="gds-suitable" className={styles.input} value={suitableFor} onChange={(event) => setSuitableFor(event.target.value)} placeholder="Single-player, run-based games" /></div>
            <div className={styles.field}><label>Game genres</label><div className={styles.checks}>{GENRES.map((genre) => <button type="button" key={genre} className={genres.includes(genre) ? styles.checkActive : styles.check} aria-pressed={genres.includes(genre)} onClick={() => toggle(genres, genre, setGenres)}>{genre}</button>)}</div></div>
            <div className={styles.field}><label>Design philosophies</label><div className={styles.checks}>{PHILOSOPHIES.map((philosophy) => <button type="button" key={philosophy} className={philosophies.includes(philosophy) ? styles.checkActive : styles.check} aria-pressed={philosophies.includes(philosophy)} onClick={() => toggle(philosophies, philosophy, setPhilosophies)}>{philosophy}</button>)}</div></div>
            <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="gds-description">Natural language description</label><textarea id="gds-description" className={styles.textarea} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the intended player experience, decisions, and tradeoffs." /></div>
          </div>
          <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={leave}>Cancel</button><button className={styles.primaryButton} type="button" onClick={() => { setError(null); setStage('sources'); }}>Continue to sources</button></div>
        </section>
      ) : null}

      {stage === 'sources' ? (
        <section className={styles.createStage} role="tabpanel">
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Step 2</span><h2>Sources</h2><p>Only selected resources and entered references are sent to generation.</p></div></div>
          <div className={styles.formGrid}>
            <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="gds-base">Base system</label><select id="gds-base" className={styles.select} value={baseSystemId} onChange={(event) => setBaseSystemId(event.target.value)}><option value="">No base system</option>{baseSystems.map((system) => <option key={system.id} value={system.id}>{system.title} ({system.source === 'official' ? 'Official' : 'My system'})</option>)}</select>{systemsQuery.isError ? <button type="button" className={styles.secondaryButton} onClick={() => systemsQuery.refetch()}><ReloadOutlined /> Retry systems</button> : null}</div>
            <div className={styles.fieldWide + ' ' + styles.field}>
              <label htmlFor="gds-source-project">Source project</label>
              <select id="gds-source-project" className={styles.select} value={sourceProjectId} onChange={(event) => { setSourceProjectId(event.target.value); setReferences([]); }}><option value="">Select a project containing source material</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
              {projectsQuery.isError ? <div className={styles.inlineError}>Failed to load projects.<button type="button" className={styles.secondaryButton} onClick={() => projectsQuery.refetch()}><ReloadOutlined /> Retry</button></div> : null}
              {sourceProjectId && referenceOptionsQuery.isLoading ? <div className={styles.resourceState}>Loading project resources...</div> : null}
              {sourceProjectId && referenceOptionsQuery.isError ? <div className={styles.inlineError}>Failed to load project resources.<button type="button" className={styles.secondaryButton} onClick={() => referenceOptionsQuery.refetch()}><ReloadOutlined /> Retry</button></div> : null}
              {sourceProjectId && referenceOptionsQuery.data?.length === 0 ? <div className={styles.resourceState}>This project has no referenceable documents or tables.</div> : null}
              {(referenceOptionsQuery.data?.length ?? 0) > 0 ? <div className={styles.resourcePicker}>{referenceOptionsQuery.data!.map((option) => {
                const key = option.kind + ':' + option.resourceId;
                return <label className={styles.resourceOption} key={key}><input type="checkbox" checked={selectedReferenceIds.has(key)} onChange={() => toggleReference({ kind: option.kind, projectId: option.projectId, resourceId: option.resourceId })} /><span><strong>{option.label}</strong><small>{option.kind === 'document' ? 'Document' : 'Keco table'} / Updated {new Date(option.updatedAt).toLocaleDateString()}</small></span></label>;
              })}</div> : null}
            </div>
            <div className={styles.fieldWide + ' ' + styles.field}><label htmlFor="gds-markdown">Existing GAME_DESIGN_SYSTEM.md</label><textarea id="gds-markdown" className={styles.editorCompact} value={pastedMarkdown} onChange={(event) => setPastedMarkdown(event.target.value)} placeholder="Paste legacy Markdown as a compatibility source." /></div>
            <div className={styles.fieldWide + ' ' + styles.field}>
              <label>Reference games</label>
              {referenceGames.map((game, index) => <div className={styles.referenceRow} key={index}><input className={styles.input} aria-label={'Reference game ' + (index + 1)} value={game.name} onChange={(event) => setReferenceGames((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Game name" /><input className={styles.input} aria-label={'Reference value ' + (index + 1)} value={game.reference} onChange={(event) => setReferenceGames((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reference: event.target.value } : item))} placeholder="What to reference" /><input className={styles.input} aria-label={'Reference avoid ' + (index + 1)} value={game.avoid} onChange={(event) => setReferenceGames((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, avoid: event.target.value } : item))} placeholder="What to avoid" /><button className={styles.iconButtonDanger} type="button" aria-label="Remove reference game" title="Remove reference game" onClick={() => setReferenceGames((current) => current.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutlined /></button></div>)}
              <button type="button" className={styles.secondaryButton} onClick={() => setReferenceGames((current) => [...current, { name: '', reference: '', avoid: '' }])}><PlusOutlined /> Add reference game</button>
            </div>
          </div>
          <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={() => setStage('foundation')}><ArrowLeftOutlined /> Foundation</button><button className={styles.primaryButton} type="button" onClick={() => { setError(null); setStage('review'); }}>Review input</button></div>
        </section>
      ) : null}

      {stage === 'review' ? (
        <section className={styles.createStage} role="tabpanel">
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Step 3</span><h2>Review</h2><p>Confirm the exact input before starting the durable job.</p></div></div>
          <div className={styles.reviewGrid}>
            <section><span className={styles.eyebrow}>Foundation</span><h3>{title.trim() || 'System name required'}</h3><dl className={styles.breakdown}><div><dt>Genres</dt><dd>{genres.join(', ') || 'None'}</dd></div><div><dt>Philosophies</dt><dd>{philosophies.join(', ') || 'None'}</dd></div><div><dt>Suitable for</dt><dd>{suitableFor.trim() || 'Not specified'}</dd></div></dl></section>
            <section><span className={styles.eyebrow}>Evidence</span><h3>{references.length + normalizedGames.length} selected references</h3><dl className={styles.breakdown}><div><dt>Project resources</dt><dd>{references.length}</dd></div><div><dt>Reference games</dt><dd>{normalizedGames.length}</dd></div><div><dt>Base system</dt><dd>{baseSystemId ? baseSystems.find((system) => system.id === baseSystemId)?.title || 'Selected' : 'None'}</dd></div></dl></section>
            <section><span className={styles.eyebrow}>Output contract</span><h3>Validated structured rules</h3><p>The job validates the canonical rule schema and saves one immutable version only after validation succeeds.</p></section>
          </div>
          <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={() => setStage('sources')}><ArrowLeftOutlined /> Sources</button><button className={styles.primaryButton} type="button" aria-label="Generate system" disabled={submitting} onClick={() => void submit()}><ThunderboltOutlined /> Generate system</button></div>
        </section>
      ) : null}
    </section>
  );
}
