import { describe, expect, it } from 'vitest';
import { generarGcode, numeroPositivo, validarConfigMaquina, ErrorGcode } from '../../src/gcode';

const base = { sMax: '1000', camaAncho: '400', camaAlto: '400', laserMode32: '' };
const INVALIDOS: [string, unknown][] = [
  ['vacío', ''],
  ['espacios', '   '],
  ['cero', '0'],
  ['cero decimal', '0.0'],
  ['negativo', '-1'],
  ['NaN', 'NaN'],
  ['texto', 'abc'],
  ['número y texto', '12abc'],
  ['infinito', 'Infinity'],
  ['undefined', undefined],
  ['null', null],
  ['número NaN', Number.NaN],
  ['número negativo', -5],
  ['número cero', 0],
];

describe('configuración de la máquina', () => {
  it('acepta valores válidos y guarda $32 solo como dato', () => {
    const r = validarConfigMaquina({ ...base, laserMode32: '1' });
    expect(r).toEqual({ ok: true, config: { sMax: 1000, camaAncho: 400, camaAlto: 400, laserMode32: 1 } });
    const r2 = validarConfigMaquina(base);
    expect(r2.ok && r2.config.laserMode32).toBe(null);
  });

  it('acepta coma decimal', () => {
    expect(numeroPositivo('12,5')).toBe(12.5);
  });

  it('sin configuración no hay valores por defecto', () => {
    expect(validarConfigMaquina(undefined).ok).toBe(false);
    expect(validarConfigMaquina({}).ok).toBe(false);
  });

  for (const campo of ['sMax', 'camaAncho', 'camaAlto'] as const) {
    for (const [nombre, valor] of INVALIDOS) {
      it(`bloquea con ${campo} ${nombre}`, () => {
        const r = validarConfigMaquina({ ...base, [campo]: valor });
        expect(r.ok).toBe(false);
        // El generador tampoco exporta con esa configuración.
        const m = { sMax: 1000, camaAncho: 400, camaAlto: 400, laserMode32: null, [campo]: valor } as never;
        expect(() => generarGcode({ capas: [] }, m)).toThrow(ErrorGcode);
      });
    }
  }
});
