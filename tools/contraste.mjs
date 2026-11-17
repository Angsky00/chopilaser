#!/usr/bin/env node
// Contraste WCAG 2.x de cada par texto/fondo que usa src/estilo.css.
// Lee los colores de las variables de :root, mezcla los fondos translúcidos sobre
// su base y exige AA: 4.5:1 texto normal, 3:1 texto grande y bordes de controles.
// Uso: node tools/contraste.mjs   (sale con código 1 si algún par no cumple)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = fileURLToPath(new URL('../src/estilo.css', import.meta.url));

export function variables(css = readFileSync(CSS, 'utf8')) {
  const raiz = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  const v = {};
  for (const m of raiz.matchAll(/--([\w-]+):\s*([^;]+);/g)) v[m[1]] = m[2].trim();
  return v;
}

function parse(c) {
  c = c.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(',').map((x) => Number(x.trim()));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`Color no reconocido: ${c}`);
}

/** Mezcla capas [base, capa1, capa2...] (la base debe ser opaca). */
export function mezclar(...capas) {
  let [r, g, b] = parse(capas[0]);
  for (const c of capas.slice(1)) {
    const [r2, g2, b2, a] = parse(c);
    r = r2 * a + r * (1 - a);
    g = g2 * a + g * (1 - a);
    b = b2 * a + b * (1 - a);
  }
  return [r, g, b];
}

function luminancia([r, g, b]) {
  const f = (x) => {
    x /= 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const hex = ([r, g, b]) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

/** Pares que usa la interfaz. min: 4.5 texto normal, 3 texto grande o borde de control. */
export function pares(v = variables()) {
  const TOPBAR = '#0b1a2c';
  const PIE = '#061018';
  const REJILLA = [v['bg-night'], v.grid];
  const FIELDSET = [v['bg-panel'], 'rgba(8, 20, 33, 0.45)'];
  const P = [];
  const par = (uso, texto, fondo, min) => P.push({ uso, texto, fondo, min });
  for (const [n, f] of [
    ['panel (arriba)', [v['bg-panel-2']]],
    ['panel (abajo)', [v['bg-panel']]],
    ['campo (inset)', [v['bg-inset']]],
    ['recuadro del área', FIELDSET],
  ]) {
    par(`Texto principal sobre ${n}`, [v.text], f, 4.5);
    par(`Texto secundario (lead, etiquetas) sobre ${n}`, [v['text-dim']], f, 4.5);
    par(`Ayuda y placeholder sobre ${n}`, [v['text-mute']], f, 4.5);
    par(`Errores sobre ${n}`, [v.error], f, 4.5);
  }
  par('Título del área (legend) sobre recuadro', [v.cyan], FIELDSET, 4.5);
  par('«Listo: se llenaron…» sobre panel', [v.ok], [v['bg-panel-2']], 4.5);
  par('Marca «Chopi» sobre encabezado', [v.text], [TOPBAR], 4.5);
  par('Marca «Laser» naranja sobre encabezado (texto grande, 700)', [v.orange], [TOPBAR], 3);
  par('«(nombre provisional)» sobre encabezado', [v['text-mute']], [TOPBAR], 4.5);
  par('Pie sobre su fondo', [v['text-mute']], [PIE], 4.5);
  par('Texto sobre fondo con rejilla (peor caso)', [v['text-mute']], REJILLA, 4.5);
  par('Botón naranja: texto oscuro sobre naranja', [v['orange-ink']], [v.orange], 4.5);
  par('Botón naranja (hover)', [v['orange-ink']], [v['orange-hover']], 4.5);
  par('Botón cian: texto sobre cian suave', [v.text], [v['bg-panel-2'], v['cyan-soft']], 4.5);
  par('Botón cian (hover)', [v.text], [v['bg-panel-2'], v['cyan-hover']], 4.5);
  par('Botón fantasma (hover)', [v.text], [v['bg-panel-2'], v['cyan-soft']], 4.5);
  par('Botón deshabilitado: texto sobre bg-lift', [v['text-mute']], [v['bg-lift']], 4.5);
  par('Borde de botón fantasma sobre panel', [v['line-hot']], [v['bg-panel-2']], 3);
  par('Borde de campo (sin foco) sobre panel', [v['line-hot']], [v['bg-panel']], 3);
  par('Borde de campo (sin foco) sobre recuadro del área', [v['line-hot']], FIELDSET, 3);
  par('Borde de campo con foco (cian) sobre panel', [v.cyan], [v['bg-panel-2']], 3);
  par('Borde de campo con error sobre panel', [v['error-borde']], [v['bg-panel-2']], 3);
  par('Borde del botón naranja (naranja) sobre panel', [v.orange], [v['bg-panel-2']], 3);
  // Lienzo (fase 1): área clara para ver trazos de cualquier color, incluido el negro.
  par('Marco y tiradores de selección sobre el área del lienzo', [v['lienzo-seleccion']], [v['lienzo-area']], 3);
  par('Figura fuera del área sobre el área del lienzo', [v['lienzo-fuera']], [v['lienzo-area']], 3);
  par('Borde del lienzo sobre panel', [v['line-hot']], [v['bg-panel']], 3);
  return P.map((p) => {
    const t = mezclar(...p.texto);
    const f = mezclar(...p.fondo);
    const r = contraste(t, f);
    return { uso: p.uso, texto: hex(t), fondo: hex(f), ratio: Math.round(r * 100) / 100, min: p.min, ok: r >= p.min };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = pares();
  console.log('| Uso | Texto | Fondo | Contraste | Mínimo AA | Cumple |');
  console.log('|---|---|---|---|---|---|');
  for (const p of r) console.log(`| ${p.uso} | \`${p.texto}\` | \`${p.fondo}\` | ${p.ratio.toFixed(2)}:1 | ${p.min}:1 | ${p.ok ? 'sí' : 'NO'} |`);
  process.exit(r.every((p) => p.ok) ? 0 : 1);
}
