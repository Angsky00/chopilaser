// Utilidades compartidas por Vitest y Playwright.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_GOLDEN = join(RAIZ, 'tests', 'golden');

export interface MaquinaPrueba {
  sMax: number;
  laserMode32: 0 | 1 | null;
  camaAncho: number;
  camaAlto: number;
}
export interface CasoGolden {
  archivo: string;
  maquinaPrueba: MaquinaPrueba;
}

/** Configuraciones de PRUEBA (no son los valores reales de la máquina de Angel). */
export function casosGolden(): CasoGolden[] {
  return JSON.parse(readFileSync(join(DIR_GOLDEN, 'configs.json'), 'utf8')).goldens;
}

export function sha256(datos: Uint8Array | string): string {
  return createHash('sha256').update(datos).digest('hex');
}

const PYTHON = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

/** Corre el validador de QA SIN --laser-mode: un G0 con láser encendido es error. */
export function lint(archivos: string | string[], m: MaquinaPrueba): { codigo: number; salida: string } {
  const r = spawnSync(
    PYTHON,
    [join(RAIZ, 'tools', 'gcode_lint.py'), '--max-s', String(m.sMax), '--bed', `${m.camaAncho},${m.camaAlto}`, ...[archivos].flat()],
    { encoding: 'utf8' },
  );
  if (r.error) throw r.error;
  return { codigo: r.status ?? -1, salida: `${r.stdout}${r.stderr}` };
}
