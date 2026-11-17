// Perfiles de máquina y validación estricta. No hay valores por defecto: si $30
// o el área de trabajo faltan o no son válidos, no se puede guardar, generar ni exportar.
import type { AreaTrabajo, ConfigMaquina } from './types';

export type OrigenCama =
  | 'inferior-izquierda'
  | 'inferior-derecha'
  | 'superior-izquierda'
  | 'superior-derecha'
  | 'personalizada';

export const ORIGENES: { valor: OrigenCama; texto: string }[] = [
  { valor: 'inferior-izquierda', texto: 'Abajo a la izquierda (X e Y positivos)' },
  { valor: 'inferior-derecha', texto: 'Abajo a la derecha (X negativo, Y positivo)' },
  { valor: 'superior-izquierda', texto: 'Arriba a la izquierda (X positivo, Y negativo)' },
  { valor: 'superior-derecha', texto: 'Arriba a la derecha (X e Y negativos)' },
  { valor: 'personalizada', texto: 'Personalizada (xmin, ymin, xmax, ymax)' },
];

/** Perfil tal como viene del formulario o de localStorage (texto). */
export interface PerfilCrudo {
  nombre?: unknown;
  sMax?: unknown;
  laserMode32?: unknown;
  camaAncho?: unknown;
  camaAlto?: unknown;
  origen?: unknown;
  xMin?: unknown;
  yMin?: unknown;
  xMax?: unknown;
  yMax?: unknown;
}

export interface Perfil {
  nombre: string;
  config: ConfigMaquina;
}

export type ResultadoPerfil = { ok: true; perfil: Perfil } | { ok: false; errores: string[] };

const NUMERO = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/** Convierte a número finito (acepta negativos y coma decimal), o devuelve null. */
export function numeroFinito(valor: unknown): number | null {
  let n: number;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'string') {
    const t = valor.trim().replace(',', '.');
    if (!NUMERO.test(t)) return null;
    n = Number(t);
  } else return null;
  return Number.isFinite(n) ? n : null;
}

/** Número positivo y finito, o null. Rechaza vacío, 0, negativos, NaN y texto. */
export function numeroPositivo(valor: unknown): number | null {
  const n = numeroFinito(valor);
  return n !== null && n > 0 ? n : null;
}

function modoLaser(valor: unknown): 0 | 1 | null {
  if (valor === 0 || valor === '0') return 0;
  if (valor === 1 || valor === '1') return 1;
  return null;
}

/** Área de trabajo a partir del tamaño de la cama y la esquina donde queda el origen (0,0). */
export function areaDesdeCama(ancho: number, alto: number, origen: Exclude<OrigenCama, 'personalizada'>): AreaTrabajo {
  const derecha = origen.endsWith('derecha');
  const superior = origen.startsWith('superior');
  return {
    xMin: derecha ? -ancho : 0,
    xMax: derecha ? 0 : ancho,
    yMin: superior ? -alto : 0,
    yMax: superior ? 0 : alto,
  };
}

/** Errores de una configuración ya numérica (la usa también el generador). */
export function erroresConfigMaquina(c: ConfigMaquina | null | undefined): string[] {
  const e: string[] = [];
  if (!c) return ['Falta la configuración de la máquina.'];
  if (typeof c.sMax !== 'number' || !Number.isFinite(c.sMax) || c.sMax <= 0)
    e.push('S máximo ($30) es obligatorio y debe ser un número mayor que 0.');
  else if (Math.floor(c.sMax * 1000) < 1) e.push('S máximo ($30) es demasiado pequeño.');
  const a = c.area;
  if (!a || ![a.xMin, a.yMin, a.xMax, a.yMax].every((v) => typeof v === 'number' && Number.isFinite(v)))
    e.push('El área de trabajo no es válida.');
  else {
    if (a.xMax - a.xMin < 0.001) e.push('El área de trabajo debe tener un ancho mayor que 0 (xmax > xmin).');
    if (a.yMax - a.yMin < 0.001) e.push('El área de trabajo debe tener un alto mayor que 0 (ymax > ymin).');
  }
  return e;
}

export function validarPerfil(crudo: PerfilCrudo | null | undefined): ResultadoPerfil {
  const c = crudo ?? {};
  const errores: string[] = [];
  const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
  if (!nombre) errores.push('El nombre del perfil es obligatorio.');
  const sMax = numeroPositivo(c.sMax);
  if (sMax === null) errores.push('S máximo ($30) es obligatorio y debe ser un número mayor que 0.');
  const origen = ORIGENES.find((o) => o.valor === c.origen)?.valor;
  let area: AreaTrabajo | null = null;
  if (!origen) {
    errores.push('Elige la esquina del origen o un área personalizada.');
  } else if (origen === 'personalizada') {
    const [xMin, yMin, xMax, yMax] = [c.xMin, c.yMin, c.xMax, c.yMax].map(numeroFinito);
    if (xMin === null || yMin === null || xMax === null || yMax === null)
      errores.push('xmin, ymin, xmax e ymax son obligatorios y deben ser números.');
    else area = { xMin, yMin, xMax, yMax };
  } else {
    const ancho = numeroPositivo(c.camaAncho);
    const alto = numeroPositivo(c.camaAlto);
    if (ancho === null) errores.push('El ancho del área es obligatorio y debe ser un número mayor que 0.');
    if (alto === null) errores.push('El alto del área es obligatorio y debe ser un número mayor que 0.');
    if (ancho !== null && alto !== null) area = areaDesdeCama(ancho, alto, origen);
  }
  if (sMax !== null && area !== null) {
    const config: ConfigMaquina = { sMax, laserMode32: modoLaser(c.laserMode32), area };
    errores.push(...erroresConfigMaquina(config));
    if (errores.length === 0) return { ok: true, perfil: { nombre, config } };
  }
  return { ok: false, errores };
}

/** Valores de fábrica de GRBL 1.1 ($30=1000, $32=0, $130=$131=200). No son los de ninguna máquina concreta. */
export const PRESET_GRBL11: Required<Pick<PerfilCrudo, 'sMax' | 'laserMode32' | 'camaAncho' | 'camaAlto'>> = {
  sMax: '1000',
  laserMode32: '0',
  camaAncho: '200',
  camaAlto: '200',
};

/**
 * Lee la salida de `$$` de GRBL y devuelve los campos que encuentra:
 * $30 -> sMax, $32 -> laserMode32, $130 -> ancho, $131 -> alto.
 */
export function leerSalidaDolarDolar(texto: string): Partial<Record<'sMax' | 'laserMode32' | 'camaAncho' | 'camaAlto', string>> {
  const r: Partial<Record<'sMax' | 'laserMode32' | 'camaAncho' | 'camaAlto', string>> = {};
  const campos: Record<string, 'sMax' | 'laserMode32' | 'camaAncho' | 'camaAlto'> = {
    '30': 'sMax',
    '32': 'laserMode32',
    '130': 'camaAncho',
    '131': 'camaAlto',
  };
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*\$(\d+)\s*=\s*([-+]?\d+(?:\.\d+)?)/.exec(linea);
    if (m && campos[m[1]]) r[campos[m[1]]] = String(Number(m[2]));
  }
  return r;
}
