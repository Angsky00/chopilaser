// Guardado de perfiles de máquina en localStorage. Se guarda el texto tal como se
// escribió; al cargar se vuelve a validar, así un valor dañado nunca llega al generador.
import { validarPerfil, type Perfil, type PerfilCrudo } from './gcode';

export const CLAVE_PERFILES = 'chopilaser.perfiles.v1';

export interface Almacen {
  activo: number;
  perfiles: PerfilCrudo[];
}

const CAMPOS = ['nombre', 'sMax', 'laserMode32', 'camaAncho', 'camaAlto', 'origen', 'xMin', 'yMin', 'xMax', 'yMax'] as const;

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

export function escribirAlmacen(s: Pick<Storage, 'setItem'>, a: Almacen): void {
  s.setItem(CLAVE_PERFILES, JSON.stringify(a));
}

/** Perfil activo validado, o null si no hay ninguno válido (entonces se muestra la configuración). */
export function perfilActivo(a: Almacen): Perfil | null {
  const crudo = a.perfiles[a.activo];
  if (!crudo) return null;
  const r = validarPerfil(crudo);
  return r.ok ? r.perfil : null;
}
