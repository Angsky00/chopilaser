// Modelo del proyecto: figuras en el lienzo, capas por color y paso a un Trabajo para el
// generador seguro. Módulo puro: sin DOM.
import type { Capa, Polilinea, Trabajo } from '../gcode/types';
import { aMilesimas } from '../gcode/formato';
import {
  aplicar,
  areaPoligono,
  cajaDePuntos,
  cajaDeTrazos,
  multiplicar,
  rotacion,
  escala,
  traslacion,
  unirCajas,
  type Caja,
  type Matriz,
  type Trazo,
} from './geometria';
import { trama } from './trama';
import type { Punto } from '../gcode/types';
import type { ResultadoImportacion } from '../importar/tipos';

export interface Figura {
  id: string;
  /** Color del trazo original; define la capa. */
  color: string;
  /** Trazos en coordenadas locales (mm), centrados en el centro de su caja. */
  trazos: Trazo[];
  /** Tamaño de la caja local sin escalar (mm). */
  ancho0: number;
  alto0: number;
  /** Centro en el diseño (mm). */
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** Ángulo en grados, antihorario. */
  angulo: number;
}

export type ModoCapa = 'corte' | 'grabado';

export interface CapaProyecto {
  color: string;
  modo: ModoCapa;
  /** Valores tal como se escriben en el formulario (texto). */
  potencia: string;
  velocidad: string;
  pasadas: string;
  /** Solo grabado: separación entre líneas de relleno (mm). */
  intervalo: string;
  /** Se ve en el lienzo. */
  visible: boolean;
  /** Se incluye al exportar. */
  salida: boolean;
}

export interface Proyecto {
  material: string;
  figuras: Figura[];
  capas: CapaProyecto[];
}

let contador = 0;
export const nuevoId = (): string => `f${Date.now().toString(36)}${(++contador).toString(36)}`;

export function matrizFigura(f: Figura): Matriz {
  return multiplicar(traslacion(f.x, f.y), multiplicar(rotacion(f.angulo), escala(f.sx, f.sy)));
}

export function trazosMundo(f: Figura): Trazo[] {
  const m = matrizFigura(f);
  return f.trazos.map((t) => ({ cerrado: t.cerrado, puntos: t.puntos.map((p) => aplicar(m, p)) }));
}

export function cajaFigura(f: Figura): Caja | null {
  return cajaDeTrazos(trazosMundo(f));
}

export function cajaFiguras(fs: readonly Figura[]): Caja | null {
  return fs.reduce<Caja | null>((c, f) => unirCajas(c, cajaFigura(f)), null);
}

/** Crea una figura a partir de trazos en coordenadas del diseño, sin moverla. */
export function figuraDesdeTrazos(color: string, trazos: Trazo[], id = nuevoId()): Figura {
  const c = cajaDeTrazos(trazos) ?? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  const cx = (c.xMin + c.xMax) / 2;
  const cy = (c.yMin + c.yMax) / 2;
  return {
    id,
    color,
    trazos: trazos.map((t) => ({ cerrado: t.cerrado, puntos: t.puntos.map((p) => ({ x: p.x - cx, y: p.y - cy })) })),
    ancho0: c.xMax - c.xMin,
    alto0: c.yMax - c.yMin,
    x: cx,
    y: cy,
    sx: 1,
    sy: 1,
    angulo: 0,
  };
}

/**
 * Figuras de un archivo importado. Si caben en el área tal como vienen, se quedan en su
 * sitio; si no, el conjunto se lleva a la esquina (0,0) del área.
 */
export function figurasDesdeImportacion(r: ResultadoImportacion, area: { ancho: number; alto: number }): Figura[] {
  const caja = r.figuras.reduce<Caja | null>((c, f) => unirCajas(c, cajaDeTrazos(f.trazos)), null);
  if (!caja) return [];
  const cabe = caja.xMin >= 0 && caja.yMin >= 0 && caja.xMax <= area.ancho && caja.yMax <= area.alto;
  const dx = cabe ? 0 : -caja.xMin;
  const dy = cabe ? 0 : -caja.yMin;
  return r.figuras.map((f) =>
    figuraDesdeTrazos(
      f.color,
      f.trazos.map((t) => ({ cerrado: t.cerrado, puntos: t.puntos.map((p) => ({ x: p.x + dx, y: p.y + dy })) })),
    ),
  );
}

/** Capas para los colores presentes: conserva las existentes y crea las que faltan. */
export function sincronizarCapas(figuras: readonly Figura[], capas: readonly CapaProyecto[], nueva: (color: string) => CapaProyecto): CapaProyecto[] {
  const colores: string[] = [];
  for (const f of figuras) if (!colores.includes(f.color)) colores.push(f.color);
  const existentes = capas.filter((c) => colores.includes(c.color));
  for (const color of colores) if (!existentes.some((c) => c.color === color)) existentes.push(nueva(color));
  return existentes;
}

// ---------------------------------------------------------------------------
// Validación de capas y paso a Trabajo

export const LIMITES_CAPA = {
  velocidadMax: 100000,
  pasadasMax: 100,
  intervaloMin: 0.01,
  intervaloMax: 10,
} as const;

const NUM = /^\d+(\.\d+)?$/;
const ENTERO = /^\d+$/;

/** Textos de la interfaz. */
export const TEXTOS_CAPA = {
  potencia: 'Potencia: escribe un número de 1 a 100.',
  velocidad: `Velocidad: escribe un número mayor que 0 y hasta ${LIMITES_CAPA.velocidadMax}.`,
  pasadas: `Pasadas: escribe un entero de 1 a ${LIMITES_CAPA.pasadasMax}.`,
  intervalo: `Intervalo: escribe un número de ${LIMITES_CAPA.intervaloMin} a ${LIMITES_CAPA.intervaloMax} mm.`,
} as const;

export type CampoCapa = 'potencia' | 'velocidad' | 'pasadas' | 'intervalo';

export interface CapaValida {
  potencia: number;
  velocidad: number;
  pasadas: number;
  intervalo: number;
}

export function validarCapa(c: CapaProyecto): { ok: true; capa: CapaValida } | { ok: false; porCampo: Partial<Record<CampoCapa, string>> } {
  const porCampo: Partial<Record<CampoCapa, string>> = {};
  const t = (v: string) => v.trim();
  const potencia = NUM.test(t(c.potencia)) ? Number(t(c.potencia)) : NaN;
  if (!(potencia >= 1 && potencia <= 100)) porCampo.potencia = TEXTOS_CAPA.potencia;
  const velocidad = NUM.test(t(c.velocidad)) ? Number(t(c.velocidad)) : NaN;
  if (!(velocidad > 0 && velocidad <= LIMITES_CAPA.velocidadMax) || aMilesimas(velocidad) < 1) porCampo.velocidad = TEXTOS_CAPA.velocidad;
  const pasadas = ENTERO.test(t(c.pasadas)) ? Number(t(c.pasadas)) : NaN;
  if (!(pasadas >= 1 && pasadas <= LIMITES_CAPA.pasadasMax)) porCampo.pasadas = TEXTOS_CAPA.pasadas;
  let intervalo = 0;
  if (c.modo === 'grabado') {
    intervalo = NUM.test(t(c.intervalo)) ? Number(t(c.intervalo)) : NaN;
    if (!(intervalo >= LIMITES_CAPA.intervaloMin && intervalo <= LIMITES_CAPA.intervaloMax)) porCampo.intervalo = TEXTOS_CAPA.intervalo;
  }
  if (Object.keys(porCampo).length) return { ok: false, porCampo };
  return { ok: true, capa: { potencia, velocidad, pasadas, intervalo } };
}

/** true si el punto cae dentro del área una vez redondeado a milésimas, como hace el generador. */
function dentro(v: number, tamano: number): boolean {
  const k = aMilesimas(v);
  return k >= 0 && k <= Math.floor(tamano * 1000 + 1e-6);
}

export function figuraFuera(f: Figura, area: { ancho: number; alto: number }): boolean {
  return trazosMundo(f).some((t) => t.puntos.some((p) => !dentro(p.x, area.ancho) || !dentro(p.y, area.alto)));
}

/** Textos de la interfaz. */
export const TEXTOS_EXPORTAR = {
  sinFiguras: 'No hay nada que exportar: importa un diseño o activa la salida de alguna capa.',
  fuera: (n: number) =>
    n === 1
      ? 'Hay 1 figura fuera del área de trabajo. Muévela o achícala para poder exportar.'
      : `Hay ${n} figuras fuera del área de trabajo. Muévelas o achícalas para poder exportar.`,
  capaIncompleta: (n: number) => `Completa los ajustes de la capa ${n} para poder exportar.`,
  abiertosEnGrabado: (m: number, n: number) =>
    m === 1
      ? `El relleno no incluye 1 trazo abierto de la capa ${n}. Ciérralos o pásalos a una capa de corte.`
      : `El relleno no incluye ${m} trazos abiertos de la capa ${n}. Ciérralos o pásalos a una capa de corte.`,
} as const;

export type ResultadoTrabajo =
  | { ok: true; trabajo: Trabajo; avisos: string[] }
  | { ok: false; error: string; fuera: string[] };

/** Trayecto de corte con los ajustes de su capa, para ordenarlo con los de todas las capas. */
interface Corte {
  puntos: Punto[];
  cerrado: boolean;
  capa: Capa;
  /** Índice de la capa en el proyecto (para agrupar tramos seguidos de la misma capa). */
  indice: number;
  caja: Caja;
  area: number;
  orden: number;
}

function puntoDentro(p: Punto, poli: readonly Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i];
    const b = poli[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** true si el trayecto `t` está dentro del trayecto cerrado `c` (caja contenida y sus puntos dentro). */
function contenidoEn(t: Corte, c: Corte): boolean {
  if (t === c || !c.cerrado) return false;
  const a = t.caja;
  const b = c.caja;
  if (a.xMin < b.xMin || a.yMin < b.yMin || a.xMax > b.xMax || a.yMax > b.yMax) return false;
  if (a.xMin === b.xMin && a.yMin === b.yMin && a.xMax === b.xMax && a.yMax === b.yMax && t.area >= c.area) return false;
  // Basta con que la mayoría de los puntos (muestreados) caigan dentro: tolera puntos sobre el borde.
  const paso = Math.max(1, Math.floor(t.puntos.length / 16));
  let dentro = 0;
  let total = 0;
  for (let i = 0; i < t.puntos.length; i += paso) {
    total++;
    if (puntoDentro(t.puntos[i], c.puntos)) dentro++;
  }
  return dentro * 2 > total;
}

/**
 * Orden global de corte (todas las capas de corte juntas): un trayecto que está dentro de otro
 * cerrado se corta antes que él. Se ordena por profundidad de anidado (lo más hondo primero) y,
 * a igual profundidad, por área (lo más pequeño primero; los abiertos cuentan con área 0).
 */
export function ordenarCortes<T extends { puntos: Punto[]; cerrado: boolean }>(trayectos: readonly T[]): T[] {
  const cs = trayectos.map((t, orden) => {
    const caja = cajaDePuntos(t.puntos)!;
    return { t, c: { puntos: t.puntos, cerrado: t.cerrado, caja, area: t.cerrado ? Math.abs(areaPoligono(t.puntos)) : 0, orden } as Corte };
  });
  const prof = cs.map(({ c }) => cs.reduce((n, o) => (contenidoEn(c, o.c) ? n + 1 : n), 0));
  return cs
    .map((x, i) => ({ ...x, prof: prof[i] }))
    .sort((a, b) => b.prof - a.prof || a.c.area - b.c.area || a.c.orden - b.c.orden)
    .map((x) => x.t);
}

/**
 * Trabajo para el generador con las capas visibles y con salida activa. Primero las capas de
 * grabado y después todo el corte. El corte se ordena junto, aunque venga de figuras o capas
 * distintas: lo que está dentro de un contorno (agujeros, marcas) se corta antes que ese
 * contorno; cada trayecto conserva la potencia, velocidad y pasadas de su capa.
 */
export function trabajoDesdeProyecto(p: Proyecto, area: { ancho: number; alto: number }): ResultadoTrabajo {
  const activas = p.capas.map((c, i) => ({ c, i })).filter(({ c }) => c.visible && c.salida);
  const figurasDe = (color: string) => p.figuras.filter((f) => f.color === color);
  const conFiguras = activas.filter(({ c }) => figurasDe(c.color).length > 0);
  if (!conFiguras.length) return { ok: false, error: TEXTOS_EXPORTAR.sinFiguras, fuera: [] };
  const fuera = conFiguras.flatMap(({ c }) => figurasDe(c.color).filter((f) => figuraFuera(f, area)).map((f) => f.id));
  if (fuera.length) return { ok: false, error: TEXTOS_EXPORTAR.fuera(fuera.length), fuera };
  for (const { c, i } of conFiguras) if (!validarCapa(c).ok) return { ok: false, error: TEXTOS_EXPORTAR.capaIncompleta(i + 1), fuera: [] };
  const capaDe = (c: CapaProyecto): { capa: Capa; intervalo: number } => {
    const v = validarCapa(c);
    if (!v.ok) throw new Error('inalcanzable');
    return {
      capa: { potencia: v.capa.potencia, velocidad: v.capa.velocidad, pasadas: v.capa.pasadas, modo: c.modo === 'corte' ? 'M3' : 'M4' },
      intervalo: v.capa.intervalo,
    };
  };
  const avisos: string[] = [];
  const capas: Trabajo['capas'] = [];
  for (const { c, i } of conFiguras.filter(({ c }) => c.modo === 'grabado')) {
    const { capa, intervalo } = capaDe(c);
    const mundo = figurasDe(c.color).flatMap((f) => trazosMundo(f));
    const abiertos = mundo.filter((t) => !t.cerrado && t.puntos.length >= 2).length;
    if (abiertos) avisos.push(TEXTOS_EXPORTAR.abiertosEnGrabado(abiertos, i + 1));
    const cerrados = mundo.filter((t) => t.cerrado).map((t) => t.puntos.slice(0, -1));
    capas.push({ capa, trayectorias: trama(cerrados, intervalo).filter((t) => t.length >= 2) });
  }
  const cortes = conFiguras
    .filter(({ c }) => c.modo === 'corte')
    .flatMap(({ c, i }) => {
      const { capa } = capaDe(c);
      return figurasDe(c.color).flatMap((f) =>
        trazosMundo(f)
          .filter((t) => t.puntos.length >= 2)
          .map((t) => ({ puntos: t.puntos, cerrado: t.cerrado, capa, indice: i })),
      );
    });
  // Tramos seguidos de la misma capa van juntos (el generador repite las pasadas por tramo).
  for (const t of ordenarCortes(cortes)) {
    const ultima = capas[capas.length - 1] as (Trabajo['capas'][number] & { indice?: number }) | undefined;
    if (ultima && ultima.indice === t.indice && ultima.capa.modo === 'M3') ultima.trayectorias.push(t.puntos);
    else capas.push(Object.assign({ capa: t.capa, trayectorias: [t.puntos] as Polilinea[] }, { indice: t.indice }));
  }
  return { ok: true, trabajo: { capas: capas.map(({ capa, trayectorias }) => ({ capa, trayectorias })) }, avisos };
}
