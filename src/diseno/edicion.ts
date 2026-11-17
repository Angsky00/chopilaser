// Operaciones de edición sobre las figuras (puras: devuelven figuras nuevas).
import type { Punto } from '../gcode/types';
import { aplicar, rotacion, type Caja } from './geometria';
import { cajaFiguras, type Figura } from './proyecto';

/** Tamaño mínimo de una figura al escalar (mm). */
export const TAMANO_MINIMO = 0.1;

const sel = (figs: readonly Figura[], ids: ReadonlySet<string>) => figs.filter((f) => ids.has(f.id));

export function mover(figs: readonly Figura[], ids: ReadonlySet<string>, dx: number, dy: number): Figura[] {
  return figs.map((f) => (ids.has(f.id) ? { ...f, x: f.x + dx, y: f.y + dy } : f));
}

export function borrar(figs: readonly Figura[], ids: ReadonlySet<string>): Figura[] {
  return figs.filter((f) => !ids.has(f.id));
}

/** Gira las figuras seleccionadas `grados` alrededor de `centro`. */
export function rotarAlrededor(figs: readonly Figura[], ids: ReadonlySet<string>, grados: number, centro: Punto): Figura[] {
  const r = rotacion(grados);
  return figs.map((f) => {
    if (!ids.has(f.id)) return f;
    const p = aplicar(r, { x: f.x - centro.x, y: f.y - centro.y });
    return { ...f, x: centro.x + p.x, y: centro.y + p.y, angulo: normalizarAngulo(f.angulo + grados) };
  });
}

/** Escala uniforme de las figuras seleccionadas respecto a un punto fijo. */
export function escalarGrupo(figs: readonly Figura[], ids: ReadonlySet<string>, factor: number, fijo: Punto): Figura[] {
  return figs.map((f) =>
    ids.has(f.id) ? { ...f, x: fijo.x + (f.x - fijo.x) * factor, y: fijo.y + (f.y - fijo.y) * factor, sx: f.sx * factor, sy: f.sy * factor } : f,
  );
}

export function normalizarAngulo(a: number): number {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

/** Tamaño propio (sin girar) de una figura. */
export function tamanoFigura(f: Figura): { ancho: number; alto: number } {
  return { ancho: f.ancho0 * Math.abs(f.sx), alto: f.alto0 * Math.abs(f.sy) };
}

/**
 * Escala una figura desde un tirador. (ux, uy) ∈ {-1,0,1}² es la posición del tirador en la
 * caja propia de la figura; queda fijo el punto opuesto. `p` es el puntero en el diseño.
 */
export function escalarDesdeTirador(f: Figura, ux: number, uy: number, p: Punto, proporcional: boolean): Figura {
  const { ancho, alto } = tamanoFigura(f);
  const r = rotacion(f.angulo);
  const ri = rotacion(-f.angulo);
  const fijoLocal = { x: (-ux * ancho) / 2, y: (-uy * alto) / 2 };
  const fl = aplicar(r, fijoLocal);
  const fijo = { x: f.x + fl.x, y: f.y + fl.y };
  const v = aplicar(ri, { x: p.x - fijo.x, y: p.y - fijo.y });
  let nAncho = ux !== 0 ? Math.max(TAMANO_MINIMO, v.x * ux) : ancho;
  let nAlto = uy !== 0 ? Math.max(TAMANO_MINIMO, v.y * uy) : alto;
  if (f.ancho0 === 0) nAncho = 0;
  if (f.alto0 === 0) nAlto = 0;
  if (proporcional && ux !== 0 && uy !== 0 && ancho > 0 && alto > 0) {
    const k = Math.max(nAncho / ancho, nAlto / alto);
    nAncho = ancho * k;
    nAlto = alto * k;
  } else if (proporcional && (ux === 0 || uy === 0) && ancho > 0 && alto > 0) {
    const k = ux !== 0 ? nAncho / ancho : nAlto / alto;
    nAncho = ancho * k;
    nAlto = alto * k;
  }
  const c = aplicar(r, { x: (ux * nAncho) / 2, y: (uy * nAlto) / 2 });
  // Con ux = 0 el centro no se mueve en ese eje (el fijo está en el centro de ese lado).
  return {
    ...f,
    x: fijo.x + c.x,
    y: fijo.y + c.y,
    sx: f.ancho0 > 0 ? (Math.sign(f.sx) || 1) * (nAncho / f.ancho0) : f.sx,
    sy: f.alto0 > 0 ? (Math.sign(f.sy) || 1) * (nAlto / f.alto0) : f.sy,
  };
}

export interface ValoresCaja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
  angulo: number;
}

/**
 * Valores de los campos numéricos para la selección: X/Y es la esquina inferior izquierda
 * de la caja de la selección; ancho/alto es el tamaño propio (una figura) o el de la caja
 * (varias); el ángulo solo existe con una figura.
 */
export function valoresSeleccion(figs: readonly Figura[], ids: ReadonlySet<string>): (ValoresCaja & { varias: boolean }) | null {
  const s = sel(figs, ids);
  const caja = cajaFiguras(s);
  if (!caja) return null;
  if (s.length === 1) {
    const t = tamanoFigura(s[0]);
    return { x: caja.xMin, y: caja.yMin, ancho: t.ancho, alto: t.alto, angulo: s[0].angulo, varias: false };
  }
  return { x: caja.xMin, y: caja.yMin, ancho: caja.xMax - caja.xMin, alto: caja.yMax - caja.yMin, angulo: 0, varias: true };
}

/** Aplica los campos numéricos a la selección. */
export function aplicarValores(figs: readonly Figura[], ids: ReadonlySet<string>, v: ValoresCaja): Figura[] {
  const s = sel(figs, ids);
  if (!s.length) return figs.slice();
  let r = figs.slice();
  if (s.length === 1) {
    const f = s[0];
    const g: Figura = {
      ...f,
      angulo: normalizarAngulo(v.angulo),
      sx: f.ancho0 > 0 && v.ancho > 0 ? (Math.sign(f.sx) || 1) * (v.ancho / f.ancho0) : f.sx,
      sy: f.alto0 > 0 && v.alto > 0 ? (Math.sign(f.sy) || 1) * (v.alto / f.alto0) : f.sy,
    };
    r = r.map((x) => (x.id === f.id ? g : x));
  } else {
    const caja = cajaFiguras(s)!;
    const w = caja.xMax - caja.xMin;
    const h = caja.yMax - caja.yMin;
    // Varias figuras: se escalan de forma uniforme (no se deforman figuras giradas).
    const k = w > 0 && v.ancho !== w ? v.ancho / w : h > 0 && v.alto !== h ? v.alto / h : 1;
    if (k > 0 && k !== 1) r = escalarGrupo(r, ids, k, { x: caja.xMin, y: caja.yMin });
  }
  const caja = cajaFiguras(sel(r, ids))!;
  return mover(r, ids, v.x - caja.xMin, v.y - caja.yMin);
}

export function cajaSeleccion(figs: readonly Figura[], ids: ReadonlySet<string>): Caja | null {
  return cajaFiguras(sel(figs, ids));
}
