import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function hashRespondent(sessionId, anonymousId) {
  return createHash('sha256').update(`${sessionId}:${anonymousId}`).digest('hex');
}

export class JsonStore {
  constructor(path) {
    this.path = path;
    this.data = { sessions: [], ratings: [] };
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try { this.data = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.#persist();
    }
    return this;
  }

  listSessions() { return this.data.sessions.map((session) => ({ ...session })); }
  getSession(id) { return this.data.sessions.find((session) => session.id === id) || null; }
  getSessionByToken(token) { return this.data.sessions.find((session) => session.publicToken === token) || null; }
  getRatings(sessionId) { return this.data.ratings.filter((rating) => rating.sessionId === sessionId).map((rating) => ({ ...rating })); }

  async createSession(input) {
    const now = new Date().toISOString();
    const session = { id: randomUUID(), publicToken: randomBytes(24).toString('base64url'), status: 'open', createdAt: now, updatedAt: now, lastSyncError: null, ...input };
    return this.#mutate(() => { this.data.sessions.push(session); return { ...session }; });
  }

  async closeSession(id) {
    return this.#mutate(() => {
      const session = this.getSession(id);
      if (!session) throw new Error('Rating session not found');
      session.status = 'closed';
      session.updatedAt = new Date().toISOString();
      return { ...session };
    });
  }

  async deleteSession(id) {
    return this.#mutate(() => {
      this.data.sessions = this.data.sessions.filter((session) => session.id !== id);
      this.data.ratings = this.data.ratings.filter((rating) => rating.sessionId !== id);
    });
  }

  async setSyncError(id, message) {
    return this.#mutate(() => {
      const session = this.getSession(id);
      if (!session) throw new Error('Rating session not found');
      session.lastSyncError = message || null;
      session.updatedAt = new Date().toISOString();
      return { ...session };
    });
  }

  async upsertRating(sessionId, respondentHash, rating) {
    return this.#mutate(() => {
      const session = this.getSession(sessionId);
      if (!session) throw new Error('Rating session not found');
      if (session.status !== 'open') throw new Error('Rating session is closed');
      if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('Rating session has expired');
      const now = new Date().toISOString();
      let record = this.data.ratings.find((item) => item.sessionId === sessionId && item.respondentHash === respondentHash);
      if (record) Object.assign(record, rating, { updatedAt: now });
      else {
        record = { id: randomUUID(), sessionId, respondentHash, ...rating, createdAt: now, updatedAt: now };
        this.data.ratings.push(record);
      }
      session.updatedAt = now;
      return { ...record };
    });
  }

  #mutate(action) {
    const operation = this.queue.then(async () => { const result = action(); await this.#persist(); return result; });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async #persist() {
    const temp = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.path);
  }
}
