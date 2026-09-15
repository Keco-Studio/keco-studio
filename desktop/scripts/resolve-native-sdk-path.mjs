import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkPath = path.join(desktopRoot, 'node_modules', '@native-sdk', 'cli');
const command = process.argv[2] ?? 'check';

if (command !== 'check') throw new Error(`Unsupported Native SDK command: ${command}`);

execFileSync(path.join(sdkPath, 'bin', 'native.js'), ['check', '.'], {
  cwd: desktopRoot,
  stdio: 'inherit',
  env: { ...process.env, NATIVE_SDK_PATH: sdkPath },
});
