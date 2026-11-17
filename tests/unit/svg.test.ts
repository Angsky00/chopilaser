// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { aplanarTrayecto, importarSvg, leerTransform, longitudMm } from '../../src/importar/svg';
import { areaPoligono, cajaDeTrazos, TOLERANCIA_MM } from '../../src/diseno/geometria';

const svg = (cuerpo: string, attrs = 'width="100mm" height="50mm" viewBox="0 0 100 50"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${cuerpo}</svg>`;
const caja = (r: ReturnType<typeof importarSvg>, i = 0) => cajaDeTrazos(r.figuras[i].trazos)!;
const cerca = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('unidades y viewBox', () => {
  it('longitudes CSS a mm', () => {
    expect(longitudMm('10mm')).toBe(10);
    expect(longitudMm('1in')).toBe(25.4);
    expect(longitudMm('2cm')).toBe(20);
    expect(longitudMm('72pt')).toBeCloseTo(25.4);
    expect(longitudMm('96')).toBeCloseTo(25.4);
    expect(longitudMm('96px')).toBeCloseTo(25.4);
    expect(longitudMm('50%')).toBe(null);
  });

  it('viewBox con tamaño en mm escala y voltea Y (el diseño tiene Y hacia arriba)', () => {
    const r = importarSvg(svg('<rect x="10" y="5" width="20" height="10"/>', 'width="200mm" height="100mm" viewBox="0 0 100 50"'));
    const c = caja(r);
    // x: 10..30 -> 20..60 mm; y (abajo): 5..15 -> 100-30 .. 100-10 = 70..90 mm.
    expect(c).toEqual({ xMin: 20, yMin: 70, xMax: 60, yMax: 90 });
  });

  it('sin width/height el viewBox se toma en px a 96 ppp', () => {
    const r = importarSvg(svg('<line x1="0" y1="0" x2="96" y2="0" stroke="red"/>', 'viewBox="0 0 96 96"'));
    const c = caja(r);
    cerca(c.xMax - c.xMin, 25.4);
    cerca(c.yMin, 25.4);
  });

  it('viewBox desplazado y preserveAspectRatio por defecto (centrado)', () => {
    const r = importarSvg(svg('<rect x="-10" y="-10" width="10" height="10"/>', 'width="40mm" height="20mm" viewBox="-10 -10 20 20"'));
    // Escala min(40/20, 20/20) = 1, centrado en x: desplazamiento (40-20)/2 = 10.
    expect(caja(r)).toEqual({ xMin: 10, yMin: 10, xMax: 20, yMax: 20 });
  });

  it('documento en pulgadas', () => {
    const r = importarSvg(svg('<rect width="1" height="1"/>', 'width="2in" height="2in" viewBox="0 0 2 2"'));
    const c = caja(r);
    cerca(c.xMax - c.xMin, 25.4);
  });
});

describe('comandos de trayecto', () => {
  it('M L H V Z absolutos y relativos', () => {
    const t = aplanarTrayecto('M0 0 L10 0 V10 H0 Z m20 0 l10 0 v10 h-10 z');
    expect(t).toHaveLength(2);
    expect(t[0].cerrado).toBe(true);
    expect(t[0].puntos).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
    expect(cajaDeTrazos([t[1]])).toEqual({ xMin: 20, yMin: 0, xMax: 30, yMax: 10 });
  });

  it('pares implícitos después de M son líneas, y números pegados', () => {
    const t = aplanarTrayecto('M0,0 10,0 10-10.5.5.5');
    expect(t[0].puntos).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: -10.5 },
      { x: 0.5, y: 0.5 },
    ]);
  });

  it('cúbica C y S terminan en el punto exacto y quedan cerca de la curva', () => {
    const t = aplanarTrayecto('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    const pts = t[0].puntos;
    expect(pts[pts.length - 1]).toEqual({ x: 20, y: 0 });
    // Punto medio de la primera curva: (5, 7.5).
    expect(pts.some((p) => Math.abs(p.x - 5) < 0.2 && Math.abs(p.y - 7.5) < 0.05)).toBe(true);
    // Simetría de S: hay un punto cerca de (15, -7.5).
    expect(pts.some((p) => Math.abs(p.x - 15) < 0.2 && Math.abs(p.y + 7.5) < 0.05)).toBe(true);
  });

  it('cuadrática Q y T', () => {
    const t = aplanarTrayecto('M0 0 Q5 10 10 0 T20 0');
    const pts = t[0].puntos;
    expect(pts[pts.length - 1]).toEqual({ x: 20, y: 0 });
    expect(pts.some((p) => Math.abs(p.x - 5) < 0.2 && Math.abs(p.y - 5) < 0.05)).toBe(true);
    expect(pts.some((p) => Math.abs(p.x - 15) < 0.2 && Math.abs(p.y + 5) < 0.05)).toBe(true);
  });

  it('arcos: semicírculo con todas las banderas y banderas pegadas', () => {
    // Semicírculo de radio 10 de (0,0) a (20,0); barrido=1 en SVG (Y abajo) pasa por y negativa.
    const a = aplanarTrayecto('M0 0 A10 10 0 0 1 20 0')[0].puntos;
    for (const p of a) cerca(Math.hypot(p.x - 10, p.y), 10, 1e-9);
    cerca(Math.min(...a.map((p) => p.y)), -10, TOLERANCIA_MM);
    const b = aplanarTrayecto('M0 0 A10 10 0 0 0 20 0')[0].puntos;
    cerca(Math.max(...b.map((p) => p.y)), 10, TOLERANCIA_MM);
    // Banderas pegadas: «a10 10 0 0120 0» = a 10 10 0 0 1 20 0.
    const c = aplanarTrayecto('M0 0a10 10 0 0120 0')[0].puntos;
    expect(c).toEqual(a);
    // Arco grande: 3/4 de círculo.
    const d = aplanarTrayecto('M10 0 A10 10 0 1 1 0 -10')[0].puntos;
    const caja = cajaDeTrazos([{ puntos: d, cerrado: false }])!;
    expect(caja.xMax - caja.xMin).toBeCloseTo(20, 1);
  });

  it('el radio demasiado pequeño se agranda (como pide la especificación)', () => {
    const a = aplanarTrayecto('M0 0 A1 1 0 0 1 20 0')[0].puntos;
    for (const p of a) cerca(Math.hypot(p.x - 10, p.y), 10, 1e-9);
  });

  it('la tolerancia de aplanado de un círculo se cumple', () => {
    const r = importarSvg(svg('<circle cx="50" cy="25" r="20"/>'));
    const pts = r.figuras[0].trazos[0].puntos;
    expect(r.figuras[0].trazos[0].cerrado).toBe(true);
    for (let i = 1; i < pts.length; i++) {
      const m = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
      expect(20 - Math.hypot(m.x - 50, m.y - 25)).toBeLessThanOrEqual(TOLERANCIA_MM + 1e-9);
    }
    // El polígono inscrito pierde menos del 0,2 % del área.
    expect(Math.abs(areaPoligono(pts)) / (Math.PI * 400)).toBeGreaterThan(0.998);
  });

  it('un trayecto mal formado da error', () => {
    expect(() => aplanarTrayecto('10 10')).toThrow();
    expect(() => aplanarTrayecto('M0 0 L10')).toThrow();
  });
});

describe('transformaciones', () => {
  it('translate, scale, rotate con centro, matrix y skewX', () => {
    expect(leerTransform('translate(5)')).toEqual([1, 0, 0, 1, 5, 0]);
    expect(leerTransform('scale(2,3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(leerTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
    const r = leerTransform('rotate(90 10 10)');
    // (20,10) gira 90° alrededor de (10,10) -> (10,20).
    cerca(r[0] * 20 + r[2] * 10 + r[4], 10);
    cerca(r[1] * 20 + r[3] * 10 + r[5], 20);
    const k = leerTransform('skewX(45)');
    cerca(k[2], 1);
  });

  it('se componen las de los grupos y la del elemento', () => {
    const r = importarSvg(
      svg('<g transform="translate(10 0)"><g transform="scale(2)"><rect x="0" y="0" width="5" height="5" transform="translate(1 1)"/></g></g>'),
    );
    // x: (0+1)*2+10 = 12 .. (5+1)*2+10 = 22; y: 2..12 -> 50-12..50-2 = 38..48.
    expect(caja(r)).toEqual({ xMin: 12, yMin: 38, xMax: 22, yMax: 48 });
  });

  it('use, svg anidado y elementos ocultos', () => {
    const r = importarSvg(
      svg(
        '<defs><rect id="r" width="10" height="10"/></defs><use href="#r" x="20" y="0"/>' +
          '<svg x="50" y="0" width="20" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' +
          '<rect width="5" height="5" display="none"/><g style="visibility:hidden"><rect width="5" height="5"/></g>',
      ),
    );
    expect(r.figuras).toHaveLength(2);
    expect(caja(r, 0)).toEqual({ xMin: 20, yMin: 40, xMax: 30, yMax: 50 });
    expect(caja(r, 1)).toEqual({ xMin: 50, yMin: 30, xMax: 70, yMax: 50 });
  });
});

describe('formas y colores', () => {
  it('rect con esquinas redondeadas, ellipse, polyline, polygon y line', () => {
    const r = importarSvg(
      svg(
        '<rect x="0" y="0" width="20" height="10" rx="2"/><ellipse cx="50" cy="25" rx="10" ry="5"/>' +
          '<polyline points="0,0 10,10 20,0"/><polygon points="0,0 10,10 20,0"/><line x1="0" y1="0" x2="5" y2="5"/>',
      ),
    );
    expect(r.figuras).toHaveLength(5);
    expect(caja(r, 0)).toEqual({ xMin: 0, yMin: 40, xMax: 20, yMax: 50 });
    const e = caja(r, 1);
    cerca(e.xMax - e.xMin, 20, 1e-9);
    cerca(e.yMax - e.yMin, 10, 2 * TOLERANCIA_MM);
    expect(r.figuras[2].trazos[0].cerrado).toBe(false);
    expect(r.figuras[3].trazos[0].cerrado).toBe(true);
  });

  it('el color de la capa sale del trazo, si no del relleno, si no negro; con herencia', () => {
    const r = importarSvg(
      svg(
        '<g stroke="#F00"><rect width="1" height="1"/><rect width="1" height="1" style="stroke: rgb(0, 0, 255)"/></g>' +
          '<rect width="1" height="1" fill="lime" stroke="none"/><rect width="1" height="1"/>',
      ),
    );
    expect(r.figuras.map((f) => f.color)).toEqual(['#ff0000', '#0000ff', '#00ff00', '#000000']);
  });

  it('avisa de textos e imágenes que no se importan', () => {
    const r = importarSvg(svg('<text>hola</text><image href="a.png"/><rect width="1" height="1"/>'));
    expect(r.avisos).toEqual(['textos', 'imágenes']);
    expect(r.figuras).toHaveLength(1);
  });

  it('un archivo que no es SVG da error', () => {
    expect(() => importarSvg('<html></html>')).toThrow('El archivo no es un SVG válido.');
    expect(() => importarSvg('no es xml')).toThrow();
  });
});

describe('color: precedencia (stroke gana a fill; style gana al atributo; hoja <style>)', () => {
  const colores = (cuerpo: string) => importarSvg(svg(cuerpo)).figuras.map((f) => f.color);

  it('con stroke y fill a la vez, manda el stroke (en atributos y en style)', () => {
    expect(colores('<rect width="5" height="5" fill="#00ff00" stroke="#ff0000"/>')).toEqual(['#ff0000']);
    expect(colores('<rect width="5" height="5" style="fill:#00ff00;stroke:#0000ff"/>')).toEqual(['#0000ff']);
    // Grupo: el hijo solo tiene fill, el stroke heredado sigue mandando.
    expect(colores('<g stroke="#ff0000"><rect width="5" height="5" fill="#00ff00"/></g>')).toEqual(['#ff0000']);
  });

  it('style gana al atributo de presentación', () => {
    expect(colores('<rect width="5" height="5" stroke="#ff0000" style="stroke:#0000ff"/>')).toEqual(['#0000ff']);
    expect(colores('<rect width="5" height="5" fill="#ff0000" style="fill:#00ff00"/>')).toEqual(['#00ff00']);
    // style: stroke:none deja paso al fill aunque el atributo diga otra cosa.
    expect(colores('<rect width="5" height="5" stroke="#ff0000" fill="#0000ff" style="stroke:none"/>')).toEqual(['#0000ff']);
  });

  it('lee colores de reglas de clase, etiqueta e id de <style> (SVG de Illustrator)', () => {
    const cuerpo =
      '<defs><style>/* Illustrator */ .cls-1{fill:none;stroke:#f00;stroke-miterlimit:10}.cls-2,.cls-3{fill:#00f}' +
      ' circle{stroke:#0f0} #especial{stroke:#ff00ff} @media print{.cls-1{stroke:#123456}}</style></defs>' +
      '<rect class="cls-1" width="5" height="5"/><path class="cls-3" d="M0 0 H5 V5 Z"/><circle cx="20" cy="20" r="3"/>' +
      '<circle id="especial" class="cls-2" cx="30" cy="20" r="3"/><rect class="otra cls-1" x="40" width="5" height="5"/>';
    expect(colores(cuerpo)).toEqual(['#ff0000', '#0000ff', '#00ff00', '#ff00ff', '#ff0000']);
  });

  it('style en línea gana a la hoja, y la hoja gana al atributo', () => {
    const hoja = '<style>.c{stroke:#ff0000}</style>';
    expect(colores(`${hoja}<rect class="c" stroke="#00ff00" width="5" height="5"/>`)).toEqual(['#ff0000']);
    expect(colores(`${hoja}<rect class="c" style="stroke:#0000ff" width="5" height="5"/>`)).toEqual(['#0000ff']);
    // Misma especificidad: gana la regla posterior; más especificidad gana aunque vaya antes.
    expect(colores('<style>rect.c{stroke:#00f} .c{stroke:#f00} .c{stroke:#0f0}</style><rect class="c" width="5" height="5"/>')).toEqual(['#0000ff']);
  });
});
