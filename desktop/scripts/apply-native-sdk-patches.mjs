import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkPath = process.env.NATIVE_SDK_PATH ?? path.join(desktopRoot, 'node_modules', '@native-sdk', 'cli');
const packageJson = JSON.parse(readFileSync(path.join(sdkPath, 'package.json'), 'utf8'));
const patchPath = path.join(desktopRoot, 'patches', 'native-sdk-0.10.1-popup-block.patch');

if (packageJson.version !== '0.10.1') {
  throw new Error(`Expected @native-sdk/cli@0.10.1, found ${packageJson.version}`);
}

try {
  execFileSync('git', ['apply', '--check', patchPath], { cwd: sdkPath, stdio: 'pipe' });
  execFileSync('git', ['apply', patchPath], { cwd: sdkPath, stdio: 'inherit' });
} catch {
  const source = readFileSync(path.join(sdkPath, 'src/platform/windows/webview2_host.cpp'), 'utf8');
  if (!source.includes('kNativeSdkIID_NewWindowRequestedHandler')) throw new Error('Native SDK popup patch did not apply');
}
