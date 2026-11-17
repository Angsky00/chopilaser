// Utilidades de las pruebas de vectorizar: decodificar PNG/JPEG en Node y preparar potrace.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { RAIZ } from './util';
import { fijarBytesPotrace } from '../src/vectorizar/potrace';

export const DIR_VECTOR_REF = join(RAIZ, 'tests', 'vector_ref');

/** En Node, potrace.wasm se lee del disco (en la app lo carga el Worker con fetch). */
export function prepararPotraceEnNode(): void {
  fijarBytesPotrace(readFileSync(join(RAIZ, 'src', 'vectorizar', 'potrace.wasm')));
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
