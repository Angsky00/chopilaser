// Materiales: nombre y ajustes por modo (corte y grabado), guardados en localStorage.
// No hay valores inventados: los ajustes empiezan vacíos y se llenan con lo que salga de la
// cuadrícula de prueba. Exportar/importar en .json con validación estricta (como los perfiles).
import { MAX_NOMBRE, normalizarNombre } from './gcode/config';
import { validarCapa, type ModoCapa } from './diseno/proyecto';

export const CLAVE_MATERIALES = 'chopilaser.materiales.v1';
export const CLAVE_MATERIALES_DANADOS = 'chopilaser.materiales.v1.danado';

export interface AjusteCorte {
  potencia: string;
  velocidad: string;
  pasadas: string;
}
export interface AjusteGrabado extends AjusteCorte {
  intervalo: string;
}
export interface Material {
  nombre: string;
  corte: AjusteCorte;
  grabado: AjusteGrabado;
}

export const ajusteVacio = (): AjusteGrabado => ({ potencia: '', velocidad: '', pasadas: '', intervalo: '' });
export const materialNuevo = (nombre: string): Material => {
  const { potencia, velocidad, pasadas } = ajusteVacio();
  return { nombre: nombre.trim(), corte: { potencia, velocidad, pasadas }, grabado: ajusteVacio() };
};

const CAMPOS_CORTE = ['potencia', 'velocidad', 'pasadas'] as const;
const CAMPOS_GRABADO = ['potencia', 'velocidad', 'pasadas', 'intervalo'] as const;
const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Textos provisionales (pendientes de Marketing). */
export const TEXTOS_MATERIAL = {
  nombreVacio: 'Escribe el nombre del material.',
  nombreLargo: `El nombre puede tener hasta ${MAX_NOMBRE} caracteres.`,
  nombreRepetido: 'Ya hay un material con ese nombre.',
} as const;

export function errorNombreMaterial(nombre: string, otros: readonly string[]): string | null {
  const n = nombre.trim();
  if (!n) return TEXTOS_MATERIAL.nombreVacio;
  if ([...n].length > MAX_NOMBRE) return TEXTOS_MATERIAL.nombreLargo;
  if (otros.some((o) => normalizarNombre(o) === normalizarNombre(n))) return TEXTOS_MATERIAL.nombreRepetido;
  return null;
}

/** Ajuste de un modo: vacío del todo (sin llenar) o completo y válido. Devuelve el error o null. */
export function errorAjuste(modo: ModoCapa, a: Partial<AjusteGrabado>): string | null {
  const campos = modo === 'corte' ? CAMPOS_CORTE : CAMPOS_GRABADO;
  const valores = campos.map((c) => (a[c] ?? '').trim());
  if (valores.every((v) => v === '')) return null;
  const v = validarCapa({
    color: '',
    modo,
    potencia: a.potencia ?? '',
    velocidad: a.velocidad ?? '',
    pasadas: a.pasadas ?? '',
    intervalo: a.intervalo ?? '',
    visible: true,
    salida: true,
  });
  return v.ok ? null : Object.values(v.porCampo)[0]!;
}

function limpiarMaterial(m: unknown): Material | null {
  if (!esObjeto(m) || typeof m.nombre !== 'string') return null;
  const corte = esObjeto(m.corte) ? m.corte : {};
  const grabado = esObjeto(m.grabado) ? m.grabado : {};
  const txt = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    nombre: m.nombre,
    corte: { potencia: txt(corte.potencia), velocidad: txt(corte.velocidad), pasadas: txt(corte.pasadas) },
    grabado: { potencia: txt(grabado.potencia), velocidad: txt(grabado.velocidad), pasadas: txt(grabado.pasadas), intervalo: txt(grabado.intervalo) },
  };
}

export function materialesDanados(s: Pick<Storage, 'getItem'>): boolean {
  const crudo = s.getItem(CLAVE_MATERIALES);
  if (crudo === null) return false;
  try {
    const o = JSON.parse(crudo) as unknown;
    return !esObjeto(o) || !Array.isArray(o.materiales) || o.materiales.some((m) => limpiarMaterial(m) === null);
  } catch {
    return true;
  }
}

export function leerMateriales(s: Pick<Storage, 'getItem'>): Material[] {
  try {
    const o = JSON.parse(s.getItem(CLAVE_MATERIALES) ?? 'null') as unknown;
    if (esObjeto(o) && Array.isArray(o.materiales)) return o.materiales.map(limpiarMaterial).filter((m): m is Material => m !== null);
  } catch {
    /* dañado: se avisa en la interfaz con materialesDanados() */
  }
  return [];
}

export function escribirMateriales(s: Pick<Storage, 'getItem' | 'setItem'>, materiales: Material[]): void {
  if (materialesDanados(s)) s.setItem(CLAVE_MATERIALES_DANADOS, s.getItem(CLAVE_MATERIALES) ?? '');
  s.setItem(CLAVE_MATERIALES, JSON.stringify({ materiales }));
}

// ---------------------------------------------------------------------------
// Archivo .json

export const FORMATO_MATERIALES = 'chopilaser-materiales';
export const VERSION_MATERIALES = 1;
export const MAX_MATERIALES_ARCHIVO = 200;
export const MAX_BYTES_MATERIALES = 1_000_000;

export function exportarMateriales(materiales: Material[]): string {
  return JSON.stringify({ formato: FORMATO_MATERIALES, version: VERSION_MATERIALES, materiales }, null, 2) + '\n';
}

/** Textos provisionales (pendientes de Marketing). */
export const TEXTOS_IMPORTAR_MATERIALES = {
  error: (motivo: string) => `No se importó nada: ${motivo}`,
  noJson: 'el archivo no es JSON válido.',
  grande: `el archivo pasa de ${MAX_BYTES_MATERIALES / 1_000_000} MB.`,
  formato: 'no es un archivo de materiales de ChopiLaser.',
  version: 'la versión del archivo no es compatible.',
  sinMateriales: 'el archivo no trae materiales.',
  muchos: `el archivo trae más de ${MAX_MATERIALES_ARCHIVO} materiales.`,
  noObjeto: (i: number) => `el material ${i} no tiene el formato esperado.`,
  desconocido: (i: number, c: string) => `el material ${i} tiene un dato desconocido («${c}»).`,
  noTexto: (i: number, c: string) => `el material ${i} tiene «${c}» con un valor que no es texto.`,
  invalido: (i: number, campo: string, msg: string) => `el material ${i} no es válido (${campo}: ${msg})`,
  ok: (n: number) => (n === 1 ? 'Se importó 1 material.' : `Se importaron ${n} materiales.`),
} as const;

const ETIQUETA_MODO: Record<ModoCapa, string> = { corte: 'Corte', grabado: 'Grabado' };

export type ResultadoImportarMateriales = { ok: true; materiales: Material[] } | { ok: false; error: string };

export function leerArchivoMateriales(texto: string, nombresExistentes: readonly string[] = []): ResultadoImportarMateriales {
  const T = TEXTOS_IMPORTAR_MATERIALES;
  const mal = (m: string): ResultadoImportarMateriales => ({ ok: false, error: T.error(m) });
  if (texto.length > MAX_BYTES_MATERIALES || new TextEncoder().encode(texto).length > MAX_BYTES_MATERIALES) return mal(T.grande);
  let o: unknown;
  try {
    o = JSON.parse(texto.replace(/^\uFEFF/, ''));
  } catch {
    return mal(T.noJson);
  }
  if (!esObjeto(o) || o.formato !== FORMATO_MATERIALES) return mal(T.formato);
  if (Object.keys(o).some((k) => !['formato', 'version', 'materiales'].includes(k))) return mal(T.formato);
  if (o.version !== VERSION_MATERIALES) return mal(T.version);
  if (!Array.isArray(o.materiales) || o.materiales.length === 0) return mal(T.sinMateriales);
  if (o.materiales.length > MAX_MATERIALES_ARCHIVO) return mal(T.muchos);
  const r: Material[] = [];
  for (const [j, m] of (o.materiales as unknown[]).entries()) {
    const i = j + 1;
    if (!esObjeto(m)) return mal(T.noObjeto(i));
    for (const k of Object.keys(m)) if (!['nombre', 'corte', 'grabado'].includes(k)) return mal(T.desconocido(i, k));
    if (typeof m.nombre !== 'string') return mal(T.noTexto(i, 'Nombre'));
    const en = errorNombreMaterial(m.nombre, [...nombresExistentes, ...r.map((x) => x.nombre)]);
    if (en) return mal(T.invalido(i, 'Nombre', en));
    for (const modo of ['corte', 'grabado'] as const) {
      const a = m[modo];
      if (!esObjeto(a)) return mal(T.noObjeto(i));
      const campos: readonly string[] = modo === 'corte' ? CAMPOS_CORTE : CAMPOS_GRABADO;
      for (const [k, v] of Object.entries(a)) {
        if (!campos.includes(k)) return mal(T.desconocido(i, `${modo}.${k}`));
        if (typeof v !== 'string') return mal(T.noTexto(i, `${ETIQUETA_MODO[modo]}: ${k}`));
      }
      const e = errorAjuste(modo, a as Partial<AjusteGrabado>);
      if (e) return mal(T.invalido(i, ETIQUETA_MODO[modo], e));
    }
    r.push(limpiarMaterial(m)!);
  }
  return { ok: true, materiales: r };
}
