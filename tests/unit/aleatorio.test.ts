// Trabajos aleatorios (con semilla fija) pasados por el validador de QA sin --laser-mode.
// Configuraciones de PRUEBA, no son los valores reales de la máquina de Angel.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gcodeABytes, generarGcode, type ModoLaser, type Trabajo } from '../../src/gcode';
import { lint } from '../util';
import type { ConfigMaquina } from '../../src/gcode';

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

function trabajoAleatorio(r: () => number, m: ConfigMaquina): Trabajo {
  const ancho = m.area.xMax - m.area.xMin;
  const alto = m.area.yMax - m.area.yMin;
  const capas: Trabajo['capas'] = [];
  const nCapas = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nCapas; i++) {
    const trayectorias = [];
    const n = Math.floor(r() * 6);
    for (let j = 0; j < n; j++) {
      const pts = [];
      const k = 1 + Math.floor(r() * 8);
      for (let p = 0; p < k; p++) pts.push({ x: r() * ancho, y: r() * alto });
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

const MAQUINAS_PRUEBA: ConfigMaquina[] = [
  { sMax: 1000, laserMode32: null, area: { xMin: 0, yMin: 0, xMax: 400, yMax: 400 } },
  { sMax: 255, laserMode32: 0, area: { xMin: -300, yMin: -200, xMax: 0, yMax: 0 } },
  { sMax: 1, laserMode32: 1, area: { xMin: 10, yMin: 20, xMax: 310, yMax: 220 } },
];

for (const m of MAQUINAS_PRUEBA) {
  describe(`200 trabajos aleatorios con sMax de prueba ${m.sMax}`, () => {
    it('todos pasan el validador', () => {
      const r = mulberry32(Math.round(m.sMax * 7919));
      const archivos: string[] = [];
      for (let i = 0; i < 200; i++) {
        const f = join(dir, `s${m.sMax}_${i}.gcode`);
        writeFileSync(f, gcodeABytes(generarGcode(trabajoAleatorio(r, m), m)));
        archivos.push(f);
      }
      // Un solo proceso de Python para todos los archivos.
      const { xMin, yMin, xMax, yMax } = m.area;
      const res = lint(archivos, { sMax: m.sMax, area: [xMin, yMin, xMax, yMax] });
      expect(res.salida).not.toContain('FAIL');
      expect(res.salida).not.toMatch(/^\s+aviso /m);
      expect(res.salida.match(/^OK /gm)).toHaveLength(200);
      expect(res.codigo).toBe(0);
    }, 60_000);
  });
}
