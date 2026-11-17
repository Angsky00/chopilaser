import { describe, expect, it } from 'vitest';
import {
  figuraDesdeTrazos,
  figuraFuera,
  figurasDesdeImportacion,
  sincronizarCapas,
  TEXTOS_CAPA,
  TEXTOS_EXPORTAR,
  trabajoDesdeProyecto,
  validarCapa,
  type CapaProyecto,
  type Figura,
  type Proyecto,
} from '../../src/diseno/proyecto';
import type { Trazo } from '../../src/diseno/geometria';

const cuadro = (x0: number, y0: number, l: number): Trazo => ({
  cerrado: true,
  puntos: [{ x: x0, y: y0 }, { x: x0 + l, y: y0 }, { x: x0 + l, y: y0 + l }, { x: x0, y: y0 + l }, { x: x0, y: y0 }],
});
const capa = (color: string, c: Partial<CapaProyecto> = {}): CapaProyecto => ({
  color,
  modo: 'corte',
  potencia: '50',
  velocidad: '600',
  pasadas: '1',
  intervalo: '',
  visible: true,
  salida: true,
  ...c,
});
const AREA = { ancho: 100, alto: 100 };

describe('validarCapa', () => {
  it('acepta una capa completa y da números', () => {
    const r = validarCapa(capa('#f00', { potencia: '12.5', velocidad: '1500', pasadas: '3' }));
    expect(r).toEqual({ ok: true, capa: { potencia: 12.5, velocidad: 1500, pasadas: 3, intervalo: 0 } });
  });
  it('rechaza cada campo fuera de rango con su texto', () => {
    const r = validarCapa(capa('#f00', { potencia: '101', velocidad: '0', pasadas: '1.5' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porCampo).toEqual({ potencia: TEXTOS_CAPA.potencia, velocidad: TEXTOS_CAPA.velocidad, pasadas: TEXTOS_CAPA.pasadas });
  });
  it('vacío no es válido (no hay valores por defecto inventados)', () => {
    expect(validarCapa(capa('#f00', { potencia: '', velocidad: '', pasadas: '' })).ok).toBe(false);
  });
  it('el intervalo solo cuenta en grabado', () => {
    expect(validarCapa(capa('#f00', { intervalo: 'x' })).ok).toBe(true);
    const g = validarCapa(capa('#f00', { modo: 'grabado', intervalo: '0' }));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.porCampo.intervalo).toBe(TEXTOS_CAPA.intervalo);
    expect(validarCapa(capa('#f00', { modo: 'grabado', intervalo: '0.1' })).ok).toBe(true);
  });
});

describe('figuras y capas', () => {
  it('importación que cabe se queda en su sitio; si no cabe, se lleva a (0,0)', () => {
    const imp = (x: number) => ({ figuras: [{ color: '#ff0000', trazos: [cuadro(x, 10, 10)] }], avisos: [] });
    expect(figurasDesdeImportacion(imp(20), AREA)[0].x).toBe(25);
    const lejos = figurasDesdeImportacion(imp(-40), AREA)[0];
    expect([lejos.x, lejos.y]).toEqual([5, 5]);
  });
  it('sincronizarCapas conserva las capas existentes, quita las vacías y crea las nuevas', () => {
    const f = [figuraDesdeTrazos('#f00', [cuadro(0, 0, 1)]), figuraDesdeTrazos('#00f', [cuadro(0, 0, 1)])];
    const vieja = capa('#f00', { potencia: '77' });
    const r = sincronizarCapas(f, [capa('#0f0'), vieja], (c) => capa(c, { potencia: '' }));
    expect(r.map((c) => c.color)).toEqual(['#f00', '#00f']);
    expect(r[0]).toBe(vieja);
    expect(r[1].potencia).toBe('');
  });
  it('figuraFuera mira el área tras redondear a milésimas', () => {
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(90, 90, 10)]), AREA)).toBe(false);
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(90.0004, 0, 10)]), AREA)).toBe(false);
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(90.001, 0, 10)]), AREA)).toBe(true);
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(-0.001, 0, 10)]), AREA)).toBe(true);
  });
});

describe('trabajoDesdeProyecto', () => {
  const rojo = figuraDesdeTrazos('#f00', [cuadro(10, 10, 40), cuadro(20, 20, 5)], 'r');
  const negro = figuraDesdeTrazos('#000', [cuadro(60, 60, 10)], 'n');
  const base = (c: Partial<Proyecto> = {}): Proyecto => ({
    material: 'Prueba',
    figuras: [rojo, negro],
    capas: [capa('#f00'), capa('#000', { modo: 'grabado', potencia: '30', intervalo: '1' })],
    ...c,
  });

  it('grabado (M4) antes que corte (M3); dentro del corte, el trazo pequeño primero', () => {
    const r = trabajoDesdeProyecto(base(), AREA);
    if (!r.ok) throw new Error(r.error);
    expect(r.trabajo.capas.map((c) => c.capa.modo)).toEqual(['M4', 'M3']);
    expect(r.trabajo.capas[0].trayectorias).toHaveLength(10);
    const corte = r.trabajo.capas[1].trayectorias;
    expect(corte[0][0]).toEqual({ x: 20, y: 20 });
    expect(corte[1][0]).toEqual({ x: 10, y: 10 });
  });

  it('sin capas con salida no hay nada que exportar', () => {
    const r = trabajoDesdeProyecto(base({ capas: [capa('#f00', { salida: false }), capa('#000', { visible: false })] }), AREA);
    expect(r).toEqual({ ok: false, error: TEXTOS_EXPORTAR.sinFiguras, fuera: [] });
    expect(trabajoDesdeProyecto(base({ figuras: [] }), AREA).ok).toBe(false);
  });

  it('una figura fuera del área bloquea la exportación y se señala', () => {
    const fuera: Figura = { ...negro, x: 99 };
    const r = trabajoDesdeProyecto(base({ figuras: [rojo, fuera] }), AREA);
    expect(r).toEqual({ ok: false, error: TEXTOS_EXPORTAR.fuera(1), fuera: ['n'] });
  });

  it('una figura fuera en una capa sin salida no bloquea', () => {
    const fuera: Figura = { ...negro, x: 99 };
    const r = trabajoDesdeProyecto(base({ figuras: [rojo, fuera], capas: [capa('#f00'), capa('#000', { salida: false })] }), AREA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trabajo.capas).toHaveLength(1);
  });

  it('una capa incompleta bloquea con su número (desde 1)', () => {
    const r = trabajoDesdeProyecto(base({ capas: [capa('#f00'), capa('#000', { potencia: '' })] }), AREA);
    expect(r).toEqual({ ok: false, error: TEXTOS_EXPORTAR.capaIncompleta(2), fuera: [] });
  });

  it('los trazos abiertos no se rellenan en grabado', () => {
    const linea = figuraDesdeTrazos('#000', [{ cerrado: false, puntos: [{ x: 1, y: 1 }, { x: 9, y: 9 }] }]);
    const r = trabajoDesdeProyecto({ material: '', figuras: [linea], capas: [capa('#000', { modo: 'grabado', intervalo: '1' })] }, AREA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trabajo.capas[0].trayectorias).toEqual([]);
  });

  it('el giro de la figura se aplica a las coordenadas que van al generador', () => {
    const g: Figura = { ...rojo, angulo: 90 };
    const r = trabajoDesdeProyecto(base({ figuras: [g], capas: [capa('#f00')] }), AREA);
    if (!r.ok) throw new Error(r.error);
    const p = r.trabajo.capas[0].trayectorias[1][0];
    expect(p.x).toBeCloseTo(50, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });
});
