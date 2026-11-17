import { describe, expect, it } from 'vitest';
import { figuraDesdeTrazos, cajaFigura, type Figura } from '../../src/diseno/proyecto';
import {
  aplicarValores,
  borrar,
  cajaSeleccion,
  escalarDesdeTirador,
  escalarGrupo,
  mover,
  normalizarAngulo,
  rotarAlrededor,
  TAMANO_MINIMO,
  valoresSeleccion,
} from '../../src/diseno/edicion';

/** Rectángulo cerrado de (x0, y0) a (x1, y1) en el diseño. */
function rect(id: string, x0: number, y0: number, x1: number, y1: number): Figura {
  return figuraDesdeTrazos('#ff0000', [{ cerrado: true, puntos: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }] }], id);
}
const cerca = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const ids = (...x: string[]) => new Set(x);

describe('edición de figuras', () => {
  const a = rect('a', 10, 70, 30, 90);
  const b = rect('b', 50, 70, 70, 90);

  it('figuraDesdeTrazos centra los trazos y guarda el centro y el tamaño', () => {
    expect([a.x, a.y, a.ancho0, a.alto0, a.sx, a.sy, a.angulo]).toEqual([20, 80, 20, 20, 1, 1, 0]);
    expect(a.trazos[0].puntos[0]).toEqual({ x: -10, y: -10 });
  });

  it('mover y borrar solo tocan la selección y no mutan la entrada', () => {
    const r = mover([a, b], ids('b'), 5, -3);
    expect(r[0]).toBe(a);
    expect([r[1].x, r[1].y]).toEqual([65, 77]);
    expect(b.x).toBe(60);
    expect(borrar([a, b], ids('a')).map((f) => f.id)).toEqual(['b']);
  });

  it('normalizarAngulo deja el ángulo en (-180, 180]', () => {
    expect(normalizarAngulo(190)).toBe(-170);
    expect(normalizarAngulo(-180)).toBe(180);
    expect(normalizarAngulo(360)).toBe(0);
    expect(normalizarAngulo(-725)).toBe(-5);
  });

  it('rotarAlrededor gira la posición y el ángulo de cada figura', () => {
    const [ga, gb] = rotarAlrededor([a, b], ids('a', 'b'), 90, { x: 40, y: 80 });
    cerca(ga.x, 40);
    cerca(ga.y, 60);
    cerca(gb.x, 40);
    cerca(gb.y, 100);
    expect([ga.angulo, gb.angulo]).toEqual([90, 90]);
  });

  it('escalarGrupo escala tamaño y distancias respecto al punto fijo', () => {
    const [ea, eb] = escalarGrupo([a, b], ids('a', 'b'), 2, { x: 10, y: 70 });
    const c = cajaSeleccion([ea, eb], ids('a', 'b'))!;
    [c.xMin, c.yMin, c.xMax, c.yMax].forEach((v, i) => cerca(v, [10, 70, 130, 110][i]));
  });

  it('escalarDesdeTirador: esquina libre deja fija la esquina opuesta', () => {
    const r = escalarDesdeTirador(a, 1, 1, { x: 50, y: 100 }, false);
    const c = cajaFigura(r)!;
    [c.xMin, c.yMin, c.xMax, c.yMax].forEach((v, i) => cerca(v, [10, 70, 50, 100][i]));
  });

  it('escalarDesdeTirador: proporcional usa el mayor factor', () => {
    const r = escalarDesdeTirador(a, 1, 1, { x: 50, y: 75 }, true);
    cerca(r.sx, 2);
    cerca(r.sy, 2);
  });

  it('escalarDesdeTirador: tirador de lado solo cambia ese eje', () => {
    const r = escalarDesdeTirador(a, 1, 0, { x: 40, y: 0 }, false);
    cerca(r.sx, 1.5);
    cerca(r.sy, 1);
    cerca(r.y, 80);
  });

  it('escalarDesdeTirador: funciona en el marco propio de una figura girada', () => {
    const g = { ...a, angulo: 90 };
    // Girada 90°: la esquina propia (1,1) está en (10, 90) y la opuesta, fija, en (30, 70).
    // Puntero en (0, 110): 40 mm a lo largo del eje X propio (+Y del diseño) y 30 mm del Y propio (-X).
    const r = escalarDesdeTirador(g, 1, 1, { x: 0, y: 110 }, false);
    cerca(r.sx, 2);
    cerca(r.sy, 1.5);
  });

  it('escalarDesdeTirador: nunca baja del tamaño mínimo ni da la vuelta a la figura', () => {
    const r = escalarDesdeTirador(a, 1, 1, { x: -100, y: -100 }, false);
    cerca(r.sx * a.ancho0, TAMANO_MINIMO);
    cerca(r.sy * a.alto0, TAMANO_MINIMO);
    expect(r.sx).toBeGreaterThan(0);
  });

  it('valoresSeleccion: una figura da su tamaño propio y ángulo; varias, la caja y sin ángulo', () => {
    const g = { ...a, angulo: 45 };
    const v1 = valoresSeleccion([g, b], ids('a'))!;
    cerca(v1.ancho, 20);
    expect(v1.angulo).toBe(45);
    expect(v1.varias).toBe(false);
    const v2 = valoresSeleccion([a, b], ids('a', 'b'))!;
    expect([v2.x, v2.y, v2.ancho, v2.alto, v2.varias]).toEqual([10, 70, 60, 20, true]);
    expect(valoresSeleccion([a, b], ids())).toBeNull();
  });

  it('aplicarValores: una figura toma posición (esquina inferior izquierda), tamaño y ángulo', () => {
    const [r] = aplicarValores([a], ids('a'), { x: 100, y: 150, ancho: 40, alto: 10, angulo: 0 });
    const c = cajaFigura(r)!;
    [c.xMin, c.yMin, c.xMax, c.yMax].forEach((v, i) => cerca(v, [100, 150, 140, 160][i]));
  });

  it('aplicarValores: varias figuras se escalan de forma uniforme', () => {
    const r = aplicarValores([a, b], ids('a', 'b'), { x: 0, y: 0, ancho: 120, alto: 20, angulo: 0 });
    const c = cajaSeleccion(r, ids('a', 'b'))!;
    [c.xMin, c.yMin, c.xMax, c.yMax].forEach((v, i) => cerca(v, [0, 0, 120, 40][i]));
  });
});
