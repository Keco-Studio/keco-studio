import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    resolveAlias: {
      '@keco/battle-core': './packages/keco-battle-core/src/index.ts',
      '@keco/battle-engine': './packages/keco-battle-engine/src/index.ts',
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@keco/battle-core': path.join(rootDir, 'packages/keco-battle-core/src/index.ts'),
      '@keco/battle-engine': path.join(rootDir, 'packages/keco-battle-engine/src/index.ts'),
    };
    return config;
  },
};

export default nextConfig;
