// Vectorizar (fase 1b): lectura de la cabecera de PNG/JPEG (tamaño y DPI) y paso de la imagen a
// un mapa de bits blanco y negro. Módulo puro: sin DOM, sirve igual en el Worker y en las pruebas.

/** Lado máximo de la imagen de entrada (px). */
export const MAX_LADO_PX = 4000;
/** Tamaño máximo del archivo de imagen (bytes). */
export const MAX_BYTES_IMAGEN = 30_000_000;
/** DPI cuando la imagen no trae resolución. */
export const DPI_POR_DEFECTO = 96;

export interface Cabecera {
  tipo: 'png' | 'jpeg';
  ancho: number;
  alto: number;
  /** Resolución declarada en el archivo (puntos por pulgada), o null si no trae. */
  dpi: number | null;
}

const PNG_FIRMA = [137, 80, 78, 71, 13, 10, 26, 10];

/** Lee tipo, tamaño y DPI de un PNG o JPEG sin decodificarlo. null si no lo reconoce. */
export function leerCabecera(b: Uint8Array): Cabecera | null {
  if (PNG_FIRMA.every((v, i) => b[i] === v)) return cabeceraPng(b);
  if (b[0] === 0xff && b[1] === 0xd8) return cabeceraJpeg(b);
  return null;
}

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

function cabeceraPng(b: Uint8Array): Cabecera | null {
  let i = 8;
  let ancho = 0;
  let alto = 0;
  let dpi: number | null = null;
  while (i + 8 <= b.length) {
    const largo = u32(b, i);
    const tipo = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const d = i + 8;
    if (d + largo > b.length) break;
    if (tipo === 'IHDR' && largo >= 8) {
      ancho = u32(b, d);
      alto = u32(b, d + 4);
    } else if (tipo === 'pHYs' && largo >= 9) {
      const px = u32(b, d);
      const py = u32(b, d + 4);
      // Unidad 1 = metro. Solo se usa si es la misma en X e Y.
      if (b[d + 8] === 1 && px > 0 && px === py) dpi = px * 0.0254;
    } else if (tipo === 'IDAT' || tipo === 'IEND') break;
    i = d + largo + 4;
  }
  return ancho > 0 && alto > 0 ? { tipo: 'png', ancho, alto, dpi } : null;
}

function cabeceraJpeg(b: Uint8Array): Cabecera | null {
  let i = 2;
  let dpi: number | null = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const largo = u16(b, i + 2);
    const d = i + 4;
    // APP0 JFIF: unidades 1 = ppp, 2 = puntos por cm; 0 = solo proporción (se ignora).
    if (m === 0xe0 && largo >= 14 && String.fromCharCode(...b.subarray(d, d + 5)) === 'JFIF\0') {
      const unidad = b[d + 7];
      const dx = u16(b, d + 8);
      const dy = u16(b, d + 10);
      if (dx > 0 && dx === dy && (unidad === 1 || unidad === 2)) dpi = unidad === 1 ? dx : dx * 2.54;
    }
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const alto = u16(b, d + 1);
      const ancho = u16(b, d + 3);
      return ancho > 0 && alto > 0 ? { tipo: 'jpeg', ancho, alto, dpi } : null;
    }
    if (m === 0xda) return null;
    // El largo cuenta sus propios 2 bytes: el siguiente marcador está en i + 2 + largo.
    i = i + 2 + largo;
  }
  return null;
}

export interface OpcionesMapa {
  /** 0–255: los píxeles con luminancia menor que el umbral son «tinta». */
  umbral: number;
  invertir: boolean;
  /** Radio del desenfoque en px (0 = sin desenfoque). */
  desenfoque: number;
}

/**
 * Pasa una imagen RGBA a un mapa de bits (1 = tinta). La transparencia se compone sobre
 * blanco: un píxel transparente es fondo, también con «invertir» (se invierte la imagen, no el
 * fondo transparente). Todo en enteros para que el resultado sea igual en cualquier navegador.
 */
export function mapaDeBits(rgba: Uint8Array | Uint8ClampedArray, ancho: number, alto: number, o: OpcionesMapa): Uint8Array {
  const n = ancho * alto;
  const lum = new Uint8Array(n);
  const opaco = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3];
    let y = Math.floor((299 * rgba[j] + 587 * rgba[j + 1] + 114 * rgba[j + 2] + 500) / 1000);
    if (o.invertir) y = 255 - y;
    lum[i] = Math.floor((y * a + 255 * (255 - a) + 127) / 255);
    opaco[i] = a;
  }
  const v = o.desenfoque > 0 ? desenfocar(lum, ancho, alto, Math.min(10, Math.round(o.desenfoque))) : lum;
  const bits = new Uint8Array(n);
  const umbral = Math.max(0, Math.min(256, Math.round(o.umbral)));
  for (let i = 0; i < n; i++) bits[i] = opaco[i] > 0 && v[i] < umbral ? 1 : 0;
  return bits;
}

/** Desenfoque de caja separable (horizontal y luego vertical), con los bordes repetidos. */
export function desenfocar(src: Uint8Array, ancho: number, alto: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const k = 2 * r + 1;
  const media = (s: number) => Math.floor((s + (k >> 1)) / k);
  for (let y = 0; y < alto; y++) {
    const f = y * ancho;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[f + Math.min(ancho - 1, Math.max(0, x))];
    for (let x = 0; x < ancho; x++) {
      tmp[f + x] = media(s);
      s += src[f + Math.min(ancho - 1, x + r + 1)] - src[f + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < ancho; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(alto - 1, Math.max(0, y)) * ancho + x];
    for (let y = 0; y < alto; y++) {
      out[y * ancho + x] = media(s);
      s += tmp[Math.min(alto - 1, y + r + 1) * ancho + x] - tmp[Math.max(0, y - r) * ancho + x];
    }
  }
  return out;
}

/** Mapa de bits a RGBA blanco y negro opaco, como lo espera potrace. */
export function rgbaDeBits(bits: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bits.length * 4);
  for (let i = 0, j = 0; i < bits.length; i++, j += 4) {
    const v = bits[i] ? 0 : 255;
    out[j] = out[j + 1] = out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}
