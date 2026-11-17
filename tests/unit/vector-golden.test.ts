// Fase 1b: G-code de imágenes vectorizadas (referencias de QA) por el generador seguro, uno por
// perfil de PRUEBA. Pasan el validador de QA SIN --laser-mode con los mismos flags que el CI
// (el CI los valida con tests/golden/*_<perfil>_*.gcode).
// Regenerar: ACTUALIZAR_GOLDEN=1 npx vitest run tests/unit/vector-golden.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gcodeABytes, generarGcode, tamanoArea, validarPerfil } from '../../src/gcode';
import { figurasDesdeImportacion, sincronizarCapas, trabajoDesdeProyecto, type CapaProyecto } from '../../src/diseno/proyecto';
import { importacionDeTrazado, OPCIONES_POR_DEFECTO, trazarImagen } from '../../src/vectorizar/trazar';
import { imagenRef, prepararPotraceEnNode } from '../vector';
import { casosGolden, DIR_GOLDEN, limitesDe, lint, sha256 } from '../util';

const ACTUALIZAR = process.env.ACTUALIZAR_GOLDEN === '1';
prepararPotraceEnNode();

// Ajustes de PRUEBA (no son de ningún material real).
const MUESTRAS: { nombre: string; imagen: string; capa: Omit<CapaProyecto, 'color' | 'visible' | 'salida'> }[] = [
  { nombre: 'trazado-logo-bn', imagen: 'logo_bn.png', capa: { modo: 'corte', potencia: '85', velocidad: '500', pasadas: '1', intervalo: '' } },
  { nombre: 'trazado-transparente', imagen: 'logo_transparente.png', capa: { modo: 'grabado', potencia: '35', velocidad: '2500', pasadas: '1', intervalo: '0.5' } },
];

describe('goldens de imágenes vectorizadas (fase 1b)', () => {
  for (const caso of casosGolden()) {
    const r = validarPerfil(caso.perfilPrueba);
    if (!r.ok) throw new Error(r.errores.join(' '));
    const cfg = r.perfil.config;
    const area = tamanoArea(cfg.area);
    const lim = limitesDe(caso);
    for (const m of MUESTRAS) {
      const archivo = caso.archivo.replace(/^cuadricula_/, `${m.nombre}_`);
      const ruta = join(DIR_GOLDEN, archivo);
      describe(`perfil ${caso.perfil}: ${archivo}`, () => {
        const generar = async () => {
          const im = imagenRef(m.imagen);
          const t = await trazarImagen(im.data, im.ancho, im.alto, OPCIONES_POR_DEFECTO, null);
          const figuras = figurasDesdeImportacion(importacionDeTrazado(t), area);
          const capas = sincronizarCapas(figuras, [], (color) => ({ color, ...m.capa, visible: true, salida: true }));
          expect(capas).toHaveLength(1); // todo en una sola capa
          const w = trabajoDesdeProyecto({ material: 'Prueba', figuras, capas }, area);
          if (!w.ok) throw new Error(w.error);
          return gcodeABytes(generarGcode(w.trabajo, cfg));
        };

        it('coincide byte por byte con el golden y es determinista', async () => {
          const bytes = await generar();
          if (ACTUALIZAR || !existsSync(ruta)) writeFileSync(ruta, bytes);
          expect(sha256(await generar())).toBe(sha256(bytes));
          expect(sha256(bytes)).toBe(sha256(readFileSync(ruta)));
        });

        it('el nombre entra en el patrón del CI (*_<perfil>_*.gcode)', () => {
          expect(archivo).toMatch(new RegExp(`^[^_]+_${caso.perfil}_[^_]+\\.gcode$`));
        });

        it(`pasa gcode_lint.py --max-s ${lim.sMax} --area=${lim.area.join(',')}`, () => {
          const res = lint(ruta, lim);
          expect(res.salida).toMatch(/^OK /);
          expect(res.salida).toContain('0 errores, 0 avisos');
          expect(res.codigo).toBe(0);
        });

        it('control negativo: el lint falla con un área desplazada', () => {
          const [x0, y0, x1, y1] = lim.area;
          const res = lint(ruta, { ...lim, area: [x0 + 50, y0 + 50, x1 + 50, y1 + 50] });
          expect(res.codigo).toBe(1);
          expect(res.salida).toContain('OUT_OF_BED');
        });
      });
    }
  }
});
