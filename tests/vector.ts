// Utilidades de las pruebas de vectorizar: decodificar PNG/JPEG en Node y preparar potrace.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { RAIZ } from './util';

export const DIR_VECTOR_REF = join(RAIZ, 'tests', 'vector_ref');

/**
 * esm-potrace-wasm detecta Node y usa `require` y `__dirname`, que no existen en un módulo ES.
 * El wasm va dentro del .js, así que basta con darle esos dos nombres antes de cargarlo.
 */
export function prepararPotraceEnNode(): void {
  const g = globalThis as Record<string, unknown>;
  g.require ??= createRequire(import.meta.url);
  g.__dirname ??= RAIZ;
  g.__filename ??= join(RAIZ, 'potrace.js');
}

export interface ImagenRgba {
  data: Uint8Array;
  ancho: number;
  alto: number;
}

export function decodificar(ruta: string): ImagenRgba {
  const b = readFileSync(ruta);
  if (ruta.endsWith('.png')) {
    const p = PNG.sync.read(b);
    return { data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length), ancho: p.width, alto: p.height };
  }
  const j = jpeg.decode(b, { useTArray: true, formatAsRGBA: true });
  return { data: j.data, ancho: j.width, alto: j.height };
}

export function imagenRef(nombre: string): ImagenRgba {
  return decodificar(join(DIR_VECTOR_REF, nombre));
}

export const esperado = () => JSON.parse(readFileSync(join(DIR_VECTOR_REF, 'esperado.json'), 'utf8'));
