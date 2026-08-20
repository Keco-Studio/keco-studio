import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

  it('preserves the production-applied GDD migration versions, names, and contents', () => {
    const productionHistory = new Map([
      ['20260819100000_gdd_version_folder_table_resources.sql', 'edb018c1a6fe9d4c314f26bc6632fe691bf8f62bde1b890bd4ac8e86c9d2100f'],
      ['20260819110000_gdd_table_rows_and_system_folders.sql', '9aa9ef89bf0410f6bf77a3cde4ccb5f4e841f921cefe923b197a8510834a8b17'],
      ['20260819130000_gdd_table_resource_compatibility.sql', '3732a7df82e17165e37be52d677578a3842023d92c7c9e4b1d918f4fc3eeaf3a'],
      ['20260819140000_gdd_table_row_compatibility.sql', '094a58d01aa73f12dcec6367d17d21ded31a498f649395960d7e8e9b4b40f0b2'],
      ['20260819150000_backfill_gdd_name_cells.sql', '779fb3008da6f5603c9cef2afbe25d3a7c5f15fad3811b7b43997489e9f23b1e'],
      ['20260819160000_gdd_dialogue_generation_jobs.sql', '4b1c48f46d6e38dd956335c8f67393775cb3d3fb8a0d056e55a09f9ee95f0b63'],
    ]);

    const actualHistory = new Map([...productionHistory.keys()].map((fileName) => [
      fileName,
      createHash('sha256').update(fs.readFileSync(path.join(migrationDirectory, fileName))).digest('hex'),
    ]));

    expect(actualHistory).toEqual(productionHistory);
  });
});
