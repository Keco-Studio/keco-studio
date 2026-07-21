import { z } from 'zod';

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
  level: mappingSchema(['level', 'exp', 'sp']),
  skillc: mappingSchema(['lv', 'cost']),
}).strict();

const importedSnapshotSchema = z.object({
  sourceProjectId: z.string().min(1),
  catalog: z.object({
    characters: z.array(characterTemplateSchema).min(1), skills: z.array(skillSchema).min(1), basic: skillSchema,
  }).strict(),
  levelRules: z.array(z.object({ level: positiveInteger, exp: nonnegative, sp: nonnegative }).strict()).min(1),
  skillCostRules: z.array(z.object({ lv: positiveInteger, cost: nonnegative }).strict()).min(1),
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
  if (!snapshot.levelRules.every(({ level }, index) => level === index + 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Level rules must be contiguous from one.', path: ['levelRules'] });
  }
  if (!snapshot.skillCostRules.every(({ lv }, index) => lv === index + 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Skill cost rules must be contiguous from one.', path: ['skillCostRules'] });
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
const v0SessionSchema = z.object(sessionFields).strict();

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

function stateSchema<T extends z.ZodTypeAny>(version: 0 | 1, sessionSchema: T) {
  return z.object({
    version: z.literal(version),
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

const stateV1Schema = stateSchema(1, v1SessionSchema);
const stateV0Schema = stateSchema(0, v0SessionSchema);

export type SimulationStorageErrorCode =
  | 'storage_unavailable'
  | 'read_failed'
  | 'write_failed'
  | 'remove_failed'
  | 'malformed'
  | 'unknown_version'
  | 'invalid_state';

export interface SimulationStorageError {
  readonly code: SimulationStorageErrorCode;
  readonly message: string;
}

export type SimulationLoadResult =
  | { readonly ok: true; readonly state: SimulationStateV1 | null; readonly migratedFrom?: 0 }
  | { readonly ok: false; readonly error: SimulationStorageError };
export type SimulationWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SimulationStorageError };

export interface SimulationStorageRepository {
  load(userId: string, projectId: string): SimulationLoadResult;
  save(userId: string, projectId: string, state: SimulationStateV1): SimulationWriteResult;
  clear(userId: string, projectId: string): SimulationWriteResult;
}

export function simulationStorageKey(userId: string, projectId: string): string {
  return `keco.simulation.sessions:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
}

function failure(
  code: SimulationStorageErrorCode,
  message: string,
): { readonly ok: false; readonly error: SimulationStorageError } {
  return { ok: false, error: { code, message } };
}

export function createSimulationStorageRepository(storage: Storage | null | undefined): SimulationStorageRepository {
  return {
    load(userId, projectId) {
      if (!storage) return failure('storage_unavailable', 'Browser storage is unavailable.');
      let raw: string | null;
      try {
        raw = storage.getItem(simulationStorageKey(userId, projectId));
      } catch {
        return failure('read_failed', 'Simulation state could not be read.');
      }
      if (raw === null) return { ok: true, state: null };
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return failure('malformed', 'Stored simulation state is not valid JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
        return failure('invalid_state', 'Stored simulation state is invalid.');
      }
      const version = (parsed as { version?: unknown }).version;
      if (version !== 0 && version !== 1) {
        return failure('unknown_version', 'Stored simulation state uses an unsupported version.');
      }
      if (version === 1) {
        const result = stateV1Schema.safeParse(parsed);
        if (!result.success || result.data.sessions.some((session) => (
          session.importedSnapshot !== null && session.importedSnapshot.sourceProjectId !== projectId
        ))) return failure('invalid_state', 'Stored simulation state is invalid.');
        return { ok: true, state: result.data as SimulationStateV1 };
      }
      const result = stateV0Schema.safeParse(parsed);
      if (!result.success || result.data.sessions.some((session) => (
        session.importedSnapshot !== null && session.importedSnapshot.sourceProjectId !== projectId
      ))) return failure('invalid_state', 'Stored simulation state is invalid.');
      return {
        ok: true,
        state: {
          version: 1,
          activeSessionId: result.data.activeSessionId,
          sessions: result.data.sessions.map((session) => ({ ...session, lastScreen: 'characters' })),
        } as SimulationStateV1,
        migratedFrom: 0,
      };
    },
    save(userId, projectId, state) {
      if (!storage) return failure('storage_unavailable', 'Browser storage is unavailable.');
      const result = stateV1Schema.safeParse(state);
      if (!result.success || result.data.sessions.some((session) => (
        session.importedSnapshot !== null && session.importedSnapshot.sourceProjectId !== projectId
      ))) {
        return failure('invalid_state', 'Simulation state is invalid.');
      }
      try {
        storage.setItem(simulationStorageKey(userId, projectId), JSON.stringify(result.data));
        return { ok: true };
      } catch {
        return failure('write_failed', 'Simulation state could not be saved.');
      }
    },
    clear(userId, projectId) {
      if (!storage) return failure('storage_unavailable', 'Browser storage is unavailable.');
      try {
        storage.removeItem(simulationStorageKey(userId, projectId));
        return { ok: true };
      } catch {
        return failure('remove_failed', 'Simulation state could not be removed.');
      }
    },
  };
}
