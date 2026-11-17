import { describe, expect, it } from 'vitest';
import { arcoBulge, importarDxf, puntosSpline } from '../../src/importar/dxf';
import { cajaDeTrazos, TOLERANCIA_MM } from '../../src/diseno/geometria';

/** DXF mínimo: pares código/valor. */
function dxf(entidades: (string | number)[][], insunits = 4, extra: (string | number)[] = []): string {
  const pares: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, insunits, 0, 'ENDSEC', ...extra, 0, 'SECTION', 2, 'ENTITIES'];
  for (const e of entidades) pares.push(...e);
  pares.push(0, 'ENDSEC', 0, 'EOF');
  const lineas: string[] = [];
  for (let i = 0; i < pares.length; i += 2) lineas.push(String(pares[i]), String(pares[i + 1]));
  return lineas.join('\n') + '\n';
}
const cerca = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('DXF', () => {
  it('LINE con color por índice y unidades en mm', () => {
    const r = importarDxf(dxf([[0, 'LINE', 8, '0', 62, 1, 10, 0, 20, 0, 11, 10, 21, 5]]));
    expect(r.figuras).toHaveLength(1);
    expect(r.figuras[0].color).toBe('#ff0000');
    expect(r.figuras[0].trazos[0].puntos).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it('$INSUNITS en pulgadas y en cm', () => {
    const pulgadas = importarDxf(dxf([[0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 1, 21, 0]], 1));
    expect(pulgadas.figuras[0].trazos[0].puntos[1].x).toBeCloseTo(25.4, 9);
    const cm = importarDxf(dxf([[0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 1, 21, 0]], 5));
    expect(cm.figuras[0].trazos[0].puntos[1].x).toBe(10);
  });

  it('LWPOLYLINE cerrada con bulge = 1 (semicírculo)', () => {
    // Cuadrado de 10 con el lado de arriba sustituido por un semicírculo hacia fuera.
    const r = importarDxf(
      dxf([[0, 'LWPOLYLINE', 8, '0', 90, 4, 70, 1, 10, 0, 20, 0, 10, 10, 20, 0, 10, 10, 20, 10, 42, 1, 10, 0, 20, 10]]),
    );
    const t = r.figuras[0].trazos[0];
    expect(t.cerrado).toBe(true);
    expect(t.puntos[0]).toEqual(t.puntos[t.puntos.length - 1]);
    const c = cajaDeTrazos([t])!;
    expect(c.xMin).toBe(0);
    expect(c.xMax).toBe(10);
    cerca(c.yMax, 15, TOLERANCIA_MM);
  });

  it('bulge: signo, centro y arcos de más de 180°', () => {
    // bulge 1 de (0,0) a (10,0): semicírculo antihorario, pasa por (5,-5).
    const a = arcoBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    for (const p of a) cerca(Math.hypot(p.x - 5, p.y), 5);
    expect(Math.min(...a.map((p) => p.y))).toBeLessThan(-4.9);
    // bulge -1: por arriba.
    const b = arcoBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, -1);
    expect(Math.max(...b.map((p) => p.y))).toBeGreaterThan(4.9);
    // bulge tan(270°/4): 3/4 de círculo, radio = 10/(2·sin(135°)).
    const g = arcoBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, Math.tan((1.5 * Math.PI) / 4));
    const r = 10 / (2 * Math.sin((0.75 * Math.PI)));
    const cy = -5; // centro (5, -5): debajo de la cuerda
    for (const p of g) cerca(Math.hypot(p.x - 5, p.y - cy), r, 1e-9);
    expect(g[g.length - 1]).toEqual({ x: 10, y: 0 });
    expect(Math.min(...g.map((p) => p.y))).toBeLessThan(cy - r + 0.05);
  });

  it('ARC y CIRCLE', () => {
    const r = importarDxf(
      dxf([
        [0, 'ARC', 8, '0', 10, 10, 20, 10, 40, 5, 50, 0, 51, 90],
        [0, 'CIRCLE', 8, '0', 62, 5, 10, 50, 20, 50, 40, 10],
      ]),
    );
    const arco = r.figuras[0].trazos[0].puntos;
    cerca(arco[0].x, 15, 1e-9);
    cerca(arco[0].y, 10, 1e-9);
    cerca(arco[arco.length - 1].x, 10, 1e-9);
    cerca(arco[arco.length - 1].y, 15, 1e-9);
    for (const p of arco) cerca(Math.hypot(p.x - 10, p.y - 10), 5, 1e-9);
    const circ = r.figuras[1];
    expect(circ.color).toBe('#0000ff');
    expect(circ.trazos[0].cerrado).toBe(true);
    const c = cajaDeTrazos(circ.trazos)!;
    cerca(c.xMax - c.xMin, 20, 2 * TOLERANCIA_MM);
  });

  it('ARC que cruza 0° (de 270° a 90°)', () => {
    const r = importarDxf(dxf([[0, 'ARC', 8, '0', 10, 0, 20, 0, 40, 10, 50, 270, 51, 90]]));
    const c = cajaDeTrazos(r.figuras[0].trazos)!;
    cerca(c.xMax, 10, TOLERANCIA_MM);
    expect(c.xMin).toBeGreaterThan(-1e-9);
  });

  it('SPLINE: B-spline cúbica que pasa por sus extremos; y spline solo con puntos de ajuste', () => {
    const nudos = [0, 0, 0, 0, 1, 1, 1, 1];
    const pts = puntosSpline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
      ],
      nudos,
      3,
    );
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 });
    // Igual que la Bézier equivalente: en t=0,5 pasa por (5, 7.5).
    expect(pts.some((p) => Math.abs(p.x - 5) < 0.05 && Math.abs(p.y - 7.5) < 0.01)).toBe(true);
    const r = importarDxf(
      dxf([
        [0, 'SPLINE', 8, '0', 70, 8, 71, 3, 72, 8, 73, 4, 40, 0, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 40, 1,
          10, 0, 20, 0, 10, 0, 20, 10, 10, 10, 20, 10, 10, 10, 20, 0],
        [0, 'SPLINE', 8, '0', 70, 8, 71, 3, 74, 3, 11, 0, 21, 0, 11, 5, 21, 5, 11, 10, 21, 0],
      ]),
    );
    expect(r.figuras).toHaveLength(2);
    const c = cajaDeTrazos(r.figuras[0].trazos)!;
    cerca(c.yMax, 7.5, 0.01);
    expect(r.figuras[1].trazos[0].puntos).toHaveLength(3);
  });

  it('color por capa (BYLAYER) y entidades no soportadas como aviso', () => {
    const tablas = [0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 0, 'LAYER', 2, 'CORTE', 70, 0, 62, 3, 0, 'ENDTAB', 0, 'ENDSEC'];
    const r = importarDxf(
      dxf(
        [
          [0, 'LINE', 8, 'CORTE', 10, 0, 20, 0, 11, 1, 21, 1],
          [0, 'TEXT', 8, '0', 10, 0, 20, 0, 40, 1, 1, 'hola'],
        ],
        4,
        tablas,
      ),
    );
    expect(r.figuras[0].color).toBe('#00ff00');
    expect(r.avisos).toEqual(['TEXT']);
  });

  it('un archivo que no es DXF da error', () => {
    expect(() => importarDxf('hola')).toThrow();
  });
});
