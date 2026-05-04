import { defineConfig } from 'tsup';

// Minify by default. Set BONFIRE_BUILD_DEBUG=1 for a readable build when
// investigating issues in the published artefact.
const minify = process.env.BONFIRE_BUILD_DEBUG !== '1';

export default defineConfig({
  entry: { 'cli/bin': 'src/cli/bin.tsx' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  minify,
  banner: { js: '#!/usr/bin/env node' },
});
