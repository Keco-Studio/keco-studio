/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The headless codec loads these through the same native ESM dependency graph.
  serverExternalPackages: [
    '@mdxeditor/editor',
    '@mdxeditor/gurx',
    'lexical',
    'pdfkit',
    'react-hook-form',
  ],
};

export default nextConfig;
