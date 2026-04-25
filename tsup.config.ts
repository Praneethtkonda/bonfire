import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'cli/bin': 'src/cli/bin.tsx' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  banner: { js: '#!/usr/bin/env node' },
});
