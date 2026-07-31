'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Library } from '@/lib/services/libraryService';
import { useSupabase } from '@/lib/SupabaseContext';
import { requestAiFieldMappings } from '@/lib/simulation/aiFieldMappingClient';
import {
  LIB_DEFS,
  missingRequiredMappings,
  SIM_FIELDS,
} from '@/lib/simulation/data';
import { importSimulationSnapshot } from '@/lib/simulation/importAdapter';
import {
  applyMappingDrag,
  buildMappingLayout,
  finalizeFieldMapping,
  orderSlotsForDisplay,
  slotMappingStatus,
  type MappingDragSource,
  type MappingDragTarget,
} from '@/lib/simulation/mappingLayout';
import { useSimulationProject } from '@/lib/simulation/SimulationProjectProvider';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type {
  FieldMapping,
  FieldMappings,
  LibraryRole,
  SimulationImportError,
  SimulationImportWarning,
  StudioColumnDefinition,
} from '@/lib/simulation/types';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

const ROLES: readonly LibraryRole[] = ['characters', 'skills', 'level', 'skillc'];
const LABELS: Record<LibraryRole, string> = {
  characters: 'Characters',
  skills: 'Skills',
  level: 'Character curve',
  skillc: 'Skill curve',
};
const ROOT_FOLDER_LABEL = 'No folder';
const emptySelection = (): Record<LibraryRole, string> => ({
  characters: '', skills: '', level: '', skillc: '',
});
const emptyMappings = (): FieldMappings => ({
  characters: {}, skills: {}, level: {}, skillc: {},
});
const emptyMappingStatus = (): Record<LibraryRole, 'idle' | 'loading' | 'error'> => ({
  characters: 'idle', skills: 'idle', level: 'idle', skillc: 'idle',
});

/** Library names that appear more than once in the project (exact match). */
function duplicateLibraryNames(libraries: readonly Library[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const library of libraries) {
    counts.set(library.name, (counts.get(library.name) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [name, count] of counts) {
    if (count > 1) duplicates.add(name);
  }
  return duplicates;
}

function folderLabelForLibrary(
  library: Library,
  folderNameById: ReadonlyMap<string, string>,
): string {
  if (!library.folder_id) return ROOT_FOLDER_LABEL;
  return folderNameById.get(library.folder_id) ?? ROOT_FOLDER_LABEL;
}

/** When names collide, show `folder/name`; otherwise just the library name. */
function formatLibraryLabel(
  library: Library,
  duplicateNames: ReadonlySet<string>,
  folderNameById: ReadonlyMap<string, string>,
): string {
  if (!duplicateNames.has(library.name)) return library.name;
  return `${folderLabelForLibrary(library, folderNameById)}/${library.name}`;
}

const ROW_H = 44;
const BOX_PAD = '0 12px';
const BOX_RADIUS = 10;
/** Same easing as CharactersScreen team-reorder FLIP. */
const MAPPING_FLIP_MS = 450;
const MAPPING_FLIP_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

function playFlipTransition(
  elements: Record<string, HTMLElement | null>,
  prevTops: Record<string, number>,
): void {
  for (const [id, el] of Object.entries(elements)) {
    if (!el) continue;
    const top = el.getBoundingClientRect().top;
    const prev = prevTops[id];
    if (prev !== undefined && Math.abs(prev - top) > 1) {
      const dy = prev - top;
      el.style.transform = `translateY(${dy}px)`;
      el.style.transition = 'none';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = `transform ${MAPPING_FLIP_MS}ms ${MAPPING_FLIP_EASE}`;
          el.style.transform = '';
        });
      });
    }
    prevTops[id] = top;
  }
}

function mapBoxStyle(active: boolean, tone: 'default' | 'error' = 'default'): CSSProperties {
  const isError = tone === 'error';
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: ROW_H,
    boxSizing: 'border-box',
    padding: BOX_PAD,
    borderRadius: BOX_RADIUS,
    border: `1px solid ${isError ? 'var(--simulation-danger)' : (active ? 'var(--simulation-blue)' : 'var(--simulation-line-200)')}`,
    background: isError ? '#fff' : (active ? 'var(--simulation-blue-soft)' : '#fff'),
    transition: 'border-color .15s, background .15s',
  };
}

function DragHandle() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 2,
        width: 12,
        flexShrink: 0,
        cursor: 'grab',
      }}
    >
      <span style={{ height: 2, borderRadius: 1, background: 'var(--simulation-ink-350)' }} />
      <span style={{ height: 2, borderRadius: 1, background: 'var(--simulation-ink-350)' }} />
      <span style={{ height: 2, borderRadius: 1, background: 'var(--simulation-ink-350)' }} />
    </span>
  );
}

function StatusIcon({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        color: '#fff',
        background: ok ? 'var(--simulation-success, #16a34a)' : 'var(--simulation-danger)',
      }}
    >
      {ok ? '✓' : '!'}
    </span>
  );
}

function parseDropTarget(value: string | null | undefined): MappingDragTarget | null {
  if (!value) return null;
  if (value === 'unmapped') return { kind: 'unmapped' };
  if (value.startsWith('slot:')) return { kind: 'slot', fieldId: value.slice(5) };
  return null;
}

function LibSlot({
  role,
  label,
  libraryId,
  selectedLabel,
  libraries,
  duplicateNames,
  folderNameById,
  active,
  open,
  errorText,
  onActivate,
  onToggle,
  onSelect,
}: {
  role: LibraryRole;
  label: string;
  libraryId: string;
  selectedLabel: string;
  libraries: readonly Library[];
  duplicateNames: ReadonlySet<string>;
  folderNameById: ReadonlyMap<string, string>;
  active: boolean;
  open: boolean;
  errorText: string;
  onActivate: () => void;
  onToggle: () => void;
  onSelect: (libraryId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const slotRef = useRef<HTMLDivElement | null>(null);
  const query = (open ? search : '').toLowerCase();
  const opts = libraries.filter((library) => {
    const display = formatLibraryLabel(library, duplicateNames, folderNameById);
    return display.toLowerCase().includes(query) || library.name.toLowerCase().includes(query);
  });

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (slotRef.current && !slotRef.current.contains(event.target as Node)) onToggle();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onToggle]);

  return (
    <div ref={slotRef} style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '12px 14px',
          borderRadius: 10,
          cursor: 'pointer',
          border: `1.5px solid ${active ? 'var(--simulation-blue)' : 'var(--simulation-line-200)'}`,
          background: active ? 'var(--simulation-blue-soft)' : '#fff',
          transition: 'border-color .15s, background .15s',
        }}
        onClick={() => {
          onActivate();
          if (!open) onToggle();
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--simulation-ink-800)' }}>{label}</span>
        <span style={{
          fontSize: 12,
          color: libraryId
            ? (active ? 'var(--simulation-blue)' : 'var(--simulation-ink-600)')
            : 'var(--simulation-blue)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        >
          {selectedLabel || 'Select library...'}
        </span>
        {errorText ? (
          <span style={{ fontSize: 11, lineHeight: 1.3, color: 'var(--simulation-danger)' }}>
            {errorText}
          </span>
        ) : null}
      </div>
      {open ? (
        <div style={{
          position: 'absolute',
          zIndex: 30,
          left: 0,
          right: 0,
          top: 'calc(100% + 6px)',
          background: '#fff',
          border: '1px solid var(--simulation-line-200)',
          borderRadius: 12,
          boxShadow: 'var(--simulation-shadow-popover)',
          padding: 8,
        }}
        >
          <input
            placeholder="Search libraries…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{
              width: '100%',
              height: 36,
              border: '1px solid var(--simulation-line-200)',
              borderRadius: 8,
              padding: '0 12px',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'var(--simulation-font-body)',
              marginBottom: 6,
            }}
          />
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {opts.map((library) => {
              const displayName = formatLibraryLabel(library, duplicateNames, folderNameById);
              return (
                <div
                  key={library.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '9px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--simulation-ink-800)',
                    background: libraryId === library.id ? 'var(--simulation-blue-tint)' : 'transparent',
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(library.id);
                    setSearch('');
                  }}
                >
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  >
                    {displayName}
                  </span>
                  <span style={{
                    color: 'var(--simulation-blue)',
                    fontSize: 12,
                    flexShrink: 0,
                    opacity: libraryId === library.id ? 1 : 0,
                  }}
                  >
                    ✓
                  </span>
                </div>
              );
            })}
            {opts.length === 0 ? (
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--simulation-ink-400)' }}>
                No libraries match.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <span className={styles.visuallyHidden}>{role}</span>
    </div>
  );
}

export function ImportScreen({
  onContinue,
  onImported,
}: {
  onContinue?: () => void;
  onImported?: () => void;
}) {
  const supabase = useSupabase();
  const { selectedProjectId, libraries, folderNameById, loadFields, loadSources } = useSimulationProject();
  const { commitImport } = useSimulationSession();
  const duplicateNames = useMemo(() => duplicateLibraryNames(libraries), [libraries]);
  const [name, setName] = useState('sumulator111');
  const [selected, setSelected] = useState(emptySelection);
  const [mappings, setMappings] = useState<FieldMappings>(emptyMappings);
  const [schemas, setSchemas] = useState<Record<string, Array<StudioColumnDefinition & { key: string; name: string }>>>({});
  const [mappingStatus, setMappingStatus] = useState(emptyMappingStatus);
  const [errors, setErrors] = useState<readonly SimulationImportError[]>([]);
  const [warnings, setWarnings] = useState<readonly SimulationImportWarning[]>([]);
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState(false);
  const [activeRole, setActiveRole] = useState<LibraryRole>('characters');
  const [ddOpen, setDdOpen] = useState<LibraryRole | null>(null);

  const bridgeRef = useRef<HTMLDivElement | null>(null);
  const sourceListRef = useRef<HTMLDivElement | null>(null);
  const targetListRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef(selected);
  const fieldRequestRef = useRef<Record<LibraryRole, number>>({ characters: 0, skills: 0, level: 0, skillc: 0 });

  const [dragSource, setDragSource] = useState<MappingDragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<MappingDragTarget | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragPreviewWidth, setDragPreviewWidth] = useState(240);
  const [flashColumnId, setFlashColumnId] = useState<string | null>(null);
  const dropTargetRef = useRef<MappingDragTarget | null>(null);
  const dragSourceRef = useRef<MappingDragSource | null>(null);
  const slotRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const unmappedRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const slotPrevTops = useRef<Record<string, number>>({});
  const unmappedPrevTops = useRef<Record<string, number>>({});

  useEffect(() => {
    for (const role of ROLES) fieldRequestRef.current[role] += 1;
    const nextSelection = emptySelection();
    selectedRef.current = nextSelection;
    setSelected(nextSelection);
    setMappings(emptyMappings());
    setSchemas({});
    setMappingStatus(emptyMappingStatus());
    setErrors([]);
    setWarnings([]);
    setImported(false);
    setActiveRole('characters');
    setDdOpen(null);
  }, [selectedProjectId]);

  const activeLibraryId = selected[activeRole];
  const activeLibSelected = Boolean(activeLibraryId);
  const activeFields = useMemo(
    () => (activeLibraryId ? schemas[activeLibraryId] ?? [] : []),
    [activeLibraryId, schemas],
  );
  const activeDefinitions = SIM_FIELDS[activeRole];
  const activeMappings = useMemo(
    () => mappings[activeRole] ?? {},
    [mappings, activeRole],
  );
  const activeMappingsRef = useRef(activeMappings);
  activeMappingsRef.current = activeMappings;
  const mappingLayout = useMemo(
    () => {
      const layout = buildMappingLayout(
        activeDefinitions.map((field) => field.id),
        activeMappings,
        activeFields.map((col) => col.key),
      );
      return {
        ...layout,
        slots: orderSlotsForDisplay(layout.slots),
      };
    },
    [activeDefinitions, activeMappings, activeFields],
  );

  useLayoutEffect(() => {
    playFlipTransition(slotRowRefs.current, slotPrevTops.current);
    playFlipTransition(unmappedRowRefs.current, unmappedPrevTops.current);
  }, [mappingLayout]);

  useEffect(() => {
    slotPrevTops.current = {};
    unmappedPrevTops.current = {};
    setFlashColumnId(null);
  }, [activeRole, activeLibraryId]);

  const columnById = useMemo(() => {
    const map = new Map<string, StudioColumnDefinition & { key: string; name: string }>();
    for (const col of activeFields) map.set(col.key, col);
    return map;
  }, [activeFields]);
  const mappedCount = Object.keys(activeMappings).length;
  const missingByLib = Object.fromEntries(
    ROLES.map((role) => [role, missingRequiredMappings(role, mappings[role] || {})]),
  ) as Record<LibraryRole, string[]>;
  const allLibsSelected = ROLES.every((role) => !!selected[role]);
  const hasAnyMissingRequired = ROLES.some((role) => missingByLib[role].length > 0);
  const canImportNow = allLibsSelected && !hasAnyMissingRequired && !loading;

  async function selectLibrary(role: LibraryRole, libraryId: string) {
    const nextSelected = { ...selectedRef.current, [role]: libraryId };
    selectedRef.current = nextSelected;
    setSelected(nextSelected);
    setMappings((current) => ({ ...current, [role]: {} }));
    setMappingStatus((current) => ({
      ...current,
      [role]: libraryId ? 'loading' : 'idle',
    }));
    setActiveRole(role);
    setDdOpen(null);
    setImported(false);
    setErrors([]);
    setWarnings([]);
    if (!libraryId || !selectedProjectId) return;
    const request = ++fieldRequestRef.current[role];
    let loadedFields: Array<StudioColumnDefinition & { key: string; name: string }> = [];
    try {
      loadedFields = [...await loadFields(libraryId)];
      if (request !== fieldRequestRef.current[role] || selectedRef.current[role] !== libraryId) return;
      setSchemas((current) => ({ ...current, [libraryId]: loadedFields }));
      const studioColumns = loadedFields.map(({ key, name: fieldName, valueType }) => ({ id: key, label: fieldName, valueType }));
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Authentication required.');
      const aiMappings = await requestAiFieldMappings(role, studioColumns, session.access_token);
      if (request !== fieldRequestRef.current[role] || selectedRef.current[role] !== libraryId) return;
      setMappings((current) => ({
        ...current,
        [role]: finalizeFieldMapping(role, aiMappings, studioColumns),
      }));
      setMappingStatus((current) => ({ ...current, [role]: 'idle' }));
    } catch {
      if (request !== fieldRequestRef.current[role] || selectedRef.current[role] !== libraryId) return;
      const columns = loadedFields.map(({ key, name: fieldName, valueType }) => ({
        id: key,
        label: fieldName,
        valueType,
      }));
      if (columns.length > 0) {
        setMappings((current) => ({
          ...current,
          [role]: finalizeFieldMapping(role, {}, columns),
        }));
      }
      setMappingStatus((current) => ({ ...current, [role]: 'error' }));
    }
  }

  function replaceRoleMapping(role: LibraryRole, nextMapping: FieldMapping) {
    fieldRequestRef.current[role] += 1;
    setMappingStatus((current) => ({ ...current, [role]: 'idle' }));
    setMappings((current) => ({ ...current, [role]: nextMapping }));
    setImported(false);
  }

  function mapField(role: LibraryRole, canonical: string, fieldId: string | null) {
    const roleMapping = { ...mappings[role] };
    for (const [key, value] of Object.entries(roleMapping)) {
      if (value === fieldId) delete roleMapping[key];
    }
    if (fieldId) roleMapping[canonical] = fieldId;
    else delete roleMapping[canonical];
    replaceRoleMapping(role, roleMapping);
  }

  async function importLibraries() {
    if (!selectedProjectId || ROLES.some((role) => !selected[role])) return;
    setLoading(true);
    setErrors([]);
    setWarnings([]);
    try {
      const sources = await loadSources(selected);
      const result = importSimulationSnapshot({
        sourceProjectId: selectedProjectId,
        sources,
        fieldMappings: mappings,
      });
      setWarnings(result.warnings);
      if ('errors' in result) {
        setErrors(result.errors);
        return;
      }
      commitImport(result.snapshot, name);
      setImported(true);
      onImported?.();
    } catch (error) {
      setErrors([{
        role: 'characters',
        code: 'unresolved_reference',
        libraryId: '',
        libraryName: 'Studio',
        assetId: null,
        assetName: null,
        field: 'Libraries',
        reason: error instanceof Error ? error.message : 'Import failed.',
        message: error instanceof Error ? error.message : 'Import failed.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const source = sourceListRef.current;
    const target = targetListRef.current;
    if (!source || !target) return;
    function onScroll(event: Event) {
      const current = event.currentTarget as HTMLDivElement;
      const other = current === source ? target : source;
      if (!other) return;
      if (other.scrollTop !== current.scrollTop) other.scrollTop = current.scrollTop;
    }
    source.addEventListener('scroll', onScroll, { passive: true });
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      source.removeEventListener('scroll', onScroll);
      target.removeEventListener('scroll', onScroll);
    };
  }, [activeLibSelected]);

  useEffect(() => {
    if (!dragSource) return;

    function onMove(event: PointerEvent) {
      setDragPos({ x: event.clientX, y: event.clientY });
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const dropEl = el?.closest?.('[data-mapping-drop]') as HTMLElement | null;
      const next = parseDropTarget(dropEl?.dataset.mappingDrop);
      dropTargetRef.current = next;
      setDropTarget(next);
    }

    function onUp() {
      const source = dragSourceRef.current;
      const target = dropTargetRef.current;
      if (source && target) {
        const movingColumnId =
          source.kind === 'unmapped'
            ? source.columnId
            : activeMappingsRef.current[source.fieldId] ?? null;
        replaceRoleMapping(activeRole, applyMappingDrag(activeMappingsRef.current, source, target));
        if (movingColumnId) {
          setFlashColumnId(movingColumnId);
          window.setTimeout(() => {
            setFlashColumnId((current) => (current === movingColumnId ? null : current));
          }, 550);
        }
      }
      dragSourceRef.current = null;
      dropTargetRef.current = null;
      setDragSource(null);
      setDropTarget(null);
      setDragPos(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragSource, activeRole]);

  function startCardDrag(source: MappingDragSource, event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const listWidth = sourceListRef.current?.clientWidth;
    if (listWidth && listWidth > 40) setDragPreviewWidth(listWidth - 28);
    dragSourceRef.current = source;
    dropTargetRef.current = null;
    setDragSource(source);
    setDropTarget(null);
    setDragPos({ x: event.clientX, y: event.clientY });
  }

  function dragLabelFor(source: MappingDragSource): string {
    if (source.kind === 'unmapped') {
      return columnById.get(source.columnId)?.name ?? source.columnId;
    }
    const columnId = activeMappings[source.fieldId];
    if (!columnId) return source.fieldId;
    return `${columnById.get(columnId)?.name ?? columnId} → ${source.fieldId}`;
  }

  const activeLibraryName = activeLibraryId
    ? libraries.find(({ id }) => id === activeLibraryId)?.name
    : undefined;
  const aiMapping = mappingStatus[activeRole] === 'loading';
  const showUnmappedPool = activeLibSelected && !aiMapping;

  return (
    <div style={{ maxWidth: 1100, width: '100%', margin: '0 auto' }}>
      <h1 style={{
        fontSize: 27,
        fontWeight: 600,
        color: 'var(--simulation-ink-900)',
        margin: '0 0 6px',
        letterSpacing: '-.01em',
      }}
      >
        Import Studio libraries
      </h1>
      <p style={{
        color: 'var(--simulation-ink-500)',
        fontSize: 15,
        margin: '0 0 20px',
        maxWidth: 760,
        lineHeight: 1.55,
      }}
      >
        Select four Studio libraries, then review the field rows created by the LLM. After mapping finishes, drag unmapped columns into empty slots or swap rows.{' '}
        Required fields are marked with an asterisk.
      </p>

      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 16,
        marginBottom: 22,
        flexWrap: 'wrap',
      }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320, flex: '0 0 auto' }}>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            color: 'var(--simulation-ink-500)',
          }}
          >
            Simulator name
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={{
              height: 40,
              border: '1px solid var(--simulation-line-200)',
              borderRadius: 10,
              padding: '0 14px',
              fontSize: 14,
              fontFamily: 'var(--simulation-font-body)',
              outline: 'none',
              color: 'var(--simulation-ink-800)',
              background: '#fff',
            }}
          />
        </label>
        {errors.length ? (
          <div style={{
            flex: '1 1 0',
            minWidth: 0,
            paddingBottom: 2,
          }}
          >
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--simulation-danger)',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.4,
            }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>⚠</span>
              <span>
                {errors.some((e) => e.code === 'unresolved_reference' && e.field === 'Libraries')
                  ? 'Import failed — see details below.'
                  : errors.some((e) => e.field && e.reason?.toLowerCase().includes('missing'))
                  ? `Missing required fields — see details below.`
                  : `Field mapping issue${errors.length > 1 ? `s (${errors.length})` : ''} — see details below.`}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            color: 'var(--simulation-ink-500)',
            padding: '0 2px 4px',
          }}
          >
            Import libraries
          </div>
          {LIB_DEFS.map((def) => {
            const libraryId = selected[def.key];
            const library = libraries.find(({ id }) => id === libraryId);
            const selectedLabel = library
              ? formatLibraryLabel(library, duplicateNames, folderNameById)
              : '';
            return (
              <LibSlot
                key={def.key}
                role={def.key}
                label={LABELS[def.key]}
                libraryId={libraryId}
                selectedLabel={selectedLabel}
                libraries={libraries}
                duplicateNames={duplicateNames}
                folderNameById={folderNameById}
                active={activeRole === def.key}
                open={ddOpen === def.key}
                errorText={
                  mappingStatus[def.key] === 'error'
                    ? 'AI mapping failed - drag fields manually.'
                    : libraryId && missingByLib[def.key].length
                    ? `Missing required: ${missingByLib[def.key].join(', ')}`
                    : ''
                }
                onActivate={() => setActiveRole(def.key)}
                onToggle={() => setDdOpen((current) => (current === def.key ? null : def.key))}
                onSelect={(nextId) => void selectLibrary(def.key, nextId)}
              />
            );
          })}

          {!imported ? (
            <SimulationButton
              variant="primary"
              loading={loading}
              disabled={!canImportNow || !selectedProjectId}
              onClick={() => void importLibraries()}
              style={{ marginTop: 6, width: '100%' }}
            >
              Import libraries
            </SimulationButton>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
              <div style={{
                height: 40,
                borderRadius: 10,
                background: 'var(--simulation-blue-soft)',
                color: 'var(--simulation-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
              }}
              >
                <span>{warnings.length ? 'Imported with warnings' : 'Imported'}</span>
                <span style={{ fontSize: 15 }}>✓</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--simulation-ink-500)', lineHeight: 1.45 }}>
                4 libraries bound, now you can config the character.
              </div>
              <SimulationButton variant="primary" onClick={() => onContinue?.()} style={{ width: '100%' }}>
                Continue to characters
              </SimulationButton>
            </div>
          )}
        </div>

        <div
          ref={bridgeRef}
          className={styles.mappingBridge}
          style={{
            position: 'relative',
            background: '#fff',
            border: '1px solid var(--simulation-line-200)',
            borderRadius: 14,
            minHeight: 420,
            display: 'grid',
            gridTemplateColumns: '1fr 52px 1fr',
            gridTemplateRows: 'auto 1fr',
            overflow: 'visible',
          }}
        >
          <div style={{
            gridColumn: 1,
            padding: '14px 16px',
            borderBottom: '1px solid var(--simulation-line-200)',
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.05em',
            color: 'var(--simulation-ink-500)',
          }}
          >
            Studio source table
            {activeLibraryName ? (
              <span style={{
                fontWeight: 400,
                textTransform: 'none',
                letterSpacing: 0,
                color: 'var(--simulation-ink-400)',
                marginLeft: 8,
              }}
              >
                {activeLibraryName}
              </span>
            ) : null}
            {mappingStatus[activeRole] === 'loading' ? (
              <span className={styles.aiMappingStatus} role="status">
                <span className={styles.aiMappingSpinner} aria-hidden="true" />
                <span>LLM auto-mapping...</span>
              </span>
            ) : mappingStatus[activeRole] === 'error' ? (
              <span className={styles.aiMappingFailure} role="alert">
                AI mapping failed - map manually
              </span>
            ) : null}
          </div>
          <div style={{ gridColumn: 2, borderBottom: '1px solid var(--simulation-line-200)', background: 'var(--simulation-surface-1)' }} />
          <div style={{
            gridColumn: 3,
            padding: '14px 16px',
            borderBottom: '1px solid var(--simulation-line-200)',
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.05em',
            color: 'var(--simulation-ink-500)',
          }}
          >
            Simulation fields
            <span style={{
              fontWeight: 400,
              textTransform: 'none',
              letterSpacing: 0,
              color: 'var(--simulation-ink-400)',
              marginLeft: 8,
            }}
            >
              {mappedCount}/{activeDefinitions.length} mapped
            </span>
          </div>

          <div
            ref={sourceListRef}
            style={{ gridColumn: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {!activeLibSelected ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--simulation-ink-400)', lineHeight: 1.5 }}>
                Select a library on the left to view its source columns.
              </div>
            ) : null}
            {activeLibSelected ? (
              <>
                {mappingLayout.slots.map((slot) => {
                  const field = activeDefinitions.find((item) => item.id === slot.fieldId)!;
                  const col = slot.columnId ? columnById.get(slot.columnId) : undefined;
                  const status = aiMapping
                    ? 'empty'
                    : slotMappingStatus(
                      field,
                      col ? { id: col.key, label: col.name, valueType: col.valueType } : null,
                    );
                  const isError = status === 'empty-required' || status === 'incompatible';
                  const isDragging = dragSource?.kind === 'slot' && dragSource.fieldId === slot.fieldId;
                  const isDrop = dropTarget?.kind === 'slot' && dropTarget.fieldId === slot.fieldId;
                  const isFlash = Boolean(slot.columnId && flashColumnId === slot.columnId);
                  return (
                    <div
                      key={slot.fieldId}
                      ref={(node) => {
                        slotRowRefs.current[slot.fieldId] = node;
                      }}
                      data-mapping-drop={`slot:${slot.fieldId}`}
                      data-testid="mapping-slot"
                      style={{
                        ...mapBoxStyle(
                          isDragging || isDrop || Boolean(slot.columnId && !aiMapping),
                          isError ? 'error' : 'default',
                        ),
                        userSelect: 'none',
                        opacity: isDragging ? 0.35 : 1,
                        willChange: 'transform',
                        animation: isFlash ? 'kMappingCardFlash 0.55s ease' : 'none',
                      }}
                    >
                      {aiMapping ? (
                        <>
                          <span style={{ flex: 1, fontSize: 13, color: 'var(--simulation-ink-400)' }}>
                            AI mapping...
                          </span>
                        </>
                      ) : slot.columnId ? (
                        <button
                          type="button"
                          aria-label={`Drag ${col?.name ?? slot.columnId}`}
                          onPointerDown={(event) => startCardDrag({ kind: 'slot', fieldId: slot.fieldId }, event)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 10,
                            flex: 1,
                            minWidth: 0,
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            cursor: 'grab',
                            font: 'inherit',
                            textAlign: 'left',
                          }}
                        >
                          <DragHandle />
                          <span style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            fontWeight: 500,
                            color: isError ? 'var(--simulation-danger)' : 'var(--simulation-ink-800)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          >
                            {col?.name ?? slot.columnId}
                            <span style={{ marginLeft: 6, fontWeight: 600 }}>→ {slot.fieldId}</span>
                          </span>
                          <StatusIcon ok={status === 'ok'} />
                        </button>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: 13, color: 'var(--simulation-ink-400)' }}>
                            Drop a source column
                          </span>
                          {isError ? <StatusIcon ok={false} /> : null}
                        </>
                      )}
                    </div>
                  );
                })}

                {showUnmappedPool ? (
                  <div
                    data-mapping-drop="unmapped"
                    data-testid="mapping-unmapped"
                    style={{
                      marginTop: 8,
                      paddingTop: 10,
                      borderTop: '1px dashed var(--simulation-line-200)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      minHeight: dropTarget?.kind === 'unmapped' ? 52 : undefined,
                      borderRadius: 10,
                      outline: dropTarget?.kind === 'unmapped' ? '2px solid var(--simulation-blue)' : undefined,
                    }}
                  >
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '.05em',
                      color: 'var(--simulation-ink-400)',
                    }}
                    >
                      Unmapped
                    </div>
                    {mappingLayout.unmapped.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--simulation-ink-350)', padding: '4px 2px' }}>
                        No extra columns
                      </div>
                    ) : null}
                    {mappingLayout.unmapped.map((columnId) => {
                      const col = columnById.get(columnId);
                      const isDragging = dragSource?.kind === 'unmapped' && dragSource.columnId === columnId;
                      const isFlash = flashColumnId === columnId;
                      return (
                        <button
                          key={columnId}
                          ref={(node) => {
                            unmappedRowRefs.current[columnId] = node;
                          }}
                          type="button"
                          data-testid="mapping-unmapped-card"
                          aria-label={`Drag ${col?.name ?? columnId}`}
                          onPointerDown={(event) => startCardDrag({ kind: 'unmapped', columnId }, event)}
                          style={{
                            ...mapBoxStyle(isDragging, 'default'),
                            width: '100%',
                            cursor: 'grab',
                            opacity: isDragging ? 0.35 : 1,
                            font: 'inherit',
                            textAlign: 'left',
                            willChange: 'transform',
                            animation: isFlash ? 'kMappingCardFlash 0.55s ease' : 'none',
                          }}
                        >
                          <DragHandle />
                          <span style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            fontWeight: 500,
                            color: 'var(--simulation-ink-800)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          >
                            {col?.name ?? columnId}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div
            style={{
              gridColumn: 2,
              background: 'var(--simulation-surface-1)',
              borderLeft: '1px solid var(--simulation-line-100)',
              borderRight: '1px solid var(--simulation-line-100)',
            }}
            title="Rows align left to right"
          />

          <div
            ref={targetListRef}
            style={{ gridColumn: 3, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {!activeLibSelected ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--simulation-ink-400)', lineHeight: 1.5 }}>
                Simulation fields appear here after you select a library.
              </div>
            ) : null}
            {activeLibSelected
              ? activeDefinitions.map((field) => {
                const mappedCol = activeMappings[field.id];
                const mappedLabel = mappedCol
                  ? activeFields.find((col) => col.key === mappedCol)?.name
                  : null;
                const missingRequired = Boolean(field.required && !mappedCol && mappingStatus[activeRole] !== 'loading');
                return (
                  <div
                    key={field.id}
                    style={mapBoxStyle(Boolean(mappedCol), missingRequired ? 'error' : 'default')}
                  >
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                    >
                      <span style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: missingRequired ? 'var(--simulation-danger)' : 'var(--simulation-ink-800)',
                      }}
                      >
                        {field.id}
                        {field.required ? <span aria-hidden="true"> *</span> : null}
                      </span>
                      <span style={{
                        fontSize: 12,
                        color: 'var(--simulation-ink-400)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      >
                        {mappedLabel ?? field.label}
                      </span>
                    </span>
                    <span
                      role={mappedCol ? 'button' : undefined}
                      tabIndex={mappedCol ? 0 : undefined}
                      aria-label={mappedCol ? 'Clear mapping' : undefined}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        color: 'var(--simulation-ink-350)',
                        cursor: mappedCol ? 'pointer' : 'default',
                        visibility: mappedCol ? 'visible' : 'hidden',
                      }}
                      onClick={() => {
                        if (mappedCol) mapField(activeRole, field.id, null);
                      }}
                      onKeyDown={(event) => {
                        if (!mappedCol) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          mapField(activeRole, field.id, null);
                        }
                      }}
                      title="Clear mapping"
                    >
                      ×
                    </span>
                  </div>
                );
              })
              : null}
          </div>

        </div>
      </div>

      {dragSource && dragPos ? (
        <div
          data-testid="mapping-drag-preview"
          style={{
            ...mapBoxStyle(true, 'default'),
            position: 'fixed',
            left: dragPos.x - Math.min(48, dragPreviewWidth / 4),
            top: dragPos.y - ROW_H / 2,
            zIndex: 10000,
            pointerEvents: 'none',
            width: dragPreviewWidth,
            height: ROW_H,
            opacity: 0.88,
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.22)',
          }}
        >
          <DragHandle />
          <span style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--simulation-ink-800)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          >
            {dragLabelFor(dragSource)}
          </span>
        </div>
      ) : null}

      {errors.length ? (
        <div className={styles.errorList} role="alert" style={{ marginTop: 16 }}>
          <strong>Import blocked</strong>
          {errors.map((error, index) => (
            <p key={index}>
              {error.libraryName}
              {error.assetName ? ` / ${error.assetName}` : ''}
              {' / '}
              {error.field}
              :
              {' '}
              {error.reason}
            </p>
          ))}
        </div>
      ) : null}
      {warnings.length ? (
        <div className={styles.warningList} role="status" style={{ marginTop: 16 }}>
          <strong>Imported with warnings</strong>
          {warnings.map((warning, index) => (
            <p key={index}>
              {warning.libraryName}
              {warning.assetName ? ` / ${warning.assetName}` : ''}
              {' / '}
              {warning.field}
              :
              {' '}
              {warning.reason}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
