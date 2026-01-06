/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable React Strict Mode to prevent double rendering and duplicate API requests in development
  // React Strict Mode intentionally double-invokes effects and renders to help detect side effects
  // While useful for debugging, it causes significant performance issues with our API calls
  reactStrictMode: false,
};

export default nextConfig;




