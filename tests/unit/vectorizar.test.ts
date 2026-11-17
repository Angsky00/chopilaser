// Fase 1b: vectorizar con potrace (potracelib compilado a wasm) usando las imágenes de referencia de QA
// (tests/vector_ref/, copia exacta: se comprueban con SHA256SUMS y no se tocan).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Punto } from '../../src/gcode/types';
import { areaPoligono, cajaDePuntos } from '../../src/diseno/geometria';
import { DPI_POR_DEFECTO, leerCabecera, mapaDeBits, MAX_LADO_PX } from '../../src/vectorizar/imagen';
import {
  OPCIONES_POR_DEFECTO,
  SEGMENTO_MINIMO_MM,
  svgTrazado,
  trazarImagen,
  type OpcionesTrazado,
  type ResultadoTrazado,
} from '../../src/vectorizar/trazar';
import { DIR_VECTOR_REF, esperado, imagenRef, prepararPotraceEnNode } from '../vector';
import { DIR_GOLDEN } from '../util';

const ACTUALIZAR = process.env.ACTUALIZAR_GOLDEN === '1';
const E = esperado();
const LOGOS = ['logo_bn.png', 'logo_ruido.png', 'logo_jpg_q30.jpg', 'logo_transparente.png'];
/** Tolerancia de área frente a los píxeles negros de logo_bn. */
const TOL_AREA = 0.01;

prepararPotraceEnNode();

async function trazar(nombre: string, o: Partial<OpcionesTrazado> = {}): Promise<ResultadoTrazado> {
  const im = imagenRef(nombre);
  return trazarImagen(im.data, im.ancho, im.alto, { ...OPCIONES_POR_DEFECTO, ...o }, null);
}

const contornos = (r: ResultadoTrazado) => r.grupos.flatMap((g) => g.trazos.map((t) => t.puntos));
/** En px de la imagen, con Y hacia abajo como en esperado.json. */
const cajaPx = (c: Punto[], r: ResultadoTrazado) => {
  const b = cajaDePuntos(c)!;
  const k = 1 / r.mmPorPx;
  return [b.xMin * k, 400 - b.yMax * k, b.xMax * k, 400 - b.yMin * k];
};

describe('imágenes de referencia de QA', () => {
  it('son copia exacta (sha256sum -c SHA256SUMS)', () => {
    const lineas = readFileSync(join(DIR_VECTOR_REF, 'SHA256SUMS'), 'utf8').trim().split('\n');
    expect(lineas).toHaveLength(6);
    for (const l of lineas) {
      const [hash, archivo] = l.split(/\s+\*?/);
      const real = createHash('sha256').update(readFileSync(join(DIR_VECTOR_REF, archivo))).digest('hex');
      expect(`${archivo}:${real}`).toBe(`${archivo}:${hash}`);
    }
    if (process.platform !== 'win32') execFileSync('sha256sum', ['-c', '--quiet', 'SHA256SUMS'], { cwd: DIR_VECTOR_REF });
  });
});

describe('cabecera de la imagen (tamaño y DPI)', () => {
  it('las de referencia miden 400 x 400 y no traen DPI (se usa 96)', () => {
    for (const n of [...LOGOS, 'foto_degradado.png']) {
      const c = leerCabecera(readFileSync(join(DIR_VECTOR_REF, n)))!;
      expect([c.ancho, c.alto, c.dpi]).toEqual([400, 400, null]);
    }
    expect(DPI_POR_DEFECTO).toBe(96);
  });

  const chunk = (tipo: string, datos: number[]) => [0, 0, 0, datos.length, ...[...tipo].map((c) => c.charCodeAt(0)), ...datos, 0, 0, 0, 0];
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const png = (phys?: number[]) =>
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', [...be32(1200), ...be32(800), 8, 0, 0, 0, 0]), ...(phys ? chunk('pHYs', phys) : []), ...chunk('IEND', [])]);

  it('PNG: tamaño de IHDR y DPI de pHYs (en metros)', () => {
    expect(leerCabecera(png())).toEqual({ tipo: 'png', ancho: 1200, alto: 800, dpi: null });
    const c = leerCabecera(png([...be32(11811), ...be32(11811), 1]))!;
    expect(c.dpi).toBeCloseTo(300, 1);
    expect(leerCabecera(png([...be32(11811), ...be32(5000), 1]))!.dpi).toBeNull(); // distinto en X e Y
    expect(leerCabecera(png([...be32(1), ...be32(1), 0]))!.dpi).toBeNull(); // solo proporción
  });

  const jpg = (unidad: number, d: number) =>
    new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, unidad, d >> 8, d & 255, d >> 8, d & 255, 0, 0,
      0xff, 0xc0, 0, 11, 8, 0x02, 0x58, 0x03, 0x20, 1, 1, 0x11, 0,
    ]);
  it('JPEG: tamaño de SOF y DPI de JFIF (ppp o puntos por cm; 0 = sin DPI)', () => {
    expect(leerCabecera(jpg(1, 300))).toEqual({ tipo: 'jpeg', ancho: 800, alto: 600, dpi: 300 });
    expect(leerCabecera(jpg(2, 118))!.dpi).toBeCloseTo(299.72, 2);
    expect(leerCabecera(jpg(0, 1))!.dpi).toBeNull();
    expect(leerCabecera(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('el máximo es de unos 4000 px por lado', () => expect(MAX_LADO_PX).toBe(4000));
});

describe('mapa de bits', () => {
  const rgba = (...px: number[][]) => new Uint8Array(px.flat());
  it('umbral: tinta si la luminancia es menor; la transparencia es fondo, también al invertir', () => {
    const img = rgba([0, 0, 0, 255], [127, 127, 127, 255], [128, 128, 128, 255], [0, 0, 0, 0], [255, 255, 255, 0]);
    expect([...mapaDeBits(img, 5, 1, { umbral: 128, invertir: false, desenfoque: 0 })]).toEqual([1, 1, 0, 0, 0]);
    expect([...mapaDeBits(img, 5, 1, { umbral: 128, invertir: true, desenfoque: 0 })]).toEqual([0, 0, 1, 0, 0]);
    expect([...mapaDeBits(img, 5, 1, { umbral: 0, invertir: false, desenfoque: 0 })]).toEqual([0, 0, 0, 0, 0]);
  });
  it('desenfoque: reparte un punto negro entre sus vecinos de forma determinista', () => {
    const img = new Uint8Array(5 * 5 * 4).fill(255);
    img.fill(0, 12 * 4, 12 * 4 + 3);
    const a = mapaDeBits(img, 5, 5, { umbral: 250, invertir: false, desenfoque: 1 });
    expect([...a].reduce((s, v) => s + v, 0)).toBe(9);
    expect(mapaDeBits(img, 5, 5, { umbral: 250, invertir: false, desenfoque: 1 })).toEqual(a);
  });
});

describe('vectorizar las imágenes de referencia', () => {
  const r: Record<string, ResultadoTrazado> = {};
  beforeAll(async () => {
    for (const n of [...LOGOS, 'foto_degradado.png']) r[n] = await trazar(n);
  }, 60_000);

  for (const n of [...LOGOS, 'foto_degradado.png']) {
    it(`${n}: SVG determinista (igual al de referencia guardado y al repetir)`, async () => {
      const svg = svgTrazado(r[n], 400, 400);
      const otra = svgTrazado(await trazar(n), 400, 400);
      expect(otra).toBe(svg);
      const ruta = join(DIR_GOLDEN, 'vector', n.replace(/\.(png|jpg)$/, '.svg'));
      if (ACTUALIZAR || !existsSync(ruta)) writeFileSync(ruta, svg);
      expect(svg).toBe(readFileSync(ruta, 'utf8'));
    });
  }

  for (const n of LOGOS) {
    it(`${n}: ${E.logo_bn.contornos_exteriores} contornos exteriores, ${E.logo_bn.huecos} huecos y área de ${E.logo_bn.pixeles_negros} px ± 1 %`, () => {
      expect(r[n].exteriores).toBe(E.logo_bn.contornos_exteriores);
      expect(r[n].huecos).toBe(E.logo_bn.huecos);
      expect(Math.abs(r[n].areaPx - E.logo_bn.pixeles_negros) / E.logo_bn.pixeles_negros).toBeLessThan(TOL_AREA);
    });
  }

  it('logo_bn: los contornos están donde dice esperado.json (± 1,5 px)', () => {
    const f = E.logo_bn.formas;
    const [cx, cy] = f.circulo.centro;
    const esperadas = [
      [cx - f.circulo.r, cy - f.circulo.r, cx + f.circulo.r, cy + f.circulo.r],
      f.cuadrado,
      f.hueco_cuadrado,
      f.barra,
      f.hueco_barra,
    ];
    const cajas = contornos(r['logo_bn.png']).map((c) => cajaPx(c, r['logo_bn.png']));
    for (const e of esperadas) {
      const c = cajas.find((b) => b.every((v, i) => Math.abs(v - e[i]) <= 1.5));
      expect(c, `contorno ${e.join(',')}`).toBeDefined();
    }
  });

  it('logo_bn: el tamaño sale de 96 ppp (400 px = 105,833 mm)', () => {
    expect(r['logo_bn.png'].mmPorPx * 400).toBeCloseTo(105.833, 3);
  });

  it('logo_transparente: lo transparente es fondo; da lo mismo que logo_bn', () => {
    expect(r['logo_transparente.png'].trayectos).toEqual(r['logo_bn.png'].trayectos);
  });

  it('logo_jpg_q30: con los artefactos del JPG da los mismos contornos', () => {
    const cajas = (x: ResultadoTrazado) => contornos(x).map((c) => cajaPx(c, x)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const a = cajas(r['logo_bn.png']);
    const b = cajas(r['logo_jpg_q30.jpg']);
    expect(b).toHaveLength(a.length);
    b.forEach((c, i) => c.forEach((v, j) => expect(Math.abs(v - a[i][j])).toBeLessThanOrEqual(1.5)));
  });

  describe('quitar manchas (logo_ruido)', () => {
    it('sin quitar manchas, el ruido sí aparece', async () => {
      const sin = await trazar('logo_ruido.png', { manchas: 0 });
      expect(sin.exteriores + sin.huecos).toBeGreaterThan(5);
    });
    for (const manchas of [5, 10, 30]) {
      it(`con manchas = ${manchas}: los mismos 3 contornos y 2 huecos, sin comerse los huecos`, async () => {
        const x = manchas === OPCIONES_POR_DEFECTO.manchas ? r['logo_ruido.png'] : await trazar('logo_ruido.png', { manchas });
        expect([x.exteriores, x.huecos]).toEqual([3, 2]);
        // Cada contorno (también los dos huecos) conserva el área que tiene en logo_bn ± 1 %.
        const areas = (y: ResultadoTrazado) =>
          contornos(y)
            .map((c) => Math.abs(areaPoligono(c)) / (y.mmPorPx * y.mmPorPx))
            .sort((a, b) => a - b);
        const ref = areas(r['logo_bn.png']);
        areas(x).forEach((a, i) => expect(Math.abs(a - ref[i]) / ref[i]).toBeLessThan(0.01));
        expect(ref[0]).toBeGreaterThan(3500); // el hueco cuadrado (unos 60 x 60 px) sigue ahí
      });
    }
  });

  for (const n of [...LOGOS, 'foto_degradado.png']) {
    it(`${n}: sin segmentos diminutos ni contornos repetidos`, () => {
      const cs = contornos(r[n]);
      for (const c of cs) {
        for (let i = 1; i < c.length; i++) expect(Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y)).toBeGreaterThanOrEqual(SEGMENTO_MINIMO_MM);
        expect(c[0]).toEqual(c[c.length - 1]);
      }
      const firmas = cs.map((c) => c.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).sort().join(' '));
      expect(new Set(firmas).size).toBe(firmas.length);
    });
  }

  it('foto_degradado: determinista y monótono con el umbral', async () => {
    let anterior = -1;
    for (const umbral of [32, 64, 96, 128, 160, 192, 224]) {
      const x = await trazar('foto_degradado.png', { umbral });
      const y = await trazar('foto_degradado.png', { umbral });
      expect(y.trayectos).toEqual(x.trayectos);
      expect(x.pixelesTinta).toBeGreaterThan(anterior);
      expect(Math.abs(x.areaPx - x.pixelesTinta) / Math.max(1, x.pixelesTinta)).toBeLessThan(0.02);
      anterior = x.pixelesTinta;
    }
  }, 60_000);

  it('invertir: la tinta pasa a ser el fondo', async () => {
    const x = await trazar('logo_bn.png', { invertir: true });
    expect(x.pixelesTinta).toBe(400 * 400 - E.logo_bn.pixeles_negros);
  });

  it('una imagen sin tinta no da contornos', async () => {
    const x = await trazar('logo_bn.png', { umbral: 0 });
    expect(x.grupos).toEqual([]);
  });
});

describe('reducir imágenes de más de 4000 px', () => {
  it('el lado mayor queda en 4000 px con la misma proporción; lo que cabe no cambia', async () => {
    const { medidaReducida } = await import('../../src/ui/vectorizar');
    expect(medidaReducida(4000, 3000)).toEqual({ ancho: 4000, alto: 3000, reducida: false });
    expect(medidaReducida(4001, 4)).toEqual({ ancho: 4000, alto: 4, reducida: true });
    expect(medidaReducida(6000, 3000)).toEqual({ ancho: 4000, alto: 2000, reducida: true });
    expect(medidaReducida(3000, 6000)).toEqual({ ancho: 2000, alto: 4000, reducida: true });
    expect(medidaReducida(9000, 1)).toEqual({ ancho: 4000, alto: 1, reducida: true });
  });
});
