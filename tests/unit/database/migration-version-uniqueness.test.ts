import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationDirectory = path.join(process.cwd(), 'supabase/migrations');

describe('Supabase migration history', () => {
  it('uses each migration version exactly once', () => {
    const migrationsByVersion = new Map<string, string[]>();

    for (const fileName of fs.readdirSync(migrationDirectory)) {
      const match = /^(\d{14})_.+\.sql$/.exec(fileName);
      if (!match) continue;

      const version = match[1];
      const files = migrationsByVersion.get(version) ?? [];
      files.push(fileName);
      migrationsByVersion.set(version, files);
    }

    const duplicates = [...migrationsByVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `${version}: ${files.sort().join(', ')}`);

    expect(duplicates).toEqual([]);
  });
});
