import { existsSync } from 'node:fs';
import path from 'node:path';

describe('desktop repository ownership', () => {
  it('does not retain native shell or release ownership in the Web repository', () => {
    expect(existsSync(path.join(process.cwd(), 'desktop'))).toBe(false);
    expect(existsSync(path.join(process.cwd(), '.github/workflows/release-desktop.yml'))).toBe(false);
    expect(existsSync(path.join(process.cwd(), 'tests/unit/desktop-release-workflow-static.test.ts'))).toBe(false);
  });
});
