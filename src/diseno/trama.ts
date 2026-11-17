// Relleno por líneas (rayado horizontal) de contornos cerrados, regla par-impar.
// Módulo puro. Sirve para el modo «grabado».
import type { Polilinea, Punto } from '../gcode/types';

/**
 * Rayado horizontal de los polígonos (en mm) con líneas separadas `intervalo` mm.
 * Las líneas van en zigzag (alternan sentido) para reducir los movimientos en vacío.
 * Un punto está dentro si lo cruza un número impar de bordes (así los agujeros quedan vacíos).
 */
export function trama(poligonos: readonly (readonly Punto[])[], intervalo: number): Polilinea[] {
  if (!(intervalo > 0) || !Number.isFinite(intervalo)) throw new Error('El intervalo debe ser mayor que 0.');
  const bordes: [Punto, Punto][] = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pol of poligonos) {
    const n = pol.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = pol[i];
      const b = pol[(i + 1) % n];
      if (a.y === b.y) continue; // los bordes horizontales no cortan las líneas
      bordes.push([a, b]);
      yMin = Math.min(yMin, a.y, b.y);
      yMax = Math.max(yMax, a.y, b.y);
    }
  }
  if (!bordes.length) return [];
  const r: Polilinea[] = [];
  // Primera línea a medio intervalo del borde inferior: el relleno queda centrado.
  const total = Math.floor((yMax - yMin) / intervalo + 1e-9);
  const margen = (yMax - yMin - total * intervalo) / 2 + intervalo / 2;
  let fila = 0;
  for (let y = yMin + margen; y < yMax; y = yMin + margen + ++fila * intervalo) {
    const xs: number[] = [];
    for (const [a, b] of bordes) {
      // Semiabierto [min, max): un vértice sobre la línea cuenta una sola vez.
      const lo = a.y < b.y ? a : b;
      const hi = a.y < b.y ? b : a;
      if (y >= lo.y && y < hi.y) xs.push(lo.x + ((y - lo.y) * (hi.x - lo.x)) / (hi.y - lo.y));
    }
    xs.sort((p, q) => p - q);
    const segmentos: Polilinea[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 1e-6) continue;
      segmentos.push([
        { x: xs[i], y },
        { x: xs[i + 1], y },
      ]);
    }
    if (fila % 2 === 1) {
      segmentos.reverse();
      for (const s of segmentos) s.reverse();
    }
    r.push(...segmentos);
  }
  return r;
}
