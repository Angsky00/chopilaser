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
  ORIGENES,
  MAX_S,
  MAX_DIMENSION_MM,
  mascara23,
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
      perfil: {
        nombre: 'Prueba',
        config: { sMax: 1000, laserMode32: 1, area: { xMin: 0, yMin: 0, xMax: 400, yMax: 400 } },
        homing23: null,
      },
    });
    const r2 = validarPerfil(base);
    expect(r2.ok && r2.perfil.config.laserMode32).toBe(null);
  });

  it('acepta negativos donde corresponde y solo el punto como decimal', () => {
    expect(numeroPositivo('12.5')).toBe(12.5);
    expect(numeroFinito('-300')).toBe(-300);
    expect(numeroPositivo('-300')).toBe(null);
    // La coma no se adivina: «1,000» no es 1 ni 1000.
    for (const v of ['1,000', '12,5', '1,000.5', '-5,5']) {
      expect(numeroFinito(v)).toBe(null);
      expect(numeroPositivo(v)).toBe(null);
    }
  });

  it('una coma en un campo da «Escribe un número.»', () => {
    const r = validarPerfil({ ...base, sMax: '1,000', camaAncho: '12,5', camaAlto: '400' });
    expect(!r.ok && r.porCampo).toEqual({ sMax: 'Escribe un número.', camaAncho: 'Escribe un número.' });
    const r2 = validarPerfil({ nombre: 'P', sMax: '1', origen: 'personalizada', xMin: '-10', yMin: '-5,5', xMax: '10', yMax: '0' });
    expect(!r2.ok && r2.porCampo).toEqual({ yMin: 'Escribe un número.' });
  });

  it('topes: $30 hasta MAX_S y cada dimensión hasta MAX_DIMENSION_MM', () => {
    expect(MAX_S).toBe(100000);
    // $30 = 0 se rechaza (no es «hasta 100000» desde 0).
    for (const v of ['0', '0.0', '-0', '0.0001'])
      expect(validarPerfil({ ...base, sMax: v }).ok, v).toBe(false);
    expect(erroresConfigMaquina({ sMax: 0, laserMode32: null, area: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } })).not.toEqual([]);
    expect(MAX_DIMENSION_MM).toBe(5000);
    expect(validarPerfil({ ...base, sMax: '100000', camaAncho: '5000', camaAlto: '5000' }).ok).toBe(true);
    const r = validarPerfil({ ...base, sMax: '100000.001', camaAncho: '5000.001', camaAlto: '1e9' });
    expect(!r.ok && r.porCampo).toEqual({
      sMax: 'Escribe un número mayor que 0 y hasta 100000.',
      camaAncho: 'Escribe un número mayor que 0 y hasta 5000.',
      camaAlto: 'Escribe un número mayor que 0.',
    });
    expect(validarPerfil({ ...base, camaAlto: '99999' }).ok).toBe(false);
    const av = { nombre: 'P', sMax: '1', origen: 'personalizada' };
    expect(validarPerfil({ ...av, xMin: '-5000', yMin: '-2500', xMax: '0', yMax: '2500' }).ok).toBe(true);
    const r2 = validarPerfil({ ...av, xMin: '-3000', yMin: '-3000', xMax: '3000', yMax: '2001' });
    expect(!r2.ok && r2.porCampo).toEqual({
      xMax: 'El área no puede medir más de 5000 mm de ancho.',
      yMax: 'El área no puede medir más de 5000 mm de fondo.',
    });
    const r3 = validarPerfil({ ...av, xMin: '-5001', yMin: '0', xMax: '0', yMax: '10' });
    expect(!r3.ok && r3.porCampo).toEqual({ xMin: 'Escribe un número entre -5000 y 5000.' });
    // El generador también rechaza configuraciones fuera de tope.
    expect(erroresConfigMaquina({ sMax: 100001, laserMode32: null, area: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 } })).not.toEqual([]);
    expect(erroresConfigMaquina({ sMax: 1000, laserMode32: null, area: { xMin: 0, yMin: 0, xMax: 5001, yMax: 10 } })).not.toEqual([]);
    expect(erroresConfigMaquina({ sMax: 1000, laserMode32: null, area: { xMin: 0, yMin: 0, xMax: 5000, yMax: 5000 } })).toEqual([]);
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

  it('nombre: hasta 60 caracteres y sin repetir', () => {
    expect(validarPerfil({ ...base, nombre: 'n'.repeat(60) }).ok).toBe(true);
    const r = validarPerfil({ ...base, nombre: 'n'.repeat(61) });
    expect(!r.ok && r.porCampo.nombre).toBe('El nombre puede tener hasta 60 caracteres.');
    const r2 = validarPerfil({ ...base, nombre: '  PRUEBA ' }, ['Otro', 'prueba']);
    expect(!r2.ok && r2.porCampo.nombre).toBe('Ya hay un perfil con ese nombre.');
    expect(validarPerfil(base, ['Otro']).ok).toBe(true);
  });

  it('la configuración usa la misma redacción de topes que los campos', () => {
    const area = (xMax: number, yMax: number) => ({ xMin: 0, yMin: 0, xMax, yMax });
    expect(erroresConfigMaquina({ sMax: 1000, laserMode32: null, area: area(5001, 10) })).toEqual([
      'El área no puede medir más de 5000 mm de ancho.',
      'Escribe un número entre -5000 y 5000.',
    ]);
    expect(erroresConfigMaquina({ sMax: 1000, laserMode32: null, area: area(10, 5001) })).toEqual([
      'El área no puede medir más de 5000 mm de fondo.',
      'Escribe un número entre -5000 y 5000.',
    ]);
    expect(erroresConfigMaquina({ sMax: 100001, laserMode32: null, area: area(10, 10) })).toEqual(['Escribe un número mayor que 0 y hasta 100000.']);
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

  it('textos de las opciones de origen', () => {
    expect(ORIGENES.map((o) => o.texto)).toEqual([
      'Abajo a la izquierda',
      'Abajo a la derecha',
      'Arriba a la izquierda',
      'Arriba a la derecha',
      'Avanzado: área por coordenadas (mm)',
    ]);
  });

  it('personalizada usa xmin, ymin, xmax, ymax', () => {
    const r = validarPerfil({ nombre: 'P', sMax: '1', origen: 'personalizada', xMin: '-10', yMin: '-5.5', xMax: '10', yMax: '0' });
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

  it('lee $23 como dato', () => {
    expect(leerSalidaDolarDolar('$23=3\n$30=1000\n')).toEqual({ homing23: '3', sMax: '1000' });
    expect(mascara23('3')).toBe(3);
    expect(mascara23('256')).toBe(null);
    expect(mascara23('1.5')).toBe(null);
    expect(mascara23('')).toBe(null);
    const r = validarPerfil({ ...base, homing23: '3' });
    expect(r.ok && r.perfil.homing23).toBe(3);
  });

  it('ignora (no recorta) valores que no son números estrictos', () => {
    const salida = '$30=1e3\n$130=4.0.0\n$131=400abc\n$23=1.5\n$32=2\n$30=+100\n$131=.5\n$130=5.\n';
    expect(leerSalidaDolarDolar(salida)).toEqual({});
    expect(leerSalidaDolarDolar('$130=-300.25\n$30=1000 (spindle max, rpm)\n')).toEqual({ camaAncho: '-300.25', sMax: '1000' });
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
