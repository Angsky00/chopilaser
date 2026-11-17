import { describe, expect, it } from 'vitest';
import {
  ErrorGcode,
  gcodeABytes,
  generarCuadricula,
  generarGcode,
  milesimasFijas,
  potenciaAS,
  type Capa,
  type ConfigMaquina,
  type Trabajo,
} from '../../src/gcode';

// Configuraciones de PRUEBA, no son los valores reales de la máquina de Angel.
const MAQUINAS_PRUEBA: ConfigMaquina[] = [
  { sMax: 1000, laserMode32: null, camaAncho: 400, camaAlto: 400 },
  { sMax: 255, laserMode32: 0, camaAncho: 300, camaAlto: 200 },
];

const capa = (c: Partial<Capa> = {}): Capa => ({ potencia: 50, velocidad: 1200, pasadas: 1, modo: 'M3', ...c });
const cuadrado: Trabajo = {
  capas: [
    {
      capa: capa(),
      trayectorias: [
        [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 10, y: 20 },
          { x: 10, y: 10 },
        ],
      ],
    },
  ],
};
const lineas = (g: string) => g.split('\n').slice(0, -1);
const valoresS = (g: string) => [...g.matchAll(/^[^;]*?S(\d+(?:\.\d+)?)/gm)].map((m) => Number(m[1]));

for (const maq of MAQUINAS_PRUEBA) {
  describe(`generador con sMax de prueba ${maq.sMax}`, () => {
    const grid = generarGcode(generarCuadricula({ ancho: maq.camaAncho, alto: maq.camaAlto }), maq);

    it('100 % da exactamente sMax y 0 % da S0', () => {
      expect(potenciaAS(100, maq.sMax)).toBe(String(maq.sMax));
      expect(potenciaAS(0, maq.sMax)).toBe('0');
    });

    it('limita S: más de 100 % no pasa de sMax y menos de 0 % queda en S0', () => {
      expect(potenciaAS(150, maq.sMax)).toBe(String(maq.sMax));
      expect(potenciaAS(1e9, maq.sMax)).toBe(String(maq.sMax));
      expect(potenciaAS(-20, maq.sMax)).toBe('0');
      expect(potenciaAS(-0, maq.sMax)).toBe('0');
    });

    it('rechaza potencia NaN', () => {
      expect(() => potenciaAS(Number.NaN, maq.sMax)).toThrow(ErrorGcode);
    });

    it('ninguna S del archivo pasa de sMax, y aparecen los extremos', () => {
      const s = valoresS(grid);
      expect(Math.max(...s)).toBe(maq.sMax);
      expect(s).toContain(0);
      expect(grid).toContain(`M3 S${maq.sMax}\n`);
      expect(grid).toContain(`M4 S${maq.sMax}\n`);
      expect(grid).toContain('M3 S0\n');
      expect(grid).toContain('M4 S0\n');
    });

    it('cabecera G21 G90 antes de cualquier movimiento', () => {
      const l = lineas(grid).filter((x) => !x.startsWith(';'));
      expect(l[0]).toBe('G21 G90');
      expect(l[1]).toBe('M5 S0');
    });

    it('S0 justo antes de cada G0, aunque $32 sea 0 o desconocido', () => {
      const l = lineas(grid);
      let n = 0;
      l.forEach((x, i) => {
        if (/^G0\b/.test(x)) {
          n++;
          expect(l[i - 1]).toBe('S0');
        }
      });
      expect(n).toBeGreaterThan(0);
    });

    it('F antes (o en) el primer G1 de cada trayectoria', () => {
      const l = lineas(grid);
      l.forEach((x, i) => {
        if (/^G0\b/.test(x)) expect(l[i + 2]).toMatch(/^G1 .* F\d/);
      });
      const primerG1 = l.find((x) => /^G1\b/.test(x));
      expect(primerG1).toMatch(/ F\d/);
    });

    it('termina con M5 y S0', () => {
      expect(grid.endsWith('M5\nS0\n')).toBe(true);
    });

    it('sin NaN ni Infinity ni coordenadas negativas', () => {
      expect(grid).not.toMatch(/NaN|Infinity|undefined/);
      expect(grid).not.toMatch(/[XYSF]-/);
    });

    it('coordenadas con 3 decimales fijos', () => {
      for (const m of grid.matchAll(/[XY](\S+)/g)) expect(m[1]).toMatch(/^\d+\.\d{3}$/);
    });

    it('solo ASCII, sin BOM y con LF', () => {
      const bytes = gcodeABytes(grid);
      expect(bytes[0]).not.toBe(0xef);
      expect(bytes.every((b) => b === 0x0a || (b >= 0x20 && b <= 0x7e))).toBe(true);
      expect(grid).not.toContain('\r');
      expect(grid.endsWith('\n')).toBe(true);
    });

    it('rechaza coordenadas fuera de la cama, negativas o NaN', () => {
      const con = (x: number, y: number): Trabajo => ({
        capas: [{ capa: capa(), trayectorias: [[{ x: 1, y: 1 }, { x, y }]] }],
      });
      expect(() => generarGcode(con(maq.camaAncho + 0.001, 1), maq)).toThrow(ErrorGcode);
      expect(() => generarGcode(con(1, maq.camaAlto + 1), maq)).toThrow(ErrorGcode);
      expect(() => generarGcode(con(-0.001, 1), maq)).toThrow(ErrorGcode);
      expect(() => generarGcode(con(Number.NaN, 1), maq)).toThrow(ErrorGcode);
      expect(() => generarGcode(con(1, Number.POSITIVE_INFINITY), maq)).toThrow(ErrorGcode);
      // El borde exacto de la cama sí es válido.
      expect(() => generarGcode(con(maq.camaAncho, maq.camaAlto), maq)).not.toThrow();
    });
  });
}

describe('generador: detalles', () => {
  const maq = MAQUINAS_PRUEBA[0];

  it('produce el cuadrado esperado', () => {
    const g = generarGcode(cuadrado, maq);
    expect(lineas(g).filter((x) => !x.startsWith(';'))).toEqual([
      'G21 G90',
      'M5 S0',
      'S0',
      'G0 X10.000 Y10.000',
      'M3 S500',
      'G1 X20.000 Y10.000 F1200',
      'G1 X20.000 Y20.000',
      'G1 X10.000 Y20.000',
      'G1 X10.000 Y10.000',
      'M5',
      'S0',
    ]);
  });

  it('redondeo fijo a 3 decimales (mitad hacia arriba)', () => {
    expect(milesimasFijas(0)).toBe('0.000');
    expect(milesimasFijas(12345)).toBe('12.345');
    const g = generarGcode(
      { capas: [{ capa: capa(), trayectorias: [[{ x: 1.0004, y: 2.0005 }, { x: 0.1 + 0.2, y: 1 / 3 }]] }] },
      maq,
    );
    expect(g).toContain('G0 X1.000 Y2.001');
    expect(g).toContain('G1 X0.300 Y0.333 F1200');
  });

  it('un -0 o un negativo diminuto que redondea a 0 es válido', () => {
    const g = generarGcode({ capas: [{ capa: capa(), trayectorias: [[{ x: -0, y: -0.0001 }, { x: 1, y: 1 }]] }] }, maq);
    expect(g).toContain('G0 X0.000 Y0.000');
  });

  it('S proporcional y redondeado con sMax de prueba 255', () => {
    expect(potenciaAS(50, 255)).toBe('127.5');
    expect(potenciaAS(25, 255)).toBe('63.75');
    expect(potenciaAS(33.3333, 255)).toBe('85');
  });

  it('S nunca pasa de un sMax con decimales', () => {
    expect(potenciaAS(100, 0.0015)).toBe('0.001');
    expect(Number(potenciaAS(99.99, 1.9999))).toBeLessThanOrEqual(1.9999);
  });

  it('respeta las pasadas y el modo', () => {
    const g = generarGcode({ capas: [{ ...cuadrado.capas[0], capa: capa({ pasadas: 3, modo: 'M4' }) }] }, maq);
    expect(g.match(/^G0 /gm)).toHaveLength(3);
    expect(g.match(/^M4 S500$/gm)).toHaveLength(3);
    expect(g).not.toMatch(/^M3/m);
  });

  it('rechaza capas no válidas', () => {
    const con = (c: Partial<Capa>) => generarGcode({ capas: [{ ...cuadrado.capas[0], capa: capa(c) }] }, maq);
    expect(() => con({ velocidad: 0 })).toThrow(ErrorGcode);
    expect(() => con({ velocidad: Number.NaN })).toThrow(ErrorGcode);
    expect(() => con({ pasadas: 0 })).toThrow(ErrorGcode);
    expect(() => con({ pasadas: 1.5 })).toThrow(ErrorGcode);
    expect(() => con({ potencia: Number.NaN })).toThrow(ErrorGcode);
    expect(() => con({ modo: 'M5' as never })).toThrow(ErrorGcode);
  });

  it('trabajo vacío sigue siendo seguro', () => {
    expect(generarGcode({ capas: [] }, maq).endsWith('G21 G90\nM5 S0\nM5\nS0\n')).toBe(true);
  });

  it('la cuadrícula no se genera si no cabe en la cama', () => {
    expect(() => generarCuadricula({ ancho: 50, alto: 50 })).toThrow(ErrorGcode);
  });

  it('la cuadrícula tiene celdas al 0 % y al 100 %, en M3 y en M4', () => {
    const t = generarCuadricula({ ancho: 400, alto: 400 });
    const c = t.capas.map((x) => x.capa);
    for (const modo of ['M3', 'M4'] as const) {
      expect(c.some((x) => x.modo === modo && x.potencia === 100)).toBe(true);
      expect(c.some((x) => x.modo === modo && x.potencia === 0)).toBe(true);
    }
  });

  it('rechaza bytes no ASCII', () => {
    expect(() => gcodeABytes('G0 X1 ñ\n')).toThrow(ErrorGcode);
    expect(() => gcodeABytes('\ufeffG0\n')).toThrow(ErrorGcode);
    expect(() => gcodeABytes('G0\r\n')).toThrow(ErrorGcode);
  });
});
