import { defineConfig } from 'vitest/config';

// base relativa para que funcione igual en GitHub Pages (/chopilaser/) y en local.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
