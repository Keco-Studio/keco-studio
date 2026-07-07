import { describe, expect, it } from '@jest/globals';
import {
  parseWorkbookRows,
  previewWorkbookFile,
  writeXlsxWorkbook,
} from '../../src/lib/utils/workbook';

describe('workbook utilities', () => {
  it('writes and reads xlsx workbooks with sheet names and row data', async () => {
    const buffer = await writeXlsxWorkbook([
      {
        name: 'Characters',
        rows: [
          ['Name', 'Power'],
          ['Hero', 12],
          ['Mage', true],
        ],
        columns: [{ width: 12 }, { width: 8 }],
      },
      {
        name: 'Items',
        rows: [
          ['Name'],
          ['Potion'],
        ],
      },
    ]);

    const sheets = await parseWorkbookRows(buffer, 'library.xlsx');

    expect(sheets).toEqual([
      {
        name: 'Characters',
        rows: [
          ['Name', 'Power'],
          ['Hero', 12],
          ['Mage', true],
        ],
      },
      {
        name: 'Items',
        rows: [['Name'], ['Potion']],
      },
    ]);
  });

  it('parses quoted CSV rows', async () => {
    const csv = Buffer.from('Name,Notes\n"Hero, One","Line ""quoted"""\nMage,\n');

    await expect(parseWorkbookRows(csv, 'library.csv')).resolves.toEqual([
      {
        name: 'Section',
        rows: [
          ['Name', 'Notes'],
          ['Hero, One', 'Line "quoted"'],
          ['Mage', ''],
        ],
      },
    ]);
  });

  it('previews browser files through the same parser', async () => {
    const file = new File([Buffer.from('Name,Power\nHero,12\n')], 'preview.csv', {
      type: 'text/csv',
    });

    await expect(previewWorkbookFile(file)).resolves.toEqual({
      sheetCount: 1,
      columnCount: 2,
      rowCount: 1,
    });
  });
});
