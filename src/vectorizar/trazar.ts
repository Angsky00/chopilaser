// Vectorizar (fase 1b): potrace (esm-potrace-wasm, GPL-2.0) sobre el mapa de bits y paso de sus
// trayectos a trazos en mm. Módulo sin DOM: corre en el Worker y en las pruebas (Node).
import type { Punto } from '../gcode/types';
import { areaPoligono, escala, type Trazo } from '../diseno/geometria';
import { aplanarTrayecto } from '../importar/svg';
import type { ResultadoImportacion } from '../importar/tipos';
import { DPI_POR_DEFECTO, mapaDeBits, rgbaDeBits, type OpcionesMapa } from './imagen';

export interface OpcionesTrazado extends OpcionesMapa {
  /** Quitar manchas: potrace descarta las zonas de hasta este número de píxeles (turdsize). */
  manchas: number;
  /** Suavizado de esquinas de potrace (alphamax): 0 = esquinas vivas, 1,33 = muy redondeado. */
  suavizado: number;
}

export const OPCIONES_POR_DEFECTO: OpcionesTrazado = { umbral: 128, invertir: false, desenfoque: 0, manchas: 5, suavizado: 1 };

export const LIMITES_TRAZADO = {
  umbral: [0, 255],
  desenfoque: [0, 10],
  manchas: [0, 1000],
  suavizado: [0, 1.33],
} as const;

/** Un grupo de potrace: un contorno exterior con sus huecos (como lo agrupa potrace). */
export interface GrupoTrazado {
  trazos: Trazo[];
}

export interface ResultadoTrazado {
  grupos: GrupoTrazado[];
  /** Trayectos tal como los da potrace (unidades de 0,1 px, Y hacia arriba). */
  trayectos: string[];
  exteriores: number;
  huecos: number;
  /** Área de tinta del resultado, en px² (exteriores menos huecos). */
  areaPx: number;
  /** Píxeles de tinta del mapa de bits. */
  pixelesTinta: number;
  /** mm por px usados. */
  mmPorPx: number;
}

type FnPotrace = (img: { data: Uint8ClampedArray; width: number; height: number }, o: Record<string, unknown>) => Promise<string[]>;
let cargado: Promise<FnPotrace> | null = null;

/** Carga potrace una sola vez (import dinámico: el wasm va dentro del módulo). */
export function cargarPotrace(): Promise<FnPotrace> {
  cargado ??= import('esm-potrace-wasm').then(async (m) => {
    await m.init();
    return m.potrace as unknown as FnPotrace;
  });
  return cargado;
}

/** Distancia mínima entre puntos seguidos de un trazo (mm): por debajo se funden. */
export const SEGMENTO_MINIMO_MM = 0.001;

function limpiar(puntos: readonly Punto[], cerrado: boolean): Punto[] {
  const r: Punto[] = [];
  for (const p of puntos) {
    const q = r[r.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) >= SEGMENTO_MINIMO_MM) r.push(p);
  }
  if (cerrado && r.length > 1) {
    // Cierra exactamente sobre el primer punto.
    const a = r[0];
    const z = r[r.length - 1];
    if (Math.hypot(a.x - z.x, a.y - z.y) < SEGMENTO_MINIMO_MM) r.pop();
    r.push({ ...a });
  }
  return r;
}

function dentroDe(p: Punto, poli: readonly Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i];
    const b = poli[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/**
 * Traza una imagen RGBA. El resultado está en mm con el origen abajo a la izquierda de la
 * imagen (Y hacia arriba, como el diseño). Tamaño: según el DPI de la imagen o 96 ppp.
 */
export async function trazarImagen(
  rgba: Uint8Array | Uint8ClampedArray,
  ancho: number,
  alto: number,
  o: OpcionesTrazado,
  dpi: number | null,
): Promise<ResultadoTrazado> {
  const bits = mapaDeBits(rgba, ancho, alto, o);
  let pixelesTinta = 0;
  for (const b of bits) pixelesTinta += b;
  const mmPorPx = 25.4 / (dpi && dpi > 0 ? dpi : DPI_POR_DEFECTO);
  if (!pixelesTinta) return { grupos: [], trayectos: [], exteriores: 0, huecos: 0, areaPx: 0, pixelesTinta, mmPorPx };
  const potrace = await cargarPotrace();
  const trayectos = await potrace(
    { data: rgbaDeBits(bits), width: ancho, height: alto },
    {
      turdsize: Math.max(0, Math.round(o.manchas)),
      turnpolicy: 4,
      alphamax: Math.max(0, Math.min(1.3334, o.suavizado)),
      opticurve: 1,
      opttolerance: 0.2,
      pathonly: true,
      extractcolors: false,
      posterizelevel: 2,
      posterizationalgorithm: 0,
    },
  );
  // potrace da coordenadas en décimas de px con Y hacia arriba desde el borde inferior.
  const k = mmPorPx / 10;
  const grupos: GrupoTrazado[] = [];
  const todos: Punto[][] = [];
  for (const d of trayectos) {
    const trazos = aplanarTrayecto(d.trim(), escala(k, k))
      .map((t) => ({ cerrado: true, puntos: limpiar(t.puntos, true) }))
      .filter((t) => t.puntos.length >= 4);
    if (!trazos.length) continue;
    grupos.push({ trazos });
    todos.push(...trazos.map((t) => t.puntos));
  }
  // Exterior u hueco según cuántos contornos lo rodean (par = exterior).
  let exteriores = 0;
  let huecos = 0;
  let area = 0;
  for (const [i, c] of todos.entries()) {
    const nivel = todos.reduce((n, otro, j) => (j !== i && dentroDe(c[0], otro) ? n + 1 : n), 0);
    const a = Math.abs(areaPoligono(c));
    if (nivel % 2 === 0) {
      exteriores++;
      area += a;
    } else {
      huecos++;
      area -= a;
    }
  }
  return { grupos, trayectos, exteriores, huecos, areaPx: area / (mmPorPx * mmPorPx), pixelesTinta, mmPorPx };
}

/**
 * SVG del resultado tal como sale de potrace (para la vista previa y para comprobar que el
 * trazado es determinista). Mismo tamaño en px que la imagen.
 */
export function svgTrazado(r: Pick<ResultadoTrazado, 'trayectos'>, ancho: number, alto: number): string {
  const d = r.trayectos.map((t) => t.trim()).join(' ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">` +
    `<path transform="translate(0 ${alto}) scale(0.1 -0.1)" fill="#000" fill-rule="evenodd" d="${d}"/></svg>\n`
  );
}

/** Color (y por tanto capa) de lo vectorizado: todo va a una sola capa. */
export const COLOR_TRAZADO = '#000000';

/** Resultado listo para el lienzo: una figura por grupo de potrace (contorno con sus huecos). */
export function importacionDeTrazado(r: Pick<ResultadoTrazado, 'grupos'>, color = COLOR_TRAZADO): ResultadoImportacion {
  return { figuras: r.grupos.map((g) => ({ color, trazos: g.trazos })), avisos: [] };
}
