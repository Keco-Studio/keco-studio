import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextCoreWebVitals,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'out/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
      '*.d.ts',
      'supabase/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    rules: {
      // React Compiler-era rules newly surfaced by the ESLint 9 flat preset.
      // The legacy `next lint` never checked these, so they represent a large
      // pre-existing backlog rather than regressions from this change. Keep
      // them as warnings so CI stays green while the backlog is worked down
      // separately.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
];
