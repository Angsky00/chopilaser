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
  { valor: 'inferior-izquierda', texto: 'Abajo a la izquierda' },
  { valor: 'inferior-derecha', texto: 'Abajo a la derecha' },
  { valor: 'superior-izquierda', texto: 'Arriba a la izquierda' },
  { valor: 'superior-derecha', texto: 'Arriba a la derecha' },
  // Opción avanzada: área con xmin, ymin, xmax, ymax.
  { valor: 'personalizada', texto: 'Avanzado: área por coordenadas (mm)' },
];

/** Tope de S máximo ($30). Por encima se considera un error de tecleo. */
export const MAX_S = 100000;
/** Tope de cada dimensión del área de trabajo (ancho y fondo), en mm. */
export const MAX_DIMENSION_MM = 5000;
/** Largo máximo del nombre del perfil, en caracteres. */
export const MAX_NOMBRE = 60;

/** Textos de error de los campos (textos finales de Marketing). */
export const MENSAJES = {
  vacio: 'Este dato hace falta.',
  numeroInvalido: 'Escribe un número mayor que 0.',
  exportarSinPerfil: 'Antes de exportar, configura tu máquina.',
  // Provisional (pendiente de Marketing).
  perfilCambiado: 'El perfil cambió en otra pestaña. Vuelve a generar la cuadrícula.',
  // Solo para el modo avanzado del área.
  noEsNumero: 'Escribe un número.',
  xInvertido: 'El máximo de X debe ser mayor que el mínimo.',
  yInvertido: 'El máximo de Y debe ser mayor que el mínimo.',
  nombreRepetido: 'Ya hay un perfil con ese nombre.',
  // Provisional (pendiente de Marketing).
  nombreLargo: `El nombre puede tener hasta ${MAX_NOMBRE} caracteres.`,
} as const;

/** Tope de un campo positivo: $30, ancho y fondo (texto de Marketing, una sola redacción). */
export const mensajeTope = (max: number): string => `Escribe un número mayor que 0 y hasta ${max}.`;
export const mensajeRango = (min: number, max: number): string => `Escribe un número entre ${min} y ${max}.`;
export const mensajeAnchoMaximo = (max: number): string => `El área no puede medir más de ${max} mm de ancho.`;
export const mensajeFondoMaximo = (max: number): string => `El área no puede medir más de ${max} mm de fondo.`;

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
  /** $23 (máscara de dirección del homing), solo como dato leído de $$. */
  homing23?: unknown;
}

export interface Perfil {
  nombre: string;
  config: ConfigMaquina;
  /** $23 tal como se leyó de $$, o null si no se leyó. No se usa para generar. */
  homing23: number | null;
}

export type CampoPerfil = 'nombre' | 'sMax' | 'camaAncho' | 'camaAlto' | 'origen' | 'xMin' | 'yMin' | 'xMax' | 'yMax';

export type ResultadoPerfil =
  | { ok: true; perfil: Perfil }
  | { ok: false; errores: string[]; porCampo: Partial<Record<CampoPerfil, string>> };

const NUMERO = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * Convierte a número finito (acepta negativos), o devuelve null. El separador decimal
 * es solo el punto: «1,000» se rechaza, no se adivina si la coma es de miles o decimal.
 */
export function numeroFinito(valor: unknown): number | null {
  let n: number;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'string') {
    const t = valor.trim();
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
  else if (c.sMax > MAX_S) e.push(mensajeTope(MAX_S));
  const a = c.area;
  if (!a || ![a.xMin, a.yMin, a.xMax, a.yMax].every((v) => typeof v === 'number' && Number.isFinite(v)))
    e.push('El área de trabajo no es válida.');
  else {
    if (a.xMax - a.xMin < 0.001) e.push('El área de trabajo debe tener un ancho mayor que 0 (xmax > xmin).');
    if (a.yMax - a.yMin < 0.001) e.push('El área de trabajo debe tener un alto mayor que 0 (ymax > ymin).');
    if (a.xMax - a.xMin > MAX_DIMENSION_MM) e.push(mensajeAnchoMaximo(MAX_DIMENSION_MM));
    if (a.yMax - a.yMin > MAX_DIMENSION_MM) e.push(mensajeFondoMaximo(MAX_DIMENSION_MM));
    if (![a.xMin, a.yMin, a.xMax, a.yMax].every((v) => Math.abs(v) <= MAX_DIMENSION_MM))
      e.push(mensajeRango(-MAX_DIMENSION_MM, MAX_DIMENSION_MM));
  }
  return e;
}

function vacio(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Forma de comparar nombres: sin espacios a los lados y sin distinguir mayúsculas. */
export function normalizarNombre(n: unknown): string {
  return typeof n === 'string' ? n.trim().toLocaleLowerCase('es') : '';
}

/** Valida un perfil. `otrosNombres`: nombres de los demás perfiles, para no repetirlos. */
export function validarPerfil(crudo: PerfilCrudo | null | undefined, otrosNombres: readonly unknown[] = []): ResultadoPerfil {
  const c = crudo ?? {};
  const porCampo: Partial<Record<CampoPerfil, string>> = {};
  const positivo = (campo: CampoPerfil, max: number): number | null => {
    const v = c[campo];
    if (vacio(v)) {
      porCampo[campo] = MENSAJES.vacio;
      return null;
    }
    if (typeof v === 'string' && v.includes(',')) {
      porCampo[campo] = MENSAJES.noEsNumero;
      return null;
    }
    const n = numeroPositivo(v);
    if (n === null) porCampo[campo] = MENSAJES.numeroInvalido;
    else if (n > max) {
      porCampo[campo] = mensajeTope(max);
      return null;
    }
    return n;
  };
  const finito = (campo: CampoPerfil): number | null => {
    const v = c[campo];
    if (vacio(v)) {
      porCampo[campo] = MENSAJES.vacio;
      return null;
    }
    const n = numeroFinito(v);
    if (n === null) porCampo[campo] = MENSAJES.noEsNumero;
    else if (Math.abs(n) > MAX_DIMENSION_MM) {
      porCampo[campo] = mensajeRango(-MAX_DIMENSION_MM, MAX_DIMENSION_MM);
      return null;
    }
    return n;
  };

  const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
  if (!nombre) porCampo.nombre = MENSAJES.vacio;
  else if ([...nombre].length > MAX_NOMBRE) porCampo.nombre = MENSAJES.nombreLargo;
  else if (otrosNombres.some((o) => normalizarNombre(o) === normalizarNombre(nombre))) porCampo.nombre = MENSAJES.nombreRepetido;
  let sMax = positivo('sMax', MAX_S);
  if (sMax !== null && Math.floor(sMax * 1000) < 1) {
    porCampo.sMax = MENSAJES.numeroInvalido;
    sMax = null;
  }
  const origen = ORIGENES.find((o) => o.valor === c.origen)?.valor;
  let area: AreaTrabajo | null = null;
  if (!origen) {
    porCampo.origen = MENSAJES.vacio;
    positivo('camaAncho', MAX_DIMENSION_MM);
    positivo('camaAlto', MAX_DIMENSION_MM);
  } else if (origen === 'personalizada') {
    const [xMin, yMin, xMax, yMax] = (['xMin', 'yMin', 'xMax', 'yMax'] as const).map(finito);
    if (xMin !== null && xMax !== null && xMax - xMin < 0.001) porCampo.xMax = MENSAJES.xInvertido;
    else if (xMin !== null && xMax !== null && xMax - xMin > MAX_DIMENSION_MM) porCampo.xMax = mensajeAnchoMaximo(MAX_DIMENSION_MM);
    if (yMin !== null && yMax !== null && yMax - yMin < 0.001) porCampo.yMax = MENSAJES.yInvertido;
    else if (yMin !== null && yMax !== null && yMax - yMin > MAX_DIMENSION_MM) porCampo.yMax = mensajeFondoMaximo(MAX_DIMENSION_MM);
    if (xMin !== null && yMin !== null && xMax !== null && yMax !== null) area = { xMin, yMin, xMax, yMax };
  } else {
    const ancho = positivo('camaAncho', MAX_DIMENSION_MM);
    const alto = positivo('camaAlto', MAX_DIMENSION_MM);
    if (ancho !== null && alto !== null) area = areaDesdeCama(ancho, alto, origen);
  }
  const errores = Object.entries(porCampo).map(([campo, m]) => `${campo}: ${m}`);
  if (errores.length === 0 && sMax !== null && area !== null) {
    const config: ConfigMaquina = { sMax, laserMode32: modoLaser(c.laserMode32), area };
    const extra = erroresConfigMaquina(config);
    if (extra.length === 0) return { ok: true, perfil: { nombre, config, homing23: mascara23(c.homing23) } };
    errores.push(...extra);
  }
  return { ok: false, errores, porCampo };
}

/** $23 válido (entero de 0 a 255) o null. */
export function mascara23(v: unknown): number | null {
  const t = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n <= 255 ? n : null;
}

/**
 * Valores de fábrica de GRBL 1.1: solo $30=1000 y $32=0. El área, el origen y el
 * nombre no se suponen: los escribe el usuario.
 */
export const PRESET_GRBL11: Required<Pick<PerfilCrudo, 'sMax' | 'laserMode32'>> = {
  sMax: '1000',
  laserMode32: '0',
};

export type CampoDolar = 'sMax' | 'laserMode32' | 'camaAncho' | 'camaAlto' | 'homing23';

/** Número estricto de $$: sin exponentes, sin signo +, sin varios puntos. */
const NUMERO_DOLAR = /^-?\d+(\.\d+)?$/;

/**
 * Lee la salida de `$$` de GRBL y devuelve los campos que encuentra:
 * $30 -> sMax, $32 -> laserMode32, $130 -> ancho, $131 -> alto, $23 -> homing23 (solo dato).
 * Un valor que no es un número estricto (p. ej. «1e3» o «4.0.0») se ignora, no se recorta.
 */
export function leerSalidaDolarDolar(texto: string): Partial<Record<CampoDolar, string>> {
  const r: Partial<Record<CampoDolar, string>> = {};
  const campos: Record<string, CampoDolar> = {
    '23': 'homing23',
    '30': 'sMax',
    '32': 'laserMode32',
    '130': 'camaAncho',
    '131': 'camaAlto',
  };
  for (const linea of texto.split(/\r?\n/)) {
    // «$30=1000», y también «$30=1000 (rpm max)» como en GRBL 0.9.
    const m = /^\s*\$(\d+)\s*=\s*(\S+)(?:\s+\(.*\))?\s*$/.exec(linea);
    if (!m || !campos[m[1]] || !NUMERO_DOLAR.test(m[2])) continue;
    const campo = campos[m[1]];
    if (campo === 'homing23' && mascara23(m[2]) === null) continue;
    if (campo === 'laserMode32' && m[2] !== '0' && m[2] !== '1') continue;
    r[campo] = String(Number(m[2]));
  }
  return r;
}
