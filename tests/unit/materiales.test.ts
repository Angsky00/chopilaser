import { describe, expect, it } from 'vitest';
import {
  CLAVE_MATERIALES,
  CLAVE_MATERIALES_DANADOS,
  errorAjuste,
  errorNombreMaterial,
  escribirMateriales,
  exportarMateriales,
  leerArchivoMateriales,
  leerMateriales,
  MAX_BYTES_MATERIALES,
  MAX_MATERIALES_ARCHIVO,
  materialesDanados,
  materialNuevo,
  TEXTOS_IMPORTAR_MATERIALES as T,
  TEXTOS_MATERIAL,
  type Material,
} from '../../src/materiales';
import { TEXTOS_CAPA } from '../../src/diseno/proyecto';

class Almacen {
  datos = new Map<string, string>();
  getItem(k: string) {
    return this.datos.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.datos.set(k, v);
  }
}

const lleno = (nombre: string): Material => ({
  nombre,
  corte: { potencia: '90', velocidad: '300', pasadas: '2' },
  grabado: { potencia: '30', velocidad: '3000', pasadas: '1', intervalo: '0.1' },
});
const archivo = (materiales: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ formato: 'chopilaser-materiales', version: 1, materiales, ...extra });
const error = (texto: string, existentes: string[] = []) => {
  const r = leerArchivoMateriales(texto, existentes);
  return r.ok ? null : r.error;
};

describe('materiales', () => {
  it('un material nuevo empieza con todos los ajustes vacíos (no se inventan valores)', () => {
    const m = materialNuevo('  MDF 3 mm ');
    expect(m.nombre).toBe('MDF 3 mm');
    expect(Object.values(m.corte).every((v) => v === '')).toBe(true);
    expect(Object.values(m.grabado).every((v) => v === '')).toBe(true);
  });

  it('nombre: vacío, largo y repetido (sin distinguir mayúsculas ni espacios)', () => {
    expect(errorNombreMaterial('  ', [])).toBe(TEXTOS_MATERIAL.nombreVacio);
    expect(errorNombreMaterial('x'.repeat(61), [])).toBe(TEXTOS_MATERIAL.nombreLargo);
    expect(errorNombreMaterial('x'.repeat(60), [])).toBeNull();
    expect(errorNombreMaterial(' mdf ', ['MDF'])).toBe(TEXTOS_MATERIAL.nombreRepetido);
  });

  it('ajuste: vacío del todo vale; a medias o fuera de rango no', () => {
    expect(errorAjuste('corte', { potencia: '', velocidad: '', pasadas: '' })).toBeNull();
    expect(errorAjuste('corte', { potencia: '50', velocidad: '', pasadas: '1' })).toBe(TEXTOS_CAPA.velocidad);
    expect(errorAjuste('grabado', { potencia: '50', velocidad: '100', pasadas: '1', intervalo: '' })).toBe(TEXTOS_CAPA.intervalo);
    expect(errorAjuste('grabado', lleno('a').grabado)).toBeNull();
    // Potencia de 1 a 100, como en las capas.
    expect(errorAjuste('corte', { potencia: '0', velocidad: '100', pasadas: '1' })).toBe('Potencia: escribe un número de 1 a 100.');
    expect(errorAjuste('corte', { potencia: '101', velocidad: '100', pasadas: '1' })).toBe('Potencia: escribe un número de 1 a 100.');
    expect(errorAjuste('corte', { potencia: '1', velocidad: '100', pasadas: '1' })).toBeNull();
  });

  it('guardar y leer en localStorage', () => {
    const s = new Almacen();
    expect(leerMateriales(s)).toEqual([]);
    escribirMateriales(s, [lleno('A')]);
    expect(leerMateriales(s)).toEqual([lleno('A')]);
    expect(materialesDanados(s)).toBe(false);
  });

  it('localStorage dañado: se avisa y se guarda una copia antes de sobrescribir', () => {
    const s = new Almacen();
    s.setItem(CLAVE_MATERIALES, '{roto');
    expect(materialesDanados(s)).toBe(true);
    expect(leerMateriales(s)).toEqual([]);
    escribirMateriales(s, [lleno('A')]);
    expect(s.getItem(CLAVE_MATERIALES_DANADOS)).toBe('{roto');
    expect(materialesDanados(s)).toBe(false);
  });

  it('exportar y volver a importar da lo mismo', () => {
    const texto = exportarMateriales([lleno('A'), materialNuevo('B')]);
    expect(texto.endsWith('\n')).toBe(true);
    expect(leerArchivoMateriales(texto)).toEqual({ ok: true, materiales: [lleno('A'), materialNuevo('B')] });
  });
});

describe('importar materiales: validación estricta', () => {
  it('JSON, formato, versión y lista', () => {
    expect(error('{')).toBe(T.error(T.noJson));
    expect(error(JSON.stringify({ formato: 'otro', version: 1, materiales: [] }))).toBe(T.error(T.formato));
    expect(error(archivo([lleno('A')], { extra: 1 }))).toBe(T.error(T.formato));
    expect(error(archivo([lleno('A')], { version: 2 }))).toBe(T.error(T.version));
    expect(error(archivo([]))).toBe(T.error(T.sinMateriales));
    const muchos = Array.from({ length: MAX_MATERIALES_ARCHIVO + 1 }, (_, i) => materialNuevo(`m${i}`));
    expect(error(archivo(muchos))).toBe(T.error(T.muchos));
  });

  it('el tamaño se mide en bytes (UTF-8), no en caracteres', () => {
    const relleno = 'ñ'.repeat(Math.ceil(MAX_BYTES_MATERIALES / 2));
    expect(relleno.length).toBeLessThan(MAX_BYTES_MATERIALES);
    expect(error(archivo([lleno('A')], { _r: relleno }))).toBe(T.error(T.grande));
  });

  it('acepta BOM al principio', () => {
    expect(leerArchivoMateriales('\uFEFF' + archivo([lleno('A')])).ok).toBe(true);
  });

  it('datos desconocidos, tipos y ajustes inválidos, con el número de material desde 1', () => {
    expect(error(archivo([lleno('A'), 5]))).toBe(T.error(T.noObjeto(2)));
    expect(error(archivo([{ ...lleno('A'), color: 'x' }]))).toBe(T.error(T.desconocido(1, 'color')));
    expect(error(archivo([{ ...lleno('A'), nombre: 3 }]))).toBe(T.error(T.noTexto(1, 'Nombre')));
    expect(error(archivo([{ ...lleno('A'), corte: { ...lleno('A').corte, intervalo: '1' } }]))).toBe(T.error(T.desconocido(1, 'corte.intervalo')));
    expect(error(archivo([{ ...lleno('A'), corte: { ...lleno('A').corte, potencia: 50 } }]))).toBe(T.error(T.noTexto(1, 'Corte: potencia')));
    expect(error(archivo([{ ...lleno('A'), grabado: { ...lleno('A').grabado, potencia: '150' } }]))).toBe(
      T.error(T.invalido(1, 'Grabado', TEXTOS_CAPA.potencia)),
    );
    expect(error(archivo([{ nombre: 'A', corte: lleno('A').corte }]))).toBe(T.error(T.noObjeto(1)));
  });

  it('nombres repetidos dentro del archivo o con los que ya hay', () => {
    expect(error(archivo([lleno('A'), lleno(' a ')]))).toBe(T.error(T.invalido(2, 'Nombre', TEXTOS_MATERIAL.nombreRepetido)));
    expect(error(archivo([lleno('Pino')]), ['PINO'])).toBe(T.error(T.invalido(1, 'Nombre', TEXTOS_MATERIAL.nombreRepetido)));
  });
});
