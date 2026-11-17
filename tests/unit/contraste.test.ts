// Contraste WCAG AA de la paleta (ver tools/contraste.mjs).
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo JS sin tipos
import { contraste, mezclar, pares } from '../../tools/contraste.mjs';

describe('contraste WCAG AA', () => {
  it('la fórmula da los valores de referencia', () => {
    expect(contraste(mezclar('#000000'), mezclar('#ffffff'))).toBeCloseTo(21, 5);
    expect(contraste(mezclar('#777777'), mezclar('#ffffff'))).toBeCloseTo(4.48, 2);
  });

  for (const p of pares() as { uso: string; ratio: number; min: number; ok: boolean }[]) {
    it(`${p.uso}: ${p.ratio}:1 ≥ ${p.min}:1`, () => {
      expect(p.ok).toBe(true);
    });
  }
});
