import ExcelJS from 'exceljs';

export type WorkbookSheetRows = {
  name: string;
  rows: unknown[][];
};

export type XlsxSheetInput = {
  name: string;
  rows: Array<Array<string | number | boolean | null>>;
  columns?: Array<{ width?: number }>;
};

function fileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function normalizeCellValue(value: unknown): unknown {
  if (value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return value;
}

function trimTrailingEmptyCells(row: unknown[]): unknown[] {
  const next = row.map(normalizeCellValue);
  while (next.length > 0 && (next[next.length - 1] === '' || next[next.length - 1] == null)) {
    next.pop();
  }
  return next;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toArrayBuffer(input: Buffer | ArrayBuffer): ArrayBuffer {
  if (!Buffer.isBuffer(input)) {
    return input;
  }
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

export async function parseWorkbookRows(
  input: Buffer | ArrayBuffer,
  fileName: string
): Promise<WorkbookSheetRows[]> {
  const ext = fileExtension(fileName);
  const arrayBuffer = toArrayBuffer(input);

  if (ext === 'csv') {
    return [{ name: 'Section', rows: parseCsvRows(Buffer.from(arrayBuffer).toString('utf8')) }];
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  return workbook.worksheets
    .filter((worksheet) => worksheet.name.trim().length > 0)
    .map((worksheet) => {
      const rows: unknown[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (worksheetRow) => {
        const values = Array.isArray(worksheetRow.values) ? worksheetRow.values.slice(1) : [];
        rows.push(trimTrailingEmptyCells(values));
      });
      return { name: worksheet.name, rows };
    });
}

export async function writeXlsxWorkbook(sheets: XlsxSheetInput[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    if (sheet.columns) {
      worksheet.columns = sheet.columns.map((column) => ({ width: column.width }));
    }
    sheet.rows.forEach((row) => worksheet.addRow(row));
  }

  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output);
}

export async function previewWorkbookFile(file: File): Promise<{
  sheetCount: number;
  columnCount: number;
  rowCount: number;
}> {
  const sheets = await parseWorkbookRows(await file.arrayBuffer(), file.name);
  let columnCount = 0;
  let rowCount = 0;

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;
    const headers = sheet.rows[0].filter((cell) => String(cell ?? '').trim().length > 0);
    const dataRows = sheet.rows
      .slice(1)
      .filter((row) => row.some((cell) => String(cell ?? '').trim().length > 0));
    columnCount += headers.length;
    rowCount = Math.max(rowCount, dataRows.length);
  }

  return {
    sheetCount: sheets.length,
    columnCount,
    rowCount,
  };
}
