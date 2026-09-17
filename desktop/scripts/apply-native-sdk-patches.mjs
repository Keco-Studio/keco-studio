import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkPath = process.env.NATIVE_SDK_PATH ?? path.join(desktopRoot, 'node_modules', '@native-sdk', 'cli');
const packageJson = JSON.parse(readFileSync(path.join(sdkPath, 'package.json'), 'utf8'));
const patchPath = path.join(desktopRoot, 'patches', 'native-sdk-0.10.1-popup-block.patch');
const patchedSourcePath = path.join(sdkPath, 'src/platform/windows/webview2_host.cpp');

if (packageJson.version !== '0.10.1') {
  throw new Error(`Expected @native-sdk/cli@0.10.1, found ${packageJson.version}`);
}

try {
  execFileSync('git', ['apply', '--check', patchPath], { cwd: sdkPath, stdio: 'pipe' });
  execFileSync('git', ['apply', patchPath], { cwd: sdkPath, stdio: 'inherit' });
} catch {
  const source = readFileSync(patchedSourcePath, 'utf8');
  const appliedMarkers = [
    'kNativeSdkIID_NewWindowRequestedHandler',
    'WebView2HandlerIid<ICoreWebView2NewWindowRequestedEventHandler>',
    'found->second.webview->add_NewWindowRequested',
    'ICoreWebView2NewWindowRequestedEventArgs *args',
    'if (args) args->put_Handled(TRUE);',
  ];
  if (!appliedMarkers.every((marker) => source.includes(marker))) {
    throw new Error('Native SDK popup patch context changed or the complete patch is not applied');
  }
}
