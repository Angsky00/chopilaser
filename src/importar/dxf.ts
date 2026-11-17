// Importador de DXF con dxf-parser (MIT). Entidades: LINE, LWPOLYLINE y POLYLINE (con
// bulge), ARC, CIRCLE, ELLIPSE, SPLINE (B-spline no racional; si solo trae puntos de
// ajuste, se unen con rectas) e INSERT de bloques. Unidades según $INSUNITS.
import DxfParser from 'dxf-parser';
import type { Punto } from '../gcode/types';
import {
  aplicar,
  escala,
  escalaMaxima,
  multiplicar,
  puntosArco,
  rotacion,
  traslacion,
  type Matriz,
  type Trazo,
} from '../diseno/geometria';
import { colorDeEntero } from './color';
import type { FiguraImportada, ResultadoImportacion } from './tipos';

/** mm por unidad según $INSUNITS. Sin unidades (0 o ausente) se supone mm. */
export const MM_POR_INSUNITS: Record<number, number> = {
  0: 1,
  1: 25.4,
  2: 304.8,
  4: 1,
  5: 10,
  6: 1000,
  8: 0.0000254,
  9: 0.0254,
  10: 914.4,
  14: 100,
};

/** Puntos del arco de una polilínea con bulge entre p y q (sin incluir p). */
export function arcoBulge(p: Punto, q: Punto, bulge: number, escalaMm = 1): Punto[] {
  if (!bulge || (p.x === q.x && p.y === q.y)) return [q];
  const theta = 4 * Math.atan(bulge); // ángulo barrido, positivo = antihorario
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const cuerda = Math.hypot(dx, dy);
  const r = cuerda / (2 * Math.abs(Math.sin(theta / 2)));
  // Centro: desde el punto medio, sobre la normal izquierda de la cuerda. tan(θ/2) da el
  // lado correcto también para arcos de más de 180°.
  const h = cuerda / 2 / Math.tan(theta / 2);
  const c = { x: (p.x + q.x) / 2 - (dy / cuerda) * h, y: (p.y + q.y) / 2 + (dx / cuerda) * h };
  const t0 = Math.atan2(p.y - c.y, p.x - c.x);
  const pts = puntosArco(c, r, r, 0, t0, theta, escalaMm);
  pts[pts.length - 1] = q;
  return pts;
}

/** Evalúa una B-spline no racional de grado k con nudos dados (algoritmo de De Boor). */
export function puntosSpline(control: Punto[], nudos: number[], grado: number, escalaMm = 1): Punto[] {
  const n = control.length;
  if (n < 2) return control.slice();
  const k = Math.max(1, Math.min(grado, n - 1));
  let U = nudos;
  if (U.length !== n + k + 1) {
    // Nudos uniformes cerrados en los extremos (clamped).
    U = [];
    for (let i = 0; i <= n + k; i++) U.push(i <= k ? 0 : i >= n ? n - k : i - k);
  }
  const u0 = U[k];
  const u1 = U[n];
  let largo = 0;
  for (let i = 1; i < n; i++) largo += Math.hypot(control[i].x - control[i - 1].x, control[i].y - control[i - 1].y);
  const muestras = Math.min(4000, Math.max(8 * (n - 1), Math.ceil((largo * escalaMm) / 0.2)));
  const r: Punto[] = [];
  for (let s = 0; s <= muestras; s++) {
    const u = s === muestras ? u1 : u0 + ((u1 - u0) * s) / muestras;
    let span = k;
    while (span < n - 1 && u >= U[span + 1]) span++;
    const d = control.slice(span - k, span + 1).map((p) => ({ x: p.x, y: p.y }));
    for (let rr = 1; rr <= k; rr++) {
      for (let j = k; j >= rr; j--) {
        const i = span - k + j;
        const den = U[i + k - rr + 1] - U[i];
        const a = den === 0 ? 0 : (u - U[i]) / den;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
      }
    }
    r.push(d[k]);
  }
  return r;
}

interface Entidad {
  type: string;
  layer?: string;
  color?: number;
  colorIndex?: number;
  [k: string]: unknown;
}

function cerrarSi(puntos: Punto[], cerrado: boolean): Trazo {
  if (cerrado && puntos.length > 1) {
    const a = puntos[0];
    const b = puntos[puntos.length - 1];
    if (a.x !== b.x || a.y !== b.y) puntos.push({ ...a });
  }
  return { puntos, cerrado };
}

export function importarDxf(texto: string): ResultadoImportacion {
  let dxf: ReturnType<DxfParser['parseSync']>;
  try {
    dxf = new DxfParser().parseSync(texto);
  } catch {
    throw new Error('El archivo no es un DXF válido.');
  }
  if (!dxf) throw new Error('El archivo no es un DXF válido.');
  const unidades = Number((dxf.header as Record<string, unknown> | undefined)?.['$INSUNITS'] ?? 0);
  const mmPorUnidad = MM_POR_INSUNITS[unidades] ?? 1;
  const capas = (dxf.tables as { layer?: { layers?: Record<string, { color?: number; visible?: boolean; frozen?: boolean }> } } | undefined)?.layer?.layers ?? {};
  const bloques = (dxf.blocks ?? {}) as unknown as Record<string, { entities?: Entidad[]; position?: Punto }>;
  const figuras: FiguraImportada[] = [];
  const omitidos = new Set<string>();

  const colorDe = (e: Entidad, colorBloque: string | null): string => {
    const capa = e.layer !== undefined ? capas[e.layer] : undefined;
    // 256 = BYLAYER, 0 = BYBLOCK.
    if (e.colorIndex === 0 && colorBloque) return colorBloque;
    if (e.color !== undefined && e.colorIndex !== 256 && e.colorIndex !== 0) return colorDeEntero(e.color);
    if (capa?.color !== undefined) return colorDeEntero(capa.color);
    return '#000000';
  };

  const visitar = (entidades: Entidad[], m: Matriz, colorBloque: string | null, profundidad: number) => {
    if (profundidad > 20) return;
    const esc = escalaMaxima(m);
    for (const e of entidades) {
      const capa = e.layer !== undefined ? capas[e.layer] : undefined;
      if (capa && (capa.visible === false || capa.frozen)) continue;
      const trazos: Trazo[] = [];
      const t = (pts: Punto[], cerrado: boolean) => trazos.push(cerrarSi(pts.map((p) => aplicar(m, p)), cerrado));
      switch (e.type) {
        case 'LINE': {
          const v = e.vertices as Punto[];
          if (v?.length >= 2) t([v[0], v[1]], false);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const v = (e.vertices as (Punto & { bulge?: number })[]) ?? [];
          if (v.length < 2) break;
          const cerrado = !!e.shape;
          const pts: Punto[] = [{ x: v[0].x, y: v[0].y }];
          const n = cerrado ? v.length : v.length - 1;
          for (let i = 0; i < n; i++) {
            const p = v[i];
            const q = v[(i + 1) % v.length];
            pts.push(...arcoBulge(p, { x: q.x, y: q.y }, p.bulge ?? 0, esc));
          }
          t(pts, cerrado);
          break;
        }
        case 'ARC': {
          const c = e.center as Punto;
          const r = e.radius as number;
          const a0 = e.startAngle as number;
          let a1 = e.endAngle as number;
          while (a1 <= a0) a1 += 2 * Math.PI;
          const pts = [{ x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) }, ...puntosArco(c, r, r, 0, a0, a1 - a0, esc)];
          t(pts, false);
          break;
        }
        case 'CIRCLE': {
          const c = e.center as Punto;
          const r = e.radius as number;
          t([{ x: c.x + r, y: c.y }, ...puntosArco(c, r, r, 0, 0, 2 * Math.PI, esc)], true);
          break;
        }
        case 'ELLIPSE': {
          const c = e.center as Punto;
          const mayor = e.majorAxisEndPoint as Punto;
          const rx = Math.hypot(mayor.x, mayor.y);
          const ry = rx * (e.axisRatio as number);
          const phi = Math.atan2(mayor.y, mayor.x);
          const t0 = (e.startAngle as number) ?? 0;
          let t1 = (e.endAngle as number) ?? 2 * Math.PI;
          while (t1 <= t0) t1 += 2 * Math.PI;
          const completo = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9;
          const p0 = { x: c.x + rx * Math.cos(t0) * Math.cos(phi) - ry * Math.sin(t0) * Math.sin(phi), y: c.y + rx * Math.cos(t0) * Math.sin(phi) + ry * Math.sin(t0) * Math.cos(phi) };
          t([p0, ...puntosArco(c, rx, ry, phi, t0, t1 - t0, esc)], completo);
          break;
        }
        case 'SPLINE': {
          const control = (e.controlPoints as Punto[] | undefined) ?? [];
          const ajuste = (e.fitPoints as Punto[] | undefined) ?? [];
          const pts =
            control.length >= 2
              ? puntosSpline(control, (e.knotValues as number[]) ?? [], (e.degreeOfSplineCurve as number) ?? 3, esc)
              : ajuste.slice();
          if (pts.length >= 2) t(pts, !!e.closed);
          break;
        }
        case 'INSERT': {
          const b = bloques[e.name as string];
          if (!b?.entities) break;
          const pos = (e.position as Punto) ?? { x: 0, y: 0 };
          const base = b.position ?? { x: 0, y: 0 };
          const mi = multiplicar(
            m,
            multiplicar(
              traslacion(pos.x, pos.y),
              multiplicar(rotacion((e.rotation as number) ?? 0), multiplicar(escala((e.xScale as number) ?? 1, (e.yScale as number) ?? 1), traslacion(-base.x, -base.y))),
            ),
          );
          visitar(b.entities, mi, colorDe(e, colorBloque), profundidad + 1);
          continue;
        }
        default:
          omitidos.add(e.type);
      }
      const validos = trazos.filter((x) => x.puntos.length >= 2 && x.puntos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
      if (validos.length) figuras.push({ color: colorDe(e, colorBloque), trazos: validos });
    }
  };
  visitar((dxf.entities ?? []) as unknown as Entidad[], escala(mmPorUnidad), null, 0);
  return { figuras, avisos: [...omitidos].sort() };
}
