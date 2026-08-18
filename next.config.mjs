import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@keco/battle-core', '@keco/battle-engine'],
  reactStrictMode: true,
  // The headless codec loads these through the same native ESM dependency graph.
  serverExternalPackages: [
    '@mdxeditor/editor',
    '@mdxeditor/gurx',
    'lexical',
    'pdfkit',
    'react-hook-form',
  ],
  turbopack: {
    root: rootDir,
    resolveAlias: {
      '@keco/battle-core': './packages/keco-battle-core/src/index.ts',
      '@keco/battle-engine': './packages/keco-battle-engine/src/index.ts',
      // Keep a single Yjs constructor identity across @lexical/yjs, y-protocols,
      // and app imports. Duplicate copies break instanceof checks and can race
      // Lexical/React DOM updates into removeChild NotFoundError.
      // Turbopack resolveAlias must be project-relative (absolute paths get
      // mistreated as ./home/... and fail module resolution).
      yjs: './node_modules/yjs',
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@keco/battle-core': path.join(rootDir, 'packages/keco-battle-core/src/index.ts'),
      '@keco/battle-engine': path.join(rootDir, 'packages/keco-battle-engine/src/index.ts'),
      yjs: path.join(rootDir, 'node_modules/yjs'),
    };
    return config;
  },
};

export default nextConfig;
