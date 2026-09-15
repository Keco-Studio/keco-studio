import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('desktop release workflow', () => {
  it('is valid YAML for GitHub Actions to load', () => {
    expect(() => parse(read('.github/workflows/release-desktop.yml'))).not.toThrow();
  });

  it('builds all targets privately before publishing one draft-verified release', () => {
    const workflow = read('.github/workflows/release-desktop.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('windows-2022');
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).toContain('macos-14');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('actions/download-artifact@v4');
    expect(workflow).toContain('gh release create "v${VERSION}" --draft');
    expect(workflow).toContain('gh release view "v${VERSION}" --json assets --jq \'.assets[].name\'');
    expect(workflow).toContain('assert-release-assets.mjs "$VERSION" --names-file release-asset-names.txt');
    expect(workflow).toContain('gh release edit "v${VERSION}" --draft=false');
  });

  it('packages the Native SDK output before installer creation and checks package architectures', () => {
    const workflow = read('.github/workflows/release-desktop.yml');

    expect(workflow).toContain('package --target windows --manifest app.json');
    expect(workflow).toContain('create-release-manifest.mjs "$VERSION" app.json');
    expect(workflow).toContain('--output release/windows');
    expect(workflow).toContain('KECO_DESKTOP_SOURCE_DIR = (Resolve-Path desktop/release/windows).Path');
    expect(workflow).toContain('WebView2Loader.dll');
    expect(workflow).toContain('hdiutil attach');
    expect(workflow).toContain('lipo -archs');
    expect(workflow).toContain('x86_64');
    expect(workflow).toContain('arm64');
  });

  it('builds the Windows release for a portable x64 CPU baseline', () => {
    const workflow = read('.github/workflows/release-desktop.yml');

    expect(workflow).toContain('zig build -Dtarget=x86_64-windows-msvc -Dplatform=windows -Doptimize=ReleaseFast');
  });

  it('retries transient macOS DMG packaging failures with a clean output directory', () => {
    const workflow = read('.github/workflows/release-desktop.yml');
    const retryCleanupBlocks = workflow.match(/if \[ "\$attempt" -gt 1 \]; then[\s\S]*?rm -rf release/g) ?? [];

    expect(workflow.match(/for attempt in 1 2 3; do/g) ?? []).toHaveLength(2);
    expect(workflow.match(/rm -rf release/g) ?? []).toHaveLength(2);
    expect(retryCleanupBlocks).toHaveLength(2);
    expect(retryCleanupBlocks.every((block) => block.includes('hdiutil detach -quiet -force "$mount_point"'))).toBe(true);
    expect(workflow.match(/if \[ "\$attempt" -eq 3 \]; then\n\s+exit 1/g) ?? []).toHaveLength(2);
  });

  it('uses a per-user x64 Inno Setup installation with WebView2 detection', () => {
    const installer = read('desktop/installer/KecoStudio.iss');
    expect(installer).toContain('PrivilegesRequired=lowest');
    expect(installer).toContain('{localappdata}\\Programs\\Keco Studio');
    expect(installer).toContain('ArchitecturesInstallIn64BitMode=x64');
    expect(installer).toContain('WebView2');
    expect(installer).toContain('{app}\\bin\\keco-studio.exe');
    expect(installer).toContain('[UninstallDelete]');
  });
});
