// @vitest-environment happy-dom
// Goldens de la fase 1: proyectos de muestra (importar -> mover/girar -> capas -> generador
// seguro), uno por perfil de PRUEBA. Pasan el validador de QA (tools/gcode_lint.py) SIN
// --laser-mode, con los mismos --max-s y --area= que el CI.
// Para regenerar: ACTUALIZAR_GOLDEN=1 npx vitest run tests/unit/proyectos-golden.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gcodeABytes, generarGcode, tamanoArea, validarPerfil } from '../../src/gcode';
import { figurasDesdeImportacion, sincronizarCapas, trabajoDesdeProyecto, type CapaProyecto, type Proyecto } from '../../src/diseno/proyecto';
import { importarSvg } from '../../src/importar/svg';
import { importarDxf } from '../../src/importar/dxf';
import { casosGolden, DIR_GOLDEN, limitesDe, lint, RAIZ, sha256 } from '../util';

const ACTUALIZAR = process.env.ACTUALIZAR_GOLDEN === '1';

interface AjusteCapa {
  modo: 'corte' | 'grabado';
  potencia: string;
  velocidad: string;
  pasadas: string;
  intervalo?: string;
  salida?: boolean;
}
interface ProyectoMuestra {
  nombre: string;
  archivo: string;
  mover: [number, number];
  giros: Record<string, number>;
  capas: Record<string, AjusteCapa>;
}

const proyectos: ProyectoMuestra[] = JSON.parse(readFileSync(join(DIR_GOLDEN, 'proyectos.json'), 'utf8')).proyectos;

export function proyectoDeMuestra(m: ProyectoMuestra, area: { ancho: number; alto: number }): Proyecto {
  const texto = readFileSync(join(RAIZ, 'tests', 'muestras', m.archivo), 'utf8');
  const imp = m.archivo.endsWith('.dxf') ? importarDxf(texto) : importarSvg(texto);
  const figuras = figurasDesdeImportacion(imp, area).map((f, i) => ({
    ...f,
    id: `f${i}`,
    x: f.x + m.mover[0],
    y: f.y + m.mover[1],
    angulo: m.giros[String(i)] ?? 0,
  }));
  const capas = sincronizarCapas(figuras, [], (color): CapaProyecto => {
    const a = m.capas[color];
    if (!a) throw new Error(`falta la capa ${color} en proyectos.json`);
    return { color, modo: a.modo, potencia: a.potencia, velocidad: a.velocidad, pasadas: a.pasadas, intervalo: a.intervalo ?? '', visible: true, salida: a.salida ?? true };
  });
  return { material: 'Prueba', figuras, capas };
}

describe('goldens de proyectos (fase 1)', () => {
  it('hay dos proyectos de muestra', () => {
    expect(proyectos.map((p) => p.nombre)).toEqual(['llavero', 'placa']);
  });

  for (const caso of casosGolden()) {
    const r = validarPerfil(caso.perfilPrueba);
    if (!r.ok) throw new Error(r.errores.join(' '));
    const cfg = r.perfil.config;
    const lim = limitesDe(caso);
    for (const m of proyectos) {
      const archivo = caso.archivo.replace(/^cuadricula_/, `proyecto-${m.nombre}_`);
      const ruta = join(DIR_GOLDEN, archivo);
      describe(`perfil ${caso.perfil}: ${archivo}`, () => {
        const t = trabajoDesdeProyecto(proyectoDeMuestra(m, tamanoArea(cfg.area)), tamanoArea(cfg.area));
        if (!t.ok) throw new Error(t.error);
        const bytes = gcodeABytes(generarGcode(t.trabajo, cfg));

        it('coincide byte por byte con el golden', () => {
          if (ACTUALIZAR || !existsSync(ruta)) writeFileSync(ruta, bytes);
          const golden = readFileSync(ruta);
          expect(sha256(bytes)).toBe(sha256(golden));
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

        it('control negativo: el lint falla con un $30 menor', () => {
          const res = lint(ruta, { ...lim, sMax: lim.sMax * 0.79 });
          expect(res.codigo).toBe(1);
          expect(res.salida).toContain('S_OVER_MAX');
        });

        it('control negativo: el lint falla con un área desplazada', () => {
          const [x0, y0, x1, y1] = lim.area;
          const res = lint(ruta, { ...lim, area: [x0 + 50, y0 + 50, x1 + 50, y1 + 50] });
          expect(res.codigo).toBe(1);
          expect(res.salida).toContain('OUT_OF_BED');
        });

        if (m.nombre === 'llavero') {
          it('el grabado va antes que el corte (M4 antes del primer M3)', () => {
            const txt = new TextDecoder().decode(bytes);
            expect(txt.indexOf('M4')).toBeGreaterThan(-1);
            expect(txt.indexOf('M4')).toBeLessThan(txt.indexOf('M3'));
          });
        }
        if (m.nombre === 'placa') {
          it('la capa con la salida apagada no se exporta (solo una potencia)', () => {
            const txt = new TextDecoder().decode(bytes);
            const potencias = new Set([...txt.matchAll(/^G1 .*S([\d.]+)/gm)].map((x) => x[1]));
            expect(potencias.size).toBeLessThanOrEqual(1);
          });
        }
      });
    }
  }
});
