// Un trazo abierto en una capa de corte sale como línea, con su S, y pasa el validador de QA.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gcodeABytes, generarGcode, tamanoArea, validarPerfil } from '../../src/gcode';
import { figuraDesdeTrazos, trabajoDesdeProyecto } from '../../src/diseno/proyecto';
import { casosGolden, limitesDe, lint } from '../util';

describe('trazo abierto en corte', () => {
  for (const caso of casosGolden()) {
    it(`perfil ${caso.perfil}: sale como G1 con S y pasa el lint`, () => {
      const r = validarPerfil(caso.perfilPrueba);
      if (!r.ok) throw new Error(r.errores.join(' '));
      const cfg = r.perfil.config;
      const linea = figuraDesdeTrazos('#f00', [{ cerrado: false, puntos: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 15 }] }]);
      const t = trabajoDesdeProyecto(
        { material: '', figuras: [linea], capas: [{ color: '#f00', modo: 'corte', potencia: '50', velocidad: '600', pasadas: '1', intervalo: '', visible: true, salida: true }] },
        tamanoArea(cfg.area),
      );
      if (!t.ok) throw new Error(t.error);
      const texto = new TextDecoder().decode(gcodeABytes(generarGcode(t.trabajo, cfg)));
      const s = Math.round(cfg.sMax * 0.5 * 1000) / 1000;
      expect(texto).toMatch(new RegExp(`^M3 S${String(s).replace('.', '\\.')}$`, 'm'));
      expect(texto.match(/^G1 /gm)).toHaveLength(2);
      const ruta = join(mkdtempSync(join(tmpdir(), 'chopi-')), 'abierto.gcode');
      writeFileSync(ruta, texto);
      const res = lint(ruta, limitesDe(caso));
      expect(res.salida).toContain('0 errores, 0 avisos');
      expect(res.codigo).toBe(0);
    });
  }
});
