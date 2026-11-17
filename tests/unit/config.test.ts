import { describe, expect, it } from 'vitest';
import {
  areaDesdeCama,
  erroresConfigMaquina,
  ErrorGcode,
  generarGcode,
  leerSalidaDolarDolar,
  numeroFinito,
  numeroPositivo,
  PRESET_GRBL11,
  MENSAJES,
  validarPerfil,
} from '../../src/gcode';
import { leerAlmacen, perfilActivo, CLAVE_PERFILES } from '../../src/perfiles';

// Perfil de PRUEBA, no son los valores reales de la máquina de Angel.
const base = { nombre: 'Prueba', sMax: '1000', camaAncho: '400', camaAlto: '400', origen: 'inferior-izquierda', laserMode32: '' };
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

describe('perfil de máquina', () => {
  it('acepta valores válidos y guarda $32 solo como dato', () => {
    const r = validarPerfil({ ...base, laserMode32: '1' });
    expect(r).toEqual({
      ok: true,
      perfil: { nombre: 'Prueba', config: { sMax: 1000, laserMode32: 1, area: { xMin: 0, yMin: 0, xMax: 400, yMax: 400 } } },
    });
    const r2 = validarPerfil(base);
    expect(r2.ok && r2.perfil.config.laserMode32).toBe(null);
  });

  it('acepta coma decimal y negativos donde corresponde', () => {
    expect(numeroPositivo('12,5')).toBe(12.5);
    expect(numeroFinito('-300')).toBe(-300);
    expect(numeroPositivo('-300')).toBe(null);
  });

  it('sin perfil no hay valores por defecto', () => {
    expect(validarPerfil(undefined).ok).toBe(false);
    expect(validarPerfil({}).ok).toBe(false);
  });

  it('errores por campo con los textos finales', () => {
    const r = validarPerfil({ ...base, nombre: '', sMax: '', camaAncho: 'abc', camaAlto: '-1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.porCampo).toEqual({
      nombre: 'Este dato hace falta.',
      sMax: 'Este dato hace falta.',
      camaAncho: 'Escribe un número mayor que 0.',
      camaAlto: 'Escribe un número mayor que 0.',
    });
    const r2 = validarPerfil({ ...base, origen: '' });
    expect(!r2.ok && r2.porCampo.origen).toBe('Este dato hace falta.');
    expect(MENSAJES.exportarSinPerfil).toBe('Antes de exportar, configura tu máquina.');
  });

  it('el nombre es obligatorio', () => {
    expect(validarPerfil({ ...base, nombre: '  ' }).ok).toBe(false);
  });

  it('la esquina del origen es obligatoria', () => {
    expect(validarPerfil({ ...base, origen: '' }).ok).toBe(false);
    expect(validarPerfil({ ...base, origen: 'centro' }).ok).toBe(false);
  });

  for (const campo of ['sMax', 'camaAncho', 'camaAlto'] as const) {
    for (const [nombre, valor] of INVALIDOS) {
      it(`bloquea con ${campo} ${nombre}`, () => {
        expect(validarPerfil({ ...base, [campo]: valor }).ok).toBe(false);
      });
    }
  }

  it('el generador también rechaza sMax no válido', () => {
    for (const sMax of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.0001]) {
      const cfg = { sMax, laserMode32: null, area: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } };
      expect(erroresConfigMaquina(cfg).length).toBeGreaterThan(0);
      expect(() => generarGcode({ capas: [] }, cfg)).toThrow(ErrorGcode);
    }
  });

  it('el generador rechaza áreas vacías, invertidas o con NaN', () => {
    for (const area of [
      { xMin: 0, yMin: 0, xMax: 0, yMax: 10 },
      { xMin: 0, yMin: 10, xMax: 10, yMax: 0 },
      { xMin: Number.NaN, yMin: 0, xMax: 10, yMax: 10 },
    ]) {
      expect(() => generarGcode({ capas: [] }, { sMax: 1000, laserMode32: null, area })).toThrow(ErrorGcode);
    }
  });
});

describe('área de trabajo', () => {
  it('se deriva de la esquina del origen', () => {
    expect(areaDesdeCama(300, 200, 'inferior-izquierda')).toEqual({ xMin: 0, yMin: 0, xMax: 300, yMax: 200 });
    expect(areaDesdeCama(300, 200, 'superior-derecha')).toEqual({ xMin: -300, yMin: -200, xMax: 0, yMax: 0 });
    expect(areaDesdeCama(300, 200, 'superior-izquierda')).toEqual({ xMin: 0, yMin: -200, xMax: 300, yMax: 0 });
    expect(areaDesdeCama(300, 200, 'inferior-derecha')).toEqual({ xMin: -300, yMin: 0, xMax: 0, yMax: 200 });
  });

  it('personalizada usa xmin, ymin, xmax, ymax', () => {
    const r = validarPerfil({ nombre: 'P', sMax: '1', origen: 'personalizada', xMin: '-10', yMin: '-5,5', xMax: '10', yMax: '0' });
    expect(r.ok && r.perfil.config.area).toEqual({ xMin: -10, yMin: -5.5, xMax: 10, yMax: 0 });
  });

  it('personalizada rechaza valores vacíos, texto o un área invertida', () => {
    const p = { nombre: 'P', sMax: '1', origen: 'personalizada', xMin: '0', yMin: '0', xMax: '10', yMax: '10' };
    expect(validarPerfil(p).ok).toBe(true);
    expect(validarPerfil({ ...p, xMin: '' }).ok).toBe(false);
    expect(validarPerfil({ ...p, yMax: 'abc' }).ok).toBe(false);
    expect(validarPerfil({ ...p, xMax: '-1' }).ok).toBe(false);
    expect(validarPerfil({ ...p, yMin: '10' }).ok).toBe(false);
  });
});

describe('preset de GRBL 1.1 y salida de $$', () => {
  it('el preset tiene los valores de fábrica de GRBL 1.1', () => {
    // Solo $30 y $32: el área, el origen y el nombre los escribe el usuario.
    expect(PRESET_GRBL11).toEqual({ sMax: '1000', laserMode32: '0' });
  });

  it('lee $30, $32, $130 y $131 de la salida de $$', () => {
    const salida = '$0=10\r\n$30=1000\n$31=0\n$32=1\n$100=80.000\n$130=410.000\n$131=400.500\n$132=50.000\nok\n';
    expect(leerSalidaDolarDolar(salida)).toEqual({ sMax: '1000', laserMode32: '1', camaAncho: '410', camaAlto: '400.5' });
  });

  it('con texto sin ajustes no devuelve nada', () => {
    expect(leerSalidaDolarDolar('hola\n$$\nok')).toEqual({});
  });
});

describe('almacén de perfiles', () => {
  const almacen = (v: unknown) => ({ getItem: (k: string) => (k === CLAVE_PERFILES ? JSON.stringify(v) : null) });

  it('vacío o dañado: no hay perfil activo', () => {
    expect(perfilActivo(leerAlmacen({ getItem: () => null }))).toBe(null);
    expect(perfilActivo(leerAlmacen({ getItem: () => '{no es json' }))).toBe(null);
  });

  it('un perfil guardado con $30 inválido no se usa', () => {
    expect(perfilActivo(leerAlmacen(almacen({ activo: 0, perfiles: [{ ...base, sMax: '0' }] })))).toBe(null);
  });

  it('devuelve el perfil activo validado', () => {
    const a = leerAlmacen(almacen({ activo: 1, perfiles: [base, { ...base, nombre: 'Otro', sMax: '255' }] }));
    expect(perfilActivo(a)?.nombre).toBe('Otro');
    expect(perfilActivo(a)?.config.sMax).toBe(255);
  });
});
