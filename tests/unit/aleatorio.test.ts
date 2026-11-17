// Trabajos aleatorios (con semilla fija) pasados por el validador de QA sin --laser-mode.
// Configuraciones de PRUEBA, no son los valores reales de la máquina de Angel.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gcodeABytes, generarGcode, type ModoLaser, type Trabajo } from '../../src/gcode';
import { lint, type MaquinaPrueba } from '../util';

function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trabajoAleatorio(r: () => number, m: MaquinaPrueba): Trabajo {
  const capas: Trabajo['capas'] = [];
  const nCapas = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nCapas; i++) {
    const trayectorias = [];
    const n = Math.floor(r() * 6);
    for (let j = 0; j < n; j++) {
      const pts = [];
      const k = 1 + Math.floor(r() * 8);
      for (let p = 0; p < k; p++) pts.push({ x: r() * m.camaAncho, y: r() * m.camaAlto });
      trayectorias.push(pts);
    }
    const modo: ModoLaser = r() < 0.5 ? 'M3' : 'M4';
    capas.push({
      capa: { potencia: r() * 140 - 20, velocidad: 1 + r() * 6000, pasadas: 1 + Math.floor(r() * 3), modo },
      trayectorias,
    });
  }
  return { capas };
}

const dir = mkdtempSync(join(tmpdir(), 'chopilaser-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MAQUINAS_PRUEBA: MaquinaPrueba[] = [
  { sMax: 1000, laserMode32: null, camaAncho: 400, camaAlto: 400 },
  { sMax: 255, laserMode32: 0, camaAncho: 300, camaAlto: 200 },
];

for (const m of MAQUINAS_PRUEBA) {
  describe(`200 trabajos aleatorios con sMax de prueba ${m.sMax}`, () => {
    it('todos pasan el validador', () => {
      const r = mulberry32(m.sMax);
      const archivos: string[] = [];
      for (let i = 0; i < 200; i++) {
        const f = join(dir, `s${m.sMax}_${i}.gcode`);
        writeFileSync(f, gcodeABytes(generarGcode(trabajoAleatorio(r, m), m)));
        archivos.push(f);
      }
      // Un solo proceso de Python para todos los archivos.
      const res = lint(archivos, m);
      expect(res.salida).not.toContain('FAIL');
      expect(res.salida).not.toMatch(/^\s+aviso /m);
      expect(res.salida.match(/^OK /gm)).toHaveLength(200);
      expect(res.codigo).toBe(0);
    }, 60_000);
  });
}
