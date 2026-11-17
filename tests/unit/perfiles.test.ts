import { describe, expect, it } from 'vitest';
import {
  almacenDanado,
  CLAVE_DANADOS,
  CLAVE_PERFILES,
  combinarImportados,
  escribirAlmacen,
  exportarPerfiles,
  leerAlmacen,
  leerArchivoPerfiles,
  perfilActivo,
} from '../../src/perfiles';

// Perfiles de PRUEBA, no son los valores reales de la máquina de Angel.
const A = { nombre: 'A', sMax: '1000', laserMode32: '1', camaAncho: '400', camaAlto: '400', origen: 'inferior-izquierda' };
const B = { nombre: 'B', sMax: '255', laserMode32: '', origen: 'personalizada', xMin: '-300', yMin: '-200', xMax: '0', yMax: '0', homing23: '3' };

function memoria(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const archivo = (o: Record<string, unknown>) => JSON.stringify({ formato: 'chopilaser-perfiles', version: 1, activo: 0, ...o });

describe('localStorage dañado', () => {
  it('detecta JSON roto o estructura inesperada', () => {
    expect(almacenDanado(memoria())).toBe(false);
    expect(almacenDanado(memoria({ [CLAVE_PERFILES]: JSON.stringify({ activo: 0, perfiles: [A] }) }))).toBe(false);
    for (const v of ['{no es json', '[]', 'null', '"x"', '{"perfiles":3}', '{"perfiles":[1]}', '{"perfiles":[[]]}'])
      expect(almacenDanado(memoria({ [CLAVE_PERFILES]: v })), v).toBe(true);
  });

  it('al guardar encima de datos dañados se conserva una copia', () => {
    const s = memoria({ [CLAVE_PERFILES]: '{no es json' });
    escribirAlmacen(s, { activo: 0, perfiles: [A] });
    expect(s.getItem(CLAVE_DANADOS)).toBe('{no es json');
    expect(almacenDanado(s)).toBe(false);
    expect(perfilActivo(leerAlmacen(s))?.nombre).toBe('A');
    // Si no estaba dañado, no se crea copia.
    const s2 = memoria();
    escribirAlmacen(s2, { activo: 0, perfiles: [A] });
    expect(s2.getItem(CLAVE_DANADOS)).toBe(null);
  });
});

describe('exportar e importar perfiles', () => {
  it('ida y vuelta conserva los perfiles y el activo', () => {
    const texto = exportarPerfiles({ activo: 1, perfiles: [A, B] });
    expect(JSON.parse(texto)).toEqual({ formato: 'chopilaser-perfiles', version: 1, activo: 1, perfiles: [A, B] });
    const r = leerArchivoPerfiles(texto);
    expect(r.ok && r.archivo).toEqual({ formato: 'chopilaser-perfiles', version: 1, activo: 1, perfiles: [A, B] });
  });

  it('exporta solo los perfiles válidos', () => {
    const texto = exportarPerfiles({ activo: 2, perfiles: [A, { ...A, sMax: '0' }, B] });
    expect(JSON.parse(texto)).toMatchObject({ activo: 1, perfiles: [A, B] });
  });

  const MALOS: [string, string, string][] = [
    ['no es JSON', '{', 'el archivo no es JSON válido.'],
    ['otro formato', JSON.stringify({ perfiles: [A] }), 'no es un archivo de perfiles de ChopiLaser.'],
    ['clave extra', archivo({ perfiles: [A], extra: 1 }), 'no es un archivo de perfiles de ChopiLaser.'],
    ['versión', archivo({ version: 2, perfiles: [A] }), 'la versión del archivo no es compatible.'],
    ['sin perfiles', archivo({ perfiles: [] }), 'el archivo no trae perfiles.'],
    ['perfiles no lista', archivo({ perfiles: {} }), 'el archivo no trae perfiles.'],
    ['demasiados', archivo({ perfiles: Array(101).fill(A) }), 'el archivo trae más de 100 perfiles.'],
    ['activo fuera', archivo({ activo: 1, perfiles: [A] }), 'el perfil activo del archivo no existe.'],
    ['activo texto', archivo({ activo: '0', perfiles: [A] }), 'el perfil activo del archivo no existe.'],
    ['perfil no objeto', archivo({ perfiles: [A, 'B'] }), 'el perfil 2 no tiene el formato esperado.'],
    ['dato desconocido', archivo({ perfiles: [{ ...A, potencia: '10' }] }), 'el perfil 1 tiene un dato desconocido («potencia»).'],
    ['número en vez de texto', archivo({ perfiles: [{ ...A, sMax: 1000 }] }), 'el perfil 1 tiene «Potencia máxima» con un valor que no es texto.'],
    ['$30 = 0', archivo({ perfiles: [A, { ...A, nombre: 'A2', sMax: '0' }] }), 'el perfil 2 no es válido (Potencia máxima: Escribe un número mayor que 0.)'],
    ['coma', archivo({ perfiles: [{ ...A, camaAncho: '1,5' }] }), 'el perfil 1 no es válido (Ancho (X): Escribe un número.)'],
    ['tope', archivo({ perfiles: [{ ...A, sMax: '200000' }] }), 'el perfil 1 no es válido (Potencia máxima: Escribe un número mayor que 0 y hasta 100000.)'],
    ['$32 raro', archivo({ perfiles: [{ ...A, laserMode32: '5' }] }), 'el perfil 1 no es válido (Modo láser: debe ser 0 o 1)'],
    ['$23 raro', archivo({ perfiles: [{ ...B, homing23: '1e3' }] }), 'el perfil 1 tiene un $23 que no es válido.'],
    ['sin nombre', archivo({ perfiles: [{ ...A, nombre: ' ' }] }), 'el perfil 1 no es válido (Nombre de la máquina: Este dato hace falta.)'],
  ];
  for (const [caso, texto, motivo] of MALOS) {
    it(`rechaza el archivo entero: ${caso}`, () => {
      expect(leerArchivoPerfiles(texto)).toEqual({ ok: false, error: `No se importó nada: ${motivo}` });
    });
  }

  it('{i} cuenta desde 1: el primer perfil es «perfil 1» y el tercero «perfil 3»', () => {
    const malo = { ...A, nombre: 'Malo', sMax: '' };
    expect(leerArchivoPerfiles(archivo({ perfiles: [malo, A, B] }))).toEqual({
      ok: false,
      error: 'No se importó nada: el perfil 1 no es válido (Potencia máxima: Este dato hace falta.)',
    });
    expect(leerArchivoPerfiles(archivo({ perfiles: [A, B, malo] }))).toEqual({
      ok: false,
      error: 'No se importó nada: el perfil 3 no es válido (Potencia máxima: Este dato hace falta.)',
    });
    expect(leerArchivoPerfiles(archivo({ perfiles: [7, A] }))).toEqual({
      ok: false,
      error: 'No se importó nada: el perfil 1 no tiene el formato esperado.',
    });
    expect(leerArchivoPerfiles(archivo({ perfiles: [{ ...A, extra: 'x' }] }))).toEqual({
      ok: false,
      error: 'No se importó nada: el perfil 1 tiene un dato desconocido («extra»).',
    });
  });

  it('límite de 1 MB en bytes, no en caracteres', () => {
    // 600 000 «ñ» son 600 000 caracteres pero 1 200 000 bytes en UTF-8.
    const texto = archivo({ perfiles: [{ ...A, nombre: 'ñ'.repeat(600_000) }] });
    expect(texto.length).toBeLessThan(1_000_000);
    expect(leerArchivoPerfiles(texto)).toEqual({ ok: false, error: 'No se importó nada: el archivo pasa de 1 MB.' });
  });

  it('nombre de hasta 60 caracteres', () => {
    expect(leerArchivoPerfiles(archivo({ perfiles: [{ ...A, nombre: 'n'.repeat(60) }] })).ok).toBe(true);
    expect(leerArchivoPerfiles(archivo({ perfiles: [{ ...A, nombre: 'n'.repeat(61) }] }))).toEqual({
      ok: false,
      error: 'No se importó nada: el perfil 1 no es válido (Nombre de la máquina: El nombre puede tener hasta 60 caracteres.)',
    });
  });

  it('nombres repetidos: dentro del archivo o con los guardados (sin distinguir mayúsculas ni espacios)', () => {
    expect(leerArchivoPerfiles(archivo({ perfiles: [A, { ...B, nombre: ' a ' }] }))).toEqual({
      ok: false,
      error: 'No se importó nada: el perfil 2 no es válido (Nombre de la máquina: Ya hay un perfil con ese nombre.)',
    });
    expect(leerArchivoPerfiles(archivo({ perfiles: [B] }), ['A', 'b'])).toEqual({
      ok: false,
      error: 'No se importó nada: el perfil 1 no es válido (Nombre de la máquina: Ya hay un perfil con ese nombre.)',
    });
    expect(leerArchivoPerfiles(archivo({ perfiles: [B] }), ['A']).ok).toBe(true);
  });

  it('demasiado grande', () => {
    expect(leerArchivoPerfiles(' '.repeat(1_000_001))).toEqual({ ok: false, error: 'No se importó nada: el archivo pasa de 1 MB.' });
  });

  it('combinar añade sin borrar; sin perfiles válidos toma el activo del archivo', () => {
    const r = leerArchivoPerfiles(archivo({ activo: 1, perfiles: [A, B] }));
    if (!r.ok) throw new Error(r.error);
    expect(combinarImportados({ activo: 0, perfiles: [A] }, r.archivo)).toEqual({ activo: 0, perfiles: [A, A, B] });
    expect(combinarImportados({ activo: 0, perfiles: [] }, r.archivo)).toEqual({ activo: 1, perfiles: [A, B] });
  });
});
