// Normaliza colores de SVG/CSS a #rrggbb (minúsculas). Módulo puro.

const NOMBRES: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080',
  grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', navy: '#000080', purple: '#800080',
  teal: '#008080', orange: '#ffa500', brown: '#a52a2a', pink: '#ffc0cb', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b',
  gold: '#ffd700', violet: '#ee82ee', indigo: '#4b0082',
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** '#rrggbb', 'none' o null si no se entiende. */
export function normalizarColor(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const v = valor.trim().toLowerCase();
  if (v === '' || v === 'inherit' || v === 'currentcolor') return null;
  if (v === 'none' || v === 'transparent') return 'none';
  if (NOMBRES[v]) return NOMBRES[v];
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/.exec(v);
  if (m) {
    const c = [m[1], m[2], m[3]].map((x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x)));
    return `#${c.map(hex2).join('')}`;
  }
  return null;
}

/** Color de AutoCAD como entero 0xRRGGBB a '#rrggbb'. El blanco (índice 7) se trata como negro. */
export function colorDeEntero(n: number): string {
  const c = `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  return c === '#ffffff' ? '#000000' : c;
}
