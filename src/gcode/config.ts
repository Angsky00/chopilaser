// Validación estricta de la configuración de la máquina. No hay valores por defecto:
// si $30 o la cama faltan o no son válidos, no se puede generar ni exportar.
import type { ConfigMaquina } from './types';

/** Valores tal como vienen del formulario o de localStorage. */
export interface ConfigMaquinaCruda {
  sMax?: unknown;
  laserMode32?: unknown;
  camaAncho?: unknown;
  camaAlto?: unknown;
}

export type ResultadoConfig =
  | { ok: true; config: ConfigMaquina }
  | { ok: false; errores: string[] };

const NUMERO = /^\+?(\d+(\.\d*)?|\.\d+)$/;

/** Convierte a número positivo y finito, o devuelve null. Rechaza vacío, 0, negativos, NaN y texto. */
export function numeroPositivo(valor: unknown): number | null {
  let n: number;
  if (typeof valor === 'number') {
    n = valor;
  } else if (typeof valor === 'string') {
    const t = valor.trim().replace(',', '.');
    if (!NUMERO.test(t)) return null;
    n = Number(t);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function modoLaser(valor: unknown): 0 | 1 | null {
  if (valor === 0 || valor === '0') return 0;
  if (valor === 1 || valor === '1') return 1;
  return null;
}

export function validarConfigMaquina(cruda: ConfigMaquinaCruda | null | undefined): ResultadoConfig {
  const c = cruda ?? {};
  const errores: string[] = [];
  const sMax = numeroPositivo(c.sMax);
  const camaAncho = numeroPositivo(c.camaAncho);
  const camaAlto = numeroPositivo(c.camaAlto);
  if (sMax === null) errores.push('S máximo ($30) es obligatorio y debe ser un número mayor que 0.');
  else if (Math.round(sMax * 1000) < 1) errores.push('S máximo ($30) es demasiado pequeño.');
  if (camaAncho === null) errores.push('El ancho de la cama es obligatorio y debe ser un número mayor que 0.');
  if (camaAlto === null) errores.push('El alto de la cama es obligatorio y debe ser un número mayor que 0.');
  if (errores.length > 0 || sMax === null || camaAncho === null || camaAlto === null) {
    return { ok: false, errores };
  }
  return { ok: true, config: { sMax, laserMode32: modoLaser(c.laserMode32), camaAncho, camaAlto } };
}
