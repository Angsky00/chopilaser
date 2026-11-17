// Guardado de perfiles de máquina en localStorage. Se guarda el texto tal como se
// escribió; al cargar se vuelve a validar, así un valor dañado nunca llega al generador.
import { mascara23, validarPerfil, type CampoPerfil, type Perfil, type PerfilCrudo } from './gcode';

export const CLAVE_PERFILES = 'chopilaser.perfiles.v1';
/** Copia de los datos dañados, para no perderlos al guardar encima. */
export const CLAVE_DANADOS = 'chopilaser.perfiles.v1.danado';

export interface Almacen {
  activo: number;
  perfiles: PerfilCrudo[];
}

export const CAMPOS = ['nombre', 'sMax', 'laserMode32', 'camaAncho', 'camaAlto', 'origen', 'xMin', 'yMin', 'xMax', 'yMax', 'homing23'] as const;

function limpiar(p: unknown): PerfilCrudo {
  const r: Record<string, string> = {};
  if (p && typeof p === 'object') {
    for (const c of CAMPOS) {
      const v = (p as Record<string, unknown>)[c];
      if (typeof v === 'string' || typeof v === 'number') r[c] = String(v);
    }
  }
  return r;
}

/**
 * true si hay algo guardado que no se puede leer como perfiles (JSON roto, estructura
 * inesperada o algún perfil que no es un objeto). La app lo avisa en vez de descartarlo en silencio.
 */
export function almacenDanado(s: Pick<Storage, 'getItem'>): boolean {
  const crudo = s.getItem(CLAVE_PERFILES);
  if (crudo === null) return false;
  try {
    const o = JSON.parse(crudo) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return true;
    const perfiles = (o as { perfiles?: unknown }).perfiles;
    return !Array.isArray(perfiles) || perfiles.some((p) => !p || typeof p !== 'object' || Array.isArray(p));
  } catch {
    return true;
  }
}

export function leerAlmacen(s: Pick<Storage, 'getItem'>): Almacen {
  try {
    const o = JSON.parse(s.getItem(CLAVE_PERFILES) ?? 'null') as unknown;
    if (o && typeof o === 'object' && Array.isArray((o as Almacen).perfiles)) {
      const perfiles = (o as Almacen).perfiles.map(limpiar);
      const a = Number((o as Almacen).activo);
      return { perfiles, activo: Number.isInteger(a) && a >= 0 && a < perfiles.length ? a : 0 };
    }
  } catch {
    /* JSON dañado: se trata como si no hubiera perfiles */
  }
  return { activo: 0, perfiles: [] };
}

export function escribirAlmacen(s: Pick<Storage, 'getItem' | 'setItem'>, a: Almacen): void {
  // Antes de pisar datos dañados se guarda una copia tal cual.
  if (almacenDanado(s)) s.setItem(CLAVE_DANADOS, s.getItem(CLAVE_PERFILES) ?? '');
  s.setItem(CLAVE_PERFILES, JSON.stringify(a));
}

/** Perfil activo validado, o null si no hay ninguno válido (entonces se muestra la configuración). */
export function perfilActivo(a: Almacen): Perfil | null {
  const crudo = a.perfiles[a.activo];
  if (!crudo) return null;
  const r = validarPerfil(crudo);
  return r.ok ? r.perfil : null;
}

// ---------------------------------------------------------------------------
// Archivo .json de perfiles (exportar / importar).

export const FORMATO_ARCHIVO = 'chopilaser-perfiles';
export const VERSION_ARCHIVO = 1;
export const MAX_PERFILES_ARCHIVO = 100;
export const MAX_BYTES_ARCHIVO = 1_000_000;

export interface ArchivoPerfiles {
  formato: typeof FORMATO_ARCHIVO;
  version: typeof VERSION_ARCHIVO;
  activo: number;
  perfiles: PerfilCrudo[];
}

/** JSON con los perfiles válidos guardados. El activo se conserva si es válido. */
export function exportarPerfiles(a: Almacen): string {
  const perfiles: PerfilCrudo[] = [];
  let activo = 0;
  a.perfiles.forEach((p, i) => {
    if (!validarPerfil(p).ok) return;
    if (i === a.activo) activo = perfiles.length;
    perfiles.push(limpiar(p));
  });
  const archivo: ArchivoPerfiles = { formato: FORMATO_ARCHIVO, version: VERSION_ARCHIVO, activo, perfiles };
  return JSON.stringify(archivo, null, 2) + '\n';
}

/** Etiqueta visible de cada dato, para los motivos de rechazo al importar. */
const NOMBRES_CAMPOS: Record<CampoPerfil | 'laserMode32' | 'homing23', string> = {
  nombre: 'Nombre de la máquina',
  sMax: 'Potencia máxima',
  laserMode32: 'Modo láser',
  homing23: 'Dirección del homing',
  camaAncho: 'Ancho (X)',
  camaAlto: 'Fondo (Y)',
  origen: 'Origen',
  xMin: 'xmin',
  yMin: 'ymin',
  xMax: 'xmax',
  yMax: 'ymax',
};

export type ResultadoImportar = { ok: true; archivo: ArchivoPerfiles } | { ok: false; error: string };

/** Textos de la interfaz. */
export const TEXTOS_IMPORTAR = {
  error: (motivo: string) => `No se importó nada: ${motivo}`,
  noJson: 'el archivo no es JSON válido.',
  grande: `el archivo pasa de ${MAX_BYTES_ARCHIVO / 1_000_000} MB.`,
  formato: 'no es un archivo de perfiles de ChopiLaser.',
  version: 'la versión del archivo no es compatible.',
  sinPerfiles: 'el archivo no trae perfiles.',
  muchos: `el archivo trae más de ${MAX_PERFILES_ARCHIVO} perfiles.`,
  activo: 'el perfil activo del archivo no existe.',
  noObjeto: (i: number) => `el perfil ${i} no tiene el formato esperado.`,
  desconocido: (i: number, c: string) => `el perfil ${i} tiene un dato desconocido («${c}»).`,
  noTexto: (i: number, c: string) => `el perfil ${i} tiene «${c}» con un valor que no es texto.`,
  invalido: (i: number, campo: string, msg: string) => `el perfil ${i} no es válido (${campo}: ${msg})`,
  homing: (i: number) => `el perfil ${i} tiene un $23 que no es válido.`,
  ok: (n: number) => (n === 1 ? 'Se importó 1 perfil.' : `Se importaron ${n} perfiles.`),
} as const;

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Valida estrictamente un archivo de perfiles. Si algo no vale, se rechaza entero. */
export function leerArchivoPerfiles(texto: string, nombresExistentes: readonly unknown[] = []): ResultadoImportar {
  const mal = (motivo: string): ResultadoImportar => ({ ok: false, error: TEXTOS_IMPORTAR.error(motivo) });
  // El límite es en bytes (UTF-8), no en caracteres.
  if (texto.length > MAX_BYTES_ARCHIVO || new TextEncoder().encode(texto).length > MAX_BYTES_ARCHIVO)
    return mal(TEXTOS_IMPORTAR.grande);
  let o: unknown;
  try {
    o = JSON.parse(texto.replace(/^\uFEFF/, ''));
  } catch {
    return mal(TEXTOS_IMPORTAR.noJson);
  }
  if (!esObjeto(o) || o.formato !== FORMATO_ARCHIVO) return mal(TEXTOS_IMPORTAR.formato);
  if (Object.keys(o).some((k) => !['formato', 'version', 'activo', 'perfiles'].includes(k))) return mal(TEXTOS_IMPORTAR.formato);
  if (o.version !== VERSION_ARCHIVO) return mal(TEXTOS_IMPORTAR.version);
  if (!Array.isArray(o.perfiles) || o.perfiles.length === 0) return mal(TEXTOS_IMPORTAR.sinPerfiles);
  if (o.perfiles.length > MAX_PERFILES_ARCHIVO) return mal(TEXTOS_IMPORTAR.muchos);
  const activo = o.activo === undefined ? 0 : o.activo;
  if (typeof activo !== 'number' || !Number.isInteger(activo) || activo < 0 || activo >= o.perfiles.length)
    return mal(TEXTOS_IMPORTAR.activo);
  const perfiles: PerfilCrudo[] = [];
  for (const [j, p] of (o.perfiles as unknown[]).entries()) {
    const i = j + 1;
    if (!esObjeto(p)) return mal(TEXTOS_IMPORTAR.noObjeto(i));
    for (const [k, v] of Object.entries(p)) {
      if (!(CAMPOS as readonly string[]).includes(k)) return mal(TEXTOS_IMPORTAR.desconocido(i, k));
      if (typeof v !== 'string') return mal(TEXTOS_IMPORTAR.noTexto(i, NOMBRES_CAMPOS[k as keyof typeof NOMBRES_CAMPOS] ?? k));
    }
    // Sin nombres repetidos, ni con los ya guardados ni dentro del archivo.
    const r = validarPerfil(p, [...nombresExistentes, ...perfiles.map((q) => q.nombre)]);
    if (!r.ok) {
      const [campo, msg] = Object.entries(r.porCampo)[0] ?? ['perfil', r.errores[0] ?? ''];
      return mal(TEXTOS_IMPORTAR.invalido(i, NOMBRES_CAMPOS[campo as keyof typeof NOMBRES_CAMPOS] ?? campo, msg ?? ''));
    }
    if (p.laserMode32 !== undefined && !['', '0', '1'].includes(p.laserMode32 as string))
      return mal(TEXTOS_IMPORTAR.invalido(i, NOMBRES_CAMPOS.laserMode32, 'Escribe 0 o 1.'));
    const h = p.homing23;
    if (typeof h === 'string' && h.trim() !== '' && mascara23(h) === null) return mal(TEXTOS_IMPORTAR.homing(i));
    perfiles.push(limpiar(p));
  }
  return { ok: true, archivo: { formato: FORMATO_ARCHIVO, version: VERSION_ARCHIVO, activo, perfiles } };
}

/**
 * Añade los perfiles importados a los guardados (no borra nada). Si no había perfiles
 * válidos guardados, el activo pasa a ser el del archivo.
 */
export function combinarImportados(a: Almacen, archivo: ArchivoPerfiles): Almacen {
  if (perfilActivo(a) === null) {
    const base = a.perfiles.length;
    return { perfiles: [...a.perfiles, ...archivo.perfiles], activo: base + archivo.activo };
  }
  return { perfiles: [...a.perfiles, ...archivo.perfiles], activo: a.activo };
}
