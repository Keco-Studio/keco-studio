const crypto = require('node:crypto');
const path = require('node:path');
const esbuild = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    const result = esbuild.buildSync({
      bundle: true,
      format: 'cjs',
      platform: 'node',
      external: ['*.module.css'],
      jsx: 'automatic',
      sourcemap: 'inline',
      stdin: {
        contents: sourceText,
        loader: sourcePath.endsWith('.tsx') ? 'tsx' : 'ts',
        resolveDir: path.dirname(sourcePath),
        sourcefile: sourcePath,
      },
      target: 'node18',
      write: false,
    });
    return { code: result.outputFiles[0].text };
  },
  getCacheKey(sourceText, sourcePath, transformOptions) {
    return crypto
      .createHash('sha256')
      .update(sourceText)
      .update(sourcePath)
      .update(transformOptions.configString)
      .update('tsx-automatic-css-external-v1')
      .update(esbuild.version)
      .digest('hex');
  },
};
