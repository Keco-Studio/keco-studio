import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import { STORY_BASE_COLUMNS } from './tableFormat';
import {
  buildStoryWorkbookSheet,
  writeStoryXlsxWorkbook,
} from './storyWorkbook';

function makeRow(columns: string[], values: Record<string, string>): string[] {
  return columns.map((column) => values[column] ?? '');
}

function readRow(worksheet: ExcelJS.Worksheet, rowNumber: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const value = worksheet.getCell(rowNumber, index + 1).value;
    return value === null || value === undefined ? '' : String(value);
  });
}

describe('story workbook', () => {
  it('writes the canonical reference presentation without changing playable rows', async () => {
    const columns = [...STORY_BASE_COLUMNS, 'Option0_Commands'];
    const rows = [
      makeRow(columns, {
        Label: 'Start', Type: '1', Name: 'Guide', Content: 'Choose',
        Option0: 'Continue', Option0_Next: 'Jump End',
        Option0_Commands: '$trust+=1',
      }),
      makeRow(columns, { Label: 'End', Type: '2', Content: 'Following narration' }),
    ];

    const bytes = await writeStoryXlsxWorkbook({ name: 'Section', columns, rows });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer);
    const worksheet = workbook.worksheets[0];

    expect(readRow(worksheet, 1, columns.length)).toEqual(columns);
    expect(readRow(worksheet, 2, columns.length)).toEqual([
      '这里是跳转的节点',
      '1蓝对话框2粉3灰4无对话框5屏幕中央',
      '说话人', '对话内容', '触发条件', '指令',
      '左侧显示立绘', '右侧显示立绘', '显示CG',
      '', '', '', '', '', '', '配音路径', '背景图', '选项指令',
    ]);
    expect(worksheet.getColumn(4).width).toBe(51);
    expect(worksheet.getColumn(6).width).toBe(17);
    expect(worksheet.getColumn(17).width).toBe(14);
    expect(worksheet.getColumn(18).width).toBe(17);
    expect(worksheet.getCell('A1').font).toMatchObject({ name: 'Calibri', size: 10 });
    expect(worksheet.getCell('A1').fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9F3FD' },
    });
    expect(worksheet.getCell('A2').alignment).toMatchObject({
      vertical: 'middle',
      wrapText: true,
    });
    expect(worksheet.getCell('A4').value).toBe('*');
    expect(readRow(worksheet, 5, columns.length).every((value) => value === '')).toBe(true);
    expect(worksheet.getCell('D6').value).toBe('Following narration');
  });

  it('detects only exact base schemas with valid ordered extensions', () => {
    const properties = (columns: string[]) => columns.map((name) => ({ name }));
    expect(buildStoryWorkbookSheet('Story', properties([...STORY_BASE_COLUMNS]), []))
      .not.toBeNull();
    expect(buildStoryWorkbookSheet(
      'Story',
      properties([...STORY_BASE_COLUMNS, 'Option0_Commands', 'Option3', 'Option3_Next']),
      []
    )).not.toBeNull();
    expect(buildStoryWorkbookSheet(
      'Story',
      properties([...STORY_BASE_COLUMNS].reverse()),
      []
    )).toBeNull();
    expect(buildStoryWorkbookSheet('Story', properties(STORY_BASE_COLUMNS.slice(0, 16)), []))
      .toBeNull();
    expect(buildStoryWorkbookSheet('Story', properties(['Name', 'Description']), []))
      .toBeNull();
  });
});
