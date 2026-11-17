import { describe, expect, it } from 'vitest';
import { trama } from '../../src/diseno/trama';

const cuadrado = (x: number, y: number, l: number) => [
  { x, y },
  { x: x + l, y },
  { x: x + l, y: y + l },
  { x, y: y + l },
];

describe('relleno por líneas', () => {
  it('un cuadrado de 10 con intervalo 1 da 10 líneas centradas, en zigzag', () => {
    const r = trama([cuadrado(0, 0, 10)], 1);
    expect(r).toHaveLength(10);
    expect(r.map((s) => s[0].y)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
    expect(r[0]).toEqual([
      { x: 0, y: 0.5 },
      { x: 10, y: 0.5 },
    ]);
    expect(r[1]).toEqual([
      { x: 10, y: 1.5 },
      { x: 0, y: 1.5 },
    ]);
  });

  it('un agujero queda vacío (par-impar)', () => {
    const r = trama([cuadrado(0, 0, 10), cuadrado(3, 3, 4)], 1);
    const fila = r.filter((s) => s[0].y === 4.5);
    expect(fila).toHaveLength(2);
    const xs = fila.flatMap((s) => s.map((p) => p.x)).sort((a, b) => a - b);
    expect(xs).toEqual([0, 3, 7, 10]);
  });

  it('triángulo: el largo de cada línea es proporcional a la altura y nunca sale del contorno', () => {
    const r = trama([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]], 0.5);
    for (const s of r) {
      const [a, b] = s[0].x < s[1].x ? s : [s[1], s[0]];
      expect(a.x).toBeCloseTo(0, 9);
      expect(b.x).toBeCloseTo(10 - s[0].y, 9);
    }
  });

  it('vértices sobre una línea de relleno no duplican cortes', () => {
    // Rombo con vértices laterales en y=5; con intervalo 10/3 las líneas caen en 1.67, 5 y 8.33.
    const rombo = [{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }];
    const r = trama([rombo], 10 / 3);
    expect(r).toHaveLength(3);
    const medio = r.filter((s) => Math.abs(s[0].y - 5) < 1e-9);
    expect(medio).toHaveLength(1);
    expect(medio[0].map((p) => p.x).sort((a, b) => a - b)).toEqual([0, 10]);
  });

  it('intervalo no válido da error', () => {
    expect(() => trama([cuadrado(0, 0, 1)], 0)).toThrow();
    expect(() => trama([cuadrado(0, 0, 1)], Number.NaN)).toThrow();
  });
});
