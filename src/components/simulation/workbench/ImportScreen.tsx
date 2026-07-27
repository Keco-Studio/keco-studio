'use client';

import {
  useCallback,
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
import { useSimulationProject } from '@/lib/simulation/SimulationProjectProvider';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type {
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

function Port({
  active,
  connected,
  side,
  onPointerDown,
}: {
  active: boolean;
  connected: boolean;
  side: 'source' | 'target';
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={side === 'source' ? 'Drag to connect' : 'Connection port'}
      onPointerDown={onPointerDown}
      tabIndex={side === 'source' ? 0 : -1}
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        flexShrink: 0,
        padding: 0,
        border: `2px solid ${active || connected ? 'var(--simulation-blue)' : 'var(--simulation-line-300)'}`,
        background: connected || active ? 'var(--simulation-blue)' : '#fff',
        boxShadow: active ? '0 0 0 3px var(--simulation-blue-tint-12)' : 'none',
        cursor: side === 'source' ? 'crosshair' : 'default',
        pointerEvents: side === 'source' ? 'auto' : 'none',
        transition: 'border-color .15s, background .15s, box-shadow .15s',
      }}
    />
  );
}

function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

function pointInRect(
  x: number,
  y: number,
  rect: DOMRect,
  root: DOMRect,
) {
  const left = rect.left - root.left;
  const top = rect.top - root.top;
  return x >= left && x <= left + rect.width && y >= top && y <= top + rect.height;
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
  const sourcePortRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const targetPortRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const targetRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedRef = useRef(selected);
  const fieldRequestRef = useRef<Record<LibraryRole, number>>({ characters: 0, skills: 0, level: 0, skillc: 0 });

  const [layout, setLayout] = useState<{
    sources: Record<string, { x: number; y: number }>;
    targets: Record<string, { x: number; y: number }>;
    size: { w: number; h: number };
  }>({ sources: {}, targets: {}, size: { w: 0, h: 0 } });
  const [drag, setDrag] = useState<{ colId: string; x: number; y: number } | null>(null);
  const [hoverFieldId, setHoverFieldId] = useState<string | null>(null);
  const [hoverWireFieldId, setHoverWireFieldId] = useState<string | null>(null);

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
    try {
      const fields = [...await loadFields(libraryId)];
      if (request !== fieldRequestRef.current[role] || selectedRef.current[role] !== libraryId) return;
      setSchemas((current) => ({ ...current, [libraryId]: fields }));
      const studioColumns = fields.map(({ key, name: fieldName, valueType }) => ({ id: key, label: fieldName, valueType }));
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Authentication required.');
      const aiMappings = await requestAiFieldMappings(role, studioColumns, session.access_token);
      if (request !== fieldRequestRef.current[role] || selectedRef.current[role] !== libraryId) return;
      setMappings((current) => ({
        ...current,
        [role]: aiMappings,
      }));
      setMappingStatus((current) => ({ ...current, [role]: 'idle' }));
    } catch {
      if (request !== fieldRequestRef.current[role] || selectedRef.current[role] !== libraryId) return;
      setMappingStatus((current) => ({ ...current, [role]: 'error' }));
    }
  }

  function mapField(role: LibraryRole, canonical: string, fieldId: string | null) {
    fieldRequestRef.current[role] += 1;
    setMappingStatus((current) => ({ ...current, [role]: 'idle' }));
    setMappings((current) => {
      const roleMapping = { ...current[role] };
      for (const [key, value] of Object.entries(roleMapping)) {
        if (value === fieldId) delete roleMapping[key];
      }
      if (fieldId) roleMapping[canonical] = fieldId;
      else delete roleMapping[canonical];
      return { ...current, [role]: roleMapping };
    });
    setImported(false);
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

  const measure = useCallback(() => {
    const root = bridgeRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const sources: Record<string, { x: number; y: number }> = {};
    const targets: Record<string, { x: number; y: number }> = {};
    for (const col of activeFields) {
      const el = sourcePortRefs.current[col.key];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      sources[col.key] = {
        x: rect.left + rect.width / 2 - rootRect.left,
        y: rect.top + rect.height / 2 - rootRect.top,
      };
    }
    for (const field of activeDefinitions) {
      const el = targetPortRefs.current[field.id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      targets[field.id] = {
        x: rect.left + rect.width / 2 - rootRect.left,
        y: rect.top + rect.height / 2 - rootRect.top,
      };
    }
    setLayout({ sources, targets, size: { w: rootRect.width, h: rootRect.height } });
  }, [activeFields, activeDefinitions]);

  useLayoutEffect(() => {
    measure();
  }, [measure, activeMappings, activeRole, activeLibSelected]);

  useEffect(() => {
    const root = bridgeRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    const lists = [sourceListRef.current, targetListRef.current].filter(Boolean) as HTMLDivElement[];
    function onScroll(event: Event) {
      const source = sourceListRef.current;
      const target = targetListRef.current;
      if (!source || !target) return;
      const current = event.currentTarget as HTMLDivElement;
      const other = current === source ? target : source;
      if (other.scrollTop !== current.scrollTop) other.scrollTop = current.scrollTop;
      measure();
    }
    lists.forEach((el) => {
      el.addEventListener('scroll', onScroll, { passive: true });
      observer.observe(el);
    });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      lists.forEach((el) => el.removeEventListener('scroll', onScroll));
      window.removeEventListener('resize', measure);
    };
  }, [measure, activeLibSelected]);

  useEffect(() => {
    if (!drag) return;

    function onMove(event: PointerEvent) {
      const root = bridgeRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const x = event.clientX - rootRect.left;
      const y = event.clientY - rootRect.top;
      let nextHover: string | null = null;
      for (const field of activeDefinitions) {
        const row = targetRowRefs.current[field.id];
        if (row && pointInRect(x, y, row.getBoundingClientRect(), rootRect)) {
          nextHover = field.id;
          break;
        }
      }
      setHoverFieldId(nextHover);
      setDrag((current) => (current ? { ...current, x, y } : current));
    }

    function onUp(event: PointerEvent) {
      const root = bridgeRef.current;
      const colId = drag.colId;
      let dropFieldId: string | null = null;
      if (root) {
        const rootRect = root.getBoundingClientRect();
        const x = event.clientX - rootRect.left;
        const y = event.clientY - rootRect.top;
        for (const field of activeDefinitions) {
          const row = targetRowRefs.current[field.id];
          if (row && pointInRect(x, y, row.getBoundingClientRect(), rootRect)) {
            dropFieldId = field.id;
            break;
          }
        }
      }
      if (dropFieldId) mapField(activeRole, dropFieldId, colId);
      setDrag(null);
      setHoverFieldId(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, activeDefinitions, activeRole]);

  function startWire(colId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const root = bridgeRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    setDrag({
      colId,
      x: event.clientX - rootRect.left,
      y: event.clientY - rootRect.top,
    });
  }

  const wires = Object.entries(activeMappings).map(([fieldId, colId]) => {
    const from = layout.sources[colId];
    const to = layout.targets[fieldId];
    if (!from || !to) return null;
    return { fieldId, colId, from, to, d: bezierPath(from.x, from.y, to.x, to.y) };
  }).filter(Boolean) as Array<{
    fieldId: string;
    colId: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    d: string;
  }>;

  const dragFrom = drag ? layout.sources[drag.colId] : null;
  const dragPath = dragFrom ? bezierPath(dragFrom.x, dragFrom.y, drag.x, drag.y) : null;
  const activeLibraryName = activeLibraryId
    ? libraries.find(({ id }) => id === activeLibraryId)?.name
    : undefined;

  return (
    <div style={{ maxWidth: 1100 }}>
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
        Select four Studio libraries, then review the field connections created by the LLM. You can drag from a source port to adjust them.{' '}
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
                    ? 'AI mapping failed - connect fields manually.'
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
            {activeLibSelected
              ? activeFields.map((col) => {
                const usedBy = Object.entries(activeMappings).find(([, value]) => value === col.key)?.[0];
                const aiMapping = mappingStatus[activeRole] === 'loading';
                const isDragging = drag?.colId === col.key;
                const active = !!(isDragging || usedBy);
                return (
                  <div key={col.key} style={{ ...mapBoxStyle(active), userSelect: 'none' }}>
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 500,
                      color: active ? 'var(--simulation-blue)' : 'var(--simulation-ink-800)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    >
                      {col.name}
                      {aiMapping ? (
                        <span style={{ marginLeft: 8, color: 'var(--simulation-ink-400)', fontSize: 12, fontWeight: 500 }}>
                          AI mapping...
                        </span>
                      ) : usedBy ? <span style={{ marginLeft: 6, fontWeight: 600 }}>→ {usedBy}</span> : null}
                    </span>
                    <span ref={(el) => { sourcePortRefs.current[col.key] = el; }} style={{ display: 'inline-flex' }}>
                      <Port
                        side="source"
                        connected={!!usedBy}
                        active={!!isDragging}
                        onPointerDown={(event) => startWire(col.key, event)}
                      />
                    </span>
                  </div>
                );
              })
              : null}
          </div>

          <div
            style={{
              gridColumn: 2,
              background: 'var(--simulation-surface-1)',
              borderLeft: '1px solid var(--simulation-line-100)',
              borderRight: '1px solid var(--simulation-line-100)',
            }}
            title="Connect ports across this bridge"
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
                const isHoverTarget = hoverFieldId === field.id;
                const active = !!(mappedCol || isHoverTarget);
                const aiMapping = mappingStatus[activeRole] === 'loading';
                const missingRequired = Boolean(field.required && !mappedCol && !aiMapping);
                return (
                  <div
                    key={field.id}
                    ref={(el) => { targetRowRefs.current[field.id] = el; }}
                    style={mapBoxStyle(active, missingRequired ? 'error' : 'default')}
                  >
                    <span ref={(el) => { targetPortRefs.current[field.id] = el; }} style={{ display: 'inline-flex' }}>
                      <Port side="target" connected={!!mappedCol} active={isHoverTarget} />
                    </span>
                    <span style={{
                      flexShrink: 0,
                      maxWidth: 120,
                      marginRight: 4,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--simulation-ink-800)',
                      fontFamily: 'var(--simulation-font-body)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    >
                      {field.label}
                      {field.required ? <span style={{ color: 'var(--simulation-danger)', marginLeft: 2 }}>*</span> : null}
                    </span>
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontWeight: 500,
                      color: mappedCol
                        ? 'var(--simulation-blue)'
                        : (missingRequired ? 'var(--simulation-danger)' : 'var(--simulation-ink-400)'),
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    >
                      {mappedLabel || (missingRequired
                        ? 'Required — connect a Studio column'
                        : 'Connect a Studio column')}
                    </span>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        flexShrink: 0,
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
                      title="Clear mapping"
                    >
                      ×
                    </span>
                  </div>
                );
              })
              : null}
          </div>

          {activeLibSelected && layout.size.w > 0 ? (
            <svg
              width={layout.size.w}
              height={layout.size.h}
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 5,
                overflow: 'visible',
              }}
            >
              {wires.map((wire) => {
                const hovered = !drag && hoverWireFieldId === wire.fieldId;
                const midX = (wire.from.x + wire.to.x) / 2;
                const midY = (wire.from.y + wire.to.y) / 2;
                return (
                  <g key={wire.fieldId}>
                    <path
                      d={wire.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ pointerEvents: drag ? 'none' : 'stroke', cursor: 'pointer' }}
                      onMouseEnter={() => setHoverWireFieldId(wire.fieldId)}
                      onMouseLeave={() => setHoverWireFieldId((id) => (id === wire.fieldId ? null : id))}
                      onClick={() => {
                        mapField(activeRole, wire.fieldId, null);
                        setHoverWireFieldId(null);
                      }}
                    />
                    <path
                      d={wire.d}
                      fill="none"
                      stroke={hovered ? 'var(--simulation-danger)' : 'var(--simulation-blue)'}
                      strokeWidth={hovered ? 2.5 : 2}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'none', transition: 'stroke .15s' }}
                    />
                    {hovered ? (
                      <g style={{ pointerEvents: 'none' }}>
                        <rect x={midX - 42} y={midY - 34} width={84} height={26} rx={6} fill="#1F2937" />
                        <polygon
                          points={`${midX - 5},${midY - 8} ${midX + 5},${midY - 8} ${midX},${midY - 2}`}
                          fill="#1F2937"
                        />
                        <text
                          x={midX}
                          y={midY - 16}
                          textAnchor="middle"
                          fill="#fff"
                          fontSize="12"
                          fontFamily="var(--simulation-font-body)"
                          fontWeight="500"
                        >
                          Delete line
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
              {dragPath ? (
                <path
                  d={dragPath}
                  fill="none"
                  stroke="var(--simulation-blue)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                  opacity={0.85}
                />
              ) : null}
            </svg>
          ) : null}
        </div>
      </div>

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
