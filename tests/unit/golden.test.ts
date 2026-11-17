// Compara la cuadrícula generada con los archivos de referencia y pasa el
// validador de QA (tools/gcode_lint.py) SIN --laser-mode, con --max-s y --bed
// de cada configuración de PRUEBA (no son los valores reales de la máquina de Angel).
// Para regenerar los goldens: npm run golden
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gcodeABytes, generarCuadricula, generarGcode } from '../../src/gcode';
import { casosGolden, DIR_GOLDEN, lint, sha256 } from '../util';

const ACTUALIZAR = process.env.ACTUALIZAR_GOLDEN === '1';
const casos = casosGolden();

describe('goldens', () => {
  it('hay un golden por cada sMax de prueba (1000 y 255)', () => {
    expect(casos.map((c) => c.maquinaPrueba.sMax).sort((a, b) => a - b)).toEqual([255, 1000]);
  });

  for (const caso of casos) {
    const m = caso.maquinaPrueba;
    const ruta = join(DIR_GOLDEN, caso.archivo);
    describe(caso.archivo, () => {
      const bytes = gcodeABytes(generarGcode(generarCuadricula({ ancho: m.camaAncho, alto: m.camaAlto }), m));

      it('coincide byte por byte con el golden', () => {
        if (ACTUALIZAR || !existsSync(ruta)) writeFileSync(ruta, bytes);
        const golden = readFileSync(ruta);
        expect(sha256(bytes)).toBe(sha256(golden));
        expect(Buffer.compare(Buffer.from(bytes), golden)).toBe(0);
      });

      it(`pasa gcode_lint.py --max-s ${m.sMax} --bed ${m.camaAncho},${m.camaAlto}`, () => {
        const r = lint(ruta, m);
        expect(r.salida).toMatch(/^OK /);
        expect(r.salida).toContain('0 errores, 0 avisos');
        expect(r.codigo).toBe(0);
      });

      it('el lint sí falla con un $30 menor (control negativo)', () => {
        const r = lint(ruta, { ...m, sMax: m.sMax - 1 });
        expect(r.codigo).toBe(1);
        expect(r.salida).toContain('S_OVER_MAX');
      });
    });
  }
});
