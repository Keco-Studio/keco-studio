import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('desktop release workflow', () => {
  it('builds all targets privately before publishing one draft-verified release', () => {
    const workflow = read('.github/workflows/release-desktop.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('windows-2022');
    expect(workflow).toContain('macos-13');
    expect(workflow).toContain('macos-14');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('actions/download-artifact@v4');
    expect(workflow).toContain('gh release create "v${VERSION}" --draft');
    expect(workflow).toContain('gh release edit "v${VERSION}" --draft=false');
  });

  it('uses a per-user x64 Inno Setup installation with WebView2 detection', () => {
    const installer = read('desktop/installer/KecoStudio.iss');
    expect(installer).toContain('PrivilegesRequired=lowest');
    expect(installer).toContain('{localappdata}\\Programs\\Keco Studio');
    expect(installer).toContain('ArchitecturesInstallIn64BitMode=x64');
    expect(installer).toContain('WebView2');
    expect(installer).toContain('[UninstallDelete]');
  });
});
