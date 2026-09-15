import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(path.join(desktopRoot, relativePath), 'utf8');

test('desktop manifest has one narrow remote WebView surface', () => {
  const manifest = JSON.parse(read('app.json'));

  assert.deepEqual(manifest.platforms, ['macos', 'windows']);
  assert.deepEqual(manifest.permissions, []);
  assert.deepEqual(manifest.capabilities, ['webview']);
  assert.deepEqual(manifest.security.navigation.allowed_origins, ['https://keco-studio-main.vercel.app']);
  assert.equal(manifest.security.navigation.external_links.action, 'deny');
  assert.deepEqual(manifest.windows, [{
    label: 'main', title: 'Keco Studio', width: 1280, height: 800, restore_state: true,
  }]);
});

test('desktop shell opens the fixed production URL without a bridge or bundled frontend', () => {
  const source = read('src/main.zig');

  assert.match(source, /https:\/\/keco-studio-main\.vercel\.app\/projects\?desktop=1/);
  assert.doesNotMatch(source, /BridgeDispatcher|window\.zero|frontend\/|productionSource/);
});

test('desktop dependencies and popup patch are pinned to Native SDK 0.10.1', () => {
  const packageJson = JSON.parse(read('package.json'));
  const patch = read('patches/native-sdk-0.10.1-popup-block.patch');

  assert.equal(packageJson.devDependencies['@native-sdk/cli'], '0.10.1');
  assert.match(patch, /add_NewWindowRequested/);
  assert.match(patch, /ICoreWebView2NewWindowRequestedEventArgs/);
  assert.match(patch, /put_Handled\(TRUE\)/);
});

test('desktop build package fingerprint matches the Native SDK template for keco_studio', () => {
  assert.match(read('build.zig.zon'), /\.fingerprint = 0x6ded5f995a707070,/);
});
