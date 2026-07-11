import ExcelJS from 'exceljs';
import {
  isStoryTableColumns,
  STORY_COLUMN_DESCRIPTIONS,
  STORY_COLUMN_WIDTHS,
} from './tableFormat';

export type StoryWorkbookCell = string | number | boolean | null;

export type StoryWorkbookSheet = {
  name: string;
  columns: string[];
  rows: StoryWorkbookCell[][];
};

export function buildStoryWorkbookSheet(
  name: string,
  properties: Array<{ name: string }>,
  rows: StoryWorkbookCell[][]
): StoryWorkbookSheet | null {
  const columns = properties.map((property) => property.name);
  return isStoryTableColumns(columns) ? { name, columns, rows } : null;
}

export async function writeStoryXlsxWorkbook(
  sheet: StoryWorkbookSheet
): Promise<Uint8Array> {
  if (!isStoryTableColumns(sheet.columns)) {
    throw new Error('Story workbook columns do not match the story table contract');
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || 'Section');
  worksheet.addRow(sheet.columns);
  worksheet.addRow(sheet.columns.map(descriptionForColumn));

  for (const row of sheet.rows) {
    worksheet.addRow(row);
    if (hasChoice(row, sheet.columns)) {
      const marker = Array<StoryWorkbookCell>(sheet.columns.length).fill('');
      marker[0] = '*';
      worksheet.addRow(marker);
      worksheet.addRow(Array<StoryWorkbookCell>(sheet.columns.length).fill(''));
    }
  }

  for (const rowNumber of [1, 2]) {
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9F3FD' },
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  }

  sheet.columns.forEach((column, index) => {
    const width = widthForColumn(column);
    if (width !== undefined) {
      worksheet.getColumn(index + 1).width = width;
    }
  });

  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output);
}

function descriptionForColumn(column: string): string {
  if (/^Option\d+_Commands$/.test(column)) return '选项指令';
  if (/^Option\d+(?:_Next)?$/.test(column)) return '';
  return STORY_COLUMN_DESCRIPTIONS[column] ?? '';
}

function widthForColumn(column: string): number | undefined {
  if (/^Option\d+_Commands$/.test(column)) return 17;
  return STORY_COLUMN_WIDTHS[column];
}

function hasChoice(row: StoryWorkbookCell[], columns: string[]): boolean {
  return columns.some((column, index) => (
    /^Option\d+$/.test(column)
    && String(row[index] ?? '').trim().length > 0
  ));
}
