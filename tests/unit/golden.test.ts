// Compara la cuadrícula generada con los archivos de referencia y pasa el
// validador de QA (tools/gcode_lint.py) SIN --laser-mode, con --max-s y --area=
// de cada perfil de PRUEBA (no son los valores reales de la máquina de Angel).
// Para regenerar los goldens: npm run golden
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gcodeABytes, generarCuadricula, generarGcode, tamanoArea, validarPerfil } from '../../src/gcode';
import { casosGolden, DIR_GOLDEN, limitesDe, lint, sha256 } from '../util';

const ACTUALIZAR = process.env.ACTUALIZAR_GOLDEN === '1';
const casos = casosGolden();

describe('goldens', () => {
  it('hay un golden por perfil de prueba: a (1000), b (255, área negativa) y c (S de 0 a 1)', () => {
    expect(casos.map((c) => `${c.perfil}:${c.perfilPrueba.sMax}`)).toEqual(['a:1000', 'b:255', 'c:1']);
    expect(casos[1].area.slice(0, 2).every((v) => v < 0)).toBe(true);
  });

  for (const caso of casos) {
    const ruta = join(DIR_GOLDEN, caso.archivo);
    const lim = limitesDe(caso);
    describe(`perfil ${caso.perfil}: ${caso.archivo}`, () => {
      const r = validarPerfil(caso.perfilPrueba);
      if (!r.ok) throw new Error(r.errores.join(' '));
      const cfg = r.perfil.config;
      const bytes = gcodeABytes(generarGcode(generarCuadricula(tamanoArea(cfg.area)), cfg));

      it('el perfil deriva el área declarada', () => {
        const a = cfg.area;
        expect([a.xMin, a.yMin, a.xMax, a.yMax]).toEqual(caso.area);
      });

      it('coincide byte por byte con el golden', () => {
        if (ACTUALIZAR || !existsSync(ruta)) writeFileSync(ruta, bytes);
        const golden = readFileSync(ruta);
        expect(sha256(bytes)).toBe(sha256(golden));
        expect(Buffer.compare(Buffer.from(bytes), golden)).toBe(0);
      });

      it(`pasa gcode_lint.py --max-s ${lim.sMax} --area=${lim.area.join(',')}`, () => {
        const res = lint(ruta, lim);
        expect(res.salida).toMatch(/^OK /);
        expect(res.salida).toContain('0 errores, 0 avisos');
        expect(res.codigo).toBe(0);
      });

      it('control negativo: el lint falla con un $30 menor', () => {
        const res = lint(ruta, { ...lim, sMax: lim.sMax * 0.99 });
        expect(res.codigo).toBe(1);
        expect(res.salida).toContain('S_OVER_MAX');
      });

      it('control negativo: el lint falla con un área desplazada', () => {
        const [x0, y0, x1, y1] = lim.area;
        const res = lint(ruta, { ...lim, area: [x0 + 50, y0, x1 + 50, y1] });
        expect(res.codigo).toBe(1);
        expect(res.salida).toContain('OUT_OF_BED');
      });
    });
  }
});
