import { defineConfig } from 'vitest/config';

// base relativa para que funcione igual en GitHub Pages (/chopilaser/) y en local.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  // El vectorizado corre en un Worker de módulo (potrace wasm va dentro del módulo).
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
