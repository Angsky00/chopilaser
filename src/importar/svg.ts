// Importador de SVG propio: DOMParser + aplanado de trayectos a polilíneas en mm.
// Soporta path (todos los comandos, también arcos), rect (con rx/ry), circle, ellipse,
// line, polyline, polygon, g y svg anidados, use simple, transform, viewBox y unidades.
import type { Punto } from '../gcode/types';
import {
  IDENTIDAD,
  aplicar,
  bezierCuadratica,
  bezierCubica,
  escalaMaxima,
  multiplicar,
  puntosArco,
  traslacion,
  type Matriz,
  type Trazo,
} from '../diseno/geometria';
import { normalizarColor } from './color';
import type { FiguraImportada, ResultadoImportacion } from './tipos';

/** mm por unidad CSS. Sin unidad = px (96 por pulgada, como los navegadores e Inkscape). */
const MM_POR_UNIDAD: Record<string, number> = {
  '': 25.4 / 96,
  px: 25.4 / 96,
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  q: 0.25,
};

/** Longitud CSS en mm, o null (p. ej. porcentajes o vacío). */
export function longitudMm(valor: string | null): number | null {
  if (!valor) return null;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z]*)\s*$/i.exec(valor);
  if (!m) return null;
  const u = m[2].toLowerCase();
  if (!(u in MM_POR_UNIDAD)) return null;
  const n = parseFloat(m[1]) * MM_POR_UNIDAD[u];
  return Number.isFinite(n) ? n : null;
}

function numeros(texto: string | null): number[] {
  if (!texto) return [];
  return (texto.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

/** Atributo transform de SVG a matriz. */
export function leerTransform(texto: string | null): Matriz {
  let m: Matriz = IDENTIDAD;
  if (!texto) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(texto))) {
    const a = numeros(r[2]);
    let t: Matriz = IDENTIDAD;
    switch (r[1]) {
      case 'matrix':
        if (a.length === 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        t = traslacion(a[0] ?? 0, a[1] ?? 0);
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const g = ((a[0] ?? 0) * Math.PI) / 180;
        const rot: Matriz = [Math.cos(g), Math.sin(g), -Math.sin(g), Math.cos(g), 0, 0];
        const cx = a[1] ?? 0;
        const cy = a[2] ?? 0;
        t = multiplicar(traslacion(cx, cy), multiplicar(rot, traslacion(-cx, -cy)));
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiplicar(m, t);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Trayectos (atributo d)

type Token = string | number;

function tokensTrayecto(d: string): Token[] {
  const r: Token[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) r.push(m[1] ?? Number(m[2]));
  return r;
}

/** Banderas de arco: pueden venir pegadas («a1 1 0 0110 10»). */
function separarBanderas(d: string): string {
  return d.replace(/([Aa])([^MmLlHhVvCcSsQqTtZzAa]*)/g, (_, c: string, resto: string) => {
    // Releer de forma secuencial: rx ry rot bandera bandera x y (repetible).
    const out: string[] = [];
    const re = /\s*,?\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
    const reBandera = /\s*,?\s*([01])/y;
    let pos = 0;
    let campo = 0;
    while (pos < resto.length) {
      const esBandera = campo % 7 === 3 || campo % 7 === 4;
      const rr = esBandera ? reBandera : re;
      rr.lastIndex = pos;
      const mm = rr.exec(resto);
      if (!mm) break;
      out.push(mm[1]);
      pos = rr.lastIndex;
      campo++;
    }
    return `${c} ${out.join(' ')} `;
  });
}

/**
 * Aplana un atributo d a subtrayectos en las unidades del SVG, aplicando la matriz m.
 * escalaMm: mm por unidad tras m, para decidir la subdivisión.
 */
export function aplanarTrayecto(d: string, m: Matriz = IDENTIDAD, mmPorUnidad = 1): Trazo[] {
  const t = tokensTrayecto(separarBanderas(d));
  const esc = escalaMaxima(m) * mmPorUnidad;
  const trazos: Trazo[] = [];
  let actual: Punto[] = [];
  let p: Punto = { x: 0, y: 0 };
  let inicio: Punto = { x: 0, y: 0 };
  let ctrlC: Punto | null = null;
  let ctrlQ: Punto | null = null;
  let cmd = '';
  let i = 0;
  const cerrarActual = (cerrado: boolean) => {
    if (actual.length >= 2) trazos.push({ puntos: actual.map((q) => aplicar(m, q)), cerrado });
    actual = [];
  };
  const num = (): number => {
    const v = t[i];
    if (typeof v !== 'number') throw new Error('Trayecto SVG mal formado.');
    i++;
    return v;
  };
  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++] as string;
    else if (cmd === '') throw new Error('Trayecto SVG mal formado.');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? p.x : 0;
    const oy = rel ? p.y : 0;
    let nuevoCtrlC: Punto | null = null;
    let nuevoCtrlQ: Punto | null = null;
    switch (C) {
      case 'M': {
        cerrarActual(false);
        p = { x: ox + num(), y: oy + num() };
        inicio = p;
        actual = [p];
        cmd = rel ? 'l' : 'L'; // pares siguientes = lineto
        break;
      }
      case 'L':
        p = { x: ox + num(), y: oy + num() };
        actual.push(p);
        break;
      case 'H':
        p = { x: ox + num(), y: p.y };
        actual.push(p);
        break;
      case 'V':
        p = { x: p.x, y: oy + num() };
        actual.push(p);
        break;
      case 'C': {
        const c1 = { x: ox + num(), y: oy + num() };
        const c2 = { x: ox + num(), y: oy + num() };
        const fin = { x: ox + num(), y: oy + num() };
        actual.push(...bezierCubica(p, c1, c2, fin, esc));
        nuevoCtrlC = c2;
        p = fin;
        break;
      }
      case 'S': {
        const c1 = ctrlC ? { x: 2 * p.x - ctrlC.x, y: 2 * p.y - ctrlC.y } : p;
        const c2 = { x: ox + num(), y: oy + num() };
        const fin = { x: ox + num(), y: oy + num() };
        actual.push(...bezierCubica(p, c1, c2, fin, esc));
        nuevoCtrlC = c2;
        p = fin;
        break;
      }
      case 'Q': {
        const c: Punto = { x: ox + num(), y: oy + num() };
        const fin: Punto = { x: ox + num(), y: oy + num() };
        actual.push(...bezierCuadratica(p, c, fin, esc));
        nuevoCtrlQ = c;
        p = fin;
        break;
      }
      case 'T': {
        const c: Punto = ctrlQ ? { x: 2 * p.x - ctrlQ.x, y: 2 * p.y - ctrlQ.y } : p;
        const fin = { x: ox + num(), y: oy + num() };
        actual.push(...bezierCuadratica(p, c, fin, esc));
        nuevoCtrlQ = c;
        p = fin;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const grande = num() !== 0;
        const barrido = num() !== 0;
        const fin = { x: ox + num(), y: oy + num() };
        actual.push(...arcoSvg(p, fin, rx, ry, rot, grande, barrido, esc));
        p = fin;
        break;
      }
      case 'Z': {
        if (actual.length > 0) {
          const ult = actual[actual.length - 1];
          if (ult.x !== inicio.x || ult.y !== inicio.y) actual.push(inicio);
        }
        cerrarActual(true);
        p = inicio;
        actual = [p];
        break;
      }
      default:
        throw new Error(`Comando de trayecto desconocido: ${cmd}`);
    }
    ctrlC = nuevoCtrlC;
    ctrlQ = nuevoCtrlQ;
  }
  cerrarActual(false);
  return trazos;
}

/** Arco elíptico de SVG (parametrización por extremos, apéndice F.6 de SVG 1.1). */
function arcoSvg(p0: Punto, p1: Punto, rx0: number, ry0: number, rotGrados: number, grande: boolean, barrido: boolean, esc: number): Punto[] {
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return [p1];
  const phi = (rotGrados * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cp * dx + sp * dy;
  const y1 = -sp * dx + cp * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (grande === barrido) k = -k;
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cp * cx1 - sp * cy1 + (p0.x + p1.x) / 2;
  const cy = sp * cx1 + cp * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!barrido && dt > 0) dt -= 2 * Math.PI;
  else if (barrido && dt < 0) dt += 2 * Math.PI;
  const pts = puntosArco({ x: cx, y: cy }, rx, ry, phi, t0, dt, esc);
  pts[pts.length - 1] = p1; // extremo exacto
  return pts;
}

// ---------------------------------------------------------------------------
// Documento

const IGNORAR = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'title', 'desc', 'metadata', 'style', 'script', 'text', 'image', 'lineargradient', 'radialgradient', 'filter', 'foreignobject']);

interface Estilo {
  stroke: string | null;
  fill: string | null;
  visible: boolean;
}

function propiedad(el: Element, nombre: string): string | null {
  const st = el.getAttribute('style');
  if (st) {
    for (const decl of st.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0 && decl.slice(0, i).trim().toLowerCase() === nombre) return decl.slice(i + 1).replace(/!important/, '').trim();
    }
  }
  return el.getAttribute(nombre);
}

function estiloDe(el: Element, padre: Estilo): Estilo {
  const s = normalizarColor(propiedad(el, 'stroke'));
  const f = normalizarColor(propiedad(el, 'fill'));
  const disp = propiedad(el, 'display');
  const vis = propiedad(el, 'visibility');
  return {
    stroke: s ?? padre.stroke,
    fill: f ?? padre.fill,
    visible: padre.visible && disp !== 'none' && vis !== 'hidden',
  };
}

/** Color de la capa: el del trazo; si no tiene, el del relleno; si tampoco, negro. */
function colorDeEstilo(e: Estilo): string {
  if (e.stroke && e.stroke !== 'none') return e.stroke;
  if (e.fill && e.fill !== 'none') return e.fill;
  return '#000000';
}

function attrNum(el: Element, nombre: string, def = 0): number {
  const v = el.getAttribute(nombre);
  if (v === null) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function dDeElemento(el: Element): string | null {
  const tag = el.localName.toLowerCase();
  switch (tag) {
    case 'path':
      return el.getAttribute('d');
    case 'rect': {
      const x = attrNum(el, 'x');
      const y = attrNum(el, 'y');
      const w = attrNum(el, 'width');
      const h = attrNum(el, 'height');
      if (!(w > 0 && h > 0)) return null;
      let rx = el.hasAttribute('rx') ? attrNum(el, 'rx') : NaN;
      let ry = el.hasAttribute('ry') ? attrNum(el, 'ry') : NaN;
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (rx === 0 || ry === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return (
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}` +
        `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
        `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
      );
    }
    case 'circle':
    case 'ellipse': {
      const cx = attrNum(el, 'cx');
      const cy = attrNum(el, 'cy');
      const rx = tag === 'circle' ? attrNum(el, 'r') : attrNum(el, 'rx');
      const ry = tag === 'circle' ? rx : attrNum(el, 'ry');
      if (!(rx > 0 && ry > 0)) return null;
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`;
    }
    case 'line':
      return `M${attrNum(el, 'x1')} ${attrNum(el, 'y1')}L${attrNum(el, 'x2')} ${attrNum(el, 'y2')}`;
    case 'polyline':
    case 'polygon': {
      const n = numeros(el.getAttribute('points'));
      if (n.length < 4) return null;
      let d = `M${n[0]} ${n[1]}`;
      for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
  }
  return null;
}

/** Matriz del viewBox de un elemento svg (de unidades de usuario a su viewport). */
function matrizViewBox(svg: Element, ancho: number | null, alto: number | null): { m: Matriz; ancho: number; alto: number } {
  const vb = numeros(svg.getAttribute('viewBox'));
  if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) return { m: IDENTIDAD, ancho: ancho ?? 0, alto: alto ?? 0 };
  const w = ancho ?? vb[2];
  const h = alto ?? vb[3];
  let sx = w / vb[2];
  let sy = h / vb[3];
  let tx = 0;
  let ty = 0;
  const par = (svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet').trim().split(/\s+/);
  if (par[0] !== 'none') {
    const s = par[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    const alin = par[0];
    const fx = alin.includes('xMid') ? 0.5 : alin.includes('xMax') ? 1 : 0;
    const fy = alin.includes('YMid') ? 0.5 : alin.includes('YMax') ? 1 : 0;
    tx = (w - vb[2] * s) * fx;
    ty = (h - vb[3] * s) * fy;
    sx = sy = s;
  }
  return { m: [sx, 0, 0, sy, tx - vb[0] * sx, ty - vb[1] * sy], ancho: w, alto: h };
}

export function importarSvg(texto: string, parser: DOMParser = new DOMParser()): ResultadoImportacion {
  const doc = parser.parseFromString(texto, 'image/svg+xml');
  const raiz = doc.documentElement;
  if (!raiz || raiz.localName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0)
    throw new Error('El archivo no es un SVG válido.');
  // Unidades: el tamaño del documento (width/height) en mm, en unidades de usuario px a 96 ppp.
  const anchoMm = longitudMm(raiz.getAttribute('width'));
  const altoMm = longitudMm(raiz.getAttribute('height'));
  const PX = MM_POR_UNIDAD.px;
  const vb = numeros(raiz.getAttribute('viewBox'));
  let raizM: Matriz;
  let altoDoc: number;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    // Tamaño en mm; si falta, el viewBox se toma en px.
    const w = anchoMm ?? (altoMm !== null ? (altoMm * vb[2]) / vb[3] : vb[2] * PX);
    const h = altoMm ?? (anchoMm !== null ? (anchoMm * vb[3]) / vb[2] : vb[3] * PX);
    const r = matrizViewBox(raiz, w, h);
    raizM = r.m;
    altoDoc = h;
  } else {
    raizM = [PX, 0, 0, PX, 0, 0];
    altoDoc = altoMm ?? 0;
  }
  // Paso a coordenadas del diseño (Y hacia arriba): y' = altoDoc - y.
  const voltear: Matriz = [1, 0, 0, -1, 0, altoDoc];
  const base = multiplicar(voltear, raizM);
  const figuras: FiguraImportada[] = [];
  const omitidos = new Set<string>();
  const ids = new Map<string, Element>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const id = el.getAttribute('id');
    if (id) ids.set(id, el);
  }

  const visitar = (el: Element, m: Matriz, estiloPadre: Estilo, profundidad: number) => {
    if (profundidad > 50) return;
    const tag = el.localName.toLowerCase();
    if (IGNORAR.has(tag)) {
      if (tag === 'text' || tag === 'image') omitidos.add(tag);
      return;
    }
    const estilo = estiloDe(el, estiloPadre);
    if (!estilo.visible) return;
    let mm = multiplicar(m, leerTransform(el.getAttribute('transform')));
    if (tag === 'svg' && el !== raiz) {
      const w = el.hasAttribute('width') ? attrNum(el, 'width') : null;
      const h = el.hasAttribute('height') ? attrNum(el, 'height') : null;
      mm = multiplicar(mm, traslacion(attrNum(el, 'x'), attrNum(el, 'y')));
      mm = multiplicar(mm, matrizViewBox(el, w, h).m);
    }
    if (tag === 'use') {
      const ref = (el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').replace(/^#/, '');
      const destino = ids.get(ref);
      if (destino && !destino.contains(el)) {
        const mu = multiplicar(mm, traslacion(attrNum(el, 'x'), attrNum(el, 'y')));
        const t = destino.localName.toLowerCase();
        if (t === 'symbol') for (const h of Array.from(destino.children)) visitar(h, mu, estilo, profundidad + 1);
        else visitar(destino, mu, estilo, profundidad + 1);
      }
      return;
    }
    const d = dDeElemento(el);
    if (d) {
      const trazos = aplanarTrayecto(d, mm, 1).filter((t) => t.puntos.length >= 2);
      // Cada elemento es una figura; la capa sale de su color.
      if (trazos.length) figuras.push({ color: colorDeEstilo(estilo), trazos });
      return;
    }
    for (const h of Array.from(el.children)) visitar(h, mm, estilo, profundidad + 1);
  };
  visitar(raiz, base, { stroke: null, fill: null, visible: true }, 0);

  return { figuras, avisos: [...omitidos].map((t) => (t === 'text' ? 'textos' : 'imágenes')) };
}
