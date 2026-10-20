import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const tableStyles = readFileSync(
  path.join(process.cwd(), 'src/components/libraries/LibraryAssetsTable.module.css'),
  'utf8',
);
const uploadStyles = readFileSync(
  path.join(process.cwd(), 'src/components/media/MediaFileUpload.module.css'),
  'utf8',
);

const imageDataUrl = (width: number, height: number, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`,
  )}`;

const thumbnailMarkup = (id: string, width: number, height: number, color: string) => `
  <table class="table colsCustom" style="width: 180px; min-width: 180px">
    <colgroup><col style="width: 180px"></colgroup>
    <tbody>
      <tr class="row rowCustomHeight" style="--row-height: 80px">
        <td id="${id}" class="cell" style="width: 180px; min-width: 180px; max-width: 180px">
          <div class="mediaFileUploadContainer mediaFileUploadContainerCentered">
            <div class="container containerTableCell">
              <div class="uploadedFileContainer uploadedFileContainerTableCell">
                <div class="fileInfoClickable fileInfoClickableTableCell">
                  <div class="imageThumbnail">
                    <img
                      class="thumbnailImage"
                      src="${imageDataUrl(width, height, color)}"
                      alt="${id}"
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
`;

async function thumbnailMetrics(page: Page, id: string) {
  return page.locator(`#${id}`).evaluate((cell) => {
    const thumbnail = cell.querySelector<HTMLElement>('.imageThumbnail');
    const image = cell.querySelector<HTMLImageElement>('.thumbnailImage');
    if (!thumbnail || !image) throw new Error('Thumbnail markup is incomplete');

    const cellRect = cell.getBoundingClientRect();
    const thumbnailRect = thumbnail.getBoundingClientRect();
    return {
      cell: {
        top: cellRect.top,
        right: cellRect.right,
        bottom: cellRect.bottom,
        left: cellRect.left,
      },
      thumbnail: {
        top: thumbnailRect.top,
        right: thumbnailRect.right,
        bottom: thumbnailRect.bottom,
        left: thumbnailRect.left,
        width: thumbnailRect.width,
        height: thumbnailRect.height,
      },
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      objectFit: getComputedStyle(image).objectFit,
    };
  });
}

test.describe('table image thumbnail layout', () => {
  test('scales landscape, portrait, and square images within the resized cell without cropping', async ({ page }) => {
    await page.setContent(`
      <style>${tableStyles}\n${uploadStyles}</style>
      ${thumbnailMarkup('landscape', 320, 160, '#ef4444')}
      ${thumbnailMarkup('portrait', 160, 320, '#22c55e')}
      ${thumbnailMarkup('square', 240, 240, '#3b82f6')}
    `);

    await expect(page.getByRole('img')).toHaveCount(3);

    for (const [id, expectedRatio] of [
      ['landscape', 2],
      ['portrait', 0.5],
      ['square', 1],
    ] as const) {
      const metrics = await thumbnailMetrics(page, id);
      expect(metrics.naturalWidth / metrics.naturalHeight).toBe(expectedRatio);
      expect(metrics.objectFit).toBe('contain');
      expect(metrics.thumbnail.width).toBeGreaterThan(20);
      expect(metrics.thumbnail.height).toBeGreaterThan(20);
      expect(metrics.thumbnail.left).toBeGreaterThanOrEqual(metrics.cell.left);
      expect(metrics.thumbnail.top).toBeGreaterThanOrEqual(metrics.cell.top);
      expect(metrics.thumbnail.right).toBeLessThanOrEqual(metrics.cell.right);
      expect(metrics.thumbnail.bottom).toBeLessThanOrEqual(metrics.cell.bottom);
    }

    const beforeResize = await thumbnailMetrics(page, 'landscape');
    await page.locator('#landscape').evaluate((cell) => {
      const table = cell.closest('table');
      const column = table?.querySelector('col');
      const row = cell.closest('tr');
      if (!table || !column || !row) throw new Error('Resizable table markup is incomplete');

      column.setAttribute('style', 'width: 280px');
      table.setAttribute('style', 'width: 280px; min-width: 280px');
      cell.setAttribute('style', 'width: 280px; min-width: 280px; max-width: 280px');
      row.setAttribute('style', '--row-height: 140px');
    });
    const afterResize = await thumbnailMetrics(page, 'landscape');

    expect(afterResize.thumbnail.width).toBeGreaterThan(beforeResize.thumbnail.width);
    expect(afterResize.thumbnail.height).toBeGreaterThan(beforeResize.thumbnail.height);
    expect(afterResize.thumbnail.right).toBeLessThanOrEqual(afterResize.cell.right);
    expect(afterResize.thumbnail.bottom).toBeLessThanOrEqual(afterResize.cell.bottom);
  });
});
