import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { SimulationStateV1 } from './types';

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const element = z.enum(['Fire', 'Ice', 'Lightning', 'Earth', 'Light', 'Shadow', 'Physical']);

const characterTemplateSchema = z.object({
  id: z.string().min(1), name: z.string(), cls: z.string().optional(), el: element,
  hp: finite.positive(), atk: nonnegative, def: nonnegative, spd: nonnegative, mp: nonnegative,
}).strict();

const characterSnapshotSchema = z.object({
  name: z.string(), cls: z.string().optional(), el: element,
  hp: finite.positive(), atk: nonnegative, def: nonnegative, spd: nonnegative, mp: nonnegative,
  lv: positiveInteger,
}).strict();

const skillSchema = z.object({
  id: z.string().min(1), name: z.string(), el: element, mp: nonnegative, power: nonnegative,
  cd: nonnegative, kind: z.enum(['dmg', 'heal', 'buff']),
  status: z.enum(['burn', 'dot', 'freeze', 'stun', '']).nullable().optional(), fx: z.string().optional(),
}).strict();

const fourRolesSchema = <T extends z.ZodTypeAny>(schema: T) => z.object({
  characters: schema, skills: schema, level: schema, skillc: schema,
}).strict();

function mappingSchema<const Keys extends readonly [string, ...string[]]>(keys: Keys) {
  const shape = Object.fromEntries(keys.map((key) => [key, z.string().min(1).optional()]));
  return z.object(shape).strict().superRefine((mapping, context) => {
    const values = Object.values(mapping).filter((value): value is string => typeof value === 'string');
    if (values.length !== new Set(values).size) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Mapped fields must be unique.' });
    }
  });
}

const fieldMappingsSchema = z.object({
  characters: mappingSchema(['id', 'name', 'cls', 'el', 'hp', 'atk', 'def', 'spd', 'mp']),
  skills: mappingSchema(['id', 'name', 'el', 'mp', 'power', 'cd', 'kind', 'status', 'fx']),
  level: mappingSchema(['characterId', 'level', 'exp', 'sp']),
  skillc: mappingSchema(['skillId', 'lv', 'cost']),
}).strict();

const importedSnapshotSchema = z.object({
  sourceProjectId: z.string().min(1),
  catalog: z.object({
    characters: z.array(characterTemplateSchema).min(1), skills: z.array(skillSchema).min(1), basic: skillSchema,
  }).strict(),
  levelRules: z.array(z.object({ characterId: z.string().min(1).optional(), level: positiveInteger, exp: nonnegative, sp: nonnegative }).strict()).min(1),
  skillCostRules: z.array(z.object({ skillId: z.string().min(1).optional(), lv: positiveInteger, cost: nonnegative }).strict()).min(1),
  sourceLibraryIds: fourRolesSchema(z.string().min(1)),
  fieldMappings: fieldMappingsSchema,
  importedAt: z.string().datetime(),
}).strict().superRefine((snapshot, context) => {
  const characterIds = snapshot.catalog.characters.map(({ id }) => id);
  const skillIds = snapshot.catalog.skills.map(({ id }) => id);
  if (new Set(characterIds).size !== characterIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Character ids must be unique.', path: ['catalog', 'characters'] });
  }
  if (new Set(skillIds).size !== skillIds.length || skillIds.includes(snapshot.catalog.basic.id)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Skill ids must be unique.', path: ['catalog', 'skills'] });
  }
  if (snapshot.catalog.basic.id !== 'basic') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The basic skill id is reserved.', path: ['catalog', 'basic', 'id'] });
  }
  const characterIdSet = new Set(characterIds);
  const skillIdSet = new Set(skillIds);
  if (snapshot.levelRules.some(({ characterId }) => characterId && !characterIdSet.has(characterId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Level rules must reference catalog characters.', path: ['levelRules'] });
  }
  if (snapshot.skillCostRules.some(({ skillId }) => skillId && !skillIdSet.has(skillId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Skill cost rules must reference catalog skills.', path: ['skillCostRules'] });
  }
});

const rosterSchema = z.object({
  uid: z.string().min(1), tmplId: z.string().min(1), team: z.enum(['A', 'B']), snapshot: characterSnapshotSchema.nullable().optional(),
}).strict();

const progressionSchema = z.object({
  exp: z.record(z.string(), nonnegative),
  lv: z.record(z.string(), positiveInteger),
  sp: z.record(z.string(), nonnegativeInteger),
}).strict();

const sessionFields = {
  id: z.string().min(1),
  name: z.string(),
  importedSnapshot: importedSnapshotSchema.nullable(),
  roster: z.array(rosterSchema),
  loadout: z.record(z.string(), z.array(z.string().min(1))),
  skillLevels: z.record(z.string(), z.record(z.string(), positiveInteger)),
  progression: progressionSchema,
};

const v1SessionSchema = z.object({
  ...sessionFields,
  lastScreen: z.enum(['characters', 'skills', 'progression', 'battle']),
}).strict();

function validateSessionReferences(
  session: z.infer<typeof v1SessionSchema>,
  context: z.RefinementCtx,
  sessionIndex: number,
): void {
  const uids = session.roster.map(({ uid }) => uid);
  const uidSet = new Set(uids);
  if (uids.length !== uidSet.size) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Roster uids must be unique.', path: ['sessions', sessionIndex, 'roster'] });
  }
  const characterIds = new Set(session.importedSnapshot?.catalog.characters.map(({ id }) => id) ?? []);
  const skillIds = new Set(session.importedSnapshot?.catalog.skills.map(({ id }) => id) ?? []);
  for (const [index, entry] of session.roster.entries()) {
    if (!characterIds.has(entry.tmplId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Roster template is not in the imported catalog.', path: ['sessions', sessionIndex, 'roster', index, 'tmplId'] });
    }
  }
  for (const mapName of ['loadout', 'skillLevels'] as const) {
    for (const uid of Object.keys(session[mapName])) {
      if (!uidSet.has(uid)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Map uid is not in the roster.', path: ['sessions', sessionIndex, mapName, uid] });
    }
  }
  for (const mapName of ['exp', 'lv', 'sp'] as const) {
    for (const uid of Object.keys(session.progression[mapName])) {
      if (!uidSet.has(uid)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Progression uid is not in the roster.', path: ['sessions', sessionIndex, 'progression', mapName, uid] });
    }
  }
  for (const [uid, loadout] of Object.entries(session.loadout)) {
    const seen = new Set<string>();
    for (const skillId of loadout) {
      if (!skillIds.has(skillId) || seen.has(skillId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Loadout skills must be unique catalog skills.', path: ['sessions', sessionIndex, 'loadout', uid] });
      }
      seen.add(skillId);
    }
  }
  for (const [uid, levels] of Object.entries(session.skillLevels)) {
    const equipped = new Set(session.loadout[uid] ?? []);
    for (const skillId of Object.keys(levels)) {
      if (!skillIds.has(skillId) || !equipped.has(skillId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Skill level must reference an equipped catalog skill.', path: ['sessions', sessionIndex, 'skillLevels', uid, skillId] });
      }
    }
  }
}

function stateSchema<T extends z.ZodTypeAny>(sessionSchema: T) {
  return z.object({
    version: z.literal(1),
    activeSessionId: z.string().min(1).nullable(),
    sessions: z.array(sessionSchema),
  }).strict().superRefine((state, context) => {
    const sessions = state.sessions as Array<z.infer<typeof v1SessionSchema>>;
    const ids = sessions.map(({ id }) => id);
    if (ids.length !== new Set(ids).size) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Session ids must be unique.', path: ['sessions'] });
    }
    if (state.activeSessionId !== null && !ids.includes(state.activeSessionId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Active session must exist.', path: ['activeSessionId'] });
    }
    sessions.forEach((session, index) => validateSessionReferences(session, context, index));
  });
}

const stateV1Schema = stateSchema(v1SessionSchema);

export type SimulationStorageErrorCode =
  | 'storage_unavailable'
  | 'read_failed'
  | 'write_failed'
  | 'remove_failed'
  | 'malformed'
  | 'unknown_version'
  | 'invalid_state'
  | 'unauthorized'
  | 'conflict';

export interface SimulationStorageError {
  readonly code: SimulationStorageErrorCode;
  readonly message: string;
  readonly observedRevision?: number;
}

export type SimulationLoadResult =
  | { readonly ok: true; readonly state: SimulationStateV1 | null; readonly revision: number }
  | { readonly ok: false; readonly error: SimulationStorageError };
export type SimulationSaveResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly error: SimulationStorageError };
export type SimulationClearResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SimulationStorageError };

export interface SimulationStorageRepository {
  load(projectId: string): Promise<SimulationLoadResult>;
  save(projectId: string, expectedRevision: number, state: SimulationStateV1): Promise<SimulationSaveResult>;
  clear(projectId: string, expectedRevision: number): Promise<SimulationClearResult>;
}

function failure(
  code: SimulationStorageErrorCode,
  message: string,
  observedRevision?: number,
): { readonly ok: false; readonly error: SimulationStorageError } {
  return {
    ok: false,
    error: observedRevision === undefined ? { code, message } : { code, message, observedRevision },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

type SimulationSupabaseClient = Pick<SupabaseClient, 'from' | 'rpc'>;
type BackendError = { readonly code?: string; readonly message?: string };
type RpcRow = { readonly status?: unknown; readonly revision?: unknown };

function isUnauthorized(error: BackendError): boolean {
  return error.code === '42501'
    || error.code === '401'
    || error.code === '403'
    || error.code === 'PGRST301';
}

function backendFailure(
  error: BackendError,
  fallbackCode: 'read_failed' | 'write_failed' | 'remove_failed',
  fallbackMessage: string,
) {
  return isUnauthorized(error)
    ? failure('unauthorized', 'Simulation state is not accessible.')
    : failure(fallbackCode, fallbackMessage);
}

function rpcRow(data: unknown): RpcRow | null {
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== 'object') return null;
  return data[0] as RpcRow;
}

export function createSimulationStorageRepository(
  supabase: SimulationSupabaseClient | null | undefined,
): SimulationStorageRepository {
  return {
    async load(projectId) {
      if (!supabase) return failure('storage_unavailable', 'Cloud storage is unavailable.');
      let response: { data: unknown; error: BackendError | null };
      try {
        response = await supabase
          .from('simulation_states')
          .select('state_version,state,revision')
          .eq('project_id', projectId)
          .maybeSingle();
      } catch {
        return failure('read_failed', 'Simulation state could not be read.');
      }
      if (response.error) {
        return backendFailure(response.error, 'read_failed', 'Simulation state could not be read.');
      }
      if (response.data === null) return { ok: true, state: null, revision: 0 };
      if (typeof response.data !== 'object') {
        return failure('malformed', 'Cloud simulation state is malformed.');
      }

      const row = response.data as { state_version?: unknown; state?: unknown; revision?: unknown };
      const revision = row.revision;
      if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
        return failure('invalid_state', 'Cloud simulation state is invalid.');
      }
      if (row.state_version !== 1) {
        return failure('unknown_version', 'Cloud simulation state uses an unsupported version.', revision as number);
      }
      const parsed = stateV1Schema.safeParse(row.state);
      if (!parsed.success || parsed.data.sessions.some((session) => (
        session.importedSnapshot !== null && session.importedSnapshot.sourceProjectId !== projectId
      ))) {
        return failure('invalid_state', 'Cloud simulation state is invalid.', revision as number);
      }
      return { ok: true, state: deepFreeze(parsed.data as SimulationStateV1), revision: revision as number };
    },
    async save(projectId, expectedRevision, state) {
      if (!supabase) return failure('storage_unavailable', 'Cloud storage is unavailable.');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return failure('invalid_state', 'Simulation revision is invalid.');
      }
      const result = stateV1Schema.safeParse(state);
      if (!result.success || result.data.sessions.some((session) => (
        session.importedSnapshot !== null && session.importedSnapshot.sourceProjectId !== projectId
      ))) {
        return failure('invalid_state', 'Simulation state is invalid.');
      }
      let response: { data: unknown; error: BackendError | null };
      try {
        response = await supabase.rpc('save_simulation_state', {
          p_project_id: projectId,
          p_expected_revision: expectedRevision,
          p_state_version: 1,
          p_state: result.data,
        });
      } catch {
        return failure('write_failed', 'Simulation state could not be saved.');
      }
      if (response.error) {
        return backendFailure(response.error, 'write_failed', 'Simulation state could not be saved.');
      }
      const row = rpcRow(response.data);
      if (row?.status === 'conflict') return failure('conflict', 'Cloud simulation state has changed.');
      if (row?.status !== 'saved' || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1) {
        return failure('write_failed', 'Simulation state could not be saved.');
      }
      return { ok: true, revision: row.revision as number };
    },
    async clear(projectId, expectedRevision) {
      if (!supabase) return failure('storage_unavailable', 'Cloud storage is unavailable.');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return failure('invalid_state', 'Simulation revision is invalid.');
      }
      let response: { data: unknown; error: BackendError | null };
      try {
        response = await supabase.rpc('reset_simulation_state', {
          p_project_id: projectId,
          p_expected_revision: expectedRevision,
        });
      } catch {
        return failure('remove_failed', 'Simulation state could not be removed.');
      }
      if (response.error) {
        return backendFailure(response.error, 'remove_failed', 'Simulation state could not be removed.');
      }
      const row = rpcRow(response.data);
      if (row?.status === 'conflict') return failure('conflict', 'Cloud simulation state has changed.');
      if (row?.status !== 'reset') return failure('remove_failed', 'Simulation state could not be removed.');
      return { ok: true };
    },
  };
}
