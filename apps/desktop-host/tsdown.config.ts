import { defineConfig } from 'tsdown'

const nodeBundle = {
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default defineConfig([
  {
    // Index and the YAML plugin must share one overlay-guard module instance:
    // pending acks live in module state. Separate configs would inline two copies.
    entry: {
      index: 'lib/types/index.js',
      'computer-use-overlay-guard': 'lib/types/computer-use-overlay-guard.js',
    },
    ...nodeBundle,
  },
  {
    entry: ['lib/types/computer-use-preset-root.js'],
    ...nodeBundle,
  },
])
