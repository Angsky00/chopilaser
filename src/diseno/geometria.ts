// Geometría 2D del diseño. Módulo puro: sin DOM.
// Unidades: mm. Coordenadas del diseño con el origen (0,0) abajo a la izquierda del
// área de trabajo y el eje Y hacia arriba (las mismas que recibe el generador).
import type { Punto } from '../gcode/types';

/** Matriz afín [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (como en SVG). */
export type Matriz = readonly [number, number, number, number, number, number];

export const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0];

/** m · n (primero se aplica n, después m). */
export function multiplicar(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function aplicar(m: Matriz, p: Punto): Punto {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invertir(m: Matriz): Matriz {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) throw new Error('Matriz no invertible.');
  const [a, b, c, d, e, f] = m;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const traslacion = (x: number, y: number): Matriz => [1, 0, 0, 1, x, y];
export const escala = (sx: number, sy = sx): Matriz => [sx, 0, 0, sy, 0, 0];
/** Rotación en grados, en sentido antihorario con Y hacia arriba. */
export function rotacion(grados: number): Matriz {
  const r = (grados * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** Factor de escala máximo de una matriz (para decidir cuánto subdividir curvas). */
export function escalaMaxima(m: Matriz): number {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
}

/** Un trazo aplanado: lista de puntos; si es cerrado, el último punto repite el primero. */
export interface Trazo {
  puntos: Punto[];
  cerrado: boolean;
}

export interface Caja {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export function cajaDePuntos(puntos: Iterable<Punto>): Caja | null {
  let c: Caja | null = null;
  for (const p of puntos) {
    if (!c) c = { xMin: p.x, yMin: p.y, xMax: p.x, yMax: p.y };
    else {
      if (p.x < c.xMin) c.xMin = p.x;
      if (p.x > c.xMax) c.xMax = p.x;
      if (p.y < c.yMin) c.yMin = p.y;
      if (p.y > c.yMax) c.yMax = p.y;
    }
  }
  return c;
}

export function cajaDeTrazos(trazos: readonly Trazo[]): Caja | null {
  return cajaDePuntos(
    (function* () {
      for (const t of trazos) yield* t.puntos;
    })(),
  );
}

export function unirCajas(a: Caja | null, b: Caja | null): Caja | null {
  if (!a) return b;
  if (!b) return a;
  return { xMin: Math.min(a.xMin, b.xMin), yMin: Math.min(a.yMin, b.yMin), xMax: Math.max(a.xMax, b.xMax), yMax: Math.max(a.yMax, b.yMax) };
}

export function transformarTrazos(trazos: readonly Trazo[], m: Matriz): Trazo[] {
  return trazos.map((t) => ({ cerrado: t.cerrado, puntos: t.puntos.map((p) => aplicar(m, p)) }));
}

/** Área con signo de un polígono (positiva si es antihorario). */
export function areaPoligono(puntos: readonly Punto[]): number {
  let a = 0;
  for (let i = 0, n = puntos.length; i < n; i++) {
    const p = puntos[i];
    const q = puntos[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Tolerancia de aplanado de curvas, en mm (distancia máxima entre la curva y su polilínea). */
export const TOLERANCIA_MM = 0.02;

/** Número de segmentos para un arco de radio r (mm) y ángulo |barrido| (rad), con TOLERANCIA_MM. */
export function segmentosArco(radioMm: number, barrido: number): number {
  const r = Math.abs(radioMm);
  if (!(r > 0) || !Number.isFinite(r)) return 1;
  const paso = r <= TOLERANCIA_MM ? Math.PI / 2 : 2 * Math.acos(1 - TOLERANCIA_MM / r);
  return Math.min(2000, Math.max(4, Math.ceil(Math.abs(barrido) / paso)));
}

/**
 * Puntos de un arco de centro c, radios rx/ry, rotación phi (rad), desde el ángulo t0
 * barriendo dt (rad). Incluye el punto final, no el inicial. `escalaMm` pasa de unidades
 * locales a mm para decidir la subdivisión.
 */
export function puntosArco(
  c: Punto,
  rx: number,
  ry: number,
  phi: number,
  t0: number,
  dt: number,
  escalaMm = 1,
): Punto[] {
  const n = segmentosArco(Math.max(rx, ry) * escalaMm, dt);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const r: Punto[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t0 + (dt * i) / n;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    r.push({ x: c.x + cp * x - sp * y, y: c.y + sp * x + cp * y });
  }
  return r;
}

/** Segmentos para aplanar una curva de Bézier según el largo de su polígono de control (en mm). */
export function segmentosBezier(control: readonly Punto[], escalaMm = 1): number {
  let largo = 0;
  for (let i = 1; i < control.length; i++) largo += Math.hypot(control[i].x - control[i - 1].x, control[i].y - control[i - 1].y);
  largo *= escalaMm;
  // Con n segmentos el error es ~ largo² / (8 n²) para curvas suaves: n = largo / sqrt(8·tol).
  return Math.min(1000, Math.max(2, Math.ceil(largo / Math.sqrt(8 * TOLERANCIA_MM))));
}

export function bezierCubica(p0: Punto, p1: Punto, p2: Punto, p3: Punto, escalaMm = 1): Punto[] {
  const n = segmentosBezier([p0, p1, p2, p3], escalaMm);
  const r: Punto[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    r.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return r;
}

export function bezierCuadratica(p0: Punto, p1: Punto, p2: Punto, escalaMm = 1): Punto[] {
  const n = segmentosBezier([p0, p1, p2], escalaMm);
  const r: Punto[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    r.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y });
  }
  return r;
}
